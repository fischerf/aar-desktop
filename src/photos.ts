// Photo search: Settings → "Fotos" (folders, model, index) and the result
// card with thumbnails under a photo_search tool call.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale, strings } from "./i18n";
import { bestGpu, hasModel, type OllamaStatus, type SystemInfo } from "./setup";

const t = strings({
  de: {
    modelLabel: "Modell für die Fotobeschreibung (muss Bilder verstehen)",
    noFolders: "Noch keine Fotoordner. Füge die Ordner hinzu, in denen Aar suchen darf.",
    addFolder: "Ordner hinzufügen …",
    remove: "Entfernen",
    photosIn: "{n} Fotos",
    missing: "Ordner nicht gefunden",
    modelAuto: "Wie das Chat-Modell ({model})",
    modelAutoNone: "Wie das Chat-Modell",
    noteQwen: "Genauere Beschreibungen; braucht etwa 6 GB Arbeitsspeicher.",
    noteMoondream: "Sehr klein und schnell; einfachere Beschreibungen.",
    noGpuTag: "gut ohne Grafikkarte",
    toDownload: "{size} herunterladen",
    download: "Herunterladen ({size})",
    downloading: "Lade {model} herunter …",
    installingOllama: "Installiere den Modell-Server (Ollama) …",
    downloadDone: "{model} ist bereit.",
    downloadFailed: "Download fehlgeschlagen: {msg}",
    cancel: "Abbrechen",
    needsDownload: "Dieses Modell ist noch nicht auf diesem PC.",
    cpuNote: "Dieser PC hat keine passende Grafikkarte: Der Prozessor beschreibt die Fotos, das dauert pro Foto deutlich länger.",
    statusLine: "{indexed} von {photos} Fotos beschrieben",
    pending: "{n} neu oder geändert",
    errors: "{n} ließen sich nicht lesen",
    skipped: "{n} sehr kleine Bilder (Icons, Sprites unter 64 px) übersprungen",
    pruned: "Index der entfernten Ordner gelöscht ({n} Einträge).",
    running: "Beschreibe Fotos … {done} von {total}",
    estimate: "Dauer etwa {minutes} Min. (ca. {per} s pro Foto, Antworten im Chat können solange langsamer sein).",
    start: "Fotos jetzt beschreiben",
    stop: "Anhalten",
    clear: "Index löschen",
    clearSure: "Wirklich löschen?",
    cleared: "Der Index wurde gelöscht.",
    stopped: "Angehalten – beim nächsten Start geht es dort weiter.",
    finished: "Fertig.",
    restartNote: "Aar nutzt die geänderten Ordner ab dem Neustart (beim Schließen der Einstellungen).",
    more: "+ {n} weitere",
    showInFolder: "Im Ordner zeigen",
    photosFound: "🖼️ Gefundene Fotos ({n})",
  },
  en: {
    modelLabel: "Model that describes the photos (must understand images)",
    noFolders: "No photo folders yet. Add the folders Aar may search.",
    addFolder: "Add folder …",
    remove: "Remove",
    photosIn: "{n} photos",
    missing: "Folder not found",
    modelAuto: "Same as the chat model ({model})",
    modelAutoNone: "Same as the chat model",
    noteQwen: "More accurate descriptions; needs about 6 GB of memory.",
    noteMoondream: "Very small and fast; simpler descriptions.",
    noGpuTag: "good without a graphics card",
    toDownload: "download {size}",
    download: "Download ({size})",
    downloading: "Downloading {model} …",
    installingOllama: "Installing the model server (Ollama) …",
    downloadDone: "{model} is ready.",
    downloadFailed: "Download failed: {msg}",
    cancel: "Cancel",
    needsDownload: "This model is not on this PC yet.",
    cpuNote: "This PC has no suitable graphics card: the processor describes the photos, which takes much longer per photo.",
    statusLine: "{indexed} of {photos} photos described",
    pending: "{n} new or changed",
    errors: "{n} could not be read",
    skipped: "{n} very small images (icons, sprites under 64 px) skipped",
    pruned: "Index of the removed folders deleted ({n} entries).",
    running: "Describing photos … {done} of {total}",
    estimate: "Takes about {minutes} min (about {per} s per photo; chat answers may be slower meanwhile).",
    start: "Describe photos now",
    stop: "Pause",
    clear: "Delete index",
    clearSure: "Really delete?",
    cleared: "The index was deleted.",
    stopped: "Paused – next time it continues where it stopped.",
    finished: "Done.",
    restartNote: "Aar uses the changed folders after restarting (when you close the settings).",
    more: "+ {n} more",
    showInFolder: "Show in folder",
    photosFound: "🖼️ Photos found ({n})",
  },
  zh: {
    modelLabel: "用于描述照片的模型（必须能理解图像）",
    noFolders: "还没有照片文件夹。请添加允许 Aar 搜索的文件夹。",
    addFolder: "添加文件夹…",
    remove: "移除",
    photosIn: "{n} 张照片",
    missing: "找不到文件夹",
    modelAuto: "与聊天模型相同（{model}）",
    modelAutoNone: "与聊天模型相同",
    noteQwen: "描述更准确；需要约 6 GB 内存。",
    noteMoondream: "非常小巧快速；描述较简单。",
    noGpuTag: "无显卡也适用",
    toDownload: "下载 {size}",
    download: "下载（{size}）",
    downloading: "正在下载 {model} …",
    installingOllama: "正在安装模型服务器（Ollama）…",
    downloadDone: "{model} 已就绪。",
    downloadFailed: "下载失败：{msg}",
    cancel: "取消",
    needsDownload: "此模型尚未下载到这台电脑。",
    cpuNote: "这台电脑没有合适的显卡：将由处理器描述照片，每张照片耗时会长得多。",
    statusLine: "已描述 {indexed} / {photos} 张照片",
    pending: "{n} 张新增或已更改",
    errors: "{n} 张无法读取",
    skipped: "已跳过 {n} 张很小的图片（小于 64 像素的图标、精灵图）",
    pruned: "已删除被移除文件夹的索引（{n} 条）。",
    running: "正在描述照片… {done} / {total}",
    estimate: "大约需要 {minutes} 分钟（每张约 {per} 秒，期间聊天回答可能变慢）。",
    start: "立即描述照片",
    stop: "暂停",
    clear: "删除索引",
    clearSure: "确定删除？",
    cleared: "索引已删除。",
    stopped: "已暂停 – 下次会从中断处继续。",
    finished: "完成。",
    restartNote: "Aar 重新启动后（关闭设置时）使用更改后的文件夹。",
    more: "+ 另外 {n} 张",
    showInFolder: "在文件夹中显示",
    photosFound: "🖼️ 找到的照片（{n}）",
  },
});

/** Small vision models offered for describing photos (they also run on the
 * processor alone). Ollama names; sizes = download size. */
export const PHOTO_MODELS: Array<{ id: string; title: string; sizeGb: number; note: "noteQwen" | "noteMoondream" }> = [
  { id: "qwen3.5:4b", title: "Qwen 3.5 (4B)", sizeGb: 3.3, note: "noteQwen" },
  { id: "moondream:1.8b", title: "Moondream 2 (1.8B)", sizeGb: 1.7, note: "noteMoondream" },
];

const fmtGb = (n: number) => `${n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;

interface PhotoStatus {
  folders: Array<{ path: string; exists: boolean; photos: number }>;
  photos: number;
  indexed: number;
  pending: number;
  errors: number;
  skipped?: number;
  running: boolean;
  progress: { done?: number; total?: number; current?: string; error?: string; stopped?: boolean; finished?: number };
  model: string;
  modelProblem: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, cls: string, run: () => void): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", run);
  return b;
}

export class PhotosView {
  private folders: string[] = [];
  private model = "";
  private models: string[] = [];
  private status: PhotoStatus | null = null;
  private note: { text: string; tone: "ok" | "bad" | "" } | null = null;
  private confirmClear = false;
  private timer: number | undefined;
  private visible = false;
  private ollama: OllamaStatus | null = null;
  private noGpu = false;
  /** Running model download (from the catalog above). */
  private pull: { model: string; text: string; frac: number | null } | null = null;

  constructor(
    private readonly onChanged: () => void,
    private readonly errText: (e: unknown) => string,
  ) {}

  open(s: { photoFolders?: string[]; photoModel?: string }) {
    this.folders = [...(s.photoFolders ?? [])];
    this.model = s.photoModel ?? "";
    this.note = null;
    this.confirmClear = false;
  }

  async show() {
    this.visible = true;
    this.render();
    void this.loadModels();
    void invoke<SystemInfo>("setup_system_info")
      .then((info) => {
        this.noGpu = !bestGpu(info);
        this.rerender();
      })
      .catch(() => undefined);
    await this.refresh();
  }

  private async loadModels() {
    const [vision, ollama] = await Promise.all([
      invoke<{ models: string[] }>("photo_models").catch(() => ({ models: [] as string[] })),
      invoke<OllamaStatus>("setup_ollama_status").catch(() => null),
    ]);
    this.models = vision.models;
    this.ollama = ollama;
    this.rerender();
  }

  private present(model: string): boolean {
    const have = [...this.models, ...(this.ollama?.models ?? [])];
    return hasModel(have, model) || have.some((m) => sameModel(m, model));
  }

  /** Download a catalog model (installs/starts Ollama first when needed). */
  private async download(model: string) {
    if (this.pull) return;
    const title = PHOTO_MODELS.find((m) => m.id === model)?.title ?? model;
    this.pull = { model, text: t("downloading", { model: title }), frac: null };
    this.note = null;
    this.render();
    const stop = await listen<{ message: string; done: number; total: number }>("setup://progress", (e) => {
      if (!this.pull) return;
      const p = e.payload;
      this.pull.text = p.message;
      this.pull.frac = p.total > 0 ? p.done / p.total : null;
      this.rerender();
    });
    try {
      let st = this.ollama ?? (await invoke<OllamaStatus>("setup_ollama_status"));
      if (!st.running) {
        this.pull.text = st.installed ? t("downloading", { model: title }) : t("installingOllama");
        this.rerender();
        st = await invoke<OllamaStatus>(st.installed ? "setup_ollama_start" : "setup_ollama_install");
      }
      await invoke("setup_ollama_pull", { model });
      this.note = { text: t("downloadDone", { model: title }), tone: "ok" };
    } catch (e) {
      this.note = { text: t("downloadFailed", { msg: this.errText(e) }), tone: "bad" };
    } finally {
      stop();
      this.pull = null;
    }
    await this.loadModels();
    await this.refresh();
  }

  hide() {
    this.visible = false;
    window.clearTimeout(this.timer);
  }

  rerender() {
    if (this.visible) this.render();
  }

  private async refresh() {
    window.clearTimeout(this.timer);
    try {
      this.status = await invoke<PhotoStatus>("photos_status");
    } catch (e) {
      this.note = { text: this.errText(e), tone: "bad" };
    }
    if (!this.visible) return;
    this.render();
    // Poll while indexing runs.
    if (this.status?.running) this.timer = window.setTimeout(() => void this.refresh(), 2000);
  }

  private async save() {
    try {
      const removed = await invoke<number>("set_photo_settings", { folders: this.folders, model: this.model });
      this.note = { text: removed ? `${t("pruned", { n: removed })} ${t("restartNote")}` : t("restartNote"), tone: "ok" };
      this.onChanged();
    } catch (e) {
      this.note = { text: this.errText(e), tone: "bad" };
    }
    await this.refresh();
  }

  private render() {
    const host = document.getElementById("photos-pane-body");
    if (!host) return;
    host.innerHTML = "";
    const st = this.status;

    // Folders
    const list = el("div", "addon-list");
    if (!this.folders.length) list.appendChild(el("p", "hint", t("noFolders")));
    for (const f of this.folders) {
      const info = st?.folders.find((x) => x.path === f);
      const row = el("div", "addon photo-folder");
      const head = el("div", "addon-head");
      head.appendChild(el("span", "addon-title mono", f));
      if (info) head.appendChild(el("span", `chip ${info.exists ? "" : "off"}`, info.exists ? t("photosIn", { n: info.photos }) : t("missing")));
      row.appendChild(head);
      const actions = el("div", "addon-actions");
      actions.appendChild(
        button(t("remove"), "danger", () => {
          this.folders = this.folders.filter((x) => x !== f);
          void this.save();
        }),
      );
      row.appendChild(actions);
      list.appendChild(row);
    }
    host.appendChild(list);
    const add = el("p");
    add.appendChild(
      button(t("addFolder"), "secondary", async () => {
        const dir = await invoke<string | null>("pick_folder").catch(() => null);
        if (!dir || this.folders.includes(dir)) return;
        this.folders.push(dir);
        await this.save();
      }),
    );
    host.appendChild(add);

    // Model
    const lab = el("label", "", "");
    lab.appendChild(document.createTextNode(t("modelLabel")));
    const sel = el("select");
    sel.id = "photo-model";
    const auto = el("option", "", st?.model && !this.model ? t("modelAuto", { model: st.model }) : t("modelAutoNone"));
    auto.value = "";
    sel.appendChild(auto);
    for (const m of PHOTO_MODELS) {
      const tags = [this.noGpu ? t("noGpuTag") : "", this.present(m.id) ? "" : t("toDownload", { size: fmtGb(m.sizeGb) })];
      const o = el("option", "", [m.title, ...tags.filter(Boolean)].join(" – "));
      o.value = m.id;
      sel.appendChild(o);
    }
    for (const m of new Set([...this.models, ...(this.model ? [this.model] : [])])) {
      // "moondream:latest" is the catalog's "moondream:1.8b" (same model).
      if (PHOTO_MODELS.some((c) => hasModel([m], c.id) || sameModel(m, c.id))) continue;
      const o = el("option", "", m);
      o.value = m;
      sel.appendChild(o);
    }
    sel.value = PHOTO_MODELS.find((c) => this.model && (hasModel([this.model], c.id) || sameModel(this.model, c.id)))?.id ?? this.model;
    sel.disabled = !!this.pull;
    sel.addEventListener("change", () => {
      this.model = sel.value;
      void this.save();
    });
    lab.appendChild(sel);
    host.appendChild(lab);
    const chosen = PHOTO_MODELS.find((m) => m.id === sel.value);
    const missing = !!chosen && !this.present(chosen.id);
    if (chosen) host.appendChild(el("p", "hint", missing ? `${t(chosen.note)} ${t("needsDownload")}` : t(chosen.note)));
    if (this.noGpu && (chosen || !this.model)) host.appendChild(el("p", "hint", t("cpuNote")));
    if (this.pull) {
      host.appendChild(el("p", "hint", this.pull.text));
      const bar = el("progress");
      if (this.pull.frac !== null) bar.value = this.pull.frac;
      host.appendChild(bar);
      const a = el("div", "addon-actions");
      a.appendChild(button(t("cancel"), "secondary", () => void invoke("setup_cancel")));
      host.appendChild(a);
    } else if (chosen && missing) {
      const a = el("div", "addon-actions");
      a.appendChild(button(t("download", { size: fmtGb(chosen.sizeGb) }), "primary", () => void this.download(chosen.id)));
      host.appendChild(a);
    }

    // Status
    if (st) {
      const p = st.progress ?? {};
      const lines: Array<{ text: string; tone?: string }> = [];
      if (st.modelProblem) lines.push({ text: st.modelProblem, tone: "bad" });
      lines.push({ text: t("statusLine", { indexed: st.indexed, photos: st.photos }) });
      if (st.pending && !st.running) {
        lines.push({ text: `${t("pending", { n: st.pending })} · ${t("estimate", { minutes: Math.max(1, Math.round((st.pending * (this.noGpu ? 25 : 4)) / 60)), per: this.noGpu ? "15–40" : "2–5" })}` });
      }
      if (st.skipped) lines.push({ text: t("skipped", { n: st.skipped }) });
      if (st.errors) lines.push({ text: t("errors", { n: st.errors }) });
      if (!st.running && p.error) lines.push({ text: p.error, tone: "bad" });
      for (const l of lines) host.appendChild(el("p", `hint ${l.tone ?? ""}`, l.text));
      if (st.running) {
        host.appendChild(el("p", "hint", t("running", { done: p.done ?? 0, total: p.total ?? 0 })));
        const bar = el("progress");
        bar.max = Math.max(1, p.total ?? 1);
        bar.value = p.done ?? 0;
        host.appendChild(bar);
        if (p.current) host.appendChild(el("p", "hint progress-line", p.current));
      }
    }
    if (this.note) host.appendChild(el("p", `hint ${this.note.tone}`, this.note.text));

    // Actions
    const actions = el("div", "addon-actions photo-actions");
    if (st?.running) {
      actions.appendChild(
        button(t("stop"), "secondary", async () => {
          await invoke("photos_index_stop").catch(() => undefined);
          this.note = { text: t("stopped"), tone: "" };
          window.setTimeout(() => void this.refresh(), 1500);
        }),
      );
    } else {
      const start = button(t("start"), "primary", async () => {
        try {
          await invoke("photos_index_start");
          this.note = null;
          window.setTimeout(() => void this.refresh(), 800);
        } catch (e) {
          this.note = { text: this.errText(e), tone: "bad" };
          this.render();
        }
      });
      start.disabled =
        !this.folders.length || !!st?.modelProblem || (st ? st.pending === 0 : false) || !!this.pull || missing;
      actions.appendChild(start);
    }
    const clear = button(this.confirmClear ? t("clearSure") : t("clear"), "danger", async () => {
      if (!this.confirmClear) {
        this.confirmClear = true;
        return this.render();
      }
      this.confirmClear = false;
      try {
        await invoke("photos_clear");
        this.note = { text: t("cleared"), tone: "ok" };
      } catch (e) {
        this.note = { text: this.errText(e), tone: "bad" };
      }
      await this.refresh();
    });
    clear.disabled = !!st?.running || !st?.indexed;
    actions.appendChild(clear);
    host.appendChild(actions);
  }
}

/** "moondream:latest" and "moondream:1.8b" point to the same download. */
function sameModel(a: string, b: string): boolean {
  const alias: Record<string, string> = { "moondream:latest": "moondream:1.8b", moondream: "moondream:1.8b" };
  return (alias[a] ?? a) === (alias[b] ?? b);
}

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------

const RESULT_LINE = /^\d+\.\s+(.+?)\s+—\s+(\S*)\s+—\s+(.*)$/;
const SHOWN = 24;

/** Gallery for the output of photo_search (null when nothing was found). */
export function photoResultCard(output: string, onError: (text: string) => void): HTMLElement | null {
  const hits = output
    .split(/\r?\n/)
    .map((l) => RESULT_LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ path: m[1], taken: m[2], description: m[3] }));
  if (!hits.length) return null;
  const card = el("div", "photos-card");
  card.appendChild(el("div", "q", t("photosFound", { n: hits.length })));
  const grid = el("div", "photo-grid");
  for (const h of hits.slice(0, SHOWN)) {
    const cell = el("div", "photo");
    const img = el("img");
    img.alt = h.description;
    img.loading = "lazy";
    cell.title = `${h.path}\n${h.taken}\n${h.description}`;
    void invoke<string | null>("photo_thumb", { path: h.path }).then((src) => {
      if (src && src.startsWith("data:image/jpeg;base64,")) img.src = src;
      else cell.classList.add("no-thumb");
    });
    img.addEventListener("click", () => void invoke("open_file", { path: h.path, reveal: false }).catch((e) => onError(String(e))));
    const reveal = button("📂", "reveal", () => void invoke("open_file", { path: h.path, reveal: true }).catch((e) => onError(String(e))));
    reveal.title = t("showInFolder");
    cell.append(img, reveal);
    grid.appendChild(cell);
  }
  card.appendChild(grid);
  if (hits.length > SHOWN) card.appendChild(el("div", "hint", t("more", { n: hits.length - SHOWN })));
  return card;
}
