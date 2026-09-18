import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  aggregateAllSessions,
  formatNumber,
  nonCacheTokens,
  rankTokens,
} from "../../lib/session-tokens.js";
import { TokensComponent, type Scope } from "./tokens-display.js";

async function openTokensView(
  ctx: ExtensionCommandContext,
  cwd?: string,
): Promise<void> {
  let scope: Scope = "project";

  const result = await ctx.ui.custom<null>((tui, theme, _kb, done) => {
    const controller = new AbortController();
    const component = new TokensComponent(
      theme,
      tui,
      () => {
        controller.abort();
        done(null);
      },
      () => {
        component.setState({ type: "loading" });
        tui.requestRender();
        void load();
      },
      (next) => {
        scope = next;
        void load();
      },
      { cwd, scope },
    );

    async function load(): Promise<void> {
      try {
        // `cwd` filters the scan; `all` means no filter at all.
        const aggregateResult = await aggregateAllSessions(
          scope === "all" ? {} : { cwd },
        );
        if (controller.signal.aborted) return;
        component.setState({ type: "loaded", result: aggregateResult });
        tui.requestRender();
      } catch {
        if (controller.signal.aborted) return;
        component.setState({
          type: "loaded",
          result: {
            totals: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
            },
            byModel: [],
            byProvider: [],
            bySession: [],
            byDay: [],
            sessionCount: 0,
            messageCount: 0,
          },
        });
        tui.requestRender();
      }
    }

    void load();

    return {
      render: (width: number) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data: string) => component.handleInput(data),
      dispose: () => {
        controller.abort();
        component.destroy();
      },
    };
  });

  // Fallback for non-interactive mode
  if (result === undefined) {
    const aggregateResult = await aggregateAllSessions({ cwd });
    const { totals } = aggregateResult;
    const lines = [
      `Token Usage (this project): ${aggregateResult.sessionCount} sessions, ${aggregateResult.messageCount} messages`,
      `  Input: ${totals.input.toLocaleString()} · Output: ${totals.output.toLocaleString()}`,
      `  Cache Read: ${totals.cacheRead.toLocaleString()} · Cache Write: ${totals.cacheWrite.toLocaleString()}`,
      `  Total: ${formatNumber(totals.totalTokens)} tokens (${formatNumber(nonCacheTokens(totals))} non-cache)`,
    ];

    lines.push("  By provider:");
    for (const provider of aggregateResult.byProvider) {
      lines.push(
        `    ${provider.provider}: ${formatNumber(provider.tokens.totalTokens)} tokens (${formatNumber(nonCacheTokens(provider.tokens))} non-cache, ${provider.messageCount} msgs)`,
      );
    }

    if (aggregateResult.byDay.length > 0) {
      lines.push("  By day (newest first):");
      // Cumulative runs oldest -> newest, matching the TUI.
      const cumulativeByDate = new Map<string, number>();
      let running = 0;
      for (let i = aggregateResult.byDay.length - 1; i >= 0; i--) {
        running += rankTokens(aggregateResult.byDay[i].tokens);
        cumulativeByDate.set(aggregateResult.byDay[i].date, running);
      }
      for (const day of aggregateResult.byDay) {
        lines.push(
          `    ${day.date}: ${formatNumber(day.tokens.totalTokens)} tokens (${day.messageCount} msgs, running total ${formatNumber(cumulativeByDate.get(day.date) ?? 0)})`,
        );
      }
    }

    for (const model of aggregateResult.byModel) {
      lines.push(
        `  ${model.provider}/${model.model}: ${formatNumber(model.tokens.totalTokens)} tokens (${model.messageCount} msgs)`,
      );
    }
    ctx.ui.notify(lines.join("\n"), "info");
  }
}

export function registerTokensCommand(pi: ExtensionAPI): void {
  pi.registerCommand("tokens", {
    description: "Display token usage across sessions",
    handler: async (_args, ctx) => {
      await openTokensView(ctx, ctx.cwd);
    },
  });
}

export default async function (pi: ExtensionAPI) {
  registerTokensCommand(pi);
}
