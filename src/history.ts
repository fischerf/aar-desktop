// Conversation list (🕘 in the header): saved aar sessions, newest first;
// a click continues the conversation (session/load), ✕ deletes it.

import { invoke } from "@tauri-apps/api/core";
import { locale, strings } from "./i18n";

const t = strings({
  de: {
    title: "Gespräche",
    intro: "Klick auf ein Gespräch, um es fortzusetzen.",
    empty: "Noch keine gespeicherten Gespräche.",
    loading: "Lade …",
    current: "aktuell",
    imageOnly: "(Bild)",
    remove: "Löschen",
    confirmRemove: "Wirklich löschen?",
    today: "heute, {time}",
    yesterday: "gestern, {time}",
    failed: "Die Gespräche konnten nicht gelesen werden: {error}",
  },
  en: {
    title: "Conversations",
    intro: "Click a conversation to continue it.",
    empty: "No saved conversations yet.",
    loading: "Loading …",
    current: "current",
    imageOnly: "(image)",
    remove: "Delete",
    confirmRemove: "Really delete?",
    today: "today, {time}",
    yesterday: "yesterday, {time}",
    failed: "Could not read the conversations: {error}",
  },
  zh: {
    title: "对话",
    intro: "点击一个对话即可继续。",
    empty: "还没有保存的对话。",
    loading: "加载中…",
    current: "当前",
    imageOnly: "（图片）",
    remove: "删除",
    confirmRemove: "确定删除？",
    today: "今天 {time}",
    yesterday: "昨天 {time}",
    failed: "无法读取对话：{error}",
  },
});

export const historyText = t;

interface SessionEntry {
  id: string;
  title: string;
  modifiedMs: number;
}

export interface HistoryHost {
  show(on: boolean): void;
  /** Continue a saved conversation. */
  load(id: string): Promise<void>;
  /** Id of the conversation shown right now. */
  current(): string | null;
  /** The shown conversation was deleted. */
  deletedCurrent(): void;
}

const $ = (id: string) => document.getElementById(id)!;

export class HistoryView {
  private open = false;

  constructor(private host: HistoryHost) {
    $("btn-history-back").addEventListener("click", () => this.close());
  }

  get isOpen() {
    return this.open;
  }

  async toggle() {
    if (this.open) this.close();
    else await this.show();
  }

  async show() {
    this.open = true;
    this.host.show(true);
    this.applyStatic();
    const list = $("history-list");
    list.textContent = t("loading");
    let entries: SessionEntry[] = [];
    try {
      entries = await invoke<SessionEntry[]>("list_sessions");
    } catch (e) {
      list.textContent = t("failed", { error: String(e) });
      return;
    }
    if (this.open) this.render(entries);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.host.show(false);
  }

  /** Texts of the static part (language may have changed). */
  applyStatic() {
    $("history-title").textContent = t("title");
    $("history-intro").textContent = t("intro");
  }

  rerender() {
    if (this.open) void this.show();
  }

  private render(entries: SessionEntry[]) {
    const list = $("history-list");
    list.innerHTML = "";
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = t("empty");
      list.appendChild(p);
      return;
    }
    const current = this.host.current();
    for (const e of entries) {
      const row = document.createElement("div");
      row.className = "history-item";
      if (e.id === current) row.classList.add("current");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-entry";
      open.dataset.session = e.id;
      const title = document.createElement("span");
      title.className = "history-title";
      title.textContent = e.title || t("imageOnly");
      const when = document.createElement("span");
      when.className = "history-when";
      when.textContent = e.id === current ? `${formatWhen(e.modifiedMs)} · ${t("current")}` : formatWhen(e.modifiedMs);
      open.append(title, when);
      open.addEventListener("click", () => {
        this.close();
        void this.host.load(e.id);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn history-delete";
      del.textContent = "🗑";
      del.title = t("remove");
      del.setAttribute("aria-label", t("remove"));
      del.addEventListener("click", async () => {
        // Two steps: the first click asks, the second deletes.
        if (!row.classList.contains("confirm")) {
          row.classList.add("confirm");
          del.textContent = t("confirmRemove");
          return;
        }
        try {
          await invoke("delete_session", { id: e.id });
          row.remove();
          if (e.id === this.host.current()) this.host.deletedCurrent();
          if (!list.querySelector(".history-item")) this.render([]);
        } catch (err) {
          del.textContent = String(err);
        }
      });
      row.append(open, del);
      list.appendChild(row);
    }
  }
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return t("today", { time });
  if (diff === 1) return t("yesterday", { time });
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
