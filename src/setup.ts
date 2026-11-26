// First-run setup wizard: check hardware, pick a model, install/start Ollama,
// download the model. The heavy lifting happens in Rust (src-tauri/src/setup.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale, strings } from "./i18n";

const t = strings({
  de: {
    noteBest: "Beste Qualität – braucht eine Grafikkarte mit mind. 20 GB Speicher",
    noteBalanced: "Ausgewogen – läuft auch ohne starke Grafikkarte",
    noteSmall: "Klein und schnell – für schwächere Rechner",
    noteEu: "Europäisches Modell von Mistral AI (Frankreich) – braucht eine Grafikkarte mit mind. 12 GB Speicher",
    tagEu: "EU-Modell",
    onGpu: "läuft auf der Grafikkarte {gpu}",
    onCpu: "läuft auf dem Prozessor ({ram} Arbeitsspeicher)",
    checking: "Prüfe …",
    ram: "{ram} Arbeitsspeicher",
    noGpu: "keine geeignete Grafikkarte",
    recommended: "empfohlen",
    present: "vorhanden",
    tooBig: "zu groß für diesen PC",
    running: "läuft (Version {version})",
    installedStarting: "installiert – wird gestartet",
    notInstalled: "nicht installiert – wird automatisch installiert (ca. 2 GB Download)",
    why: " Empfohlen, {reason}.",
    tooBigWarn: " ⚠ Für diesen PC zu groß – wird sehr langsam sein.",
    alreadyPresent: "bereits vorhanden",
    willDownload: "{size} werden heruntergeladen",
    apply: "Übernehmen",
    setUp: "Einrichten",
    cancel: "Abbrechen",
    starting: "Starte …",
    downloading: "Lade herunter …",
    startDownload: "Starte Download …",
    done: "fertig",
    cancelled: "Abgebrochen.",
    failed: "Einrichtung fehlgeschlagen: {msg}",
    retry: "Erneut versuchen",
    later: "Später",
    of: "{done} von {total}",
    optional: "(optional)",
    kindGemini: "Google Gemini (Cloud / Custom)",
    kindAnthropic: "Anthropic Claude – Cloud",
    kindOpenai: "OpenAI (Cloud / Custom)",
    kindGeneric: "Anderer Dienst (OpenAI-kompatibel)",
    geminiUrl: "leer = Google Gemini, oder eigene Gateway-URL",
    genericUrl: "z. B. https://example.com/v1/chat/completions",
    providerDefaultUrl: "leer = Standardadresse des Anbieters",
    modelPlaceholderGemini: "z. B. gemini-3.1-flash-lite",
    modelPlaceholderDefault: "nach „Testen“ aus der Liste wählen",
    cloudNote: "☁ Mit {name} gehen deine Nachrichten und alles, was Aar liest (Fenster, Dateien, Webseiten), an diesen Dienst.",
    checkingProvider: "Prüfe {name} …",
    apiKeyRequired: "Bitte den API-Schlüssel für {name} eintragen.",
    baseUrlRequired: "Bitte die Server-Adresse eintragen.",
    modelRequired: "Bitte ein Modell eintragen.",
    modelNotOnServer: "⚠ „{model}“ ist auf diesem Server nicht vorhanden.",
    introLocal: "Aar nutzt ein Sprachmodell, das direkt auf diesem Computer läuft – deine Daten bleiben hier. Ich richte alles automatisch ein.",
    introCloud: "Verbinde Aar mit einem Cloud-Anbieter (z. B. Google Gemini, OpenAI, Anthropic) oder einem eigenen API-Gateway.",
  },
  en: {
    noteBest: "Best quality – needs a graphics card with at least 20 GB of memory",
    noteBalanced: "Balanced – also runs without a powerful graphics card",
    noteSmall: "Small and fast – for less powerful computers",
    noteEu: "European model by Mistral AI (France) – needs a graphics card with at least 12 GB of memory",
    tagEu: "EU model",
    onGpu: "runs on the graphics card {gpu}",
    onCpu: "runs on the processor ({ram} of memory)",
    checking: "Checking …",
    ram: "{ram} of memory",
    noGpu: "no suitable graphics card",
    recommended: "recommended",
    present: "already downloaded",
    tooBig: "too big for this PC",
    running: "running (version {version})",
    installedStarting: "installed – will be started",
    notInstalled: "not installed – will be installed automatically (about 2 GB download)",
    why: " Recommended, {reason}.",
    tooBigWarn: " ⚠ Too big for this PC – it will be very slow.",
    alreadyPresent: "already downloaded",
    willDownload: "{size} will be downloaded",
    apply: "Use it",
    setUp: "Set up",
    cancel: "Cancel",
    starting: "Starting …",
    downloading: "Downloading …",
    startDownload: "Starting download …",
    done: "done",
    cancelled: "Cancelled.",
    failed: "Setup failed: {msg}",
    retry: "Try again",
    later: "Later",
    of: "{done} of {total}",
    optional: "(optional)",
    kindGemini: "Google Gemini (Cloud / Custom)",
    kindAnthropic: "Anthropic Claude – cloud",
    kindOpenai: "OpenAI (Cloud / Custom)",
    kindGeneric: "Other service (OpenAI-compatible)",
    geminiUrl: "empty = Google Gemini, or custom gateway URL",
    genericUrl: "e.g. https://example.com/v1/chat/completions",
    providerDefaultUrl: "empty = the provider's default address",
    modelPlaceholderGemini: "e.g. gemini-3.1-flash-lite",
    modelPlaceholderDefault: "pick one from the list after “Test”",
    cloudNote: "☁ With {name}, your messages and everything Aar reads (windows, files, web pages) go to that service.",
    checkingProvider: "Checking {name} …",
    apiKeyRequired: "Please enter the API key for {name}.",
    baseUrlRequired: "Please enter the server address.",
    modelRequired: "Please enter a model.",
    modelNotOnServer: "⚠ “{model}” is not available on this server.",
    introLocal: "Aar uses a language model that runs right on this computer – your data stays here. I'll set everything up automatically.",
    introCloud: "Connect Aar to a cloud provider (e.g. Google Gemini, OpenAI, Anthropic) or your own API gateway.",
  },
  zh: {
    noteBest: "质量最佳 – 需要至少 20 GB 显存的显卡",
    noteBalanced: "均衡 – 没有高性能显卡也能运行",
    noteSmall: "小巧快速 – 适合配置较低的电脑",
    noteEu: "来自 Mistral AI（法国）的欧洲模型 – 需要至少 12 GB 显存的显卡",
    tagEu: "欧盟模型",
    onGpu: "在显卡 {gpu} 上运行",
    onCpu: "在处理器上运行（{ram} 内存）",
    checking: "正在检查 …",
    ram: "{ram} 内存",
    noGpu: "没有合适的显卡",
    recommended: "推荐",
    present: "已下载",
    tooBig: "对这台电脑来说太大",
    running: "运行中（版本 {version}）",
    installedStarting: "已安装 – 即将启动",
    notInstalled: "未安装 – 将自动安装（约 2 GB 下载）",
    why: " 推荐，{reason}。",
    tooBigWarn: " ⚠ 对这台电脑来说太大 – 运行会非常慢。",
    alreadyPresent: "已下载",
    willDownload: "将下载 {size}",
    apply: "使用",
    setUp: "开始设置",
    cancel: "取消",
    starting: "正在启动 …",
    downloading: "正在下载 …",
    startDownload: "开始下载 …",
    done: "完成",
    cancelled: "已取消。",
    failed: "设置失败：{msg}",
    retry: "重试",
    later: "稍后",
    of: "{done} / {total}",
    optional: "（可选）",
    kindGemini: "Google Gemini（云端 / 自定义）",
    kindAnthropic: "Anthropic Claude – 云端",
    kindOpenai: "OpenAI（云端 / 自定义）",
    kindGeneric: "其他服务（兼容 OpenAI）",
    geminiUrl: "留空 = Google Gemini，或自定义网关地址",
    genericUrl: "例如 https://example.com/v1/chat/completions",
    providerDefaultUrl: "留空 = 提供方的默认地址",
    modelPlaceholderGemini: "例如 gemini-3.1-flash-lite",
    modelPlaceholderDefault: "点击“测试”后从列表中选择",
    cloudNote: "☁ 使用 {name} 时，你的消息以及 Aar 读取的所有内容（窗口、文件、网页）都会发送到该服务。",
    checkingProvider: "正在检查 {name} …",
    apiKeyRequired: "请填写 {name} 的 API 密钥。",
    baseUrlRequired: "请填写服务器地址。",
    modelRequired: "请填写模型。",
    modelNotOnServer: "⚠ 此服务器上没有“{model}”。",
    introLocal: "Aar 使用直接运行在这台电脑上的语言模型 – 你的数据不会离开这里。我会自动完成所有设置。",
    introCloud: "将 Aar 连接到云端提供方（如 Google Gemini、OpenAI、Anthropic）或自定义 API 网关。",
  },
});

type NoteKey = "noteBest" | "noteBalanced" | "noteSmall" | "noteEu";

/** Rust reports a cancelled setup with this text (in any UI language). */
const CANCELLED = ["Abgebrochen", "Cancelled", "已取消"];

export interface Gpu {
  name: string;
  vendor: "nvidia" | "amd" | "intel" | "other" | string;
  vramMb: number;
}
export interface SystemInfo {
  ramMb: number;
  cpuThreads: number;
  gpus: Gpu[];
}
export interface OllamaStatus {
  installed: boolean;
  exe: string | null;
  running: boolean;
  version: string | null;
  models: string[];
}
interface Progress {
  phase: "download" | "install" | "start" | "pull";
  message: string;
  done: number;
  total: number;
}

export interface ModelChoice {
  id: string;
  title: string;
  sizeGb: number;
  /** Minimum dedicated GPU memory to run it on the GPU. */
  minVramGb: number;
  /** Usable on CPU only (system RAM) at all? */
  cpuOk: boolean;
  minRamGb: number;
  /** Short description (translated at display time). */
  note: NoteKey;
  /** Made in the EU - the wizard shows the EU flag so EU users can pick it. */
  eu?: boolean;
  /** Offered in the list, but never suggested automatically. */
  optional?: boolean;
}

/** Ordered best → smallest. Sizes from the Ollama registry (download size). */
export const MODEL_CATALOG: ModelChoice[] = [
  {
    id: "qwen3.8:latest",
    title: "Qwen 3.8 (27B)",
    sizeGb: 17.7,
    minVramGb: 20,
    cpuOk: false,
    minRamGb: 32,
    note: "noteBest",
  },
  {
    id: "ministral-3:14b",
    title: "Ministral 3 (14B)",
    sizeGb: 9.1,
    minVramGb: 12,
    cpuOk: false,
    minRamGb: 24,
    note: "noteEu",
    eu: true,
    // Sandbox tests: a bit below Gemma 4 on desktop tasks, too slow on the processor.
    optional: true,
  },
  {
    id: "gemma4:e4b",
    title: "Gemma 4 (E4B)",
    sizeGb: 6.6,
    minVramGb: 8,
    cpuOk: true,
    minRamGb: 12,
    note: "noteBalanced",
  },
  {
    id: "qwen3.5:4b",
    title: "Qwen 3.5 (4B)",
    sizeGb: 3.3,
    minVramGb: 4,
    cpuOk: true,
    minRamGb: 6,
    note: "noteSmall",
  },
];

/** Small EU flag as SVG - Windows shows the 🇪🇺 emoji only as the letters "EU". */
export function euFlag(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 30 20");
  svg.setAttribute("class", "eu-flag");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "EU");
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", "30");
  bg.setAttribute("height", "20");
  bg.setAttribute("fill", "#003399");
  svg.appendChild(bg);
  // Twelve five-pointed stars on a circle (radius 6 around the centre).
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const cx = 15 + 6 * Math.sin(a);
    const cy = 10 - 6 * Math.cos(a);
    const pts: string[] = [];
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 1.1 : 0.45;
      const b = (k * Math.PI) / 5;
      pts.push(`${(cx + r * Math.sin(b)).toFixed(2)},${(cy - r * Math.cos(b)).toFixed(2)}`);
    }
    const star = document.createElementNS(ns, "polygon");
    star.setAttribute("points", pts.join(" "));
    star.setAttribute("fill", "#FFCC00");
    svg.appendChild(star);
  }
  return svg;
}

/** Dedicated GPUs Ollama can use (NVIDIA/AMD); integrated graphics are ignored. */
export function bestGpu(info: SystemInfo): Gpu | undefined {
  return info.gpus
    .filter((g) => (g.vendor === "nvidia" || g.vendor === "amd") && g.vramMb >= 2048)
    .sort((a, b) => b.vramMb - a.vramMb)[0];
}

export function fits(m: ModelChoice, info: SystemInfo): boolean {
  const vram = (bestGpu(info)?.vramMb ?? 0) / 1024;
  const ram = info.ramMb / 1024;
  return vram >= m.minVramGb || (m.cpuOk && ram >= m.minRamGb);
}

export function recommend(info: SystemInfo): { model: ModelChoice; reason: string } {
  const model = MODEL_CATALOG.find((m) => !m.optional && fits(m, info)) ?? MODEL_CATALOG[MODEL_CATALOG.length - 1];
  const gpu = bestGpu(info);
  const vram = (gpu?.vramMb ?? 0) / 1024;
  const reason =
    gpu && vram >= model.minVramGb
      ? t("onGpu", { gpu: gpu.name })
      : t("onCpu", { ram: gb(info.ramMb) });
  return { model, reason };
}

/** Context size (tokens) for the model on this PC. aar's system prompt plus the
 * desktop tools alone are ~4.5k tokens, a window tree or web page adds 2-3k per
 * step - Ollama's own default on small machines (4k) cuts that off. */
export function contextFor(info: SystemInfo | null): number {
  return (info?.ramMb ?? 0) >= 15 * 1024 ? 32768 : 16384;
}

/** Ollama treats "name" and "name:latest" as the same model. */
export function hasModel(models: string[], model: string): boolean {
  const norm = (m: string) => (m.includes(":") ? m : `${m}:latest`);
  return models.some((m) => norm(m) === norm(model));
}

export function gb(mb: number): string {
  return `${Math.round(mb / 1024)} GB`;
}

/** "6,6 GB" / "6.6 GB" depending on the UI language. */
function fmtGb(n: number): string {
  return `${n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return fmtGb(n / 1e9);
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} kB`;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

export interface CloudSetupResult {
  name: string;
  kind: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface SetupHost {
  /** Show/hide the setup view inside the bubble. */
  show(on: boolean): void;
  /** Called after success with the chosen Ollama model and a context size for it. */
  done(model: string, contextWindow: number): Promise<void>;
  /** Called after configuring a cloud or custom provider in the wizard. */
  doneCloud(config: CloudSetupResult): Promise<void>;
}

type SetupMode = "local" | "cloud";
type StepState = "pending" | "current" | "active" | "done" | "error" | "skip";

const CLOUD_SETUP_KINDS = ["gemini", "anthropic", "openai", "generic"] as const;
type CloudKindKey = "kindGemini" | "kindAnthropic" | "kindOpenai" | "kindGeneric";
const CLOUD_KIND_TEXT: Record<string, CloudKindKey> = {
  gemini: "kindGemini",
  anthropic: "kindAnthropic",
  openai: "kindOpenai",
  generic: "kindGeneric",
};

interface EndpointCheck {
  reachable: boolean;
  message: string;
  models: string[];
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class SetupWizard {
  private info: SystemInfo | null = null;
  private ollama: OllamaStatus | null = null;
  private running = false;
  private activeStep = "";
  private mode: SetupMode = "local";

  constructor(private host: SetupHost) {
    void listen<Progress>("setup://progress", (e) => this.onProgress(e.payload));
    $("btn-setup-start").addEventListener("click", () => void this.run());
    $("btn-setup-cancel").addEventListener("click", () => this.close());
    $("setup-model").addEventListener("change", () => this.describeChoice());
    for (const btn of document.querySelectorAll<HTMLElement>("#setup [data-setup-mode]")) {
      btn.addEventListener("click", () => {
        if (!this.running) this.setMode(btn.dataset.setupMode as SetupMode);
      });
    }
    $("setup-cloud-kind").addEventListener("change", () => this.updateCloudFields());
    $("btn-setup-cloud-test").addEventListener("click", () => void this.testCloud());
  }

  get busy() {
    return this.running;
  }

  private fillCloudKinds(selected = "gemini") {
    const sel = $<HTMLSelectElement>("setup-cloud-kind");
    sel.innerHTML = "";
    for (const k of CLOUD_SETUP_KINDS) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = t(CLOUD_KIND_TEXT[k]);
      sel.appendChild(o);
    }
    sel.value = CLOUD_SETUP_KINDS.includes(selected as (typeof CLOUD_SETUP_KINDS)[number]) ? selected : "gemini";
    $("setup-cloud-name-hint").textContent = t("optional");
    this.updateCloudFields();
  }

  private cloudKindName(kind: string): string {
    const key = CLOUD_KIND_TEXT[kind];
    return key ? t(key).replace(/ (–|\().*$/, "") : kind;
  }

  private updateCloudFields() {
    const kind = $<HTMLSelectElement>("setup-cloud-kind").value;
    const baseInput = $<HTMLInputElement>("setup-cloud-baseurl");
    const modelInput = $<HTMLInputElement>("setup-cloud-model");
    baseInput.placeholder =
      kind === "gemini"
        ? t("geminiUrl")
        : kind === "generic"
          ? t("genericUrl")
          : t("providerDefaultUrl");
    modelInput.placeholder = kind === "gemini" ? t("modelPlaceholderGemini") : t("modelPlaceholderDefault");
    $("setup-cloud-note").textContent = t("cloudNote", { name: this.cloudKindName(kind) });
  }

  private setMode(mode: SetupMode) {
    this.mode = mode;
    for (const btn of document.querySelectorAll<HTMLElement>("#setup [data-setup-mode]")) {
      const on = btn.dataset.setupMode === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    }
    $("setup-local").hidden = mode !== "local";
    $("setup-cloud").hidden = mode !== "cloud";
    $("setup-intro").textContent = mode === "cloud" ? t("introCloud") : t("introLocal");
    $("setup-error").textContent = "";
    const startBtn = $<HTMLButtonElement>("btn-setup-start");
    if (mode === "cloud") {
      startBtn.disabled = false;
      startBtn.textContent = t("apply");
    } else {
      startBtn.disabled = !this.info || !this.ollama;
      if (this.info && this.ollama) this.describeChoice();
      else startBtn.textContent = t("setUp");
    }
  }

  private setCloudTestHint(text: string, tone: "" | "ok" | "bad" = "") {
    const el = $("setup-cloud-test-result");
    el.textContent = text;
    el.className = `hint ${tone}`;
  }

  private async testCloud() {
    const kind = $<HTMLSelectElement>("setup-cloud-kind").value;
    const baseUrl = $<HTMLInputElement>("setup-cloud-baseurl").value.trim();
    const apiKey = $<HTMLInputElement>("setup-cloud-apikey").value.trim();
    const model = $<HTMLInputElement>("setup-cloud-model").value.trim();
    this.setCloudTestHint(t("checkingProvider", { name: this.cloudKindName(kind) }));
    try {
      const r = await invoke<EndpointCheck>("check_provider", { kind, baseUrl, apiKey, model });
      const list = $("setup-cloud-model-list");
      list.innerHTML = "";
      for (const m of r.models) {
        const o = document.createElement("option");
        o.value = m;
        list.appendChild(o);
      }
      let text = r.message;
      if (r.reachable && model && r.models.length && !r.models.includes(model)) {
        text += `\n${t("modelNotOnServer", { model })}`;
      }
      this.setCloudTestHint(text, r.reachable ? "ok" : "bad");
    } catch (e) {
      this.setCloudTestHint(typeof e === "string" ? e : e instanceof Error ? e.message : String(e), "bad");
    }
  }

  async open() {
    this.host.show(true);
    $("setup-error").textContent = "";
    this.fillCloudKinds("gemini");
    $<HTMLInputElement>("setup-cloud-name").value = "";
    $<HTMLInputElement>("setup-cloud-apikey").value = "";
    $<HTMLInputElement>("setup-cloud-baseurl").value = "";
    $<HTMLInputElement>("setup-cloud-model").value = "";
    $("setup-cloud-model-list").innerHTML = "";
    this.setCloudTestHint("");
    this.setMode("local");

    this.setStep("step-hw", "active", t("checking"));
    this.setStep("step-model", "pending", "");
    this.setStep("step-ollama", "pending", "");
    this.setStep("step-pull", "pending", "");
    this.progress(null);
    $<HTMLButtonElement>("btn-setup-start").disabled = true;

    const [info, ollama] = await Promise.all([
      invoke<SystemInfo>("setup_system_info"),
      invoke<OllamaStatus>("setup_ollama_status"),
    ]);
    this.info = info;
    this.ollama = ollama;

    const gpu = bestGpu(info);
    this.setStep(
      "step-hw",
      "done",
      `${t("ram", { ram: gb(info.ramMb) })} · ${gpu ? `${gpu.name} (${gb(gpu.vramMb)})` : t("noGpu")}`,
    );

    const sel = $<HTMLSelectElement>("setup-model");
    sel.innerHTML = "";
    const rec = recommend(info);
    for (const m of MODEL_CATALOG) {
      const o = document.createElement("option");
      o.value = m.id;
      const present = hasModel(ollama.models, m.id);
      const tags = [
        m.eu ? t("tagEu") : "",
        m.id === rec.model.id ? t("recommended") : "",
        present ? t("present") : fmtGb(m.sizeGb),
        fits(m, info) ? "" : t("tooBig"),
      ]
        .filter(Boolean)
        .join(", ");
      o.textContent = `${m.title} – ${tags}`;
      sel.appendChild(o);
    }
    sel.value = rec.model.id;
    this.setStep("step-model", "current", "");
    this.describeChoice();

    this.setStep(
      "step-ollama",
      ollama.running ? "done" : "pending",
      ollama.running
        ? t("running", { version: ollama.version ?? "?" })
        : ollama.installed
          ? t("installedStarting")
          : t("notInstalled"),
    );
    if (this.mode === "local") {
      $<HTMLButtonElement>("btn-setup-start").disabled = false;
    }
  }

  private describeChoice() {
    if (!this.info || !this.ollama) return;
    const id = $<HTMLSelectElement>("setup-model").value;
    const m = MODEL_CATALOG.find((x) => x.id === id)!;
    const present = hasModel(this.ollama.models, id);
    const rec = recommend(this.info);
    const why = m.id === rec.model.id ? t("why", { reason: rec.reason }) : fits(m, this.info) ? "" : t("tooBigWarn");
    const note = $("step-model-note");
    note.textContent = `${t(m.note)}.${why}`;
    if (m.eu) note.prepend(euFlag());
    this.setStep("step-pull", present ? "skip" : "pending", present ? t("alreadyPresent") : t("willDownload", { size: fmtGb(m.sizeGb) }));
    $("btn-setup-start").textContent = present && this.ollama.running ? t("apply") : t("setUp");
  }

  async run() {
    if (this.running) return;
    if (this.mode === "cloud") {
      await this.runCloud();
      return;
    }
    if (!this.ollama) return;
    this.running = true;
    const model = $<HTMLSelectElement>("setup-model").value;
    const startBtn = $<HTMLButtonElement>("btn-setup-start");
    startBtn.disabled = true;
    $<HTMLSelectElement>("setup-model").disabled = true;
    $("btn-setup-cancel").textContent = t("cancel");
    $("setup-error").textContent = "";
    this.setStep("step-model", "done", null);
    try {
      if (!this.ollama.running) {
        this.setStep("step-ollama", "active", this.ollama.installed ? t("starting") : t("downloading"));
        this.ollama = await invoke<OllamaStatus>(this.ollama.installed ? "setup_ollama_start" : "setup_ollama_install");
        this.setStep("step-ollama", "done", t("running", { version: this.ollama.version ?? "?" }));
        this.progress(null);
      }
      if (!hasModel(this.ollama.models, model)) {
        this.setStep("step-pull", "active", t("startDownload"));
        await invoke("setup_ollama_pull", { model });
        this.setStep("step-pull", "done", t("done"));
        this.progress(null);
      }
      await this.host.done(model, contextFor(this.info));
      this.close(true);
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
      if (this.activeStep) this.setStep(this.activeStep, "error", null);
      $("setup-error").textContent = CANCELLED.includes(msg) ? t("cancelled") : t("failed", { msg });
      startBtn.textContent = t("retry");
    } finally {
      this.running = false;
      startBtn.disabled = false;
      $<HTMLSelectElement>("setup-model").disabled = false;
      $("btn-setup-cancel").textContent = t("later");
    }
  }

  private async runCloud() {
    const kind = $<HTMLSelectElement>("setup-cloud-kind").value;
    const name = $<HTMLInputElement>("setup-cloud-name").value.trim();
    const apiKey = $<HTMLInputElement>("setup-cloud-apikey").value.trim();
    const baseUrl = $<HTMLInputElement>("setup-cloud-baseurl").value.trim();
    const model = $<HTMLInputElement>("setup-cloud-model").value.trim();
    if (!apiKey) {
      $("setup-error").textContent = t("apiKeyRequired", { name: this.cloudKindName(kind) });
      return;
    }
    if (kind === "generic" && !baseUrl) {
      $("setup-error").textContent = t("baseUrlRequired");
      return;
    }
    if (!model) {
      $("setup-error").textContent = t("modelRequired");
      return;
    }
    $("setup-error").textContent = "";
    this.running = true;
    const startBtn = $<HTMLButtonElement>("btn-setup-start");
    startBtn.disabled = true;
    try {
      await this.host.doneCloud({ name, kind, model, baseUrl, apiKey });
      this.close(true);
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
      $("setup-error").textContent = t("failed", { msg });
    } finally {
      this.running = false;
      startBtn.disabled = false;
    }
  }

  close(force = false) {
    if (this.running && !force) {
      void invoke("setup_cancel");
      return;
    }
    this.host.show(false);
  }

  private onProgress(p: Progress) {
    const step = p.phase === "pull" ? "step-pull" : "step-ollama";
    const label =
      p.total > 0 ? `${p.message} ${t("of", { done: fmtBytes(p.done), total: fmtBytes(p.total) })}` : p.message;
    this.setStep(step, "active", label);
    this.progress(p.total > 0 ? p.done / p.total : undefined, step);
  }

  /** null = hide; undefined = indeterminate; number = fraction. */
  private progress(value: number | null | undefined, step?: string) {
    for (const el of document.querySelectorAll<HTMLProgressElement>("#setup progress")) {
      const mine = step && el.closest("li")?.id === step;
      el.hidden = value === null || !mine;
      if (mine) {
        if (value === undefined) el.removeAttribute("value");
        else if (value !== null) el.value = value;
      }
    }
  }

  private setStep(id: string, state: StepState, text: string | null) {
    const li = $(id);
    li.dataset.state = state;
    if (state === "active") this.activeStep = id;
    if (text !== null) li.querySelector<HTMLElement>(".d")!.textContent = text;
  }
}
