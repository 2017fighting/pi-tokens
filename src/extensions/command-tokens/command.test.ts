import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import registerTokensExtension from "./command.js";

/**
 * Covers the command boundary: that the extension registers `/tokens`, and that
 * it renders through the TUI view when one is available and falls back to
 * `ctx.ui.notify` when it is not. The TUI itself is not driven here.
 */

interface CapturedCommand {
  name: string;
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function fakePi(): { pi: ExtensionAPI; commands: CapturedCommand[] } {
  const commands: CapturedCommand[] = [];
  const pi = {
    registerCommand(
      name: string,
      options: Omit<RegisteredCommand, "name" | "sourceInfo">,
    ) {
      commands.push({
        name,
        description: options.description,
        handler: options.handler,
      });
    },
  } as unknown as ExtensionAPI;
  return { pi, commands };
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

let agentDir: string;

function writeSession(): void {
  const dir = join(agentDir, "sessions", "--root-proj--");
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "session",
      id: "s1",
      cwd: "/root/proj",
      timestamp: "2026-09-01T00:00:00.000Z",
    }),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4",
        usage: {
          input: 1_000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1_500,
          cost: { total: 1.25 },
        },
      },
    }),
  ];
  writeFileSync(join(dir, "s1.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-tokens-cmd-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  writeSession();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

async function tokensHandler(): Promise<CapturedCommand> {
  const { pi, commands } = fakePi();
  await registerTokensExtension(pi);
  expect(commands).toHaveLength(1);
  return commands[0];
}

describe("registerTokensCommand", () => {
  it("registers the tokens command with a description", async () => {
    const command = await tokensHandler();
    expect(command.name).toBe("tokens");
    expect(command.description).toMatch(/token/i);
  });

  it("notifies with totals when no TUI view is available", async () => {
    const command = await tokensHandler();
    const notify = vi.fn();
    const ctx = {
      cwd: "/root/proj",
      ui: {
        custom: async () => undefined,
        notify,
      },
    } as unknown as ExtensionCommandContext;

    await command.handler("", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("info");
    expect(message).toContain("Token Usage: 1 sessions, 1 messages");
    expect(message).toContain("Total: 1,500 tokens");
    expect(message).toContain("$1.25");
    expect(message).toContain("anthropic/claude-sonnet-4");
  });

  it("opens the TUI view instead of notifying when a custom view is available", async () => {
    const command = await tokensHandler();
    const notify = vi.fn();
    let factory:
      | ((
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (result: null) => void,
        ) => { render: (width: number) => string[] })
      | undefined;

    const ctx = {
      cwd: "/root/proj",
      ui: {
        custom: async (fn: typeof factory) => {
          factory = fn;
          return null;
        },
        notify,
      },
    } as unknown as ExtensionCommandContext;

    await command.handler("", ctx);
    expect(factory).toBeDefined();
    expect(notify).not.toHaveBeenCalled();

    const tui = { requestRender: () => {} };
    const component = factory?.(tui, theme, {}, () => {}) as {
      render: (width: number) => string[];
      handleInput: (data: string) => boolean;
      dispose: () => void;
    };
    expect(component.render(80).join("\n")).toContain("Token Usage");

    // The scan is async; let it settle, then assert the view has data.
    await vi.waitFor(() => {
      expect(component.render(120).join("\n")).toContain("$1.25");
    });
    component.dispose();
  });

  it("renders the loading state immediately, before the scan resolves", async () => {
    const command = await tokensHandler();
    let factory:
      | ((
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (result: null) => void,
        ) => { render: (width: number) => string[] })
      | undefined;

    const ctx = {
      cwd: "/root/proj",
      ui: {
        custom: async (fn: typeof factory) => {
          factory = fn;
          return null;
        },
        notify: vi.fn(),
      },
    } as unknown as ExtensionCommandContext;

    await command.handler("", ctx);
    const tui = { requestRender: () => {} };
    const component = factory?.(tui, theme, {}, () => {}) as {
      render: (width: number) => string[];
      dispose: () => void;
    };

    expect(component.render(80).join("\n")).toContain("Scanning sessions");
    component.dispose();
  });
});
