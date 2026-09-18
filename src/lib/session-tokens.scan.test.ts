import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateAllSessions } from "./session-tokens.js";

/**
 * The scanner reads session files from `$PI_CODING_AGENT_DIR/sessions/<project>/<file>.jsonl`.
 * These tests point that env var at a temp tree so the aggregation logic is exercised
 * without touching the real session store.
 */

function sessionHeader(overrides: {
  id: string;
  cwd: string;
  timestamp: string;
}): string {
  return JSON.stringify({ type: "session", ...overrides });
}

function assistantMessage(overrides: {
  provider?: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  /** Entry timestamp. Omit to test the session-date fallback. */
  timestamp?: string;
}): string {
  const {
    provider = "anthropic",
    model = "claude-sonnet-4",
    input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0,
    totalTokens,
    timestamp,
  } = overrides;
  const entry: Record<string, unknown> = {
    type: "message",
    message: {
      role: "assistant",
      provider,
      model,
      usage: {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: totalTokens ?? input + output + cacheRead + cacheWrite,
      },
    },
  };
  if (timestamp !== undefined) entry.timestamp = timestamp;
  return JSON.stringify(entry);
}

function sessionInfo(name: string): string {
  return JSON.stringify({ type: "session_info", name });
}

let agentDir: string;

function writeSession(
  projectDir: string,
  fileName: string,
  lines: string[],
): string {
  const dir = join(agentDir, "sessions", projectDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-tokens-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

describe("aggregateAllSessions", () => {
  it("returns empty totals when the sessions directory is missing", async () => {
    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(0);
    expect(result.messageCount).toBe(0);
    expect(result.totals.totalTokens).toBe(0);
    expect(result.totals.totalTokens).toBe(0);
    expect(result.byModel).toEqual([]);
    expect(result.byProvider).toEqual([]);
    expect(result.bySession).toEqual([]);
  });

  it("sums token buckets across messages", async () => {
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "s1",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 100, output: 200, totalTokens: 300 }),
      assistantMessage({ input: 50, output: 25, totalTokens: 75 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(1);
    expect(result.messageCount).toBe(2);
    expect(result.totals).toEqual({
      input: 150,
      output: 225,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 375,
    });
  });

  it("aggregates per model and per provider, sorted by tokens", async () => {
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "s1",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({
        provider: "anthropic",
        model: "claude-sonnet-4",
        input: 10,
        totalTokens: 250,
      }),
      assistantMessage({
        provider: "openai",
        model: "gpt-5",
        input: 20,
        totalTokens: 2000,
      }),
      assistantMessage({
        provider: "anthropic",
        model: "claude-sonnet-4",
        input: 30,
        totalTokens: 125,
      }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.byModel.map((m) => `${m.provider}/${m.model}`)).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet-4",
    ]);

    const anthropic = result.byModel[1];
    expect(anthropic.messageCount).toBe(2);
    expect(anthropic.tokens.input).toBe(40);
    expect(anthropic.tokens.totalTokens).toBe(375);

    expect(result.byProvider.map((p) => p.provider)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(result.byProvider[1].messageCount).toBe(2);
    expect(result.byProvider[1].tokens.totalTokens).toBe(375);
  });

  it("falls back to unknown provider and model", async () => {
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "s1",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 5, output: 5, totalTokens: 10 },
        },
      }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.byModel[0].provider).toBe("unknown");
    expect(result.byModel[0].model).toBe("unknown");
    expect(result.totals.totalTokens).toBe(10);
    expect(result.byModel[0].tokens.totalTokens).toBe(10);
  });

  it("skips files with no assistant usage and non-message entries", async () => {
    writeSession("--root-proj--", "no-usage.jsonl", [
      sessionHeader({
        id: "s1",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      JSON.stringify({ type: "message", message: { role: "user" } }),
      JSON.stringify({ type: "message", message: { role: "assistant" } }),
      sessionInfo("named session"),
    ]);
    writeSession("--root-other--", "with-usage.jsonl", [
      sessionHeader({
        id: "s2",
        cwd: "/root/other",
        timestamp: "2026-09-02T00:00:00.000Z",
      }),
      assistantMessage({ input: 1, output: 1, totalTokens: 10 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(1);
    expect(result.bySession[0].sessionId).toBe("s2");
  });

  it("tolerates malformed JSONL lines", async () => {
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "s1",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      "{not json",
      "",
      assistantMessage({ input: 7, output: 3, totalTokens: 40 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.messageCount).toBe(1);
    expect(result.totals.input).toBe(7);
  });

  it("carries the session name and sorts sessions by tokens", async () => {
    writeSession("--root-proj--", "cheap.jsonl", [
      sessionHeader({
        id: "cheap",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      sessionInfo("cheap session"),
      assistantMessage({ input: 1, totalTokens: 10 }),
    ]);
    writeSession("--root-proj--", "pricey.jsonl", [
      sessionHeader({
        id: "pricey",
        cwd: "/root/proj",
        timestamp: "2026-09-02T00:00:00.000Z",
      }),
      assistantMessage({ input: 1, totalTokens: 9990 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.bySession.map((s) => s.sessionId)).toEqual([
      "pricey",
      "cheap",
    ]);
    expect(result.bySession[1].name).toBe("cheap session");
    expect(result.bySession[1].cwd).toBe("/root/proj");
    expect(result.bySession[0].created.toISOString()).toBe(
      "2026-09-02T00:00:00.000Z",
    );
    expect(result.bySession[0].sessionPath).toContain("pricey.jsonl");
  });

  it("filters by cwd", async () => {
    writeSession("--root-a--", "a.jsonl", [
      sessionHeader({
        id: "a",
        cwd: "/root/a",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 100, totalTokens: 1000 }),
    ]);
    writeSession("--root-b--", "b.jsonl", [
      sessionHeader({
        id: "b",
        cwd: "/root/b",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 5, totalTokens: 500 }),
    ]);

    const result = await aggregateAllSessions({ cwd: "/root/a" });
    expect(result.sessionCount).toBe(1);
    expect(result.totals.input).toBe(100);
    expect(result.bySession[0].sessionId).toBe("a");
  });

  it("filters by since and until", async () => {
    writeSession("--root-proj--", "old.jsonl", [
      sessionHeader({
        id: "old",
        cwd: "/root/proj",
        timestamp: "2026-08-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 100, totalTokens: 1000 }),
    ]);
    writeSession("--root-proj--", "new.jsonl", [
      sessionHeader({
        id: "new",
        cwd: "/root/proj",
        timestamp: "2026-09-10T00:00:00.000Z",
      }),
      assistantMessage({ input: 10, totalTokens: 100 }),
    ]);

    const since = await aggregateAllSessions({
      since: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(since.bySession.map((s) => s.sessionId)).toEqual(["new"]);

    const until = await aggregateAllSessions({
      until: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(until.bySession.map((s) => s.sessionId)).toEqual(["old"]);
  });

  it("limits bySession without changing totals", async () => {
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "a",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 10, totalTokens: 1000 }),
    ]);
    writeSession("--root-proj--", "b.jsonl", [
      sessionHeader({
        id: "b",
        cwd: "/root/proj",
        timestamp: "2026-09-02T00:00:00.000Z",
      }),
      assistantMessage({ input: 20, totalTokens: 2000 }),
    ]);

    const result = await aggregateAllSessions({ limit: 1 });
    expect(result.sessionCount).toBe(2);
    expect(result.bySession).toHaveLength(1);
    expect(result.bySession[0].sessionId).toBe("b");
    expect(result.totals.totalTokens).toBe(3000);
  });

  it("aggregates across more files than the batch concurrency", async () => {
    for (let i = 0; i < 40; i++) {
      writeSession("--root-proj--", `s${i}.jsonl`, [
        sessionHeader({
          id: `s${i}`,
          cwd: "/root/proj",
          timestamp: "2026-09-01T00:00:00.000Z",
        }),
        assistantMessage({ input: 1, output: 1, totalTokens: 10 }),
      ]);
    }

    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(40);
    expect(result.messageCount).toBe(40);
    expect(result.totals.input).toBe(40);
    expect(result.totals.totalTokens).toBe(400);
  });

  it("ignores non-jsonl files in a project directory", async () => {
    const dir = join(agentDir, "sessions", "--root-proj--");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not a session", "utf8");
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "a",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 3, totalTokens: 10 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(1);
  });

  it("returns an empty byDay when there is no usage", async () => {
    const result = await aggregateAllSessions();
    expect(result.byDay).toEqual([]);
  });

  describe("byDay", () => {
    // Local-time expectations: build the expected day key from the same local
    // Date APIs, so this passes in any machine timezone.
    const localKey = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;

    it("buckets messages by the day of their entry timestamp", async () => {
      writeSession("--root-proj--", "a.jsonl", [
        sessionHeader({
          id: "s1",
          cwd: "/root/proj",
          timestamp: "2026-09-01T00:00:00.000Z",
        }),
        assistantMessage({
          input: 100,
          totalTokens: 1000,
          timestamp: "2026-09-01T12:00:00.000Z",
        }),
        assistantMessage({
          input: 200,
          totalTokens: 2000,
          timestamp: "2026-09-04T12:00:00.000Z",
        }),
        assistantMessage({
          input: 300,
          totalTokens: 3000,
          timestamp: "2026-09-04T13:00:00.000Z",
        }),
      ]);

      const result = await aggregateAllSessions();
      const dFirst = localKey(new Date("2026-09-01T12:00:00.000Z"));
      const dSecond = localKey(new Date("2026-09-04T12:00:00.000Z"));

      // Newest day first. Both 09-04 timestamps are hours apart but share a
      // local day, so they must land in the same bucket.
      expect(dSecond).not.toBe(dFirst);
      expect(result.byDay.map((d) => d.date)).toEqual([dSecond, dFirst]);

      const second = result.byDay[0];
      expect(second.messageCount).toBe(2);
      expect(second.tokens.input).toBe(500);
      expect(second.tokens.totalTokens).toBe(5000);
      expect(result.byDay[1].tokens.totalTokens).toBe(1000);
    });

    it("splits a UTC day across local days when the offset shifts it", async () => {
      // 18:00Z is 02:00 the next day in UTC+8 and still the same day in UTC.
      // Wherever this runs, the local key must match localDate's own notion of
      // the date, which is what the component displays.
      const late = new Date("2026-09-02T18:00:00.000Z");
      writeSession("--root-proj--", "a.jsonl", [
        sessionHeader({
          id: "s1",
          cwd: "/root/proj",
          timestamp: "2026-09-02T00:00:00.000Z",
        }),
        assistantMessage({
          input: 1,
          totalTokens: 1000,
          timestamp: "2026-09-02T00:00:00.000Z",
        }),
        assistantMessage({
          input: 1,
          totalTokens: 2000,
          timestamp: late.toISOString(),
        }),
      ]);

      const result = await aggregateAllSessions();
      const earlyKey = localKey(new Date("2026-09-02T00:00:00.000Z"));
      const lateKey = localKey(late);

      if (earlyKey === lateKey) {
        expect(result.byDay).toHaveLength(1);
        expect(result.byDay[0].tokens.totalTokens).toBe(3000);
      } else {
        expect(result.byDay.map((d) => d.date).sort()).toEqual(
          [earlyKey, lateKey].sort(),
        );
        const lateBucket = result.byDay.find((d) => d.date === lateKey);
        expect(lateBucket?.tokens.totalTokens).toBe(2000);
      }
    });

    it("keeps day totals consistent with the overall totals", async () => {
      writeSession("--root-proj--", "a.jsonl", [
        sessionHeader({
          id: "s1",
          cwd: "/root/proj",
          timestamp: "2026-09-01T00:00:00.000Z",
        }),
        assistantMessage({
          input: 10,
          totalTokens: 500,
          timestamp: "2026-09-01T01:00:00.000Z",
        }),
        assistantMessage({
          input: 20,
          totalTokens: 1500,
          timestamp: "2026-09-03T01:00:00.000Z",
        }),
      ]);

      const result = await aggregateAllSessions();
      const dayTokens = result.byDay.reduce(
        (sum, d) => sum + d.tokens.totalTokens,
        0,
      );
      const dayMessages = result.byDay.reduce(
        (sum, d) => sum + d.messageCount,
        0,
      );
      expect(dayTokens).toBe(result.totals.totalTokens);
      expect(dayMessages).toBe(result.messageCount);
    });

    it("sorts each day's providers by tokens descending", async () => {
      writeSession("--root-proj--", "a.jsonl", [
        sessionHeader({
          id: "s1",
          cwd: "/root/proj",
          timestamp: "2026-09-01T00:00:00.000Z",
        }),
        assistantMessage({
          provider: "cheap",
          input: 1,
          totalTokens: 100,
          timestamp: "2026-09-01T01:00:00.000Z",
        }),
        assistantMessage({
          provider: "pricey",
          input: 1,
          totalTokens: 3000,
          timestamp: "2026-09-01T02:00:00.000Z",
        }),
        assistantMessage({
          provider: "cheap",
          input: 1,
          totalTokens: 200,
          timestamp: "2026-09-01T03:00:00.000Z",
        }),
      ]);

      const result = await aggregateAllSessions();
      const day = result.byDay[0];
      expect(day.byProvider.map((p) => p.provider)).toEqual(["pricey", "cheap"]);
      expect(day.byProvider[1].messageCount).toBe(2);
      // "cheap" has two messages: 100 + 200.
      expect(day.byProvider[1].tokens.totalTokens).toBe(300);
    });

    it("merges the same day across multiple sessions and projects", async () => {
      writeSession("--root-a--", "a.jsonl", [
        sessionHeader({
          id: "a",
          cwd: "/root/a",
          timestamp: "2026-09-05T00:00:00.000Z",
        }),
        assistantMessage({
          provider: "anthropic",
          input: 1,
          totalTokens: 1000,
          timestamp: "2026-09-05T12:00:00.000Z",
        }),
      ]);
      writeSession("--root-b--", "b.jsonl", [
        sessionHeader({
          id: "b",
          cwd: "/root/b",
          timestamp: "2026-09-05T00:00:00.000Z",
        }),
        assistantMessage({
          provider: "openai",
          input: 1,
          totalTokens: 2000,
          timestamp: "2026-09-05T13:00:00.000Z",
        }),
      ]);

      const result = await aggregateAllSessions();
      expect(result.byDay).toHaveLength(1);
      expect(result.byDay[0].tokens.totalTokens).toBe(3000);
      expect(result.byDay[0].messageCount).toBe(2);
      expect(result.byDay[0].byProvider).toHaveLength(2);
    });

    it("falls back to the session date when an entry has no timestamp", async () => {
      writeSession("--root-proj--", "a.jsonl", [
        sessionHeader({
          id: "s1",
          cwd: "/root/proj",
          timestamp: "2026-09-07T00:00:00.000Z",
        }),
        // No entry timestamp: attributed to the session start date.
        assistantMessage({ input: 5, totalTokens: 250 }),
      ]);

      const result = await aggregateAllSessions();
      expect(result.byDay).toHaveLength(1);
      expect(result.byDay[0].date).toBe(localKey(new Date("2026-09-07T00:00:00.000Z")));
      expect(result.byDay[0].tokens.totalTokens).toBe(250);
    });

    it("includes days in the project scope filter", async () => {
      writeSession("--root-a--", "a.jsonl", [
        sessionHeader({
          id: "a",
          cwd: "/root/a",
          timestamp: "2026-09-01T00:00:00.000Z",
        }),
        assistantMessage({
          input: 1,
          totalTokens: 9000,
          timestamp: "2026-09-01T01:00:00.000Z",
        }),
      ]);
      writeSession("--root-b--", "b.jsonl", [
        sessionHeader({
          id: "b",
          cwd: "/root/b",
          timestamp: "2026-09-02T00:00:00.000Z",
        }),
        assistantMessage({
          input: 1,
          totalTokens: 1000,
          timestamp: "2026-09-02T01:00:00.000Z",
        }),
      ]);

      const scoped = await aggregateAllSessions({ cwd: "/root/a" });
      expect(scoped.byDay).toHaveLength(1);
      expect(scoped.byDay[0].tokens.totalTokens).toBe(9000);

      const all = await aggregateAllSessions();
      expect(all.byDay).toHaveLength(2);
      expect(all.byDay.reduce((s, d) => s + d.tokens.totalTokens, 0)).toBe(10000);
    });
  });
});
