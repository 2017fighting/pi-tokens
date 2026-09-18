import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Aggregated token counts */
export interface TokenBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

/**
 * Tokens excluding cache reads and writes.
 *
 * On a cache-heavy workload `totalTokens` is dominated by cache reads, so this
 * is the figure that reflects newly processed input plus generated output.
 */
export function nonCacheTokens(buckets: TokenBuckets): number {
  return buckets.input + buckets.output;
}

/**
 * The figure rows are ranked and sized by: provider-reported total tokens.
 *
 * Kept as a single named helper so every tab ranks by the same measure.
 */
export function rankTokens(buckets: TokenBuckets): number {
  return buckets.totalTokens;
}

export function emptyBuckets(): TokenBuckets {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
  };
}

export function addBuckets(a: TokenBuckets, b: TokenBuckets): TokenBuckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Local calendar date (`YYYY-MM-DD`) for a timestamp.
 *
 * Days are bucketed in the machine's local timezone so "today" matches the
 * user's day, not UTC. Uses `Date` local getters rather than
 * `toISOString().slice(0, 10)`, which would bucket by UTC.
 */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Per-model usage row */
export interface ModelUsage {
  provider: string;
  model: string;
  tokens: TokenBuckets;
  messageCount: number;
}

/** Per-session usage row */
export interface SessionUsage {
  sessionId: string;
  sessionPath: string;
  cwd: string;
  name?: string;
  created: Date;
  tokens: TokenBuckets;
  messageCount: number;
}

/** Per-provider usage row within a single day */
export interface DayProviderUsage {
  provider: string;
  tokens: TokenBuckets;
  messageCount: number;
}

/** Usage aggregated for one local calendar day */
export interface DayUsage {
  /** Local calendar date as `YYYY-MM-DD`. */
  date: string;
  tokens: TokenBuckets;
  messageCount: number;
  byProvider: DayProviderUsage[];
}

/** Full aggregation result */
export interface AggregateResult {
  totals: TokenBuckets;
  byModel: ModelUsage[];
  byProvider: Array<{
    provider: string;
    tokens: TokenBuckets;
    messageCount: number;
  }>;
  bySession: SessionUsage[];
  /** Per-local-calendar-day usage, newest day first. */
  byDay: DayUsage[];
  sessionCount: number;
  messageCount: number;
}

/** Minimal assistant message fields for extraction */
interface AssistantMessageData {
  role: string;
  provider?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  };
}

interface SessionEntry {
  type: string;
  timestamp?: string;
  message?: AssistantMessageData;
  name?: string;
}

/**
 * Find the pi sessions directory. Scans ~/.pi/agent/sessions/ for subdirectories.
 */
function getSessionsBaseDir(): string {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(agentDir, "sessions");
}

/**
 * Discover all JSONL session files across all project directories.
 */
async function discoverSessionFiles(): Promise<string[]> {
  const baseDir = getSessionsBaseDir();
  const files: string[] = [];

  let projectDirs: string[];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const projectPath = join(baseDir, projectDir);
    try {
      const sessionEntries = await readdir(projectPath, {
        withFileTypes: true,
      });
      for (const entry of sessionEntries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(projectPath, entry.name));
        }
      }
    } catch {
      // skip inaccessible project dirs
    }
  }

  return files;
}

/**
 * Parse a single JSONL session file and extract token usage from assistant messages.
 * Returns session metadata + per-model token aggregates.
 */
async function parseSessionFile(
  filePath: string,
): Promise<{
  session: SessionUsage;
  models: Map<string, ModelUsage>;
  days: Map<string, DayUsage>;
} | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = content.trim().split("\n");
  if (lines.length === 0) return null;

  const sessionTokens = emptyBuckets();
  const models = new Map<string, ModelUsage>();
  const days = new Map<string, DayUsage>();
  let sessionId = "";
  let cwd = "";
  let name: string | undefined;
  let created: Date | undefined;
  let messageCount = 0;

  for (const line of lines) {
    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      continue;
    }

    // Extract session header
    if (entry.type === "session") {
      const header = entry as unknown as {
        id?: string;
        cwd?: string;
        timestamp?: string;
      };
      sessionId = header.id ?? "";
      cwd = header.cwd ?? "";
      if (header.timestamp) {
        created = new Date(header.timestamp);
      }
      continue;
    }

    // Extract session name
    if (entry.type === "session_info" && entry.name) {
      name = entry.name;
      continue;
    }

    // Process assistant messages
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const msg = entry.message;
      const usage = msg.usage;
      if (!usage) continue;

      const buckets: TokenBuckets = {
        input: usage.input ?? 0,
        output: usage.output ?? 0,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      };

      // Accumulate into session totals
      sessionTokens.input += buckets.input;
      sessionTokens.output += buckets.output;
      sessionTokens.cacheRead += buckets.cacheRead;
      sessionTokens.cacheWrite += buckets.cacheWrite;
      sessionTokens.totalTokens += buckets.totalTokens;
      messageCount++;

      // Accumulate per-model
      const provider = msg.provider ?? "unknown";
      const model = msg.model ?? "unknown";
      const modelKey = `${provider}/${model}`;
      const existing = models.get(modelKey);
      if (existing) {
        existing.tokens = addBuckets(existing.tokens, buckets);
        existing.messageCount++;
      } else {
        models.set(modelKey, {
          provider,
          model,
          tokens: { ...buckets },
          messageCount: 1,
        });
      }

      // Accumulate per local calendar day (and per provider within that day).
      // Day attribution uses the entry timestamp; entries without one are
      // attributed to the session date, which is stable regardless of when the
      // scan runs.
      const dayKey = localDayKey(
        entry.timestamp ? new Date(entry.timestamp) : (created ?? new Date(0)),
      );
      let day = days.get(dayKey);
      if (!day) {
        day = {
          date: dayKey,
          tokens: emptyBuckets(),
          messageCount: 0,
          byProvider: [],
        };
        days.set(dayKey, day);
      }
      day.tokens = addBuckets(day.tokens, buckets);
      day.messageCount++;
      const dayProvider = day.byProvider.find((p) => p.provider === provider);
      if (dayProvider) {
        dayProvider.tokens = addBuckets(dayProvider.tokens, buckets);
        dayProvider.messageCount++;
      } else {
        day.byProvider.push({
          provider,
          tokens: { ...buckets },
          messageCount: 1,
        });
      }
    }
  }

  if (messageCount === 0) return null;

  // Get file creation time as fallback
  let fileCreated = created ?? new Date(0);
  if (!created) {
    try {
      const fileStat = await stat(filePath);
      fileCreated = fileStat.birthtime;
    } catch {
      // keep default
    }
  }

  return {
    session: {
      sessionId,
      sessionPath: filePath,
      cwd,
      name,
      created: fileCreated,
      tokens: sessionTokens,
      messageCount,
    },
    models,
    days,
  };
}

/**
 * Aggregate token usage across all sessions.
 * Reads JSONL files directly for performance (avoids building session tree structures).
 */
export async function aggregateAllSessions(options?: {
  cwd?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}): Promise<AggregateResult> {
  const files = await discoverSessionFiles();

  const totals = emptyBuckets();
  const byModelMap = new Map<string, ModelUsage>();
  const byProviderMap = new Map<
    string,
    { tokens: TokenBuckets; messageCount: number }
  >();
  const sessions: SessionUsage[] = [];
  const byDayMap = new Map<string, DayUsage>();
  let totalMessages = 0;

  // Parse files in parallel (bounded concurrency)
  const CONCURRENCY = 16;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((f) => parseSessionFile(f)));

    for (const result of results) {
      if (!result) continue;
      const { session, models, days } = result;

      // Filter by cwd if specified
      if (options?.cwd && session.cwd !== options.cwd) continue;

      // Filter by time range
      if (options?.since && session.created < options.since) continue;
      if (options?.until && session.created > options.until) continue;

      sessions.push(session);

      // Accumulate totals
      totals.input += session.tokens.input;
      totals.output += session.tokens.output;
      totals.cacheRead += session.tokens.cacheRead;
      totals.cacheWrite += session.tokens.cacheWrite;
      totals.totalTokens += session.tokens.totalTokens;
      totalMessages += session.messageCount;

      // Accumulate per-model
      for (const [key, modelUsage] of models) {
        const existing = byModelMap.get(key);
        if (existing) {
          existing.tokens = addBuckets(existing.tokens, modelUsage.tokens);
          existing.messageCount += modelUsage.messageCount;
        } else {
          byModelMap.set(key, { ...modelUsage });
        }

        // Accumulate per-provider
        const providerEntry = byProviderMap.get(modelUsage.provider);
        if (providerEntry) {
          providerEntry.tokens = addBuckets(
            providerEntry.tokens,
            modelUsage.tokens,
          );
          providerEntry.messageCount += modelUsage.messageCount;
        } else {
          byProviderMap.set(modelUsage.provider, {
            tokens: { ...modelUsage.tokens },
            messageCount: modelUsage.messageCount,
          });
        }
      }
      // Accumulate per-day totals
      for (const [dayKey, day] of days) {
        const existingDay = byDayMap.get(dayKey);
        if (!existingDay) {
          byDayMap.set(dayKey, {
            date: day.date,
            tokens: { ...day.tokens },
            messageCount: day.messageCount,
            byProvider: day.byProvider.map((p) => ({
              provider: p.provider,
              tokens: { ...p.tokens },
              messageCount: p.messageCount,
            })),
          });
          continue;
        }

        existingDay.tokens = addBuckets(existingDay.tokens, day.tokens);
        existingDay.messageCount += day.messageCount;
        for (const dayProvider of day.byProvider) {
          const existingProvider = existingDay.byProvider.find(
            (p) => p.provider === dayProvider.provider,
          );
          if (existingProvider) {
            existingProvider.tokens = addBuckets(
              existingProvider.tokens,
              dayProvider.tokens,
            );
            existingProvider.messageCount += dayProvider.messageCount;
          } else {
            existingDay.byProvider.push({
              provider: dayProvider.provider,
              tokens: { ...dayProvider.tokens },
              messageCount: dayProvider.messageCount,
            });
          }
        }
      }
    }
  }

  // Sort sessions by tokens descending
  sessions.sort((a, b) => rankTokens(b.tokens) - rankTokens(a.tokens));

  // Sort days newest first, and each day's providers by tokens descending
  const byDay = Array.from(byDayMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  for (const day of byDay) {
    day.byProvider.sort((a, b) => rankTokens(b.tokens) - rankTokens(a.tokens));
  }

  // Sort models by tokens descending
  const byModel = Array.from(byModelMap.values()).sort(
    (a, b) => rankTokens(b.tokens) - rankTokens(a.tokens),
  );

  // Sort providers by tokens descending
  const byProvider = Array.from(byProviderMap.entries())
    .map(([provider, data]) => ({ provider, ...data }))
    .sort((a, b) => rankTokens(b.tokens) - rankTokens(a.tokens));

  // Apply limit
  const limit = options?.limit;
  const limitedSessions = limit ? sessions.slice(0, limit) : sessions;

  return {
    totals,
    byModel,
    byProvider,
    byDay,
    bySession: limitedSessions,
    sessionCount: sessions.length,
    messageCount: totalMessages,
  };
}

/**
 * Format a number with commas for readability.
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000) return n.toLocaleString("en-US");
  return String(n);
}

/**
 * Format token buckets as a compact summary line.
 */
export function formatTokenSummary(tokens: TokenBuckets): string {
  const parts: string[] = [];
  if (tokens.input > 0) parts.push(`${formatNumber(tokens.input)} in`);
  if (tokens.output > 0) parts.push(`${formatNumber(tokens.output)} out`);
  if (tokens.cacheRead > 0)
    parts.push(`${formatNumber(tokens.cacheRead)} cached`);
  return parts.join(" · ");
}
