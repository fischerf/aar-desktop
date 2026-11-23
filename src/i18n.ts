// UI languages: German (default of the project), English, Simplified Chinese.
//
// Every module declares its own strings with `strings({de, en, zh})`; the
// compiler checks that all three languages have the same keys. Static texts in
// index.html carry `data-i18n*` attributes and are filled by `applyStatic()`.
//
//   const t = strings({ de: { hi: "Hallo {name}" }, en: { hi: "Hello {name}" }, zh: { hi: "你好，{name}" } });
//   t("hi", { name: "Aar" })

export type Lang = "de" | "en" | "zh";
export const LANGS: Lang[] = ["de", "en", "zh"];
/** Names shown in the language picker (always in their own language). */
export const LANG_NAMES: Record<Lang, string> = { de: "Deutsch", en: "English", zh: "简体中文" };

const LANG_KEY = "aar-ui:lang";
let current: Lang = resolveLang(localStorage.getItem(LANG_KEY) ?? "");
const listeners = new Set<(l: Lang) => void>();

/** "" / "auto" = Windows display language (WebView2 reports it as navigator.languages). */
export function resolveLang(setting: string): Lang {
  const s = (setting || "").trim().toLowerCase();
  if (s === "de" || s === "en" || s === "zh") return s;
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const t = (tag || "").toLowerCase();
    if (t.startsWith("de")) return "de";
    if (t.startsWith("zh")) return "zh";
    if (t.startsWith("en")) return "en";
  }
  return "en";
}

export function lang(): Lang {
  return current;
}

/** Locale tag for Intl / toLocaleString. */
export function locale(): string {
  return current === "zh" ? "zh-CN" : current === "en" ? "en-GB" : "de-DE";
}

export function setLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l);
  if (l === current) return;
  current = l;
  for (const fn of listeners) fn(l);
}

export function onLangChange(fn: (l: Lang) => void) {
  listeners.add(fn);
}

export type Params = Record<string, string | number>;

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Declare the strings of one module. Returns its translate function. */
export function strings<K extends string>(dict: { de: Record<K, string>; en: Record<K, string>; zh: Record<K, string> }) {
  const all = dict as Record<Lang, Record<K, string>>;
  return (key: K, params?: Params): string => fill(all[current][key] ?? all.de[key] ?? key, params);
}

/** Pick one of three inline variants (for one-off texts). */
export function pick(de: string, en: string, zh: string, params?: Params): string {
  return fill(current === "zh" ? zh : current === "en" ? en : de, params);
}

/**
 * Fill static texts from data attributes:
 *   data-i18n="key"            -> textContent
 *   data-i18n-tip="key"        -> data-tip (tooltip)
 *   data-i18n-placeholder="key"
 *   data-i18n-aria="key"       -> aria-label
 */
export function applyStatic(t: (key: any) => string, root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-tip]")) el.dataset.tip = t(el.dataset.i18nTip!);
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]"))
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder!);
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-aria]"))
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  document.documentElement.lang = current === "zh" ? "zh-CN" : current;
}
