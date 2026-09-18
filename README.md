# pi-tokens

Cross-session token usage for Pi, as a single `/tokens` command.

Extracted from [@latentminds/pi-quotas](https://github.com/latentminds-ai/pi-quotas), where the command shipped alongside the provider quota features. This package contains the command and nothing else.

## Install

**From npm** (once published):

```bash
pi install npm:pi-tokens
```

**From source:**

```bash
git clone git@github.com:2017fighting/pi-tokens.git
pi install ./pi-tokens
```

**Try without installing:**

```bash
pi -e ./pi-tokens
```

## `/tokens`

Scans Pi session files under `~/.pi/agent/sessions/` and aggregates the token usage recorded on assistant messages.

By default the view is **scoped to the current project** (sessions whose `cwd` matches). Press `a` for all projects and `p` to go back.

| Key                | Action                          |
| ------------------ | ------------------------------- |
| `1` / `2` / `3` / `4` | Overview / Models / Sessions / Daily |
| `Tab` / `→` / `←`  | Cycle tabs                      |
| `a` / `p`          | Scope: all projects / this project |
| `v`                | Daily tab: toggle per-provider breakdown |
| `j` / `k`, `↓`/ `↑` | Scroll                          |
| `r`                | Re-scan sessions                |
| `q` / `Esc`        | Close                           |

Everything is reported in **tokens**. No currency figures are shown: `usage.cost` is the provider's list price for the model, not what a subscription plan actually bills, so it is not displayed.

**Overview** — session count, message count, input/output/cache-read/cache-write tokens, total tokens and non-cache tokens, followed by a per-provider token breakdown with bars.

**Models** — total tokens per `provider/model`, sorted by tokens, with an in/out/cached breakdown.

**Sessions** — per-session total tokens, name (or session id prefix) and local date, sorted by tokens, capped at the top sessions.

**Daily** — tokens per local calendar day, newest first, with a bar and a cumulative `→ x` figure showing tokens used up to that day. The footer shows the day count and grand total. Press `v` to expand each day into its providers. Days are bucketed in **local time**, so "today" means your day rather than UTC.

### Token figures

Two figures appear side by side because they mean different things:

- **Total tokens** — the provider-reported `totalTokens`, which is the sum of input, output, cache read and cache write. Rows are ranked and bars are sized by this figure.
- **Non-cache tokens** — `input + output` only.

On a cache-heavy workload total tokens is dominated by cache reads. In a representative 27k-message history, cache reads were **97.6%** of total tokens: a provider showing `828.9M` total had only `8.2M` non-cache. Showing both prevents the cache volume from being mistaken for new work.

When the TUI view is unavailable (non-interactive or RPC mode), the command prints the same figures through `ctx.ui.notify` instead, scoped to the current project.

## Scope

The scan includes every session file directly under a project directory (`sessions/<project>/<file>.jsonl`). Sessions without assistant messages carrying a `usage` block are skipped, and totals include only what each message recorded.

Two things to be aware of:

- **Session files nested deeper are not scanned.** Subagent runs stored under `sessions/<project>/<session-id>/<child-id>/run-0/session.jsonl` are currently outside the scan, so their cost is not included.
- **Rows are ranked by total tokens**, which includes cache reads. Use the non-cache figure when you care about newly processed input and generated output rather than cache volume.

## Notes

This extension registers exactly one command and nothing else: no footer status, no quota fetching, no configuration. Pi's rolling token-cost footer lives in pi-quotas and is not part of this package.

## Requirements

- [Pi](https://github.com/mariozechner/pi) with the `@earendil-works/*` package names (0.85.1 and later). `@mariozechner/*`-only Pi releases are not supported.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
```

## Credits

The `/tokens` command, its TUI component, and the session-JSONL aggregation were originally contributed to pi-quotas by [@gretel (DO2THX)](https://github.com/gretel). This package is an extraction of that work, kept MIT licensed.

## License

MIT — see [LICENSE](./LICENSE).
