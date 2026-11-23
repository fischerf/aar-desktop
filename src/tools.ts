// Plain-language descriptions of tool calls for non-technical users.

import type { ToolCallInfo } from "./acp";
import { lang, strings } from "./i18n";

type VerbKey =
  | "read_file" | "write_file" | "edit_file" | "list_directory" | "find_files" | "grep" | "bash"
  | "powershell" | "acp_terminal" | "list_windows" | "focus_window" | "launch_app" | "close_window"
  | "get_ui_tree" | "click_element" | "set_text" | "send_keys" | "read_text" | "screenshot" | "click_at"
  | "drag" | "spawn_agent" | "web_search" | "fetch" | "companion_status";

const verbText = strings<VerbKey>({
  de: {
    read_file: "Datei lesen",
    write_file: "Datei schreiben",
    edit_file: "Datei ändern",
    list_directory: "Ordner ansehen",
    find_files: "Dateien suchen",
    grep: "In Dateien suchen",
    bash: "Befehl ausführen",
    powershell: "PowerShell-Befehl ausführen",
    acp_terminal: "Befehl ausführen",
    // Windows desktop control (bundled MCP server)
    list_windows: "Offene Fenster ansehen",
    focus_window: "Fenster nach vorne holen",
    launch_app: "Programm starten",
    close_window: "Fenster schließen",
    get_ui_tree: "Fensterinhalt lesen",
    click_element: "Klicken",
    set_text: "Text eingeben",
    send_keys: "Tasten drücken",
    read_text: "Text lesen",
    screenshot: "Bildschirmfoto machen",
    click_at: "Klicken",
    drag: "Mit der Maus ziehen",
    spawn_agent: "Helfer beauftragen",
    web_search: "Im Internet suchen",
    fetch: "Webseite abrufen",
    companion_status: "Stimmung prüfen",
  },
  en: {
    read_file: "Read a file",
    write_file: "Write a file",
    edit_file: "Change a file",
    list_directory: "Look into a folder",
    find_files: "Find files",
    grep: "Search in files",
    bash: "Run a command",
    powershell: "Run a PowerShell command",
    acp_terminal: "Run a command",
    list_windows: "Look at open windows",
    focus_window: "Bring a window to the front",
    launch_app: "Start a program",
    close_window: "Close a window",
    get_ui_tree: "Read window contents",
    click_element: "Click",
    set_text: "Type text",
    send_keys: "Press keys",
    read_text: "Read text",
    screenshot: "Take a screenshot",
    click_at: "Click",
    drag: "Drag with the mouse",
    spawn_agent: "Ask a helper",
    web_search: "Search the web",
    fetch: "Open a web page",
    companion_status: "Check the mood",
  },
  zh: {
    read_file: "读取文件",
    write_file: "写入文件",
    edit_file: "修改文件",
    list_directory: "查看文件夹",
    find_files: "查找文件",
    grep: "在文件中搜索",
    bash: "运行命令",
    powershell: "运行 PowerShell 命令",
    acp_terminal: "运行命令",
    list_windows: "查看打开的窗口",
    focus_window: "将窗口切到前台",
    launch_app: "启动程序",
    close_window: "关闭窗口",
    get_ui_tree: "读取窗口内容",
    click_element: "点击",
    set_text: "输入文字",
    send_keys: "按键",
    read_text: "读取文字",
    screenshot: "截屏",
    click_at: "点击",
    drag: "用鼠标拖动",
    spawn_agent: "委托助手",
    web_search: "上网搜索",
    fetch: "打开网页",
    companion_status: "查看心情",
  },
});

const VERB_KEYS: Record<VerbKey, true> = {
  read_file: true, write_file: true, edit_file: true, list_directory: true, find_files: true, grep: true,
  bash: true, powershell: true, acp_terminal: true, list_windows: true, focus_window: true, launch_app: true,
  close_window: true, get_ui_tree: true, click_element: true, set_text: true, send_keys: true, read_text: true,
  screenshot: true, click_at: true, drag: true, spawn_agent: true, web_search: true, fetch: true,
  companion_status: true,
};

function verbOf(name: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(VERB_KEYS, name)) return verbText(name as VerbKey);
  const group = Object.prototype.hasOwnProperty.call(EXTRA_TOOLS, name) ? EXTRA_TOOLS[name] : undefined;
  return group ? groupText(group) : undefined;
}

// Tools of the catalog MCP servers (Playwright, Chrome DevTools, memory),
// grouped into a few plain-language actions.
type GroupKey =
  | "open_page" | "back" | "pages" | "close_page" | "page_click" | "page_type" | "page_read" | "page_shot"
  | "page_upload" | "page_dialog" | "page_script" | "page_debug" | "mem_save" | "mem_forget" | "mem_recall"
  | "photo_find" | "photo_status" | "photo_index" | "photo_look";

const groupText = strings<GroupKey>({
  de: {
    open_page: "Webseite öffnen",
    back: "Im Browser zurück",
    pages: "Browser-Tabs ansehen",
    close_page: "Browser-Tab schließen",
    page_click: "Auf der Webseite klicken",
    page_type: "Auf der Webseite eingeben",
    page_read: "Webseite lesen",
    page_shot: "Bildschirmfoto der Webseite",
    page_upload: "Datei hochladen",
    page_dialog: "Meldung im Browser beantworten",
    page_script: "Skript auf der Webseite ausführen",
    page_debug: "Webseite untersuchen",
    mem_save: "Etwas merken",
    mem_forget: "Etwas vergessen",
    mem_recall: "Im Gedächtnis nachsehen",
    photo_find: "Fotos durchsuchen",
    photo_status: "Fotosuche prüfen",
    photo_index: "Fotos beschreiben lassen",
    photo_look: "Foto ansehen",
  },
  en: {
    open_page: "Open web page",
    back: "Go back in the browser",
    pages: "Look at browser tabs",
    close_page: "Close browser tab",
    page_click: "Click on the web page",
    page_type: "Type on the web page",
    page_read: "Read web page",
    page_shot: "Screenshot of the web page",
    page_upload: "Upload a file",
    page_dialog: "Answer a browser message",
    page_script: "Run a script on the web page",
    page_debug: "Inspect the web page",
    mem_save: "Remember something",
    mem_forget: "Forget something",
    mem_recall: "Look it up in memory",
    photo_find: "Search photos",
    photo_status: "Check photo search",
    photo_index: "Have photos described",
    photo_look: "Look at a photo",
  },
  zh: {
    open_page: "打开网页",
    back: "浏览器后退",
    pages: "查看浏览器标签页",
    close_page: "关闭浏览器标签页",
    page_click: "在网页上点击",
    page_type: "在网页上输入",
    page_read: "阅读网页",
    page_shot: "网页截图",
    page_upload: "上传文件",
    page_dialog: "回应浏览器提示",
    page_script: "在网页上运行脚本",
    page_debug: "检查网页",
    mem_save: "记住内容",
    mem_forget: "忘记内容",
    mem_recall: "查阅记忆",
    photo_find: "搜索照片",
    photo_status: "检查照片搜索",
    photo_index: "描述照片",
    photo_look: "查看照片",
  },
});

const EXTRA_TOOLS: Record<string, GroupKey> = {
  navigate_page: "open_page", new_page: "open_page", browser_navigate: "open_page",
  browser_navigate_back: "back",
  list_pages: "pages", select_page: "pages", browser_tabs: "pages",
  close_page: "close_page", browser_close: "close_page",
  click: "page_click", hover: "page_click", browser_click: "page_click", browser_hover: "page_click", browser_drag: "page_click",
  fill: "page_type", fill_form: "page_type", type_text: "page_type", press_key: "page_type",
  browser_type: "page_type", browser_fill_form: "page_type", browser_press_key: "page_type", browser_select_option: "page_type",
  take_snapshot: "page_read", browser_snapshot: "page_read", wait_for: "page_read", browser_wait_for: "page_read",
  take_screenshot: "page_shot", browser_take_screenshot: "page_shot",
  upload_file: "page_upload", browser_file_upload: "page_upload",
  handle_dialog: "page_dialog", browser_handle_dialog: "page_dialog",
  evaluate_script: "page_script", browser_evaluate: "page_script",
  list_console_messages: "page_debug", get_console_message: "page_debug", list_network_requests: "page_debug",
  get_network_request: "page_debug", lighthouse_audit: "page_debug", browser_console_messages: "page_debug",
  browser_network_requests: "page_debug",
  create_entities: "mem_save", create_relations: "mem_save", add_observations: "mem_save",
  delete_entities: "mem_forget", delete_observations: "mem_forget", delete_relations: "mem_forget",
  read_graph: "mem_recall", search_nodes: "mem_recall", open_nodes: "mem_recall",
  photo_search: "photo_find", photo_index_status: "photo_status", photo_index_update: "photo_index", photo_view: "photo_look",
};

type TextKey =
  | "aWindow" | "anElement" | "inWhere" | "tool"
  | "kind_read" | "kind_edit" | "kind_delete" | "kind_move" | "kind_search" | "kind_execute" | "kind_fetch" | "kind_think"
  | "type_Edit" | "type_Button" | "type_Document" | "type_Hyperlink" | "type_MenuItem" | "type_ListItem"
  | "type_TabItem" | "type_CheckBox" | "type_ComboBox" | "type_Group" | "type_Pane";

const t = strings<TextKey>({
  de: {
    aWindow: "einem Fenster",
    anElement: "einem Element",
    inWhere: "in {where}",
    tool: "Werkzeug",
    kind_read: "Etwas lesen",
    kind_edit: "Etwas ändern",
    kind_delete: "Etwas löschen",
    kind_move: "Etwas verschieben",
    kind_search: "Suchen",
    kind_execute: "Befehl ausführen",
    kind_fetch: "Daten abrufen",
    kind_think: "Nachdenken",
    type_Edit: "Eingabefeld",
    type_Button: "Schaltfläche",
    type_Document: "Dokument",
    type_Hyperlink: "Link",
    type_MenuItem: "Menüpunkt",
    type_ListItem: "Listeneintrag",
    type_TabItem: "Registerkarte",
    type_CheckBox: "Kästchen",
    type_ComboBox: "Auswahlliste",
    type_Group: "Bereich",
    type_Pane: "Bereich",
  },
  en: {
    aWindow: "a window",
    anElement: "an element",
    inWhere: "in {where}",
    tool: "Tool",
    kind_read: "Read something",
    kind_edit: "Change something",
    kind_delete: "Delete something",
    kind_move: "Move something",
    kind_search: "Search",
    kind_execute: "Run a command",
    kind_fetch: "Fetch data",
    kind_think: "Think",
    type_Edit: "input field",
    type_Button: "button",
    type_Document: "document",
    type_Hyperlink: "link",
    type_MenuItem: "menu item",
    type_ListItem: "list item",
    type_TabItem: "tab",
    type_CheckBox: "checkbox",
    type_ComboBox: "drop-down list",
    type_Group: "area",
    type_Pane: "area",
  },
  zh: {
    aWindow: "某个窗口",
    anElement: "某个元素",
    inWhere: "在 {where} 中",
    tool: "工具",
    kind_read: "读取内容",
    kind_edit: "修改内容",
    kind_delete: "删除内容",
    kind_move: "移动内容",
    kind_search: "搜索",
    kind_execute: "运行命令",
    kind_fetch: "获取数据",
    kind_think: "思考",
    type_Edit: "输入框",
    type_Button: "按钮",
    type_Document: "文档",
    type_Hyperlink: "链接",
    type_MenuItem: "菜单项",
    type_ListItem: "列表项",
    type_TabItem: "选项卡",
    type_CheckBox: "复选框",
    type_ComboBox: "下拉列表",
    type_Group: "区域",
    type_Pane: "区域",
  },
});

/** Quote a name the way the current language does („…“ / “…”). */
function quote(s: string): string {
  return lang() === "de" ? `„${s}“` : `“${s}”`;
}

const ELEMENT_TYPES = ["Edit", "Button", "Document", "Hyperlink", "MenuItem", "ListItem", "TabItem", "CheckBox", "ComboBox", "Group", "Pane"];

function typeLabel(type: string): string {
  return ELEMENT_TYPES.includes(type) ? t(`type_${type}` as TextKey) : type;
}

const DESKTOP_ICONS: Record<string, string> = {
  list_windows: "🪟",
  focus_window: "🪟",
  launch_app: "🚀",
  close_window: "🪟",
  get_ui_tree: "👀",
  click_element: "🖱️",
  set_text: "⌨️",
  send_keys: "⌨️",
  read_text: "👀",
  screenshot: "📸",
  click_at: "🖱️",
  drag: "🖱️",
};

// ---------------------------------------------------------------------------
// What the widget has seen of the desktop. The desktop tools take window
// handles ("196788") and element ids ("e22") that mean nothing to a user;
// their names come from earlier results (list_windows, launch_app and the
// header of get_ui_tree list handles with titles, get_ui_tree lists the ids).
// ---------------------------------------------------------------------------

const windowTitles = new Map<string, string>(); // handle -> title
const windowAlias = new Map<string, string>(); // what the model passed -> handle
// handle -> id -> element name (or its control type when unnamed); translated on display.
const elementLabels = new Map<string, Map<string, { name?: string; type: string }>>();

const WINDOW_LINE = /^(\d+)\s+\S+\s+pid=\d+\s+"(.*)"(?:\s+\[minimized\])?\s*$/gm;
const ELEMENT_LINE = /^\s*(e\d+)\s+([A-Za-z]+)(?:\s+"([^"]*)")?/;

function desktopTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(DESKTOP_ICONS, name);
}

/** Remember window titles and element names from a finished desktop tool call. */
export function learnFromTool(tc: ToolCallInfo) {
  const short = toolShortName(tc);
  if (tc.status !== "completed" || !desktopTool(short)) return;
  const out = toolOutputText(tc);
  let header: string | undefined;
  for (const m of out.matchAll(WINDOW_LINE)) {
    windowTitles.set(m[1], m[2].replace(/​/g, ""));
    header ??= m[1];
  }
  const asked = inputString(tc.rawInput, "window");
  if (asked && header && short !== "list_windows" && short !== "launch_app") windowAlias.set(asked, header);
  if (short === "get_ui_tree" && header) {
    const labels = new Map<string, { name?: string; type: string }>();
    for (const line of out.split("\n")) {
      const m = ELEMENT_LINE.exec(line);
      if (m) labels.set(m[1], { name: m[3] || undefined, type: m[2] });
    }
    elementLabels.set(header, labels);
  }
}

/** Forget everything (new conversation). */
export function forgetDesktop() {
  windowTitles.clear();
  windowAlias.clear();
  elementLabels.clear();
}

function windowHandle(win: string): string {
  return windowAlias.get(win) ?? win;
}

function windowLabel(win: string): string {
  const title = windowTitles.get(windowHandle(win));
  if (title) return shorten(title, 60);
  return /^\d+$/.test(win) || /^0x[0-9a-f]+$/i.test(win) ? t("aWindow") : quote(shorten(win, 60));
}

function elementLabel(win: string, element: string): string {
  const id = /^\s*e?(\d+)\s*$/i.exec(element);
  if (id) {
    const el = elementLabels.get(windowHandle(win))?.get(`e${id[1]}`);
    if (!el) return t("anElement");
    return el.name ? quote(el.name) : typeLabel(el.type);
  }
  // Selectors like "name=Speichern" or "type=Button;name=OK".
  const name = /(?:^|;)\s*name\s*=\s*([^;]+)/i.exec(element);
  return quote(shorten((name ? name[1] : element).trim(), 60));
}

function desktopDetail(short: string, input: unknown): string {
  const win = inputString(input, "window");
  const element = inputString(input, "element");
  const where = win ? windowLabel(win) : "";
  const target = element ? elementLabel(win, element) : "";
  switch (short) {
    case "launch_app":
      return inputString(input, "name_or_path");
    case "set_text": {
      const text = shorten(inputString(input, "text"), 100);
      return target ? `${text} → ${target}` : text;
    }
    case "send_keys":
      return [inputString(input, "keys"), where && t("inWhere", { where })].filter(Boolean).join(" ");
    case "click_element":
    case "click_at":
    case "drag":
      return target ? (where ? `${target} ${t("inWhere", { where })}` : target) : where;
    default:
      return target ? `${target} ${t("inWhere", { where })}` : where;
  }
}

function inputString(input: unknown, key: string): string {
  if (!input || typeof input !== "object") return "";
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const KINDS = ["read", "edit", "delete", "move", "search", "execute", "fetch", "think"];

function kindVerb(kind: string | undefined): string | undefined {
  return kind && KINDS.includes(kind) ? t(`kind_${kind}` as TextKey) : undefined;
}

function toolName(tc: ToolCallInfo): string {
  // aar uses the raw tool name as title; MCP tools may be "server__tool".
  return (tc.title ?? "").trim();
}

function toolShortName(tc: ToolCallInfo): string {
  const name = toolName(tc);
  return name.split(/__|\./).pop() ?? name;
}

export function describeTool(tc: ToolCallInfo): { verb: string; detail: string; icon: string } {
  const name = toolName(tc);
  const short = toolShortName(tc);
  const verb = verbOf(name) ?? verbOf(short) ?? kindVerb(tc.kind) ?? humanize(short || t("tool"));
  const detail = desktopTool(short) ? desktopDetail(short, tc.rawInput) : detailOf(tc.rawInput);
  return { verb, detail, icon: iconOf(tc.kind, short) };
}

function humanize(s: string) {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function detailOf(input: unknown): string {
  if (!input || typeof input !== "object") return typeof input === "string" ? input : "";
  const o = input as Record<string, unknown>;
  if (Array.isArray(o.terms) && o.terms.length) return o.terms.join(", "); // photo_search
  for (const k of ["path", "file_path", "command", "query", "pattern", "url", "text", "keys", "name_or_path", "app", "element", "window", "name", "task", "prompt"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.length > 140 ? v.slice(0, 140) + "…" : v;
  }
  return "";
}

function iconOf(kind: string | undefined, name: string): string {
  if (DESKTOP_ICONS[name]) return DESKTOP_ICONS[name];
  const group = Object.prototype.hasOwnProperty.call(EXTRA_TOOLS, name) ? EXTRA_TOOLS[name] : undefined;
  if (group) return group.startsWith("mem_") ? "🧠" : group.startsWith("photo_") ? "🖼️" : "🌐";
  if (name === "bash" || name === "powershell" || name === "acp_terminal" || kind === "execute") return "⌨️";
  switch (kind) {
    case "read":
      return "📄";
    case "edit":
      return "✏️";
    case "delete":
      return "🗑️";
    case "search":
      return "🔍";
    case "fetch":
      return "🌐";
    default:
      return "🔧";
  }
}

export function toolOutputText(tc: ToolCallInfo): string {
  const parts: string[] = [];
  for (const c of tc.content ?? []) {
    if (c.type === "content" && c.content?.type === "text" && c.content.text) parts.push(c.content.text);
  }
  if (!parts.length && typeof tc.rawOutput === "string") parts.push(tc.rawOutput);
  return parts.join("\n");
}

export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ---------------------------------------------------------------------------
// Files a turn produced: paths mentioned in tool inputs, commands, results and
// the answer. Rust checks which of them exist and changed during the turn.
// ---------------------------------------------------------------------------

const DOC_EXT = "pdf|md|markdown|txt|html?|rtf|odt|docx?|xlsx?|ods|pptx?|csv|json|xml|png|jpe?g|gif|webp|svg";
// Quoted paths may contain spaces; unquoted ones end at whitespace.
const QUOTE = "\"'`„“”";
const QUOTED_PATH = new RegExp(String.raw`[${QUOTE}]([A-Za-z]:[\\/][^${QUOTE}\r\n]*?\.(?:${DOC_EXT}))[${QUOTE}]`, "gi");
const PLAIN_PATH = new RegExp(String.raw`(?<![\w])[A-Za-z]:[\\/][^\s${QUOTE}<>|*?]*?\.(?:${DOC_EXT})(?![\w])`, "gi");

/** Windows paths of documents mentioned in `text`. */
export function filePathsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(QUOTED_PATH)) out.add(m[1]);
  for (const m of text.matchAll(PLAIN_PATH)) out.add(m[0]);
  return [...out];
}

/** Candidate output files of one tool call (input paths, command text, result). */
export function toolFileCandidates(tc: ToolCallInfo): string[] {
  const out: string[] = [];
  for (const k of ["path", "file_path"]) {
    const v = inputString(tc.rawInput, k);
    if (v) out.push(v);
  }
  const texts: string[] = [];
  if (tc.rawInput && typeof tc.rawInput === "object") {
    for (const v of Object.values(tc.rawInput as Record<string, unknown>)) if (typeof v === "string") texts.push(v);
  }
  texts.push(toolOutputText(tc));
  for (const s of texts) out.push(...filePathsIn(s));
  return out;
}
