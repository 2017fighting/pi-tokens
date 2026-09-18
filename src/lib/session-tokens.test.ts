import { describe, expect, it } from "vitest";
import {
  addBuckets,
  emptyBuckets,
  formatCost,
  formatNumber,
  formatTokenSummary,
  type TokenBuckets,
} from "./session-tokens.js";

describe("emptyBuckets", () => {
  it("returns all zeros", () => {
    const b = emptyBuckets();
    expect(b.input).toBe(0);
    expect(b.output).toBe(0);
    expect(b.cacheRead).toBe(0);
    expect(b.cacheWrite).toBe(0);
    expect(b.totalTokens).toBe(0);
    expect(b.costTotal).toBe(0);
  });
});

describe("addBuckets", () => {
  it("sums two bucket sets", () => {
    const a: TokenBuckets = {
      input: 100,
      output: 200,
      cacheRead: 50,
      cacheWrite: 25,
      totalTokens: 375,
      costTotal: 0.05,
    };
    const b: TokenBuckets = {
      input: 300,
      output: 400,
      cacheRead: 100,
      cacheWrite: 75,
      totalTokens: 875,
      costTotal: 0.15,
    };
    const result = addBuckets(a, b);
    expect(result.input).toBe(400);
    expect(result.output).toBe(600);
    expect(result.cacheRead).toBe(150);
    expect(result.cacheWrite).toBe(100);
    expect(result.totalTokens).toBe(1250);
    expect(result.costTotal).toBe(0.2);
  });

  it("handles empty buckets", () => {
    const a = emptyBuckets();
    const b: TokenBuckets = {
      input: 100,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100,
      costTotal: 0.01,
    };
    const result = addBuckets(a, b);
    expect(result).toEqual(b);
  });
});

describe("formatNumber", () => {
  it("formats small numbers directly", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats thousands with commas", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(12345)).toBe("12.3K");
  });

  it("formats millions", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
    expect(formatNumber(5_500_000)).toBe("5.5M");
  });
});

describe("formatCost", () => {
  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small costs", () => {
    expect(formatCost(0.005)).toBe("<$0.01");
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.23)).toBe("$1.23");
  });

  it("formats large costs", () => {
    expect(formatCost(1000)).toBe("$1.0K");
    expect(formatCost(1234.56)).toBe("$1.2K");
  });
});

describe("formatTokenSummary", () => {
  it("formats full token breakdown", () => {
    const tokens: TokenBuckets = {
      input: 50000,
      output: 10000,
      cacheRead: 5000,
      cacheWrite: 2000,
      totalTokens: 67000,
      costTotal: 0.45,
    };
    const result = formatTokenSummary(tokens);
    expect(result).toContain("50.0K in");
    expect(result).toContain("10.0K out");
    expect(result).toContain("5,000 cached");
    expect(result).toContain("$0.45");
  });

  it("omits zero fields", () => {
    const tokens: TokenBuckets = {
      input: 1000,
      output: 500,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1500,
      costTotal: 0,
    };
    const result = formatTokenSummary(tokens);
    expect(result).toContain("in");
    expect(result).toContain("out");
    expect(result).not.toContain("cached");
    expect(result).not.toContain("$");
  });

  it("handles empty buckets", () => {
    const result = formatTokenSummary(emptyBuckets());
    expect(result).toBe("");
  });
});
