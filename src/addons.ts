// Settings → "Erweiterungen" (aar extensions from the registry) and
// "Werkzeuge" (MCP tool servers). Install/uninstall runs in the backend
// (bundled Python + pip); changes take effect when aar restarts, which the
// settings view does when it closes (`onChanged`).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lang, strings, type Lang } from "./i18n";
import { isWindows } from "./platform";

// ---------------------------------------------------------------------------
// Types (backend)
// ---------------------------------------------------------------------------

interface RegistryEntry {
  name: string;
  pypi: string;
  description: string;
  tags?: string[];
  author?: string;
  repository?: string;
  homepage?: string;
  status?: "published" | "planned" | "builtin" | "deprecated" | string;
}

interface RegistryResult {
  data: { extensions?: RegistryEntry[] } | null;
  cached: boolean;
  error: string | null;
}

interface ExtTool {
  name: string;
  description: string;
  sideEffects: string[];
  requiresApproval: boolean;
}

interface InstalledExt {
  name: string;
  source: "entrypoint" | "user" | string;
  path: string;
  dist: string;
  version: string;
  managed: boolean;
  hooks: string[];
  tools: ExtTool[];
  commands: string[];
  prompt: string;
  error: string | null;
}

interface HelperResult<T = unknown> {
  ok: boolean;
  data: T | null;
  log: string;
}

interface ExtListData {
  ok: boolean;
  error?: string;
  aarVersion: string;
  supportsDisable: boolean;
  extensions: InstalledExt[];
  /** Python tag the extensions were installed with, if not the current one. */
  otherPython?: string;
  python?: string;
}

export interface KeyValue {
  name: string;
  value: string;
}

export interface UserMcpServer {
  id: string;
  label: string;
  kind: "package" | "node" | "command" | "http";
  enabled: boolean;
  catalog: string;
  package: string;
  script: string;
  command: string;
  args: string[];
  env: KeyValue[];
  url: string;
  headers: KeyValue[];
  /** Values of the catalog entry's settings dialog. */
  options?: Record<string, string>;
}

interface Browsers {
  edge: string | null;
  chrome: string | null;
}

export interface AddonSettings {
  disabledExtensions?: string[];
  mcpServers?: UserMcpServer[];
}

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

type L3 = Record<Lang, string>;
type Level = "info" | "warn" | "high";
interface Warning {
  level: Level;
  text: string;
}

const t = strings({
  de: {
    loading: "Lade …",
    registryOffline: "Die Liste der Erweiterungen konnte nicht geladen werden (keine Internetverbindung?).",
    registryCached: "Offline – zeige die zuletzt geladene Liste.",
    listFailed: "Installierte Erweiterungen konnten nicht ermittelt werden.",
    runtimeOwn: "Installiert wird für dein aar ({python}).",
    noDisable: "Diese aar-Version kann Erweiterungen nicht abschalten – bitte Aar Desktop aktualisieren.",
    active: "aktiv",
    off: "aus",
    notInstalled: "nicht installiert",
    planned: "geplant",
    deprecated: "veraltet",
    install: "Installieren",
    installSure: "Trotzdem installieren",
    installing: "Installiere {name} …",
    installed: "{name} ist installiert. Aar startet neu, wenn du die Einstellungen schließt.",
    installFailed: "Installation von {name} fehlgeschlagen.",
    remove: "Entfernen",
    removeSure: "Wirklich entfernen?",
    removing: "Entferne {name} …",
    removed: "{name} wurde entfernt.",
    removedAfterRestart: "{name} wurde entfernt. Die letzten Dateien löscht Aar beim nächsten Neustart (beim Schließen der Einstellungen).",
    otherPython: "Die Erweiterungen wurden mit Python {was} installiert, Aar läuft jetzt mit Python {now}. Lädt eine nicht, bitte entfernen und neu installieren.",
    removeFailed: "Entfernen von {name} fehlgeschlagen.",
    pairEnv: "NAME=Wert",
    pairHeader: "Name: Wert",
    enabled: "Eingeschaltet",
    whatItDoes: "Was macht diese Erweiterung genau?",
    hooksLabel: "Greift ein bei",
    toolsLabel: "Neue Werkzeuge",
    commandsLabel: "Befehle im Chat",
    promptLabel: "Zusätzliche Anweisungen an Aar",
    techDetails: "Technische Details",
    fromFolder: "Aus deinem Ordner {path} (nicht über Aar Desktop installiert).",
    partOfApp: "Mit aar mitgeliefert – lässt sich nur ausschalten.",
    restartNote: "Änderungen gelten, sobald Aar neu startet (beim Schließen der Einstellungen).",
    wTool_call: "Prüft jede Aktion von Aar und kann sie blockieren – manche Aufgaben werden dann abgelehnt.",
    wUser_message: "Verändert deine Nachrichten, bevor Aar sie liest.",
    wTool_result: "Kann Ergebnisse von Werkzeugen verändern, bevor Aar sie sieht.",
    wBefore_turn: "Kann den Gesprächsverlauf vor jeder Antwort verändern.",
    wPrompt: "Gibt Aar zusätzliche Anweisungen – Aar antwortet und arbeitet dadurch anders.",
    wTools: "Bringt neue Fähigkeiten mit: {tools}.",
    wToolsEffects: "Bringt neue Fähigkeiten mit, die {effects}: {tools}.",
    wCommands: "Neue Befehle im Chat: {commands}.",
    wError: "Lässt sich nicht laden: {error}",
    wUnknown: "Was genau sie an Aars Arbeit ändert, siehst du nach der Installation.",
    effWrite: "Dateien ändern",
    effExecute: "Programme ausführen",
    effNetwork: "ins Internet gehen",
    effExternal: "andere Dienste ansprechen",
    effRead: "Dateien lesen",
    // MCP
    mcpNone: "Noch keine eigenen Werkzeug-Server.",
    mcpAdded: "hinzugefügt",
    mcpAddCatalog: "Hinzufügen",
    mcpNotInstalled: "nicht installiert",
    mcpInstalledOk: "{name} ist bereit. Aar nutzt es ab dem Neustart (beim Schließen der Einstellungen).",
    mcpKindPackage: "Python-Paket {pkg}",
    mcpKindCommandShort: "Programm: {cmd}",
    mcpKindHttpShort: "Internet-Adresse: {url}",
    mcpErrName: "Bitte gib einen Namen ein.",
    mcpErrCommand: "Bitte gib das Programm an, das den Server startet.",
    mcpErrUrl: "Die Adresse muss mit http:// oder https:// beginnen.",
    mcpErrLine: "Zeile „{line}“ verstehe ich nicht (erwartet: {format}).",
    mcpCustomWarn: "Ein eigener Server läuft mit deinen Rechten auf diesem PC bzw. bekommt, was Aar ihm schickt – füge nur Server aus vertrauenswürdiger Quelle hinzu.",
    mcpNameTaken: "Diesen Namen gibt es schon.",
    mcpKindNode: "Node.js-Paket {pkg}",
    mcpConfigure: "Anpassen",
    mcpSaveConfig: "Übernehmen",
    mcpInstallNow: "Installieren",
    cancel: "Abbrechen",
    mcpSaved: "Gespeichert. Aar nutzt die neuen Einstellungen ab dem Neustart (beim Schließen der Einstellungen).",
    mcpNodeFirst: "Installiere {name} … (beim ersten Mal wird auch Node.js geladen)",
  },
  en: {
    loading: "Loading …",
    registryOffline: "Could not load the list of extensions (no internet connection?).",
    registryCached: "Offline – showing the list from last time.",
    listFailed: "Could not determine the installed extensions.",
    runtimeOwn: "Installed for your aar ({python}).",
    noDisable: "This aar version cannot switch extensions off – please update Aar Desktop.",
    active: "on",
    off: "off",
    notInstalled: "not installed",
    planned: "planned",
    deprecated: "deprecated",
    install: "Install",
    installSure: "Install anyway",
    installing: "Installing {name} …",
    installed: "{name} is installed. Aar restarts when you close the settings.",
    installFailed: "Installing {name} failed.",
    remove: "Remove",
    removeSure: "Really remove?",
    removing: "Removing {name} …",
    removed: "{name} was removed.",
    removedAfterRestart: "{name} was removed. Aar deletes the last files at its next restart (when you close the settings).",
    otherPython: "The extensions were installed with Python {was}, Aar now runs Python {now}. If one does not load, please remove and reinstall it.",
    removeFailed: "Removing {name} failed.",
    pairEnv: "NAME=value",
    pairHeader: "Name: value",
    enabled: "Switched on",
    whatItDoes: "What exactly does this extension do?",
    hooksLabel: "Steps in at",
    toolsLabel: "New tools",
    commandsLabel: "Chat commands",
    promptLabel: "Extra instructions for Aar",
    techDetails: "Technical details",
    fromFolder: "From your folder {path} (not installed through Aar Desktop).",
    partOfApp: "Comes with aar – can only be switched off.",
    restartNote: "Changes apply once Aar restarts (when you close the settings).",
    wTool_call: "Checks every action Aar takes and can block it – some tasks will then be refused.",
    wUser_message: "Changes your messages before Aar reads them.",
    wTool_result: "Can change what tools return before Aar sees it.",
    wBefore_turn: "Can change the conversation history before every answer.",
    wPrompt: "Gives Aar extra instructions – Aar will answer and work differently.",
    wTools: "Adds new abilities: {tools}.",
    wToolsEffects: "Adds new abilities that {effects}: {tools}.",
    wCommands: "New chat commands: {commands}.",
    wError: "Cannot be loaded: {error}",
    wUnknown: "What exactly it changes about Aar's work is shown after installing.",
    effWrite: "change files",
    effExecute: "run programs",
    effNetwork: "go online",
    effExternal: "talk to other services",
    effRead: "read files",
    mcpNone: "No tool servers of your own yet.",
    mcpAdded: "added",
    mcpAddCatalog: "Add",
    mcpNotInstalled: "not installed",
    mcpInstalledOk: "{name} is ready. Aar uses it after restarting (when you close the settings).",
    mcpKindPackage: "Python package {pkg}",
    mcpKindCommandShort: "Program: {cmd}",
    mcpKindHttpShort: "Web address: {url}",
    mcpErrName: "Please enter a name.",
    mcpErrCommand: "Please enter the program that starts the server.",
    mcpErrUrl: "The address must start with http:// or https://.",
    mcpErrLine: "I don't understand the line “{line}” (expected: {format}).",
    mcpCustomWarn: "A server of your own runs with your permissions on this PC or receives whatever Aar sends it – only add servers from a trusted source.",
    mcpNameTaken: "This name already exists.",
    mcpKindNode: "Node.js package {pkg}",
    mcpConfigure: "Adjust",
    mcpSaveConfig: "Apply",
    mcpInstallNow: "Install",
    cancel: "Cancel",
    mcpSaved: "Saved. Aar uses the new settings after restarting (when you close the settings).",
    mcpNodeFirst: "Installing {name} … (the first time this also downloads Node.js)",
  },
  zh: {
    loading: "加载中…",
    registryOffline: "无法加载扩展列表（没有网络连接？）。",
    registryCached: "离线 – 显示上次加载的列表。",
    listFailed: "无法获取已安装的扩展。",
    runtimeOwn: "将为你的 aar 安装（{python}）。",
    noDisable: "此 aar 版本无法关闭扩展 – 请更新 Aar Desktop。",
    active: "已启用",
    off: "已关闭",
    notInstalled: "未安装",
    planned: "计划中",
    deprecated: "已弃用",
    install: "安装",
    installSure: "仍然安装",
    installing: "正在安装 {name}…",
    installed: "{name} 已安装。关闭设置后 Aar 将重新启动。",
    installFailed: "安装 {name} 失败。",
    remove: "移除",
    removeSure: "确定移除？",
    removing: "正在移除 {name}…",
    removed: "{name} 已移除。",
    removedAfterRestart: "{name} 已移除。剩余文件将在 Aar 下次重新启动时（关闭设置时）删除。",
    otherPython: "这些扩展是用 Python {was} 安装的，Aar 现在使用 Python {now}。如果某个扩展无法加载，请将其移除后重新安装。",
    removeFailed: "移除 {name} 失败。",
    pairEnv: "名称=值",
    pairHeader: "名称: 值",
    enabled: "已开启",
    whatItDoes: "这个扩展具体做什么？",
    hooksLabel: "介入环节",
    toolsLabel: "新工具",
    commandsLabel: "聊天命令",
    promptLabel: "给 Aar 的额外指令",
    techDetails: "技术细节",
    fromFolder: "来自你的文件夹 {path}（不是通过 Aar Desktop 安装的）。",
    partOfApp: "随 aar 附带 – 只能关闭。",
    restartNote: "Aar 重新启动后（关闭设置时）更改生效。",
    wTool_call: "会检查 Aar 的每个操作并可能阻止它 – 某些任务会因此被拒绝。",
    wUser_message: "会在 Aar 读取之前修改你的消息。",
    wTool_result: "可能在 Aar 看到之前修改工具返回的结果。",
    wBefore_turn: "可能在每次回答前修改对话记录。",
    wPrompt: "会给 Aar 额外的指令 – Aar 的回答和工作方式会因此改变。",
    wTools: "新增能力：{tools}。",
    wToolsEffects: "新增能力，可以{effects}：{tools}。",
    wCommands: "新的聊天命令：{commands}。",
    wError: "无法加载：{error}",
    wUnknown: "安装后才能看到它具体会改变 Aar 的哪些工作方式。",
    effWrite: "修改文件",
    effExecute: "运行程序",
    effNetwork: "访问互联网",
    effExternal: "连接其他服务",
    effRead: "读取文件",
    mcpNone: "还没有自己的工具服务器。",
    mcpAdded: "已添加",
    mcpAddCatalog: "添加",
    mcpNotInstalled: "未安装",
    mcpInstalledOk: "{name} 已就绪。Aar 重新启动后（关闭设置时）即可使用。",
    mcpKindPackage: "Python 包 {pkg}",
    mcpKindCommandShort: "程序：{cmd}",
    mcpKindHttpShort: "网址：{url}",
    mcpErrName: "请输入名称。",
    mcpErrCommand: "请输入启动服务器的程序。",
    mcpErrUrl: "地址必须以 http:// 或 https:// 开头。",
    mcpErrLine: "无法理解这一行“{line}”（应为：{format}）。",
    mcpCustomWarn: "自定义服务器会以你的权限在这台电脑上运行，或接收 Aar 发送给它的内容 – 只添加来源可信的服务器。",
    mcpNameTaken: "这个名称已存在。",
    mcpKindNode: "Node.js 包 {pkg}",
    mcpConfigure: "调整",
    mcpSaveConfig: "应用",
    mcpInstallNow: "安装",
    cancel: "取消",
    mcpSaved: "已保存。Aar 重新启动后（关闭设置时）使用新设置。",
    mcpNodeFirst: "正在安装 {name}…（首次安装时还会下载 Node.js）",
  },
});

const tr3 = (x: L3) => x[lang()];

/** Plain-language names, descriptions and warnings for known registry entries. */
const KNOWN_EXT: Record<string, { title: L3; desc: L3; warnings: Array<{ level: Level } & L3> }> = {
  "permission-gate": {
    title: { de: "Schutz vor gefährlichen Befehlen", en: "Guard against dangerous commands", zh: "危险命令防护" },
    desc: {
      de: "Hält gefährliche Befehle auf (z. B. ganze Ordner löschen, Systemeinstellungen ändern).",
      en: "Stops dangerous commands (e.g. deleting whole folders, changing system settings).",
      zh: "拦截危险命令（例如删除整个文件夹、修改系统设置）。",
    },
    warnings: [
      {
        level: "warn",
        de: "Blockiert bestimmte Befehle – Aar kann solche Aufgaben dann nicht mehr erledigen, auch wenn du es möchtest.",
        en: "Blocks certain commands – Aar can no longer do such tasks, even if you want it to.",
        zh: "会阻止某些命令 – 即使你需要，Aar 也无法再完成这类任务。",
      },
    ],
  },
  "protected-paths": {
    title: { de: "Geschützte Dateien", en: "Protected files", zh: "受保护的文件" },
    desc: {
      de: "Verhindert, dass Aar Passwort-, Schlüssel- und Konfigurationsdateien (.env usw.) verändert.",
      en: "Prevents Aar from changing password, key and configuration files (.env etc.).",
      zh: "防止 Aar 修改密码、密钥和配置文件（如 .env）。",
    },
    warnings: [
      {
        level: "warn",
        de: "Aar kann diese Dateien dann auch auf deinen Wunsch nicht mehr ändern.",
        en: "Aar then cannot change these files, even when you ask it to.",
        zh: "之后即使你要求，Aar 也无法修改这些文件。",
      },
    ],
  },
  "git-checkpoint": {
    title: { de: "Automatische Sicherungspunkte (Git)", en: "Automatic checkpoints (Git)", zh: "自动检查点（Git）" },
    desc: {
      de: "Speichert nach jeder Antwort einen Git-Sicherungspunkt, zu dem du zurückkehren kannst.",
      en: "Saves a Git checkpoint after every answer that you can go back to.",
      zh: "每次回答后保存一个 Git 检查点，方便你回退。",
    },
    warnings: [
      {
        level: "high",
        de: "Legt im Arbeitsordner automatisch Git-Commits an und verändert so den Verlauf deines Projekts.",
        en: "Automatically creates Git commits in the working folder and so changes your project's history.",
        zh: "会在工作文件夹中自动创建 Git 提交，从而改变项目的历史记录。",
      },
      { level: "info", de: "Braucht Git auf diesem PC.", en: "Needs Git on this PC.", zh: "需要在这台电脑上安装 Git。" },
    ],
  },
  "shadow-branching": {
    title: { de: "Getrennter Arbeitszweig (Git)", en: "Separate work branch (Git)", zh: "独立工作分支（Git）" },
    desc: {
      de: "Aar arbeitet in einem eigenen Git-Zweig; du entscheidest, ob die Änderungen übernommen werden.",
      en: "Aar works in its own Git branch; you decide whether the changes are taken over.",
      zh: "Aar 在独立的 Git 分支中工作，由你决定是否采纳更改。",
    },
    warnings: [
      {
        level: "high",
        de: "Änderungen erscheinen erst nach dem Zusammenführen in deinem Ordner – das kann verwirren.",
        en: "Changes only show up in your folder after merging – this can be confusing.",
        zh: "更改要在合并后才会出现在你的文件夹中 – 可能会让人困惑。",
      },
      {
        level: "info",
        de: "Braucht Git und einen Arbeitsordner, der ein Git-Repository ist.",
        en: "Needs Git and a working folder that is a Git repository.",
        zh: "需要 Git，且工作文件夹必须是 Git 仓库。",
      },
    ],
  },
  "mcp-tools": {
    title: { de: "MCP-Werkzeuge aus der aar-Konfiguration", en: "MCP tools from the aar config", zh: "来自 aar 配置的 MCP 工具" },
    desc: {
      de: "Bindet Werkzeug-Server (MCP) ein, die in der aar-Konfiguration eingetragen sind.",
      en: "Adds tool servers (MCP) listed in the aar configuration.",
      zh: "接入 aar 配置中列出的工具服务器（MCP）。",
    },
    warnings: [
      {
        level: "warn",
        de: "In Aar Desktop nicht nötig – Werkzeug-Server verwaltest du unter „Werkzeuge“. Doppelte Server können Fehler auslösen.",
        en: "Not needed in Aar Desktop – manage tool servers under “Tools”. Duplicate servers can cause errors.",
        zh: "在 Aar Desktop 中不需要 – 请在“工具”中管理工具服务器。重复的服务器可能导致错误。",
      },
    ],
  },
  observability: {
    title: { de: "Messdaten (Monitoring)", en: "Metrics (monitoring)", zh: "指标（监控）" },
    desc: {
      de: "Liefert Messwerte zu jeder Antwort an Prometheus/OpenTelemetry.",
      en: "Reports metrics for every answer to Prometheus/OpenTelemetry.",
      zh: "将每次回答的指标发送到 Prometheus/OpenTelemetry。",
    },
    warnings: [
      {
        level: "info",
        de: "Für Administratoren: braucht einen eingerichteten Monitoring-Server.",
        en: "For administrators: needs a monitoring server that is set up.",
        zh: "面向管理员：需要已配置好的监控服务器。",
      },
    ],
  },
  "usage-tracker": {
    title: { de: "Verbrauchsübersicht", en: "Usage overview", zh: "用量概览" },
    desc: {
      de: "Zählt, wie viel du bei Online-Sprachmodellen verbrauchst.",
      en: "Counts how much you use online language models.",
      zh: "统计你对在线语言模型的用量。",
    },
    warnings: [
      {
        level: "info",
        de: "Speichert Nutzungsdaten in ~/.aar/usage.json.",
        en: "Stores usage data in ~/.aar/usage.json.",
        zh: "将用量数据保存在 ~/.aar/usage.json。",
      },
    ],
  },
  inspect: {
    title: { de: "Sitzungsbericht", en: "Session report", zh: "会话报告" },
    desc: {
      de: "Mit /inspect im Chat zeigt Aar einen Bericht über das laufende Gespräch.",
      en: "Type /inspect in the chat and Aar shows a report about the current conversation.",
      zh: "在聊天中输入 /inspect，Aar 会显示当前对话的报告。",
    },
    warnings: [],
  },
  openjev: {
    title: { de: "Antworten prüfen (openjev)", en: "Check answers (openjev)", zh: "核查回答（openjev）" },
    desc: {
      de: "Prüft Aussagen und bewertet Antworten mit einem eigenen Prüfmodell.",
      en: "Checks claims and grades answers with a separate checking model.",
      zh: "使用独立的核查模型检查陈述并评估回答。",
    },
    warnings: [
      {
        level: "high",
        de: "Braucht einen separat eingerichteten Prüf-Server mit eigener Grafikkarte – ohne ihn schlagen diese Werkzeuge fehl.",
        en: "Needs a separately set-up checking server with its own graphics card – without it these tools fail.",
        zh: "需要单独部署、配有独立显卡的核查服务器 – 否则这些工具会失败。",
      },
    ],
  },
  laya: {
    title: { de: "Entscheidungshilfe (Laya)", en: "Decision helper (Laya)", zh: "决策助手（Laya）" },
    desc: {
      de: "Kleines lokales Modell, das Texte einordnet und vorsortiert.",
      en: "Small local model that classifies and triages texts.",
      zh: "小型本地模型，用于对文本进行分类和分流。",
    },
    warnings: [
      {
        level: "warn",
        de: "Braucht einen separat eingerichteten Modell-Server.",
        en: "Needs a separately set-up model server.",
        zh: "需要单独部署的模型服务器。",
      },
    ],
  },
  "qwen-image": {
    title: { de: "Bilder erzeugen (Qwen-Image)", en: "Create images (Qwen-Image)", zh: "生成图片（Qwen-Image）" },
    desc: {
      de: "Erzeugt und bearbeitet Bilder mit einem lokalen Bildmodell.",
      en: "Creates and edits images with a local image model.",
      zh: "使用本地图像模型生成和编辑图片。",
    },
    warnings: [
      {
        level: "high",
        de: "Braucht einen separat eingerichteten Bild-Server mit leistungsstarker Grafikkarte.",
        en: "Needs a separately set-up image server with a powerful graphics card.",
        zh: "需要单独部署、配有高性能显卡的图像服务器。",
      },
    ],
  },
};

const HOOK_NAMES: Record<string, L3> = {
  session_start: { de: "Gesprächsbeginn", en: "conversation start", zh: "对话开始" },
  session_end: { de: "Gesprächsende", en: "conversation end", zh: "对话结束" },
  before_turn: { de: "vor jeder Antwort", en: "before every answer", zh: "每次回答前" },
  after_turn: { de: "nach jeder Antwort", en: "after every answer", zh: "每次回答后" },
  user_message: { de: "deinen Nachrichten", en: "your messages", zh: "你的消息" },
  tool_call: { de: "jeder Aktion", en: "every action", zh: "每个操作" },
  tool_result: { de: "Werkzeug-Ergebnissen", en: "tool results", zh: "工具结果" },
  assistant_message: { de: "Aars Antworten", en: "Aar's answers", zh: "Aar 的回答" },
  stream_chunk: { de: "dem Antworttext", en: "the answer text", zh: "回答文本" },
  error: { de: "Fehlern", en: "errors", zh: "错误" },
};

/** A setting of a catalog server, shown in its dialog. */
interface Field {
  key: string;
  label: L3;
  hint?: L3;
  type: "select" | "bool";
  options?: Array<{ value: string; label: L3 }>;
  /** Default value ("1"/"0" for bool); may depend on the installed browsers. */
  default: string | ((b: Browsers) => string);
}

/** Tool servers that can be installed with one click: pip (bundled Python) or
 * npm (portable Node.js, downloaded on first use). */
interface CatalogEntry {
  id: string;
  title: L3;
  desc: L3;
  runtime: "python" | "node";
  /** pip requirement / npm spec. */
  package: string;
  /** Console script (pip) / bin name (npm). */
  script: string;
  fields?: Field[];
  /** Arguments and environment from the dialog values. Placeholders
   * `{edge}`, `{chrome}`, `{state}` are filled in by the backend. */
  build?: (o: Record<string, string>) => { args: string[]; env: KeyValue[] };
  warnings: Array<{ level: Level } & L3>;
}

const NODE_DOWNLOAD = {
  level: "info" as const,
  de: "Braucht Node.js – Aar lädt es beim ersten Mal selbst herunter (ca. 35 MB).",
  en: "Needs Node.js – Aar downloads it by itself the first time (about 35 MB).",
  zh: "需要 Node.js – Aar 会在首次安装时自动下载（约 35 MB）。",
};

/** Linux finds Google Chrome or Chromium as `{chrome}`. */
const CHROME_LABEL = chromeLabel();
function chromeLabel(): L3 {
  return {
    get de() {
      return isWindows() ? "Google Chrome (muss installiert sein)" : "Google Chrome / Chromium (muss installiert sein)";
    },
    get en() {
      return isWindows() ? "Google Chrome (must be installed)" : "Google Chrome / Chromium (must be installed)";
    },
    get zh() {
      return isWindows() ? "Google Chrome（需已安装）" : "Google Chrome / Chromium（需已安装）";
    },
  };
}

const F_HEADLESS: Field = {
  key: "headless",
  type: "bool",
  default: "0",
  label: { de: "Browser unsichtbar im Hintergrund", en: "Browser invisible in the background", zh: "浏览器在后台隐藏运行" },
};

const F_ISOLATED: Field = {
  key: "isolated",
  type: "bool",
  default: "1",
  label: { de: "Eigenes, leeres Browser-Profil", en: "Separate, empty browser profile", zh: "使用独立的空白浏览器配置" },
  hint: {
    de: "Empfohlen: Aar sieht keine Anmeldungen, Cookies und Passwörter. Ausgeschaltet bleibt Aar auf Webseiten angemeldet.",
    en: "Recommended: Aar sees no logins, cookies or passwords. When off, Aar stays signed in to websites.",
    zh: "推荐：Aar 看不到登录状态、Cookie 和密码。关闭后，Aar 会保持网站登录状态。",
  },
};

const BROWSER_WARNING = {
  level: "warn" as const,
  de: "Aar bedient damit einen Browser: Seiten öffnen, klicken, Formulare ausfüllen. Texte auf Webseiten können versuchen, Aar Anweisungen zu geben.",
  en: "Aar uses this to operate a browser: open pages, click, fill in forms. Text on web pages may try to give Aar instructions.",
  zh: "Aar 将借此操作浏览器：打开网页、点击、填写表单。网页上的文字可能试图向 Aar 下达指令。",
};

const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "fetch",
    runtime: "python",
    title: { de: "Webseiten lesen", en: "Read web pages", zh: "读取网页" },
    desc: {
      de: "Aar kann Internetseiten abrufen und ihren Text lesen.",
      en: "Aar can fetch web pages and read their text.",
      zh: "Aar 可以获取网页并读取其中的文字。",
    },
    package: "mcp-server-fetch",
    script: "mcp-server-fetch",
    warnings: [
      {
        level: "warn",
        de: "Texte auf Webseiten können versuchen, Aar Anweisungen zu geben – prüfe Ergebnisse kritisch.",
        en: "Text on web pages may try to give Aar instructions – check results critically.",
        zh: "网页上的文字可能试图向 Aar 下达指令 – 请审慎核对结果。",
      },
    ],
  },
  {
    id: "markitdown",
    runtime: "python",
    title: { de: "Dokumente lesen (PDF, Word, Excel, PowerPoint)", en: "Read documents (PDF, Word, Excel, PowerPoint)", zh: "读取文档（PDF、Word、Excel、PowerPoint）" },
    desc: {
      de: "Wandelt Dokumente in Text um, damit Aar ihren Inhalt versteht.",
      en: "Turns documents into text so that Aar understands their content.",
      zh: "将文档转换为文字，让 Aar 理解其内容。",
    },
    package: "markitdown-mcp",
    script: "markitdown-mcp",
    warnings: [
      { level: "info", de: "Großer Download (ca. 150 MB).", en: "Large download (about 150 MB).", zh: "下载量较大（约 150 MB）。" },
    ],
  },
  {
    id: "time",
    runtime: "python",
    title: { de: "Uhrzeit und Zeitzonen", en: "Time and time zones", zh: "时间和时区" },
    desc: {
      de: "Aar kennt die aktuelle Uhrzeit und rechnet zwischen Zeitzonen um.",
      en: "Aar knows the current time and converts between time zones.",
      zh: "Aar 可以获取当前时间并在时区之间换算。",
    },
    package: "mcp-server-time",
    script: "mcp-server-time",
    warnings: [],
  },
  {
    id: "playwright",
    runtime: "node",
    title: { de: "Webseiten bedienen (Playwright)", en: "Operate websites (Playwright)", zh: "操作网页（Playwright）" },
    get desc() {
      return isWindows()
        ? {
            de: "Aar steuert einen Browser: Seiten öffnen, lesen, klicken, Formulare ausfüllen. Läuft mit Edge, das auf jedem Windows vorhanden ist.",
            en: "Aar controls a browser: open and read pages, click, fill in forms. Works with Edge, which every Windows has.",
            zh: "Aar 控制浏览器：打开和阅读网页、点击、填写表单。可使用每台 Windows 都自带的 Edge。",
          }
        : {
            de: "Aar steuert einen Browser: Seiten öffnen, lesen, klicken, Formulare ausfüllen. Braucht Google Chrome oder Chromium.",
            en: "Aar controls a browser: open and read pages, click, fill in forms. Needs Google Chrome or Chromium.",
            zh: "Aar 控制浏览器：打开和阅读网页、点击、填写表单。需要 Google Chrome 或 Chromium。",
          };
    },
    package: "@playwright/mcp@latest",
    script: "playwright-mcp",
    fields: [
      {
        key: "browser",
        type: "select",
        // Linux: Chrome or Chromium (`{chrome}`), Edge only if installed.
        default: (b) => (isWindows() || (b.edge && !b.chrome) ? "msedge" : "chrome"),
        label: { de: "Browser", en: "Browser", zh: "浏览器" },
        options: [
          { value: "msedge", label: { de: "Microsoft Edge", en: "Microsoft Edge", zh: "Microsoft Edge" } },
          { value: "chrome", label: CHROME_LABEL },
        ],
      },
      F_HEADLESS,
      F_ISOLATED,
    ],
    build: (o) => ({
      args: [
        "--browser",
        o.browser || "msedge",
        // Linux: the Chrome/Chromium found on PATH (Playwright only knows /opt/google/chrome).
        ...(!isWindows() && o.browser === "chrome" ? ["--executable-path", "{chrome}"] : []),
        ...(o.headless === "1" ? ["--headless"] : []),
        ...(o.isolated === "1" ? ["--isolated"] : []),
      ],
      env: [],
    }),
    warnings: [BROWSER_WARNING, NODE_DOWNLOAD],
  },
  {
    id: "chrome-devtools",
    runtime: "node",
    title: { de: "Chrome DevTools", en: "Chrome DevTools", zh: "Chrome DevTools" },
    desc: {
      de: "Aar steuert und untersucht Chrome wie mit den Entwicklerwerkzeugen: Seiten öffnen, klicken, Konsole, Netzwerk, Leistung.",
      en: "Aar controls and inspects Chrome like with the developer tools: open pages, click, console, network, performance.",
      zh: "Aar 像使用开发者工具一样控制和检查 Chrome：打开网页、点击、控制台、网络、性能。",
    },
    package: "chrome-devtools-mcp@latest",
    script: "chrome-devtools-mcp",
    fields: [
      {
        key: "browser",
        type: "select",
        default: (b) => (b.chrome || !b.edge ? "chrome" : "edge"),
        label: { de: "Browser", en: "Browser", zh: "浏览器" },
        hint: {
          de: "Offiziell nur Chrome. Edge funktioniert meist auch.",
          en: "Officially Chrome only. Edge usually works too.",
          zh: "官方仅支持 Chrome，Edge 通常也可以使用。",
        },
        options: [
          {
            value: "chrome",
            get label() {
              return isWindows() ? { de: "Google Chrome", en: "Google Chrome", zh: "Google Chrome" } : CHROME_LABEL;
            },
          },
          { value: "edge", label: { de: "Microsoft Edge (inoffiziell)", en: "Microsoft Edge (unofficial)", zh: "Microsoft Edge（非官方）" } },
        ],
      },
      {
        key: "tools",
        type: "select",
        default: "standard",
        label: { de: "Werkzeugumfang", en: "Set of tools", zh: "工具范围" },
        hint: {
          de: "Weniger Werkzeuge = kleine Sprachmodelle arbeiten zuverlässiger.",
          en: "Fewer tools = small language models work more reliably.",
          zh: "工具越少，小型语言模型的表现越稳定。",
        },
        options: [
          { value: "slim", label: { de: "Basis (3 Werkzeuge)", en: "Basic (3 tools)", zh: "基础（3 个工具）" } },
          { value: "standard", label: { de: "Standard: Seiten bedienen und prüfen", en: "Standard: operate and check pages", zh: "标准：操作和检查网页" } },
          { value: "all", label: { de: "Alle (für Webentwickler, ca. 60)", en: "All (for web developers, about 60)", zh: "全部（面向 Web 开发者，约 60 个）" } },
        ],
      },
      F_HEADLESS,
      F_ISOLATED,
      {
        key: "stats",
        type: "bool",
        default: "0",
        label: { de: "Nutzungsstatistik an Google senden", en: "Send usage statistics to Google", zh: "向 Google 发送使用统计" },
      },
    ],
    build: (o) => {
      // Linux: Chrome or Chromium from PATH; Windows: the installed stable Chrome.
      const args =
        o.browser === "edge"
          ? ["--executablePath", "{edge}"]
          : isWindows()
            ? ["--channel", "stable"]
            : ["--executablePath", "{chrome}"];
      if (o.tools === "slim") args.push("--slim");
      else if (o.tools !== "all")
        args.push("--no-category-emulation", "--no-category-performance", "--no-category-network", "--no-category-memory");
      if (o.headless === "1") args.push("--headless");
      if (o.isolated === "1") args.push("--isolated");
      const env: KeyValue[] = [{ name: "CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS", value: "1" }];
      if (o.stats !== "1") {
        args.push("--no-usage-statistics");
        env.push({ name: "CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS", value: "1" });
      }
      return { args, env };
    },
    warnings: [
      BROWSER_WARNING,
      {
        level: "warn",
        de: "Bringt viele Werkzeuge mit – für kleine Sprachmodelle „Basis“ wählen.",
        en: "Brings many tools – choose “Basic” for small language models.",
        zh: "工具很多 – 小型语言模型请选择“基础”。",
      },
      NODE_DOWNLOAD,
    ],
  },
  {
    id: "memory",
    runtime: "node",
    title: { de: "Gedächtnis", en: "Memory", zh: "记忆" },
    desc: {
      de: "Aar merkt sich Personen, Projekte und Fakten über Gespräche hinweg.",
      en: "Aar remembers people, projects and facts across conversations.",
      zh: "Aar 能跨对话记住人物、项目和事实。",
    },
    package: "@modelcontextprotocol/server-memory@latest",
    script: "mcp-server-memory",
    build: () => ({ args: [], env: [{ name: "MEMORY_FILE_PATH", value: "{state}/memory.jsonl" }] }),
    warnings: [
      {
        level: "info",
        de: "Das Gemerkte liegt unverschlüsselt auf diesem PC und wird beim Entfernen gelöscht.",
        en: "What Aar remembers is stored unencrypted on this PC and deleted when you remove the server.",
        zh: "记住的内容以未加密形式保存在这台电脑上，移除服务器时会被删除。",
      },
      NODE_DOWNLOAD,
    ],
  },
];

function defaultsFor(c: CatalogEntry, b: Browsers): Record<string, string> {
  const o: Record<string, string> = {};
  for (const f of c.fields ?? []) o[f.key] = typeof f.default === "function" ? f.default(b) : f.default;
  return o;
}

/** Turn a catalog entry + dialog values into the stored server fields. */
function applyCatalog(srv: UserMcpServer, c: CatalogEntry, options: Record<string, string>) {
  const built = c.build?.(options) ?? { args: [], env: [] };
  srv.kind = c.runtime === "node" ? "node" : "package";
  srv.package = c.package;
  srv.script = c.script;
  srv.args = built.args;
  srv.env = built.env;
  srv.options = { ...options };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const canonical = (s: string) => s.toLowerCase().replace(/[-_.]+/g, "-");
const extKey = (s: string) => s.trim().toLowerCase().replace(/-/g, "_");

export function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
}

const RESERVED_IDS = ["windows", "photos"];

/** "cp313" → "3.13". */
function pyVersion(tag: string): string {
  const m = /^cp(\d)(\d+)$/.exec(tag);
  return m ? `${m[1]}.${m[2]}` : tag;
}

function parsePairs(text: string, sep: "=" | ":", format: string): KeyValue[] {
  const out: KeyValue[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(sep);
    if (i <= 0) throw new Error(t("mcpErrLine", { line, format }));
    out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
  }
  return out;
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

function warningList(list: Warning[]): HTMLElement | null {
  if (!list.length) return null;
  const ul = el("ul", "warnings");
  for (const w of list) {
    const li = el("li", `w-${w.level}`);
    li.textContent = `${w.level === "info" ? "ℹ️" : "⚠️"} ${w.text}`;
    ul.appendChild(li);
  }
  return ul;
}

function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return s || "server";
}

/** Derive warnings from what an installed extension actually registers. */
function inspectedWarnings(x: InstalledExt): Warning[] {
  const out: Warning[] = [];
  if (x.error) out.push({ level: "warn", text: t("wError", { error: x.error.slice(0, 200) }) });
  for (const [hook, level] of [
    ["before_turn", "high"],
    ["user_message", "high"],
    ["tool_call", "warn"],
    ["tool_result", "warn"],
  ] as const) {
    if (x.hooks.includes(hook)) out.push({ level, text: t(`w${hook[0].toUpperCase()}${hook.slice(1)}` as "wTool_call") });
  }
  if (x.prompt) out.push({ level: "warn", text: t("wPrompt") });
  if (x.tools.length) {
    const effects = [...new Set(x.tools.flatMap((tl) => tl.sideEffects))]
      .map((e) => ({ write: t("effWrite"), execute: t("effExecute"), network: t("effNetwork"), external: t("effExternal"), read: t("effRead") })[e])
      .filter(Boolean);
    const names = x.tools.map((tl) => tl.name).join(", ");
    out.push(
      effects.length
        ? { level: "warn", text: t("wToolsEffects", { effects: effects.join(", "), tools: names }) }
        : { level: "info", text: t("wTools", { tools: names }) },
    );
  }
  if (x.commands.length) out.push({ level: "info", text: t("wCommands", { commands: x.commands.map((c) => "/" + c).join(", ") }) });
  return out;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AddonsView {
  private registry: RegistryEntry[] = [];
  private registryNote = "";
  private installed: InstalledExt[] = [];
  private listNote = "";
  private supportsDisable = true;
  private disabled: string[] = [];
  private servers: UserMcpServer[] = [];
  private serversInstalled = new Set<string>();
  private busy: string | null = null;
  private progressLine = "";
  private confirm: string | null = null;
  private loadedExt = false;
  private runtimeNote = "";
  private browsers: Browsers = { edge: null, chrome: null };
  /** Open settings dialog: "new:<catalog id>" or "edit:<server id>". */
  private editing: string | null = null;

  constructor(
    private readonly onChanged: () => void,
    private readonly errText: (e: unknown) => string,
  ) {
    void listen<{ line: string }>("addons://progress", (e) => {
      this.progressLine = e.payload.line.slice(0, 200);
      for (const id of ["ext-status", "mcp-status"]) {
        const s = document.querySelector<HTMLElement>(`#${id} .progress-line`);
        if (s) s.textContent = this.progressLine;
      }
    });
    document.getElementById("btn-ext-reload")!.addEventListener("click", () => void this.loadExtensions(true));
    document.getElementById("btn-mcp-add")!.addEventListener("click", () => void this.addCustom());
    const kind = document.getElementById("mcp-kind") as HTMLSelectElement;
    kind.addEventListener("change", () => this.showKind(kind.value));
  }

  /** Settings were opened: take the saved lists. */
  open(s: AddonSettings) {
    this.disabled = [...(s.disabledExtensions ?? [])];
    this.servers = (s.mcpServers ?? []).map((x) => ({ ...x }));
    this.confirm = null;
    // Old status lines may be in another language by now.
    this.message = null;
    this.mcpMessage = null;
    this.editing = null;
  }

  async showExtensions() {
    this.renderExtensions();
    if (!this.loadedExt) await this.loadExtensions(false);
  }

  async showTools() {
    this.serversInstalled = new Set(await invoke<string[]>("mcp_installed").catch(() => []));
    this.browsers = await invoke<Browsers>("mcp_browsers").catch(() => this.browsers);
    this.renderTools();
  }

  /** Re-render after a language switch. */
  rerender() {
    this.renderExtensions();
    this.renderTools();
  }

  // ---- extensions ---------------------------------------------------------

  private async loadExtensions(force: boolean) {
    if (this.busy && !force) return;
    this.loadedExt = false;
    this.registryNote = t("loading");
    this.listNote = "";
    this.renderExtensions();
    const [reg, list] = await Promise.all([
      invoke<RegistryResult>("registry_fetch").catch((e) => ({ data: null, cached: false, error: this.errText(e) })),
      invoke<HelperResult<ExtListData>>("ext_list").catch((e) => ({ ok: false, data: null, log: this.errText(e) })),
    ]);
    const rt = await invoke<{ python: string; bundled: boolean } | null>("addons_runtime").catch(() => null);
    this.runtimeNote = rt && !rt.bundled ? t("runtimeOwn", { python: rt.python }) : "";
    this.registry = (reg.data?.extensions ?? []).filter((e) => e && typeof e.name === "string" && typeof e.pypi === "string");
    this.registryNote = reg.error ? (reg.cached ? t("registryCached") : t("registryOffline")) : "";
    if (list.ok && list.data?.ok) {
      this.installed = list.data.extensions;
      this.supportsDisable = list.data.supportsDisable;
      this.listNote = this.supportsDisable ? "" : t("noDisable");
      if (list.data.otherPython && this.installed.length)
        this.listNote = `${this.listNote} ${t("otherPython", { was: pyVersion(list.data.otherPython), now: pyVersion(list.data.python ?? "") })}`.trim();
    } else {
      this.installed = [];
      // The backend's message says what is missing (e.g. no Python behind the agent program).
      this.listNote = `${t("listFailed")} ${list.log.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ""}`.trim();
      if (list.log) console.warn("ext_list:", list.log);
    }
    this.loadedExt = true;
    this.renderExtensions();
  }

  private status(host: HTMLElement, lines: Array<{ text: string; tone?: "bad" | "ok" | "" }>, details = "") {
    host.innerHTML = "";
    for (const l of lines) if (l.text) host.appendChild(el("p", `hint ${l.tone ?? ""}`, l.text));
    if (this.busy) host.appendChild(el("p", "hint progress-line", this.progressLine));
    if (details) {
      const d = el("details", "tech");
      d.appendChild(el("summary", "", t("techDetails")));
      d.appendChild(el("pre", "", details));
      host.appendChild(d);
    }
  }

  private message: { text: string; tone: "ok" | "bad"; details: string } | null = null;

  private renderExtensions() {
    const host = document.getElementById("ext-list");
    const statusHost = document.getElementById("ext-status");
    if (!host || !statusHost) return;
    this.status(
      statusHost,
      [
        { text: this.registryNote, tone: this.registryNote && this.registryNote !== t("loading") ? "bad" : "" },
        { text: this.listNote, tone: "bad" },
        { text: this.runtimeNote },
        { text: this.busy ? this.busy : "" },
        { text: this.message?.text ?? "", tone: this.message?.tone },
      ],
      this.message?.details ?? "",
    );
    host.innerHTML = "";
    const seen = new Set<InstalledExt>();
    for (const r of this.registry) {
      if (r.status === "builtin") continue;
      const inst = this.installed.find(
        (x) => (x.dist && canonical(x.dist) === canonical(r.pypi)) || extKey(x.name) === extKey(r.name),
      );
      if (inst) seen.add(inst);
      host.appendChild(this.extCard(r, inst));
    }
    for (const x of this.installed) if (!seen.has(x)) host.appendChild(this.extCard(null, x));
  }

  private extCard(r: RegistryEntry | null, inst: InstalledExt | undefined): HTMLElement {
    // Own keys only: a registry name like "constructor" must not hit Object.prototype.
    const known = r && Object.prototype.hasOwnProperty.call(KNOWN_EXT, r.name) ? KNOWN_EXT[r.name] : undefined;
    const card = el("div", "addon");
    const head = el("div", "addon-head");
    const title = el("span", "addon-title", known ? tr3(known.title) : (r?.name ?? inst!.name));
    head.appendChild(title);
    const off = inst ? this.disabled.some((d) => extKey(d) === extKey(inst.name)) : false;
    const chip = inst
      ? el("span", `chip ${off ? "off" : "on"}`, off ? t("off") : t("active"))
      : el("span", "chip", r?.status === "planned" ? t("planned") : r?.status === "deprecated" ? t("deprecated") : t("notInstalled"));
    head.appendChild(chip);
    if (inst?.version) head.appendChild(el("span", "addon-version", inst.version));
    card.appendChild(head);

    card.appendChild(el("p", "addon-desc", known ? tr3(known.desc) : (r?.description ?? "")));

    const warnings: Warning[] = (known?.warnings ?? []).map((w) => ({ level: w.level, text: tr3(w) }));
    if (inst) warnings.push(...inspectedWarnings(inst));
    else if (!known) warnings.push({ level: "info", text: t("wUnknown") });
    if (inst?.source === "user") warnings.push({ level: "info", text: t("fromFolder", { path: inst.path }) });
    else if (inst && !inst.managed) warnings.push({ level: "info", text: t("partOfApp") });
    // Most severe first.
    const order: Level[] = ["high", "warn", "info"];
    warnings.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
    const wl = warningList(warnings);
    if (wl) card.appendChild(wl);

    if (inst && (inst.hooks.length || inst.tools.length || inst.commands.length || inst.prompt)) {
      card.appendChild(this.extDetails(inst));
    }

    const actions = el("div", "addon-actions");
    const key = r?.pypi ?? inst?.dist ?? inst?.name ?? "";
    const label = known ? tr3(known.title) : (r?.name ?? inst?.name ?? "");
    if (inst) {
      const toggle = el("label", "check");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !off;
      cb.disabled = !!this.busy || !this.supportsDisable;
      cb.addEventListener("change", () => void this.setEnabled(inst.name, cb.checked));
      toggle.append(cb, document.createTextNode(t("enabled")));
      actions.appendChild(toggle);
      if (inst.managed && inst.dist) {
        const sure = this.confirm === `rm:${key}`;
        const b = button(sure ? t("removeSure") : t("remove"), "danger", () => {
          if (!sure) {
            this.confirm = `rm:${key}`;
            return this.renderExtensions();
          }
          void this.uninstall(inst, label);
        });
        b.disabled = !!this.busy;
        actions.appendChild(b);
      }
    } else if (r && (r.status ?? "published") === "published") {
      const risky = warnings.some((w) => w.level === "high");
      const sure = this.confirm === `in:${key}`;
      const b = button(sure ? t("installSure") : t("install"), sure ? "danger" : "secondary", () => {
        if (risky && !sure) {
          this.confirm = `in:${key}`;
          return this.renderExtensions();
        }
        void this.install(r, label);
      });
      b.disabled = !!this.busy;
      actions.appendChild(b);
    }
    if (actions.childElementCount) card.appendChild(actions);
    return card;
  }

  private extDetails(x: InstalledExt): HTMLElement {
    const d = el("details", "addon-details");
    d.appendChild(el("summary", "", t("whatItDoes")));
    const dl = el("dl");
    const row = (k: string, v: string) => {
      if (!v) return;
      dl.appendChild(el("dt", "", k));
      dl.appendChild(el("dd", "", v));
    };
    row(t("hooksLabel"), x.hooks.map((h) => (HOOK_NAMES[h] ? tr3(HOOK_NAMES[h]) : h)).join(", "));
    row(t("toolsLabel"), x.tools.map((tl) => `${tl.name}${tl.description ? ` – ${tl.description}` : ""}`).join("\n"));
    row(t("commandsLabel"), x.commands.map((c) => "/" + c).join(", "));
    row(t("promptLabel"), x.prompt);
    d.appendChild(dl);
    return d;
  }

  private async setEnabled(name: string, on: boolean) {
    const k = extKey(name);
    this.disabled = this.disabled.filter((d) => extKey(d) !== k);
    if (!on) this.disabled.push(name);
    try {
      await invoke("set_disabled_extensions", { names: this.disabled });
      this.message = { text: t("restartNote"), tone: "ok", details: "" };
      this.onChanged();
    } catch (e) {
      this.message = { text: this.errText(e), tone: "bad", details: "" };
    }
    this.renderExtensions();
  }

  private async install(r: RegistryEntry, label: string) {
    this.confirm = null;
    this.busy = t("installing", { name: label });
    this.progressLine = "";
    this.message = null;
    this.renderExtensions();
    try {
      const res = await invoke<HelperResult<{ entryPoints?: string[] }>>("ext_install", { dist: r.pypi });
      if (res.ok) {
        // A fresh install is switched on, even if an older copy was switched off.
        const eps = res.data?.entryPoints ?? [];
        const before = this.disabled.length;
        this.disabled = this.disabled.filter((d) => !eps.some((e) => extKey(e) === extKey(d)) && extKey(d) !== extKey(r.name));
        if (this.disabled.length !== before) await invoke("set_disabled_extensions", { names: this.disabled });
        this.message = { text: t("installed", { name: label }), tone: "ok", details: "" };
        this.onChanged();
      } else {
        this.message = { text: t("installFailed", { name: label }), tone: "bad", details: res.log };
      }
    } catch (e) {
      this.message = { text: t("installFailed", { name: label }), tone: "bad", details: this.errText(e) };
    }
    this.setIdle();
    await this.loadExtensions(true);
  }

  /** `busy` blocks both tabs: when it ends, both must show it (not only the one
   * that ran the job). */
  private setIdle() {
    this.busy = null;
    this.rerender();
  }

  private async uninstall(x: InstalledExt, label: string) {
    this.confirm = null;
    this.busy = t("removing", { name: label });
    this.progressLine = "";
    this.message = null;
    this.renderExtensions();
    try {
      const res = await invoke<HelperResult>("ext_uninstall", { dist: x.dist });
      if (res.ok) {
        this.disabled = this.disabled.filter((d) => extKey(d) !== extKey(x.name));
        await invoke("set_disabled_extensions", { names: this.disabled });
        this.message = { text: t("removed", { name: label }), tone: "ok", details: "" };
        this.onChanged();
      } else {
        this.message = { text: t("removeFailed", { name: label }), tone: "bad", details: res.log };
      }
    } catch (e) {
      this.message = { text: t("removeFailed", { name: label }), tone: "bad", details: this.errText(e) };
    }
    this.setIdle();
    await this.loadExtensions(true);
  }

  // ---- MCP servers --------------------------------------------------------

  private mcpMessage: { text: string; tone: "ok" | "bad"; details: string } | null = null;

  private renderTools() {
    const list = document.getElementById("mcp-list");
    const cat = document.getElementById("mcp-catalog");
    const statusHost = document.getElementById("mcp-status");
    if (!list || !cat || !statusHost) return;
    this.status(
      statusHost,
      [{ text: this.busy ?? "" }, { text: this.mcpMessage?.text ?? "", tone: this.mcpMessage?.tone }],
      this.mcpMessage?.details ?? "",
    );

    list.innerHTML = "";
    if (!this.servers.length) list.appendChild(el("p", "hint", t("mcpNone")));
    for (const s of this.servers) list.appendChild(this.serverCard(s));

    cat.innerHTML = "";
    for (const c of MCP_CATALOG) {
      const card = el("div", "addon");
      const head = el("div", "addon-head");
      head.appendChild(el("span", "addon-title", tr3(c.title)));
      const added = this.servers.some((s) => s.catalog === c.id);
      if (added) head.appendChild(el("span", "chip on", t("mcpAdded")));
      card.appendChild(head);
      card.appendChild(el("p", "addon-desc", tr3(c.desc)));
      const wl = warningList(c.warnings.map((w) => ({ level: w.level, text: tr3(w) })));
      if (wl) card.appendChild(wl);
      if (!added && this.editing === `new:${c.id}`) {
        card.appendChild(
          this.configForm(c, defaultsFor(c, this.browsers), t("mcpInstallNow"), (o) => void this.addCatalog(c, o)),
        );
      } else if (!added) {
        const actions = el("div", "addon-actions");
        const b = button(t("mcpAddCatalog"), "secondary", () => {
          if (!c.fields?.length) return void this.addCatalog(c, {});
          this.editing = `new:${c.id}`;
          this.renderTools();
        });
        b.disabled = !!this.busy;
        actions.appendChild(b);
        card.appendChild(actions);
      }
      cat.appendChild(card);
    }
  }

  /** Settings dialog of a catalog server (inline in its card). */
  private configForm(c: CatalogEntry, values: Record<string, string>, submit: string, onSubmit: (o: Record<string, string>) => void): HTMLElement {
    const form = el("div", "mcp-config");
    const current: Record<string, string> = { ...defaultsFor(c, this.browsers), ...values };
    for (const f of c.fields ?? []) {
      if (f.type === "bool") {
        const lab = el("label", "check");
        const cb = el("input");
        cb.type = "checkbox";
        cb.dataset.key = f.key;
        cb.checked = current[f.key] === "1";
        cb.addEventListener("change", () => (current[f.key] = cb.checked ? "1" : "0"));
        lab.append(cb, document.createTextNode(tr3(f.label)));
        form.appendChild(lab);
      } else {
        const lab = el("label", "", tr3(f.label));
        const sel = el("select");
        sel.dataset.key = f.key;
        for (const o of f.options ?? []) {
          const opt = el("option", "", tr3(o.label));
          opt.value = o.value;
          sel.appendChild(opt);
        }
        sel.value = current[f.key];
        sel.addEventListener("change", () => (current[f.key] = sel.value));
        lab.appendChild(sel);
        form.appendChild(lab);
      }
      if (f.hint) form.appendChild(el("p", "hint", tr3(f.hint)));
    }
    const actions = el("div", "addon-actions");
    actions.appendChild(
      button(t("cancel"), "secondary", () => {
        this.editing = null;
        this.renderTools();
      }),
    );
    const ok = button(submit, "primary", () => onSubmit({ ...current }));
    ok.disabled = !!this.busy;
    actions.appendChild(ok);
    form.appendChild(actions);
    return form;
  }

  private serverCard(s: UserMcpServer): HTMLElement {
    const card = el("div", "addon");
    const head = el("div", "addon-head");
    const cat = MCP_CATALOG.find((c) => c.id === s.catalog);
    head.appendChild(el("span", "addon-title", cat ? tr3(cat.title) : s.label));
    const missing = (s.kind === "package" || s.kind === "node") && !this.serversInstalled.has(s.id);
    head.appendChild(
      el("span", `chip ${missing || !s.enabled ? "off" : "on"}`, missing ? t("mcpNotInstalled") : s.enabled ? t("active") : t("off")),
    );
    card.appendChild(head);
    const what =
      s.kind === "package"
        ? t("mcpKindPackage", { pkg: s.package })
        : s.kind === "node"
          ? t("mcpKindNode", { pkg: s.package })
        : s.kind === "http"
          ? t("mcpKindHttpShort", { url: s.url })
          : t("mcpKindCommandShort", { cmd: [s.command, ...s.args].join(" ") });
    card.appendChild(el("p", "addon-desc mono", what));
    if (!cat) {
      const wl = warningList([{ level: "warn", text: t("mcpCustomWarn") }]);
      if (wl) card.appendChild(wl);
    }
    if (cat && this.editing === `edit:${s.id}`) {
      card.appendChild(
        this.configForm(cat, s.options ?? {}, t("mcpSaveConfig"), (o) => {
          applyCatalog(s, cat, o);
          this.editing = null;
          void this.saveServers().then((ok) => {
            if (ok) this.mcpMessage = { text: t("mcpSaved"), tone: "ok", details: "" };
            this.renderTools();
          });
        }),
      );
      return card;
    }
    const actions = el("div", "addon-actions");
    const toggle = el("label", "check");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = s.enabled;
    cb.disabled = !!this.busy;
    cb.addEventListener("change", () => {
      s.enabled = cb.checked;
      void this.saveServers();
    });
    toggle.append(cb, document.createTextNode(t("enabled")));
    actions.appendChild(toggle);
    if (missing) {
      const b = button(t("install"), "secondary", () => void this.installServer(s));
      b.disabled = !!this.busy;
      actions.appendChild(b);
    }
    if (cat?.fields?.length) {
      const b = button(t("mcpConfigure"), "secondary", () => {
        this.editing = `edit:${s.id}`;
        this.renderTools();
      });
      b.disabled = !!this.busy;
      actions.appendChild(b);
    }
    const sure = this.confirm === `mcp:${s.id}`;
    const rm = button(sure ? t("removeSure") : t("remove"), "danger", () => {
      if (!sure) {
        this.confirm = `mcp:${s.id}`;
        return this.renderTools();
      }
      void this.removeServer(s);
    });
    rm.disabled = !!this.busy;
    actions.appendChild(rm);
    card.appendChild(actions);
    return card;
  }

  private async saveServers(): Promise<boolean> {
    try {
      await invoke("set_mcp_servers", { servers: this.servers });
      this.onChanged();
      return true;
    } catch (e) {
      this.mcpMessage = { text: this.errText(e), tone: "bad", details: "" };
      this.renderTools();
      return false;
    }
  }

  private uniqueId(base: string): string {
    let id = slugify(base);
    // Names of the servers the widget brings itself (desktop control, photo search).
    if (RESERVED_IDS.includes(id)) id = `${id}-2`;
    let n = 2;
    const stem = id;
    while (this.servers.some((s) => s.id === id)) id = `${stem}-${n++}`;
    return id;
  }

  private async addCatalog(c: CatalogEntry, options: Record<string, string>) {
    this.editing = null;
    const s: UserMcpServer = {
      id: this.uniqueId(c.id),
      label: tr3(c.title),
      kind: "package",
      enabled: true,
      catalog: c.id,
      package: "",
      script: "",
      command: "",
      args: [],
      env: [],
      url: "",
      headers: [],
    };
    applyCatalog(s, c, { ...defaultsFor(c, this.browsers), ...options });
    this.servers.push(s);
    if (await this.saveServers()) await this.installServer(s);
  }

  /** Catalog servers in the current UI language (the stored label is in the
   * language of the moment they were added). */
  private serverLabel(s: UserMcpServer): string {
    const c = MCP_CATALOG.find((x) => x.id === s.catalog);
    return c ? tr3(c.title) : s.label;
  }

  private async installServer(s: UserMcpServer) {
    const label = this.serverLabel(s);
    this.confirm = null;
    this.busy = s.kind === "node" ? t("mcpNodeFirst", { name: label }) : t("installing", { name: label });
    this.progressLine = "";
    this.mcpMessage = null;
    this.renderTools();
    try {
      const res = await invoke<HelperResult>("mcp_install", {
        id: s.id,
        requirement: s.package,
        runtime: s.kind === "node" ? "node" : "python",
        bin: s.kind === "node" ? s.script : "",
      });
      this.mcpMessage = res.ok
        ? { text: t("mcpInstalledOk", { name: label }), tone: "ok", details: "" }
        : { text: t("installFailed", { name: label }), tone: "bad", details: res.log };
      if (res.ok) this.onChanged();
    } catch (e) {
      this.mcpMessage = { text: t("installFailed", { name: label }), tone: "bad", details: this.errText(e) };
    }
    this.setIdle();
    await this.showTools();
  }

  private async removeServer(s: UserMcpServer) {
    this.confirm = null;
    this.servers = this.servers.filter((x) => x !== s);
    if (!(await this.saveServers())) return;
    const label = this.serverLabel(s);
    let msg: { text: string; tone: "ok" | "bad"; details: string } = {
      text: t("removed", { name: label }),
      tone: "ok",
      details: "",
    };
    if (s.kind === "package" || s.kind === "node") {
      try {
        // false: the running aar still uses some files (Windows); they go at its restart.
        if (!(await invoke<boolean>("mcp_remove", { id: s.id })))
          msg = { text: t("removedAfterRestart", { name: label }), tone: "ok", details: "" };
      } catch (e) {
        msg = { text: t("removeFailed", { name: label }), tone: "bad", details: this.errText(e) };
      }
    }
    this.mcpMessage = msg;
    await this.showTools();
  }

  private showKind(kind: string) {
    for (const d of document.querySelectorAll<HTMLElement>("#mcp-form [data-kind]")) d.hidden = d.dataset.kind !== kind;
  }

  private async addCustom() {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    const err = document.getElementById("mcp-form-error")!;
    err.textContent = "";
    const label = v("mcp-name");
    const kind = v("mcp-kind") === "http" ? "http" : "command";
    try {
      if (!label) throw new Error(t("mcpErrName"));
      if (this.servers.some((s) => s.label.toLowerCase() === label.toLowerCase())) throw new Error(t("mcpNameTaken"));
      const s: UserMcpServer = {
        id: this.uniqueId(label),
        label,
        kind,
        enabled: true,
        catalog: "",
        package: "",
        script: "",
        command: "",
        args: [],
        env: [],
        url: "",
        headers: [],
      };
      if (kind === "command") {
        s.command = v("mcp-command");
        if (!s.command) throw new Error(t("mcpErrCommand"));
        s.args = splitArgs(v("mcp-args"));
        s.env = parsePairs(v("mcp-env"), "=", t("pairEnv"));
      } else {
        s.url = v("mcp-url");
        if (!/^https?:\/\/\S+$/i.test(s.url)) throw new Error(t("mcpErrUrl"));
        s.headers = parsePairs(v("mcp-headers"), ":", t("pairHeader"));
      }
      this.servers.push(s);
      if (!(await this.saveServers())) {
        this.servers.pop();
        return;
      }
      for (const id of ["mcp-name", "mcp-command", "mcp-args", "mcp-env", "mcp-url", "mcp-headers"])
        (document.getElementById(id) as HTMLInputElement).value = "";
      this.mcpMessage = { text: t("restartNote"), tone: "ok", details: "" };
      this.renderTools();
    } catch (e) {
      err.textContent = this.errText(e);
    }
  }
}
