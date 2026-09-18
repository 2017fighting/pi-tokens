import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { TokensComponent } from "./tokens-display.js";
import type { AggregateResult } from "../../lib/session-tokens.js";

/**
 * Render smoke tests for the `/tokens` view.
 *
 * They cannot drive the real TUI, so they only assert what the component does
 * with state: that rendering at awkward widths neither throws nor leaves
 * unanchored content, that every tab renders, and that key handling reports
 * the keys it consumes.
 */

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const tui = { requestRender: () => {} };

const emptyResult: AggregateResult = {
  totals: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
  },
  byModel: [],
  byProvider: [],
  bySession: [],
  sessionCount: 0,
  messageCount: 0,
};

const loadedResult: AggregateResult = {
  totals: {
    input: 1_234_567,
    output: 456_789,
    cacheRead: 12_345,
    cacheWrite: 6_789,
    totalTokens: 1_710_490,
    costTotal: 42.42,
  },
  byModel: [
    {
      provider: "anthropic",
      model: "claude-sonnet-4-with-a-very-long-model-name",
      tokens: {
        input: 1_000_000,
        output: 400_000,
        cacheRead: 10_000,
        cacheWrite: 5_000,
        totalTokens: 1_415_000,
        costTotal: 40,
      },
      messageCount: 120,
    },
    {
      provider: "openai",
      model: "gpt-5",
      tokens: {
        input: 234_567,
        output: 56_789,
        cacheRead: 2_345,
        cacheWrite: 1_789,
        totalTokens: 295_490,
        costTotal: 2.42,
      },
      messageCount: 30,
    },
  ],
  byProvider: [
    {
      provider: "anthropic",
      tokens: {
        input: 1_000_000,
        output: 400_000,
        cacheRead: 10_000,
        cacheWrite: 5_000,
        totalTokens: 1_415_000,
        costTotal: 40,
      },
      messageCount: 120,
    },
    {
      provider: "openai",
      tokens: {
        input: 234_567,
        output: 56_789,
        cacheRead: 2_345,
        cacheWrite: 1_789,
        totalTokens: 295_490,
        costTotal: 2.42,
      },
      messageCount: 30,
    },
  ],
  bySession: [
    {
      sessionId: "01a05b11-dd5b-7004-958d-04daa15ad81c",
      sessionPath: "/tmp/sessions/--root-proj--/pricey.jsonl",
      cwd: "/root/proj",
      name: "pricey session",
      created: new Date("2026-09-10T00:00:00.000Z"),
      tokens: {
        input: 900_000,
        output: 300_000,
        cacheRead: 10_000,
        cacheWrite: 5_000,
        totalTokens: 1_215_000,
        costTotal: 40,
      },
      messageCount: 110,
    },
    {
      sessionId: "01a05b11-dd5b-7004-958d-04daa15ad81d",
      sessionPath: "/tmp/sessions/--root-proj--/cheap.jsonl",
      cwd: "/root/proj",
      created: new Date("2026-09-01T00:00:00.000Z"),
      tokens: {
        input: 100_000,
        output: 100_000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 200_000,
        costTotal: 2.42,
      },
      messageCount: 20,
    },
  ],
  sessionCount: 5,
  messageCount: 150,
};

interface Harness {
  component: TokensComponent;
  closed: () => boolean;
  refetches: () => number;
}

function createComponent(): Harness {
  let closed = false;
  let refetches = 0;
  const component = new TokensComponent(
    theme,
    tui,
    () => {
      closed = true;
    },
    () => {
      refetches++;
    },
  );
  return { component, closed: () => closed, refetches: () => refetches };
}

const WIDTHS = [20, 40, 80, 120, 200];

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
      for (const tab of ["1", "2", "3"]) {
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

  it("shows session totals and provider rows in the overview tab", () => {
    const { component } = createComponent();
    component.setState({ type: "loaded", result: loadedResult });

    const output = component.render(120).join("\n");
    expect(output).toContain("Sessions");
    expect(output).toContain("5");
    expect(output).toContain("Total cost");
    expect(output).toContain("$42.42");
    expect(output).toContain("anthropic");
    expect(output).toContain("openai");
    component.destroy();
  });

  it("lists models sorted by cost and sessions by cost", () => {
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
    expect(component.render(120).join("\n")).toContain("Total cost");

    expect(component.handleInput("x")).toBe(false);
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
