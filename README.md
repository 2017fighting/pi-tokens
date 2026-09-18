# pi-tokens

Cross-session token and cost usage for Pi, as a single `/tokens` command.

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

Scans every Pi session file under `~/.pi/agent/sessions/` and aggregates the token usage and cost recorded on assistant messages, then opens a bordered view with three tabs.

| Key                | Action                          |
| ------------------ | ------------------------------- |
| `1` / `2` / `3`    | Overview / Models / Sessions    |
| `Tab` / `→` / `←`  | Cycle tabs                      |
| `j` / `k`, `↓`/ `↑` | Scroll                          |
| `r`                | Re-scan sessions                |
| `q` / `Esc`        | Close                           |

**Overview** — session count, message count, input/output/cache-read/cache-write tokens, total tokens and total cost, followed by a per-provider cost breakdown with bars.

**Models** — cost per `provider/model`, sorted by cost, with a token summary line.

**Sessions** — per-session cost, name (or session id prefix) and date, sorted by cost, capped at the top sessions.

When the TUI view is unavailable (non-interactive or RPC mode), the command prints the same totals through `ctx.ui.notify` instead.

## Scope

The scan covers all sessions of every project, not only the current working directory. Sessions without assistant messages carrying a `usage` block are skipped, and totals include only what each message recorded: a provider that reports no cost contributes tokens but `$0.00`.

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
