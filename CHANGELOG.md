# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-09-18

### Added

- **Daily tab** (`4`): token usage per local calendar day, newest first, with bars, a cumulative `→ x` figure per day, and a grand total. Press `v` to expand each day into its providers. Days are bucketed in **local time**, not UTC.
- **Scope toggle** (`a` / `p`): switch the whole view between the current project and all projects without leaving the command. The command remains project-scoped by default.
- **Non-cache token figures**: `Non-cache tokens` (input + output) in the Overview, and a non-cache figure on provider and model rows. Cache reads were 97.6% of a representative 27k-message history, so a single total hid real differences between providers: one provider with 828.9M total tokens had only 8.2M non-cache.
- `nonCacheTokens()` and `rankTokens()` helpers in `src/lib/session-tokens.ts`, with tests.
- Provider and per-day breakdowns in the non-interactive `ctx.ui.notify` fallback.

### Changed

- **Token-only reporting: currency figures removed everywhere.** `usage.cost` is the provider's list price for the model, not what a subscription plan actually bills, so it was misleading for coding-plan users. All tabs, the daily cumulative line, the grand total and the fallback report tokens.
- **`TokenBuckets.costTotal` and `AggregateResult.totals.costTotal` were removed** from the data model, and `formatCost()` was deleted with its tests. Breaking change for anything importing those types.
- **Rows are ranked and sized by total tokens**, through a single `rankTokens()` helper, so every tab ranks by the same measure. Ranking by cost produced a different order than ranking by tokens.

### Fixed

- **README scope claim was wrong**: `/tokens` is scoped to the current project's `cwd`, not all projects. The previously undocumented limits (nested subagent sessions are excluded; total tokens include cache reads) are now stated.
- **Sessions tab dates were UTC** (`toISOString().slice(0, 10)`) while the Daily tab bucketed locally, so one session could appear under two different dates. Both now use the local date.
- **Provider rows printed the cost twice.**
- **Two lines overflowed narrow terminals**: the `Showing N of M sessions` footer in the Sessions tab and the key-hint line. Both are now width-truncated.

## [0.1.0] - 2026-09-18

### Added

- `/tokens` command with cross-session token/cost aggregation from Pi JSONL session files, extracted from `@latentminds/pi-quotas` 0.5.0: the three-tab TUI view (Overview / Models / Sessions), the non-interactive `notify` fallback, and the `src/lib/session-tokens.ts` aggregation library.
- Temp-directory tests for the session scanner (`aggregateAllSessions`), covering directory discovery, per-model and per-provider aggregation, `cwd`/`since`/`until`/`limit` filtering, malformed-line tolerance, and sessions without usage data. These were not covered upstream.
