import type { Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Loader, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import pkg from "../../../package.json" with { type: "json" };
import type {
  AggregateResult,
} from "../../lib/session-tokens.js";
import {
  formatNumber,
  formatTokenSummary,
  localDayKey,
  nonCacheTokens,
  rankTokens,
} from "../../lib/session-tokens.js";

type TokensState =
  | { type: "loading" }
  | { type: "loaded"; result: AggregateResult };

type TabId = "overview" | "models" | "sessions" | "daily";

type Scope = "project" | "all";

export type { Scope };

interface TokensComponentOptions {
  cwd?: string;
  /** Initial aggregation scope. Defaults to the current project. */
  scope?: Scope;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
  { id: "sessions", label: "Sessions" },
  { id: "daily", label: "Daily" },
];

function renderProgressBar(
  value: number,
  max: number,
  width: number,
  theme: Theme,
): string {
  if (max <= 0 || value <= 0) return theme.fg("dim", "░".repeat(width));
  const ratio = Math.min(1, value / max);
  const filled = Math.round(ratio * width);
  const parts: string[] = [];
  for (let i = 0; i < width; i++) {
    parts.push(i < filled ? theme.fg("accent", "█") : theme.fg("dim", "░"));
  }
  return parts.join("");
}

export class TokensComponent implements Component {
  private state: TokensState = { type: "loading" };
  private loader: Loader | null = null;
  private activeTab: TabId = "overview";
  private scrollOffset = 0;
  private scope: Scope;
  /** When true, daily rows expand into per-provider rows. */
  private dailyByProvider = false;

  constructor(
    private theme: Theme,
    private tui: any,
    private onClose: () => void,
    private onRefetch: () => void,
    private onScopeChange: (scope: Scope) => void,
    options: TokensComponentOptions = {},
  ) {
    this.scope = options.scope ?? "project";
    this.startLoader();
  }

  getScope(): Scope {
    return this.scope;
  }

  private startLoader(): void {
    this.loader = new Loader(
      this.tui,
      (s: string) => this.theme.fg("accent", s),
      (s: string) => this.theme.fg("muted", s),
      "Scanning sessions...",
    );
  }

  destroy(): void {
    this.loader?.stop();
    this.loader = null;
  }

  setState(state: TokensState): void {
    if (state.type === "loading") {
      this.loader?.stop();
      this.startLoader();
      this.scrollOffset = 0;
    } else if (this.state.type === "loading") {
      this.loader?.stop();
      this.loader = null;
    }
    this.state = state;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, "escape") || data === "q") {
      this.onClose();
      return true;
    }
    if (data === "r") {
      this.onRefetch();
      return true;
    }
    if (data === "\t" || data === "right") {
      const idx = TABS.findIndex((t) => t.id === this.activeTab);
      this.activeTab = TABS[(idx + 1) % TABS.length].id;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "left") {
      const idx = TABS.findIndex((t) => t.id === this.activeTab);
      this.activeTab = TABS[(idx - 1 + TABS.length) % TABS.length].id;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "1") {
      this.activeTab = "overview";
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "2") {
      this.activeTab = "models";
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "3") {
      this.activeTab = "sessions";
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "4") {
      this.activeTab = "daily";
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "a" || data === "p") {
      const next: Scope = data === "a" ? "all" : "project";
      if (next === this.scope) return true;
      this.scope = next;
      this.scrollOffset = 0;
      this.setState({ type: "loading" });
      this.onScopeChange(next);
      return true;
    }
    if (data === "v" && this.activeTab === "daily") {
      this.dailyByProvider = !this.dailyByProvider;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.scrollOffset++;
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, "up") || data === "k") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender();
      return true;
    }
    return false;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const border = new DynamicBorder((s: string) => this.theme.fg("border", s));
    lines.push(...border.render(width));
    lines.push(
      truncateToWidth(
        ` ${this.theme.fg("accent", this.theme.bold("Token Usage"))}`,
        width,
      ),
    );

    // Tab bar
    const tabParts = TABS.map((tab) => {
      if (tab.id === this.activeTab) {
        return this.theme.fg("accent", this.theme.bold(`[${tab.label}]`));
      }
      return this.theme.fg("dim", ` ${tab.label} `);
    });
    lines.push(truncateToWidth(`  ${tabParts.join("  ")}`, width));

    const scopeLabel =
      this.scope === "all" ? "all projects" : "this project";
    lines.push(
      truncateToWidth(
        `  ${this.theme.fg("dim", `scope: ${this.theme.fg("accent", scopeLabel)}`)}${
          this.activeTab === "daily"
            ? this.theme.fg(
              "dim",
              `   view: ${this.theme.fg(
                "accent",
                this.dailyByProvider ? "by provider" : "daily totals",
              )}`,
            )
            : ""
        }`,
        width,
      ),
    );
    lines.push("");

    if (this.state.type === "loading") {
      lines.push(
        ...(this.loader
          ? this.loader.render(width)
          : [this.theme.fg("muted", "  Scanning sessions...")]),
      );
    } else {
      const contentLines = this.renderTab(width);
      // Apply scroll
      const maxVisible = Math.max(1, 20); // approximate visible lines
      const visible = contentLines.slice(
        this.scrollOffset,
        this.scrollOffset + maxVisible,
      );
      lines.push(...visible);
    }

    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.fg(
          "dim",
          `  pi-tokens v${pkg.version}  ·  1-4 tabs  a all  p project${
            this.activeTab === "daily" ? "  v view" : ""
          }  r refresh  q/Esc close`,
        ),
        width,
      ),
    );
    lines.push(...border.render(width));
    return lines;
  }

  private renderTab(width: number): string[] {
    if (this.state.type !== "loaded") return [];
    const { result } = this.state;

    switch (this.activeTab) {
      case "overview":
        return this.renderOverview(result, width);
      case "models":
        return this.renderModels(result, width);
      case "sessions":
        return this.renderSessions(result, width);
      case "daily":
        return this.renderDaily(result, width);
    }
  }

  private renderOverview(result: AggregateResult, width: number): string[] {
    const lines: string[] = [];
    const { totals } = result;

    lines.push(
      truncateToWidth(
        `  ${this.theme.fg("accent", this.theme.bold("Summary"))}`,
        width,
      ),
    );
    lines.push("");

    const statRows = [
      ["Sessions", String(result.sessionCount)],
      ["Messages", String(result.messageCount)],
      ["Input tokens", formatNumber(totals.input)],
      ["Output tokens", formatNumber(totals.output)],
      ["Cache read", formatNumber(totals.cacheRead)],
      ["Cache write", formatNumber(totals.cacheWrite)],
      ["Total tokens", formatNumber(totals.totalTokens)],
      ["Non-cache tokens", formatNumber(nonCacheTokens(totals))],
    ];

    const labelWidth = Math.max(...statRows.map(([l]) => l.length));
    for (const [label, value] of statRows) {
      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("dim", label.padEnd(labelWidth))}  ${this.theme.fg("accent", value)}`,
          width,
        ),
      );
    }

    // Provider breakdown
    if (result.byProvider.length > 0) {
      lines.push("");
      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("accent", this.theme.bold("By Provider"))}`,
          width,
        ),
      );
      lines.push("");
      const maxTokens = Math.max(
        ...result.byProvider.map((p) => rankTokens(p.tokens)),
      );
      for (const provider of result.byProvider) {
        const barWidth = Math.min(20, Math.max(8, width - 44));
        const bar = renderProgressBar(
          rankTokens(provider.tokens),
          maxTokens,
          barWidth,
          this.theme,
        );
        lines.push(
          truncateToWidth(
            `  ${this.theme.fg("accent", provider.provider.padEnd(20))} ${bar} ${this.theme.fg(
              "accent",
              formatNumber(provider.tokens.totalTokens).padStart(7),
            )} ${this.theme.fg("dim", `${provider.messageCount} msgs · ${formatNumber(nonCacheTokens(provider.tokens))} non-cache`)}`,
            width,
          ),
        );
      }
    }

    return lines;
  }

  private renderModels(result: AggregateResult, width: number): string[] {
    const lines: string[] = [];

    if (result.byModel.length === 0) {
      lines.push(this.theme.fg("dim", "  No assistant messages found"));
      return lines;
    }

    const maxTokens = Math.max(...result.byModel.map((m) => rankTokens(m.tokens)));

    for (const model of result.byModel) {
      const barWidth = Math.min(16, Math.max(8, width - 44));
      const bar = renderProgressBar(
        rankTokens(model.tokens),
        maxTokens,
        barWidth,
        this.theme,
      );
      const label =
        model.provider === model.model
          ? model.model
          : `${model.provider}/${model.model}`;
      const shortLabel = label.length > 30 ? label.slice(0, 27) + "..." : label;

      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("accent", shortLabel)} ${this.theme.fg(
            "accent",
            formatNumber(model.tokens.totalTokens),
          )} ${this.theme.fg("dim", `${model.messageCount} msgs`)}`,
          width,
        ),
      );
      lines.push(
        truncateToWidth(
          `    ${bar} ${this.theme.fg("dim", formatTokenSummary(model.tokens))}`,
          width,
        ),
      );
    }

    return lines;
  }

  private renderSessions(result: AggregateResult, width: number): string[] {
    const lines: string[] = [];

    if (result.bySession.length === 0) {
      lines.push(this.theme.fg("dim", "  No sessions found"));
      return lines;
    }

    const maxTokens = Math.max(
      ...result.bySession.map((s) => rankTokens(s.tokens)),
    );

    for (const session of result.bySession) {
      // Local date, matching the Daily tab's bucketing.
      const dateStr = localDayKey(session.created);
      const name = session.name ?? session.sessionId.slice(0, 8);
      const msgs = `${session.messageCount} msgs`;

      const barWidth = Math.min(12, Math.max(6, width - 52));
      const bar = renderProgressBar(
        rankTokens(session.tokens),
        maxTokens,
        barWidth,
        this.theme,
      );

      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("dim", dateStr)} ${this.theme.fg("accent", name)} ${bar} ${this.theme.fg(
            "accent",
            formatNumber(session.tokens.totalTokens).padStart(7),
          )} ${this.theme.fg("dim", msgs)}`,
          width,
        ),
      );
    }

    if (result.sessionCount > result.bySession.length) {
      lines.push("");
      lines.push(
        truncateToWidth(
          this.theme.fg(
            "dim",
            `  Showing ${result.bySession.length} of ${result.sessionCount} sessions`,
          ),
          width,
        ),
      );
    }

    return lines;
  }

  private renderDaily(result: AggregateResult, width: number): string[] {
    const lines: string[] = [];

    if (result.byDay.length === 0) {
      lines.push(this.theme.fg("dim", "  No dated usage found"));
      return lines;
    }

    const maxTokens = Math.max(...result.byDay.map((d) => rankTokens(d.tokens)));

    if (this.dailyByProvider) {
      // Per-day totals, each followed by that day's providers.
      for (const day of result.byDay) {
        lines.push(
          truncateToWidth(
            `  ${this.theme.fg("accent", this.theme.bold(day.date))} ${this.theme.fg(
              "accent",
              formatNumber(day.tokens.totalTokens),
            )} ${this.theme.fg("dim", `${day.messageCount} msgs`)}`,
            width,
          ),
        );
        for (const provider of day.byProvider) {
          lines.push(
            truncateToWidth(
              `    ${this.theme.fg("dim", provider.provider.padEnd(20))} ${this.theme.fg(
                "accent",
                formatNumber(provider.tokens.totalTokens).padStart(7),
              )} ${this.theme.fg("dim", formatTokenSummary(provider.tokens))}`,
              width,
            ),
          );
        }
      }
      return lines;
    }

    // Daily totals with token bars, plus a cumulative "used up to this day"
    // figure. The cumulative runs oldest -> newest so each row is meaningful,
    // even though rows are displayed newest first.
    const dateWidth = Math.max(...result.byDay.map((d) => d.date.length));
    const cumulativeByDate = new Map<string, number>();
    let running = 0;
    for (let i = result.byDay.length - 1; i >= 0; i--) {
      running += rankTokens(result.byDay[i].tokens);
      cumulativeByDate.set(result.byDay[i].date, running);
    }

    for (const day of result.byDay) {
      const barWidth = Math.min(16, Math.max(8, width - 62));
      const bar = renderProgressBar(
        rankTokens(day.tokens),
        maxTokens,
        barWidth,
        this.theme,
      );
      // "in out cached" without repeating the total, which is the leading figure.
      const detail = [
        `${formatNumber(day.tokens.input)} in`,
        `${formatNumber(day.tokens.output)} out`,
        `${formatNumber(day.tokens.cacheRead)} cached`,
      ].join(" · ");
      lines.push(
        truncateToWidth(
          `  ${this.theme.fg("dim", day.date.padEnd(dateWidth))} ${bar} ${this.theme.fg(
            "accent",
            formatNumber(day.tokens.totalTokens).padStart(7),
          )} ${this.theme.fg("dim", detail)} ${this.theme.fg(
            "muted",
            `→ ${formatNumber(cumulativeByDate.get(day.date) ?? 0)}`,
          )}`,
          width,
        ),
      );
    }

    lines.push("");
    lines.push(
      truncateToWidth(
        `  ${this.theme.fg("dim", `${result.byDay.length} days · grand total ${this.theme.fg("accent", formatNumber(running))} tokens`)}`,
        width,
      ),
    );

    return lines;
  }

  invalidate(): void {}
}
