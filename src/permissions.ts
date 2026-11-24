// Permissions the user granted: "for this conversation" (in memory) or
// "always" (settings.allowedTools). aar itself only remembers "allow always"
// until the end of the current answer, so the widget keeps the grants and
// answers aar's permission requests for these tools on its own.

import { invoke } from "@tauri-apps/api/core";
import type { ToolCallInfo } from "./acp";
import { strings } from "./i18n";
import { describeTool } from "./tools";

const t = strings({
  de: {
    allowConversation: "Für dieses Gespräch erlauben",
    allowAlways: "Immer erlauben",
    allowedConversation: "✓ Für dieses Gespräch erlaubt",
    allowedAlways: "✓ Immer erlaubt",
    riskyNote: "Befehle, Skripte und Löschen gebe ich nur für ein Gespräch frei, nie dauerhaft.",
    autoAllowed: "✓ Ohne Nachfrage erlaubt: {what}",
    autoAllowedN: "✓ Ohne Nachfrage erlaubt: {what} ({n}×)",
    revoke: "Zurücknehmen",
    revoked: "Erlaubnis zurückgenommen – ich frage wieder.",
    head: "Erlaubnisse",
    intro: "Das darf Aar ohne Nachfrage tun. Alles andere fragt Aar vorher.",
    none: "Keine – Aar fragt vor jeder Änderung.",
    scopeAlways: "immer",
    scopeConversation: "nur dieses Gespräch",
    revokeAll: "Alle zurücknehmen",
  },
  en: {
    allowConversation: "Allow for this conversation",
    allowAlways: "Always allow",
    allowedConversation: "✓ Allowed for this conversation",
    allowedAlways: "✓ Always allowed",
    riskyNote: "Commands, scripts and deleting are only allowed for one conversation, never permanently.",
    autoAllowed: "✓ Allowed without asking: {what}",
    autoAllowedN: "✓ Allowed without asking: {what} ({n}×)",
    revoke: "Revoke",
    revoked: "Permission revoked – I'll ask again.",
    head: "Permissions",
    intro: "Aar may do this without asking. For everything else Aar asks first.",
    none: "None – Aar asks before every change.",
    scopeAlways: "always",
    scopeConversation: "this conversation only",
    revokeAll: "Revoke all",
  },
  zh: {
    allowConversation: "在本次对话中允许",
    allowAlways: "始终允许",
    allowedConversation: "✓ 已在本次对话中允许",
    allowedAlways: "✓ 已始终允许",
    riskyNote: "命令、脚本和删除只能在一次对话中允许，不能永久允许。",
    autoAllowed: "✓ 无需询问即允许：{what}",
    autoAllowedN: "✓ 无需询问即允许：{what}（{n} 次）",
    revoke: "撤销",
    revoked: "已撤销许可 – 我会再次询问。",
    head: "许可",
    intro: "Aar 可以无需询问执行以下操作。其他操作 Aar 都会先询问。",
    none: "无 – Aar 在每次更改前都会询问。",
    scopeAlways: "始终",
    scopeConversation: "仅本次对话",
    revokeAll: "全部撤销",
  },
});

export const permText = t;

/** Tools that can do a lot of harm with one call (any command, script, deleting):
 * the widget only lets the user allow them for one conversation. */
const RISKY_TOOLS = new Set([
  "bash", "powershell", "acp_terminal", "run_command", "shell", "spawn_agent",
  "evaluate_script", "browser_evaluate", "upload_file", "browser_file_upload",
  "delete_file", "move_file",
]);

export function shortName(tool: string): string {
  return tool.split(/__|\./).pop() ?? tool;
}

export function isRisky(tool: string, kind?: string): boolean {
  return kind === "delete" || kind === "move" || RISKY_TOOLS.has(shortName(tool)) || RISKY_TOOLS.has(tool);
}

/** "🖱️ Klicken" for a raw tool name. */
export function toolLabel(tool: string, kind?: string): string {
  const { icon, verb } = describeTool({ toolCallId: "", title: tool, kind } as ToolCallInfo);
  return `${icon} ${verb}`;
}

export type Scope = "always" | "conversation";

export class Grants {
  private always = new Set<string>();
  /** sessionId → tool names allowed in that conversation. */
  private conversation = new Map<string, Set<string>>();
  /** Last seen kind per tool (labels in the list). */
  private kinds = new Map<string, string>();

  load(tools: string[] | undefined) {
    this.always = new Set((tools ?? []).filter((x) => !isRisky(x)));
  }

  allowed(sid: string | null, tool: string): Scope | null {
    if (!tool) return null;
    if (this.always.has(tool) && !isRisky(tool, this.kinds.get(tool))) return "always";
    if (sid && this.conversation.get(sid)?.has(tool)) return "conversation";
    return null;
  }

  async grant(sid: string | null, tool: string, scope: Scope, kind?: string) {
    if (!tool) return;
    if (kind) this.kinds.set(tool, kind);
    if (scope === "always" && !isRisky(tool, kind)) {
      this.always.add(tool);
      await this.persist();
    } else if (sid) {
      let set = this.conversation.get(sid);
      if (!set) this.conversation.set(sid, (set = new Set()));
      set.add(tool);
    }
  }

  async revoke(sid: string | null, tool: string) {
    if (sid) this.conversation.get(sid)?.delete(tool);
    if (this.always.delete(tool)) await this.persist();
  }

  async revokeAll(sid: string | null) {
    if (sid) this.conversation.delete(sid);
    if (this.always.size) {
      this.always.clear();
      await this.persist();
    }
  }

  list(sid: string | null): Array<{ tool: string; scope: Scope; kind?: string }> {
    const out: Array<{ tool: string; scope: Scope; kind?: string }> = [];
    for (const tool of [...this.always].sort()) out.push({ tool, scope: "always", kind: this.kinds.get(tool) });
    for (const tool of [...(sid ? (this.conversation.get(sid) ?? []) : [])].sort()) {
      if (!this.always.has(tool)) out.push({ tool, scope: "conversation", kind: this.kinds.get(tool) });
    }
    return out;
  }

  private persist() {
    return invoke("set_allowed_tools", { tools: [...this.always].sort() });
  }
}

/** Settings → General → "Erlaubnisse". */
export function renderGrantList(host: HTMLElement, grants: Grants, sid: string | null, onError: (msg: string) => void) {
  const render = () => {
    host.innerHTML = "";
    const h = document.createElement("h3");
    h.textContent = t("head");
    const intro = document.createElement("p");
    intro.className = "hint";
    host.append(h, intro);
    const items = grants.list(sid);
    intro.textContent = items.length ? t("intro") : t("none");
    if (!items.length) return;
    const list = document.createElement("div");
    list.className = "grant-list";
    for (const g of items) {
      const row = document.createElement("div");
      row.className = "grant";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = toolLabel(g.tool, g.kind);
      name.title = g.tool;
      const scope = document.createElement("span");
      scope.className = `chip ${g.scope === "always" ? "on" : ""}`;
      scope.textContent = g.scope === "always" ? t("scopeAlways") : t("scopeConversation");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary";
      b.textContent = t("revoke");
      b.addEventListener("click", () => void grants.revoke(sid, g.tool).then(render, (e) => onError(String(e))));
      row.append(name, scope, b);
      list.appendChild(row);
    }
    host.appendChild(list);
    const all = document.createElement("button");
    all.type = "button";
    all.className = "link";
    all.id = "btn-revoke-all";
    all.textContent = t("revokeAll");
    all.addEventListener("click", () => void grants.revokeAll(sid).then(render, (e) => onError(String(e))));
    host.appendChild(all);
  };
  render();
}
