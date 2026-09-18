import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { TokensComponent } from "./tokens-display.js";
import type { AggregateResult, TokenBuckets } from "../../lib/session-tokens.js";

/**
 * Render smoke tests for the `/tokens` view.
 *
 * They cannot drive the real TUI, so they assert what the component does with
 * state: that rendering at awkward widths neither throws nor overflows, that
 * every tab renders, that rows are ordered by tokens, and that key handling
 * reports the keys it consumes.
 */

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const tui = { requestRender: () => {} };

function buckets(overrides: Partial<TokenBuckets> = {}): TokenBuckets {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    ...overrides,
  };
}

const emptyResult: AggregateResult = {
  totals: buckets(),
  byModel: [],
  byProvider: [],
  bySession: [],
  byDay: [],
  sessionCount: 0,
  messageCount: 0,
};

const loadedResult: AggregateResult = {
  totals: buckets({
    input: 1_234_567,
    output: 456_789,
    cacheRead: 12_345,
    cacheWrite: 6_789,
    totalTokens: 1_710_490,
  }),
  byModel: [
    {
      provider: "anthropic",
      model: "claude-sonnet-4-with-a-very-long-model-name",
      tokens: buckets({
        input: 1_000_000,
        output: 400_000,
        cacheRead: 15_000,
        totalTokens: 1_415_000,
      }),
      messageCount: 120,
    },
    {
      provider: "openai",
      model: "gpt-5",
      tokens: buckets({
        input: 234_567,
        output: 56_789,
        cacheRead: 4_134,
        totalTokens: 295_490,
      }),
      messageCount: 30,
    },
  ],
  byProvider: [
    {
      provider: "anthropic",
      tokens: buckets({
        input: 1_000_000,
        output: 400_000,
        cacheRead: 15_000,
        totalTokens: 1_415_000,
      }),
      messageCount: 120,
    },
    {
      provider: "openai",
      tokens: buckets({
        input: 234_567,
        output: 56_789,
        cacheRead: 4_134,
        totalTokens: 295_490,
      }),
      messageCount: 30,
    },
  ],
  bySession: [
    {
      sessionId: "01a05b11-dd5b-7004-958d-04daa15ad81c",
      sessionPath: "/tmp/sessions/--root-proj--/pricey.jsonl",
      cwd: "/root/proj",
      name: "pricey session",
      created: new Date(2026, 8, 10, 12, 0, 0),
      tokens: buckets({
        input: 900_000,
        output: 300_000,
        cacheRead: 15_000,
        totalTokens: 1_215_000,
      }),
      messageCount: 110,
    },
    {
      sessionId: "01a05b11-dd5b-7004-958d-04daa15ad81d",
      sessionPath: "/tmp/sessions/--root-proj--/cheap.jsonl",
      cwd: "/root/proj",
      created: new Date(2026, 8, 1, 12, 0, 0),
      tokens: buckets({
        input: 100_000,
        output: 100_000,
        totalTokens: 200_000,
      }),
      messageCount: 20,
    },
  ],
  sessionCount: 5,
  messageCount: 150,
  byDay: [
    {
      date: "2026-09-10",
      tokens: buckets({
        input: 900_000,
        output: 300_000,
        cacheRead: 15_000,
        totalTokens: 1_215_000,
      }),
      messageCount: 110,
      byProvider: [
        {
          provider: "anthropic",
          tokens: buckets({
            input: 900_000,
            output: 300_000,
            cacheRead: 15_000,
            totalTokens: 1_215_000,
          }),
          messageCount: 110,
        },
      ],
    },
    {
      date: "2026-09-01",
      tokens: buckets({
        input: 100_000,
        output: 100_000,
        totalTokens: 200_000,
      }),
      messageCount: 20,
      byProvider: [
        {
          provider: "openai",
          tokens: buckets({
            input: 100_000,
            output: 100_000,
            totalTokens: 200_000,
          }),
          messageCount: 20,
        },
      ],
    },
  ],
};

interface Harness {
  component: TokensComponent;
  closed: () => boolean;
  refetches: () => number;
  scopes: string[];
}

function createComponent(scope?: "project" | "all"): Harness {
  let closed = false;
  let refetches = 0;
  const scopes: string[] = [];
  const component = new TokensComponent(
    theme,
    tui,
    () => {
      closed = true;
    },
    () => {
      refetches++;
    },
    (next) => {
      scopes.push(next);
    },
    { scope },
  );
  return {
    component,
    closed: () => closed,
    refetches: () => refetches,
    scopes,
  };
}

const WIDTHS = [20, 40, 80, 120, 200];
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("TokensComponent", () => {
  it("renders the loading state at every width", () => {
    const { component } = createComponent();
    for (const width of WIDTHS) {
      const lines = component.render(width);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toContain("Token Usage");
      for (const line of lines) {
        expect(line).not.toContain("\n");
      }
    }
    component.destroy();
  });

  it("renders every tab with data, including empty results", () => {
    const { component } = createComponent();

    for (const result of [loadedResult, emptyResult]) {
      component.setState({ type: "loaded", result });
      for (const tab of ["1", "2", "3", "4"]) {
        component.handleInput(tab);
        for (const width of WIDTHS) {
          const lines = component.render(width);
          const output = lines.join("\n");
          expect(output).toContain("Token Usage");
          expect(output).toContain("pi-tokens v");
          expect(lines.length).toBeGreaterThan(5);
        }
      }
    }
    component.destroy();
  });

  it("keeps every rendered line within the requested width", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });

    for (const tab of ["1", "2", "3", "4"]) {
      component.handleInput(tab);
      for (const extra of ["", "v"]) {
        if (extra) component.handleInput(extra);
        for (const width of [20, 30, 45, 60, 80]) {
          for (const line of component.render(width)) {
            // ANSI sequences added by truncateToWidth occupy no columns.
            expect(line.replace(ansi, "").length).toBeLessThanOrEqual(width);
          }
        }
      }
    }
    component.destroy();
  });

  it("shows token totals and no currency", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });

    const output = component.render(120).join("\n");
    expect(output).toContain("Total tokens");
    expect(output).toContain("1.7M");
    expect(output).toContain("Non-cache tokens");
    expect(output).not.toContain("$");
    component.destroy();
  });

  it("renders daily rows with tokens and a cumulative total", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });
    component.handleInput("4");

    const output = component.render(200).join("\n");
    expect(output).toContain("2026-09-10");
    expect(output).toContain("2026-09-01");
    // Newest day first.
    expect(output.indexOf("2026-09-10")).toBeLessThan(
      output.indexOf("2026-09-01"),
    );
    // Cumulative runs oldest -> newest: 200.0K then 1.4M.
    expect(output).toContain("→ 200.0K");
    expect(output).toContain("→ 1.4M");
    expect(output).toContain("grand total 1.4M tokens");
    expect(output).not.toContain("$");
    component.destroy();
  });

  it("expands daily rows into providers with v", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });
    component.handleInput("4");

    const totals = component.render(200).join("\n");
    expect(totals).not.toContain("anthropic");

    expect(component.handleInput("v")).toBe(true);
    const expanded = component.render(200).join("\n");
    expect(expanded).toContain("anthropic");
    expect(expanded).toContain("openai");
    expect(expanded).not.toContain("$");

    component.handleInput("v");
    expect(component.render(200).join("\n")).not.toContain("anthropic");
    component.destroy();
  });

  it("renders an empty state when there is no dated usage", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: emptyResult });
    component.handleInput("4");
    expect(component.render(80).join("\n")).toContain("No dated usage found");
    component.destroy();
  });

  it("orders models and sessions by total tokens", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });

    component.handleInput("2");
    const models = component.render(200).join("\n");
    expect(models.indexOf("anthropic")).toBeLessThan(models.indexOf("openai"));

    component.handleInput("3");
    const sessions = component.render(200).join("\n");
    expect(sessions.indexOf("pricey session")).toBeLessThan(
      sessions.indexOf("01a05b11"),
    );
    expect(sessions).toContain("Showing 2 of 5 sessions");
    component.destroy();
  });

  it("orders providers by total tokens", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });
    const output = component.render(200).join("\n");
    expect(output.indexOf("anthropic")).toBeLessThan(output.indexOf("openai"));
    expect(output).toContain("non-cache");
    component.destroy();
  });

  it("renders empty-state messages when there is nothing to show", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: emptyResult });

    component.handleInput("2");
    expect(component.render(80).join("\n")).toContain(
      "No assistant messages found",
    );

    component.handleInput("3");
    expect(component.render(80).join("\n")).toContain("No sessions found");
    component.destroy();
  });

  it("closes on q and escape", () => {
    const first = createComponent();
    expect(first.component.handleInput("q")).toBe(true);
    expect(first.closed()).toBe(true);
    first.component.destroy();

    const second = createComponent();
    expect(second.component.handleInput("\u001b")).toBe(true);
    expect(second.closed()).toBe(true);
    second.component.destroy();
  });

  it("requests a refetch on r", () => {
    const { component, refetches } = createComponent();
    expect(component.handleInput("r")).toBe(true);
    expect(refetches()).toBe(1);
    component.destroy();
  });

  it("cycles tabs with tab/arrows and switches with number keys", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });

    component.handleInput("\t");
    expect(component.render(120).join("\n")).toContain("claude-sonnet-4");

    component.handleInput("1");
    expect(component.render(120).join("\n")).toContain("Total tokens");

    expect(component.handleInput("x")).toBe(false);
    component.destroy();
  });

  it("switches scope with a/p and reports only real changes", () => {
    const { component, scopes } = createComponent();
    expect(component.getScope()).toBe("project");
    expect(component.render(120).join("\n")).toContain("this project");

    expect(component.handleInput("a")).toBe(true);
    expect(component.getScope()).toBe("all");
    expect(scopes).toEqual(["all"]);
    expect(component.render(120).join("\n")).toContain("all projects");

    // Re-selecting the current scope is a no-op.
    component.handleInput("a");
    expect(scopes).toEqual(["all"]);

    component.handleInput("p");
    expect(component.getScope()).toBe("project");
    expect(scopes).toEqual(["all", "project"]);
    component.destroy();
  });

  it("honours an initial scope", () => {
    const { component } = createComponent("all");
    expect(component.getScope()).toBe("all");
    expect(component.render(120).join("\n")).toContain("all projects");
    component.destroy();
  });

  it("scrolls with j/k and clamps at the top", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });

    component.handleInput("1");
    const top = component.render(80).join("\n");

    expect(component.handleInput("k")).toBe(true);
    expect(component.handleInput("j")).toBe(true);
    expect(component.handleInput("j")).toBe(true);
    expect(component.render(80).join("\n")).not.toBe(top);

    component.handleInput("k");
    component.handleInput("k");
    component.handleInput("k");
    expect(component.render(80).join("\n")).toBe(top);
    component.destroy();
  });

  it("returns to the loading state and back to data", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });
    component.setState({ type: "loading" });
    expect(component.render(80).join("\n")).toContain("Scanning sessions");

    component.setState({ type: "loaded", result: emptyResult });
    expect(component.render(80).join("\n")).not.toContain("Scanning sessions");
    component.destroy();
  });

  it("can be destroyed twice and after a refetch", () => {
    const { component } = createComponent();
    component.handleInput("r");
    component.destroy();
    expect(() => component.destroy()).not.toThrow();
  });
});
