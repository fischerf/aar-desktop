// Minimal ACP (Agent Client Protocol, wire version 1) client.
// Transport: the Rust side pipes newline-delimited JSON-RPC to/from `aar acp`.

import { invoke } from "@tauri-apps/api/core";
import { pick } from "./i18n";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface ContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface ToolCallInfo {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: Array<{ type: string; content?: ContentBlock; [k: string]: unknown }>;
}

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: ContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | ({ sessionUpdate: "tool_call" } & ToolCallInfo)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallInfo)
  | { sessionUpdate: "plan"; entries: Array<{ content: string; status: string; priority?: string }> }
  | { sessionUpdate: "session_info_update"; title?: string }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "config_option_update"; configOptions?: ConfigOption[] }
  | { sessionUpdate: string; [k: string]: unknown };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallInfo;
  options: PermissionOption[];
}

export interface ConfigOption {
  id: string;
  name: string;
  category?: string;
  type: string;
  currentValue: string | boolean;
  options?: Array<{ value: string; name: string; description?: string }>;
}

/** ACP stdio MCP server description (passed to the agent per session). */
export interface McpServerStdio {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

/** ACP HTTP MCP server (remote tool server). */
export interface McpServerHttp {
  type: "http";
  name: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
}

export type McpServer = McpServerStdio | McpServerHttp;

export interface SessionInfo {
  sessionId: string;
  configOptions: ConfigOption[];
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | string;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  method: string;
}

export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

export interface AcpHandlers {
  onUpdate(sessionId: string, update: SessionUpdate): void;
  /** Return the chosen optionId, or null to cancel. */
  onPermission(req: PermissionRequest): Promise<string | null>;
  onExit(code: number | null, stderr: string): void;
}

export class AcpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private generation = 0;
  private unlisten: UnlistenFn[] = [];
  running = false;
  /** aar version from the initialize answer ("" if it did not say). */
  agentVersion = "";

  constructor(private handlers: AcpHandlers) {}

  async start(): Promise<void> {
    await this.dispose();
    this.unlisten.push(
      await listen<{ generation: number; line: string }>("agent://message", (e) => {
        if (e.payload.generation === this.generation) this.handleLine(e.payload.line);
      }),
      await listen<{ generation: number; code: number | null; stderr: string }>("agent://exit", (e) => {
        if (e.payload.generation !== this.generation) return;
        this.running = false;
        this.failAll(new Error(pick("Agent beendet", "Agent stopped", "代理已停止")));
        this.handlers.onExit(e.payload.code, e.payload.stderr);
      }),
    );
    this.generation = await invoke<number>("agent_start");
    this.running = true;

    const init = await this.request<{ protocolVersion: number; agentInfo?: { title?: string; version?: string } }>(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "aar-ui", title: "Aar Desktop", version: await invoke<string>("app_version").catch(() => "0") },
      },
      60_000,
    );
    this.agentVersion = init.agentInfo?.version ?? "";
    if (init.protocolVersion !== 1) {
      throw new Error(
        pick("Nicht unterstützte ACP-Version {v}", "Unsupported ACP version {v}", "不支持的 ACP 版本 {v}", {
          v: init.protocolVersion,
        }),
      );
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.generation = -1; // ignore the exit event of a deliberate stop
    await this.dispose();
    this.failAll(new Error(pick("Agent gestoppt", "Agent stopped", "代理已停止")));
    await invoke("agent_stop").catch(() => {});
  }

  private async dispose() {
    for (const u of this.unlisten) u();
    this.unlisten = [];
  }

  // -- sessions -------------------------------------------------------------

  async newSession(cwd: string, mcpServers: McpServer[] = []): Promise<SessionInfo> {
    const r = await this.request<{ sessionId: string; configOptions?: ConfigOption[] }>("session/new", {
      cwd,
      mcpServers,
    });
    return { sessionId: r.sessionId, configOptions: r.configOptions ?? [] };
  }

  /** Resume a saved session; history is replayed via session/update. Null if unknown. */
  async loadSession(sessionId: string, cwd: string, mcpServers: McpServer[] = []): Promise<SessionInfo | null> {
    const r = await this.request<{ configOptions?: ConfigOption[]; modes?: unknown } | null>("session/load", {
      sessionId,
      cwd,
      mcpServers,
    });
    // aar answers an unknown session with `{}` (spec: null); a real load
    // always carries the session's modes/config options.
    if (r === null || (r.configOptions === undefined && r.modes === undefined)) return null;
    return { sessionId, configOptions: r.configOptions ?? [] };
  }

  /** Send a prompt; `images` (base64, e.g. attached photos) go along as ACP image blocks. */
  async prompt(sessionId: string, text: string, images: Array<{ mimeType: string; data: string }> = []): Promise<StopReason> {
    const prompt = [{ type: "text", text }, ...images.map((i) => ({ type: "image", mimeType: i.mimeType, data: i.data }))];
    const r = await this.request<{ stopReason: StopReason }>("session/prompt", { sessionId, prompt }, 0);
    return r.stopReason;
  }

  cancel(sessionId: string) {
    this.notify("session/cancel", { sessionId });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<ConfigOption[]> {
    const r = await this.request<{ configOptions?: ConfigOption[] }>("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
    return r?.configOptions ?? [];
  }

  // -- JSON-RPC plumbing ------------------------------------------------------

  request<T = any>(method: string, params: unknown, timeoutMs = 120_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      let timer: number | undefined;
      const done = (fn: () => void) => {
        if (timer !== undefined) clearTimeout(timer);
        this.pending.delete(id);
        fn();
      };
      this.pending.set(id, {
        method,
        resolve: (v) => done(() => resolve(v)),
        reject: (e) => done(() => reject(e)),
      });
      if (timeoutMs > 0) {
        timer = window.setTimeout(
          () => this.pending.get(id)?.reject(new Error(pick("Zeitüberschreitung bei {m}", "Timed out: {m}", "超时：{m}", { m: method }))),
          timeoutMs,
        );
      }
      this.write({ jsonrpc: "2.0", id, method, params }).catch((e) => this.pending.get(id)?.reject(e));
    });
  }

  notify(method: string, params: unknown) {
    void this.write({ jsonrpc: "2.0", method, params }).catch(() => {});
  }

  private write(msg: unknown): Promise<void> {
    return invoke("agent_send", { line: JSON.stringify(msg) });
  }

  private failAll(err: Error) {
    for (const p of [...this.pending.values()]) p.reject(err);
  }

  private handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      console.warn("non-JSON line from agent:", line);
      return;
    }

    // Response to one of our requests.
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      else p.resolve(msg.result ?? null);
      return;
    }

    // Notification from the agent.
    if (msg.id === undefined) {
      if (msg.method === "session/update") {
        this.handlers.onUpdate(msg.params.sessionId, msg.params.update);
      }
      return;
    }

    // Request from the agent -> must answer.
    void this.handleAgentRequest(msg.id, msg.method, msg.params);
  }

  private async handleAgentRequest(id: number | string, method: string, params: any) {
    const reply = (body: { result?: unknown; error?: { code: number; message: string } }) =>
      this.write({ jsonrpc: "2.0", id, ...body }).catch(() => {});

    if (method === "session/request_permission") {
      try {
        const optionId = await this.handlers.onPermission(params as PermissionRequest);
        await reply({
          result: { outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } },
        });
      } catch {
        await reply({ result: { outcome: { outcome: "cancelled" } } });
      }
      return;
    }
    await reply({ error: { code: -32601, message: `Method not supported by aar-ui: ${method}` } });
  }
}
