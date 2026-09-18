# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-09-18

### Added

- `/tokens` command with cross-session token/cost aggregation from Pi JSONL session files, extracted from `@latentminds/pi-quotas` 0.5.0: the three-tab TUI view (Overview / Models / Sessions), the non-interactive `notify` fallback, and the `src/lib/session-tokens.ts` aggregation library.
- Temp-directory tests for the session scanner (`aggregateAllSessions`), covering directory discovery, per-model and per-provider aggregation, `cwd`/`since`/`until`/`limit` filtering, malformed-line tolerance, and sessions without usage data. These were not covered upstream.
