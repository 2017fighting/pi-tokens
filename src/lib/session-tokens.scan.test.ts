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
  costTotal?: number;
}): string {
  const {
    provider = "anthropic",
    model = "claude-sonnet-4",
    input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0,
    totalTokens,
    costTotal = 0,
  } = overrides;
  return JSON.stringify({
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
        cost: { total: costTotal },
      },
    },
  });
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
    expect(result.totals.costTotal).toBe(0);
    expect(result.byModel).toEqual([]);
    expect(result.byProvider).toEqual([]);
    expect(result.bySession).toEqual([]);
  });

  it("sums token buckets and cost across messages", async () => {
    writeSession("--root-proj--", "a.jsonl", [
      sessionHeader({
        id: "s1",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 100, output: 200, costTotal: 0.01 }),
      assistantMessage({ input: 50, output: 25, costTotal: 0.02 }),
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
      costTotal: 0.03,
    });
  });

  it("aggregates per model and per provider, sorted by cost", async () => {
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
        costTotal: 0.5,
      }),
      assistantMessage({
        provider: "openai",
        model: "gpt-5",
        input: 20,
        costTotal: 2.0,
      }),
      assistantMessage({
        provider: "anthropic",
        model: "claude-sonnet-4",
        input: 30,
        costTotal: 0.25,
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
    expect(anthropic.tokens.costTotal).toBeCloseTo(0.75);

    expect(result.byProvider.map((p) => p.provider)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(result.byProvider[1].messageCount).toBe(2);
    expect(result.byProvider[1].tokens.costTotal).toBeCloseTo(0.75);
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
    expect(result.totals.costTotal).toBe(0);
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
      assistantMessage({ input: 1, output: 1, costTotal: 0.01 }),
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
      assistantMessage({ input: 7, output: 3, costTotal: 0.04 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.messageCount).toBe(1);
    expect(result.totals.input).toBe(7);
  });

  it("carries the session name and sorts sessions by cost", async () => {
    writeSession("--root-proj--", "cheap.jsonl", [
      sessionHeader({
        id: "cheap",
        cwd: "/root/proj",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      sessionInfo("cheap session"),
      assistantMessage({ input: 1, costTotal: 0.01 }),
    ]);
    writeSession("--root-proj--", "pricey.jsonl", [
      sessionHeader({
        id: "pricey",
        cwd: "/root/proj",
        timestamp: "2026-09-02T00:00:00.000Z",
      }),
      assistantMessage({ input: 1, costTotal: 9.99 }),
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
      assistantMessage({ input: 100, costTotal: 1 }),
    ]);
    writeSession("--root-b--", "b.jsonl", [
      sessionHeader({
        id: "b",
        cwd: "/root/b",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
      assistantMessage({ input: 5, costTotal: 0.5 }),
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
      assistantMessage({ input: 100, costTotal: 1 }),
    ]);
    writeSession("--root-proj--", "new.jsonl", [
      sessionHeader({
        id: "new",
        cwd: "/root/proj",
        timestamp: "2026-09-10T00:00:00.000Z",
      }),
      assistantMessage({ input: 10, costTotal: 0.1 }),
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
      assistantMessage({ input: 10, costTotal: 1 }),
    ]);
    writeSession("--root-proj--", "b.jsonl", [
      sessionHeader({
        id: "b",
        cwd: "/root/proj",
        timestamp: "2026-09-02T00:00:00.000Z",
      }),
      assistantMessage({ input: 20, costTotal: 2 }),
    ]);

    const result = await aggregateAllSessions({ limit: 1 });
    expect(result.sessionCount).toBe(2);
    expect(result.bySession).toHaveLength(1);
    expect(result.bySession[0].sessionId).toBe("b");
    expect(result.totals.costTotal).toBe(3);
  });

  it("aggregates across more files than the batch concurrency", async () => {
    for (let i = 0; i < 40; i++) {
      writeSession("--root-proj--", `s${i}.jsonl`, [
        sessionHeader({
          id: `s${i}`,
          cwd: "/root/proj",
          timestamp: "2026-09-01T00:00:00.000Z",
        }),
        assistantMessage({ input: 1, output: 1, costTotal: 0.01 }),
      ]);
    }

    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(40);
    expect(result.messageCount).toBe(40);
    expect(result.totals.input).toBe(40);
    expect(result.totals.costTotal).toBeCloseTo(0.4);
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
      assistantMessage({ input: 3, costTotal: 0.01 }),
    ]);

    const result = await aggregateAllSessions();
    expect(result.sessionCount).toBe(1);
  });
});
