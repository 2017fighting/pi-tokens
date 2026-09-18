import { describe, expect, it } from "vitest";
import { localDayKey } from "./session-tokens.js";

/**
 * Day bucketing is local-time, not UTC. These tests pin the behavior that
 * matters: a timestamp late in the UTC day must not land on the next local day.
 * The machine running the suite may be in any timezone, so expectations are
 * computed from the same Date APIs rather than hardcoded.
 */
describe("localDayKey", () => {
  it("formats as zero-padded YYYY-MM-DD", () => {
    // Local noon on a single-digit month and day.
    const date = new Date(2026, 0, 5, 12, 0, 0);
    expect(localDayKey(date)).toBe("2026-01-05");
  });

  it("uses local time, not UTC", () => {
    const date = new Date(2026, 8, 10, 23, 30, 0);
    expect(localDayKey(date)).toBe("2026-09-10");

    // The same instant, expressed in UTC, may be a different calendar day.
    // Whatever the offset is, the local key must match the local date.
    const localY = date.getFullYear();
    const localM = String(date.getMonth() + 1).padStart(2, "0");
    const localD = String(date.getDate()).padStart(2, "0");
    expect(localDayKey(date)).toBe(`${localY}-${localM}-${localD}`);
  });

  it("does not bucket by UTC when the local day has advanced past UTC midnight", () => {
    // Pick an instant that is a different UTC day from the local day whenever
    // the machine's offset is non-zero; if offset is zero they agree and the
    // assertion is trivially true, which is still correct.
    const date = new Date(2026, 8, 10, 0, 30, 0);
    const utcKey = date.toISOString().slice(0, 10);
    const localKey = localDayKey(date);
    expect(localKey).toBe("2026-09-10");
    if (utcKey !== "2026-09-10") {
      expect(localKey).not.toBe(utcKey);
    }
  });

  it("handles both ends of a day", () => {
    expect(localDayKey(new Date(2026, 8, 10, 0, 0, 0))).toBe("2026-09-10");
    expect(localDayKey(new Date(2026, 8, 10, 23, 59, 59))).toBe("2026-09-10");
  });
});
