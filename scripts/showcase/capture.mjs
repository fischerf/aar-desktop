// Screenshots (1600x1200) and GIF frames of Aar Desktop for the project page,
// one set per language (en, de, zh). The real frontend runs inside
// scripts/showcase/stage.html with the fake Tauri/ACP backend from tests/e2e;
// demo turns are scripted below. Run via scripts/wsl/showcase.sh.
//
// Env: SHOWCASE_OUT (output root, files go to <root>/<lang>/), SHOWCASE_PHOTOS,
//      SHOWCASE_ONLY (scenes, comma separated), SHOWCASE_LANGS (default en,de,zh)
import { chromium } from "playwright";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.AAR_UI_URL ?? "http://localhost:1420";
const ROOT = process.env.SHOWCASE_OUT ?? "showcase";
const PHOTOS = process.env.SHOWCASE_PHOTOS ?? "scripts/showcase/photos"; // CC0 photos + thumbs/
const ONLY = (process.env.SHOWCASE_ONLY ?? "").split(",").filter(Boolean);
const LANGS = (process.env.SHOWCASE_LANGS || "en,de,zh").split(",").filter(Boolean);
const shim = readFileSync(new URL("../../tests/e2e/tauri-shim.js", import.meta.url), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Texts per language: prompts, demo answers, file names, the fake desktop
// ---------------------------------------------------------------------------
const PICS = "C:\\Users\\Anna\\Pictures\\2026";
const DESK = "C:\\Users\\Anna\\Desktop";
const TEXT = {
  en: {
    prompts: {
      paint: "Open Paint and paint a sunset over the sea",
      photos: "Show me all photos with tables",
      vision: "Where could this be? Write a short caption for my holiday album.",
      report: "Summarize the quarterly report on my desktop and save the summary as a Word file",
    },
    names: {
      "table1.jpg": "Kitchen corner.jpg", "table2.jpg": "Living room.jpg", "table3.jpg": "Home office.jpg",
      "beach.jpg": "Holiday beach.jpg", "mountain.jpg": "Lake hike.jpg", "dog.jpg": "Neighbour's dog.jpg",
      "cake.jpg": "Mia turns 3.jpg", "city.jpg": "Krakow trip.jpg",
    },
    paintTitle: "Untitled - Paint",
    brush: "Brush",
    paintThought: "Paint is not open yet. I'll start it, pick the brush and paint sky, sun, sea and a few birds.",
    paintDone: "Done! 🌅 Your sunset is on the canvas: a purple-to-orange sky, a big yellow sun, the sea with its reflection and three birds. Shall I save it as a picture in your Pictures folder?",
    photosThought: "Search the photo index for tables (and desks).",
    photosDone: "I found **3 photos with tables**: the round table in your kitchen corner, the coffee table in the living room and your desk in the home office. Click a photo to open it.",
    visionDone: "That's a calm beach at sunset – low sun, gentle waves and a person standing on the rocks on the right. It could be a western-facing coast, e.g. in Portugal or Cornwall.\n\n**Caption idea:** *\"Golden hour, salty hair, nowhere to be. 🌅\"*",
    reportThought: "Read the PDF, write a short summary, save it as Word file on the desktop.",
    reportRead: "Quarterly report Q3 – 14 pages: revenue +8 %, new customers in Austria, delays in shipping, outlook positive.",
    pdf: "Quarterly report Q3.pdf",
    doc: "Summary Q3.docx",
    reportDone: "Saved **Summary Q3.docx** on your desktop.",
    stage: {
      "paint-title": "Untitled - Paint", "t-pencil": "Pencil", "t-brush": "Brush", "t-fill": "Fill", "t-text": "Text",
      "ex-title": "Pictures", "ex-path": "This PC › Pictures › 2026",
      "pdf-title": "Quarterly report Q3.pdf", "pdf-h1": "Quarterly Report Q3", "pdf-sub": "Sales & Operations · page 1 of 14",
      "pdf-rev": "Revenue per quarter", "pdf-high": "Highlights", "pdf-out": "Outlook",
      "clock-time": "10:42 AM", "clock-date": "11/23/2026",
    },
  },
  de: {
    prompts: {
      paint: "Öffne Paint und male einen Sonnenuntergang über dem Meer",
      photos: "Zeig mir alle Fotos mit Tischen",
      vision: "Wo könnte das sein? Schreib eine kurze Bildunterschrift für mein Urlaubsalbum.",
      report: "Fasse den Quartalsbericht auf meinem Desktop zusammen und speichere die Zusammenfassung als Word-Datei",
    },
    names: {
      "table1.jpg": "Küchenecke.jpg", "table2.jpg": "Wohnzimmer.jpg", "table3.jpg": "Arbeitszimmer.jpg",
      "beach.jpg": "Urlaub am Strand.jpg", "mountain.jpg": "Wanderung am See.jpg", "dog.jpg": "Nachbars Hund.jpg",
      "cake.jpg": "Mia wird 3.jpg", "city.jpg": "Ausflug Krakau.jpg",
    },
    paintTitle: "Unbenannt - Paint",
    brush: "Pinsel",
    paintThought: "Paint ist noch nicht offen. Ich starte es, nehme den Pinsel und male Himmel, Sonne, Meer und ein paar Vögel.",
    paintDone: "Fertig! 🌅 Dein Sonnenuntergang ist auf der Leinwand: violett-oranger Himmel, große gelbe Sonne, das Meer mit Spiegelung und drei Vögel. Soll ich das Bild in deinem Bilder-Ordner speichern?",
    photosThought: "Fotoindex nach Tischen (und Schreibtischen) durchsuchen.",
    photosDone: "Ich habe **3 Fotos mit Tischen** gefunden: den runden Tisch in der Küchenecke, den Couchtisch im Wohnzimmer und deinen Schreibtisch im Arbeitszimmer. Klick auf ein Foto, um es zu öffnen.",
    visionDone: "Das ist ein ruhiger Strand bei Sonnenuntergang – tief stehende Sonne, sanfte Wellen und rechts steht jemand auf den Felsen. Es könnte eine Küste mit Blick nach Westen sein, z. B. in Portugal oder Cornwall.\n\n**Vorschlag:** *„Goldene Stunde, Salz im Haar, nichts vor. 🌅“*",
    reportThought: "PDF lesen, kurz zusammenfassen, als Word-Datei auf dem Desktop speichern.",
    reportRead: "Quartalsbericht Q3 – 14 Seiten: Umsatz +8 %, neue Kunden in Österreich, Verzögerungen im Versand, Ausblick positiv.",
    pdf: "Quartalsbericht Q3.pdf",
    doc: "Zusammenfassung Q3.docx",
    reportDone: "**Zusammenfassung Q3.docx** liegt jetzt auf deinem Desktop.",
    stage: {
      "paint-title": "Unbenannt - Paint", "t-pencil": "Stift", "t-brush": "Pinsel", "t-fill": "Füllen", "t-text": "Text",
      "ex-title": "Bilder", "ex-path": "Dieser PC › Bilder › 2026",
      "pdf-title": "Quartalsbericht Q3.pdf", "pdf-h1": "Quartalsbericht Q3", "pdf-sub": "Vertrieb & Betrieb · Seite 1 von 14",
      "pdf-rev": "Umsatz je Quartal", "pdf-high": "Highlights", "pdf-out": "Ausblick",
      "clock-time": "10:42", "clock-date": "23.11.2026",
    },
  },
  zh: {
    prompts: {
      paint: "打开画图，画一幅海上日落",
      photos: "给我看所有有桌子的照片",
      vision: "这可能是哪里？给我的度假相册写一句简短的配文。",
      report: "总结我桌面上的季度报告，并把摘要保存为 Word 文件",
    },
    names: {
      "table1.jpg": "厨房角落.jpg", "table2.jpg": "客厅.jpg", "table3.jpg": "书房.jpg",
      "beach.jpg": "海滩度假.jpg", "mountain.jpg": "湖边徒步.jpg", "dog.jpg": "邻居家的狗.jpg",
      "cake.jpg": "Mia 三岁生日.jpg", "city.jpg": "克拉科夫之旅.jpg",
    },
    paintTitle: "无标题 - 画图",
    brush: "刷子",
    paintThought: "画图还没有打开。我先启动它，选择画笔，然后画天空、太阳、大海和几只鸟。",
    paintDone: "完成了！🌅 日落已经画在画布上：紫橙色的天空、大大的黄色太阳、带倒影的大海和三只鸟。要我把它保存到“图片”文件夹吗？",
    photosThought: "在照片索引中搜索桌子（和书桌）。",
    photosDone: "我找到了 **3 张有桌子的照片**：厨房角落的圆桌、客厅的茶几，以及书房里的书桌。点击照片即可打开。",
    visionDone: "这是日落时分一片宁静的海滩——夕阳低垂，海浪轻柔，右边的礁石上站着一个人。可能是一处朝西的海岸，比如葡萄牙或英国的康沃尔。\n\n**配文建议：** *“黄金时刻，发梢带着海风，哪儿也不用去。🌅”*",
    reportThought: "读取 PDF，写一段简短摘要，保存为桌面上的 Word 文件。",
    reportRead: "第三季度报告 – 14 页：营收增长 8%，在奥地利有新客户，发货有延误，前景乐观。",
    pdf: "第三季度报告.pdf",
    doc: "第三季度摘要.docx",
    reportDone: "已将 **第三季度摘要.docx** 保存到你的桌面。",
    stage: {
      "paint-title": "无标题 - 画图", "t-pencil": "铅笔", "t-brush": "刷子", "t-fill": "填充", "t-text": "文本",
      "ex-title": "图片", "ex-path": "此电脑 › 图片 › 2026",
      "pdf-title": "第三季度报告.pdf", "pdf-h1": "第三季度报告", "pdf-sub": "销售与运营 · 第 1 页，共 14 页",
      "pdf-rev": "各季度营收", "pdf-high": "要点", "pdf-out": "展望",
      "clock-time": "10:42", "clock-date": "2026/11/23",
    },
  },
};

// ---------------------------------------------------------------------------
// Photos: thumbnails for the result card, files for the Explorer window
// ---------------------------------------------------------------------------
const photoFiles = readdirSync(join(PHOTOS, "thumbs")).filter((f) => f.endsWith(".jpg")).sort();
const dataUrl = (f) => `data:image/jpeg;base64,${readFileSync(join(PHOTOS, "thumbs", f)).toString("base64")}`;

function photosFor(lang) {
  const names = TEXT[lang].names;
  const shown = photoFiles.filter((f) => names[f]);
  return {
    thumbs: Object.fromEntries(shown.map((f) => [`${PICS}\\${names[f]}`, dataUrl(f)])),
    explorer: shown.map((f) => ({ name: names[f], src: dataUrl(f) })),
  };
}

// photo_search output (as the bundled photos server writes it; descriptions stay English like the index)
function photoSearchOutput(lang) {
  const n = TEXT[lang].names;
  return "Found 3 photo(s) for table, desk:\n" +
    `1. ${PICS}\\${n["table1.jpg"]} — 2026-10-02 — A round white table with two black chairs in a bright corner.\n` +
    `2. ${PICS}\\${n["table2.jpg"]} — 2026-09-14 — A low coffee table in front of a wooden wall with a cushion.\n` +
    `3. ${PICS}\\${n["table3.jpg"]} — 2026-08-30 — A desk with a laptop, a lamp and stacks of books.`;
}

// ---------------------------------------------------------------------------
// Scripted agent (runs inside the widget iframe)
// ---------------------------------------------------------------------------
function demoScript(lang, thumbsMap) {
  const T = { ...TEXT[lang], photoOut: photoSearchOutput(lang), pdfPath: `${DESK}\\${TEXT[lang].pdf}`, docPath: `${DESK}\\${TEXT[lang].doc}` };
  return `
window.__shimLang = ${JSON.stringify(lang)};
window.__shimThumbs = ${JSON.stringify(thumbsMap)};
window.__shimDemoTyping = 28;
window.__shimSettings = {
  provider: "", photoFolders: ["C:\\\\Users\\\\Anna\\\\Pictures"],
  mcpServers: [
    { id: "fetch", label: "Read web pages", kind: "package", enabled: true, catalog: "fetch", package: "mcp-server-fetch",
      script: "mcp-server-fetch", command: "", args: [], env: [], url: "", headers: [], options: {} },
    { id: "playwright", label: "Operate websites (Playwright)", kind: "node", enabled: true, catalog: "playwright",
      package: "@playwright/mcp@latest", script: "playwright-mcp", command: "", args: ["--browser", "msedge", "--isolated"],
      env: [], url: "", headers: [], options: { browser: "msedge", headless: "0", isolated: "1" } },
  ],
};
window.__shimMcpInstalled = ["fetch", "playwright"];
window.__shimRegistry = [
  { name: "permission-gate", pypi: "aar-ext-permission-gate", description: "Confirm before dangerous bash commands", tags: ["safety"], status: "published" },
  { name: "git-checkpoint", pypi: "aar-ext-git-checkpoint", description: "Auto-commit at turn boundaries", tags: ["git"], status: "published" },
  { name: "inspect", pypi: "aar-ext-inspect", description: "/inspect session report", tags: ["ui"], status: "published" },
  { name: "protected-paths", pypi: "aar-ext-protected-paths", description: "Block writes to secrets", tags: ["safety"], status: "published" },
  { name: "openjev", pypi: "aar-ext-openjev", description: "NLI verification tools", tags: ["tool"], status: "published" },
];
window.__shimInstalled = [
  { name: "permission_gate", source: "entrypoint", path: "aar_ext_permission_gate:register", dist: "aar-ext-permission-gate",
    version: "0.1.0", managed: true, hooks: ["session_start", "tool_call"], tools: [], commands: [],
    prompt: "Dangerous shell commands are blocked.", error: null },
  { name: "git_checkpoint", source: "entrypoint", path: "aar_ext_git_checkpoint:register", dist: "aar-ext-git-checkpoint",
    version: "0.1.0", managed: true, hooks: ["after_turn", "session_start"],
    tools: [{ name: "git_rollback", description: "Roll back to a checkpoint", sideEffects: ["write", "execute"], requiresApproval: true }],
    commands: [], prompt: "You can roll back with git_rollback.", error: null },
];
(() => {
  const T = ${JSON.stringify(T)};
  const W = "262714";
  const head = W + '  mspaint.exe  pid=6240  "' + T.paintTitle + '"';
  const opts = [
    { optionId: "allow_once", kind: "allow_once", name: "Allow" },
    { optionId: "allow_always", kind: "allow_always", name: "Always" },
    { optionId: "reject_once", kind: "reject_once", name: "Deny" },
  ];
  const tell = (msg) => window.parent.postMessage(msg, "*");
  window.__shimDemo = async ({ text, sid, update, stream, sleep, askClient }) => {
    const is = (k) => text.trim() === T.prompts[k];
    const call = (id, title, kind, rawInput) => update(sid, { sessionUpdate: "tool_call", toolCallId: id, title, kind, status: "pending", rawInput });
    const done = (id, out) => update(sid, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed",
      content: out ? [{ type: "content", content: { type: "text", text: out } }] : [] });
    const tool = async (id, title, kind, rawInput, out, ms = 650) => { call(id, title, kind, rawInput); await sleep(ms); done(id, out); };
    const permit = async (id, title, kind, rawInput) => {
      const tc = { toolCallId: id, title, kind, status: "pending", rawInput };
      update(sid, { sessionUpdate: "tool_call", ...tc });
      return askClient("session/request_permission", { sessionId: sid, toolCall: tc, options: opts });
    };
    if (is("paint")) {
      await stream(sid, "agent_thought_chunk", T.paintThought, 22);
      await permit("p1", "windows__launch_app", "execute", { name_or_path: "mspaint" });
      tell({ show: "paint" });
      await sleep(400);
      done("p1", head);
      await tool("p2", "windows__get_ui_tree", "read", { window: W },
        head + '\\nWindow "' + T.paintTitle + '"\\ne22 Button "' + T.brush + '" #BrushTool [on]\\ne150 Group "Canvas" #image', 700);
      await tool("p3", "windows__click_element", "execute", { window: W, element: "e22" }, "clicked", 500);
      for (const [i, part] of ["sky", "sun", "sea", "birds"].entries()) {
        call("d" + i, "windows__drag", "execute", { window: W, element: "e150", path: part });
        await sleep(700);
        tell({ paint: i + 1 });
        done("d" + i, "dragged");
      }
      return T.paintDone;
    }
    if (is("photos")) {
      tell({ show: "explorer" });
      await stream(sid, "agent_thought_chunk", T.photosThought, 22);
      await tool("f1", "photos__photo_search", "search", { terms: ["table", "desk"] }, T.photoOut, 900);
      tell({ select: [T.names["table1.jpg"], T.names["table2.jpg"], T.names["table3.jpg"]] });
      return T.photosDone;
    }
    if (is("vision")) {
      await sleep(900);
      return T.visionDone;
    }
    if (is("report")) {
      tell({ show: "pdf" });
      await stream(sid, "agent_thought_chunk", T.reportThought, 22);
      await tool("r1", "read_file", "read", { path: T.pdfPath }, T.reportRead, 900);
      await permit("r2", "write_file", "edit", { path: T.docPath, content: "Q3 …" });
      done("r2", "Written (2 KB).");
      return T.reportDone;
    }
    return undefined;
  };
})();
`;
}

const STAGE_SYNC = `
window.addEventListener("message", (e) => {
  const d = e.data || {};
  if (!window.stage) return;
  if (d.show) window.stage.show(d.show);
  if (d.paint) window.stage.paint(d.paint);
  if (d.select) window.stage.files(window.__explorerFiles || [], d.select);
});`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function open({ lang, dark = false, scale = 1.6 }) {
  const { thumbs, explorer } = photosFor(lang);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1000, height: 750 }, deviceScaleFactor: scale, colorScheme: dark ? "dark" : "light",
    locale: { en: "en-US", de: "de-DE", zh: "zh-CN" }[lang],
  });
  // Demo settings first: the shim reads them when it starts.
  await context.addInitScript(demoScript(lang, thumbs));
  await context.addInitScript(`localStorage.setItem("aar-ui:lang", ${JSON.stringify(lang)});`);
  await context.addInitScript(shim);
  await context.addInitScript(STAGE_SYNC);
  await context.addInitScript(`window.__explorerFiles = ${JSON.stringify(explorer)};`);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`${BASE}/scripts/showcase/stage.html`);
  const app = page.frameLocator("#aar");
  await app.locator("#mascot.mood-idle").waitFor();
  await page.evaluate(([texts, lang]) => {
    window.stage.texts(texts);
    document.documentElement.lang = lang;
    window.stage.files(window.__explorerFiles, []);
  }, [TEXT[lang].stage, lang]);
  if (dark) await page.evaluate(() => window.stage.dark(true));
  return { browser, page, app };
}

async function clickAt(page, locator) {
  const b = await locator.boundingBox();
  await page.evaluate(([x, y]) => window.stage.click(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
  await locator.click();
}

async function openWidget(page, app) {
  await clickAt(page, app.locator("#mascot"));
  await app.locator("#app:not(.collapsed)").waitFor();
  await sleep(400);
}

async function ask(app, text, delay = 0) {
  if (delay) await app.locator("#input").pressSequentially(text, { delay });
  else await app.locator("#input").fill(text);
  await app.locator("#input").press("Enter");
}

const idle = (app) => app.locator("#btn-send:not(.stop)").waitFor({ timeout: 60000 });
const want = (name) => !ONLY.length || ONLY.includes(name);

// ---------------------------------------------------------------------------
// Scenes (one language each; screenshots go to <root>/<lang>/<scene>.png)
// ---------------------------------------------------------------------------

function scenes(lang) {
  const OUT = join(ROOT, lang);
  mkdirSync(OUT, { recursive: true });
  const P = TEXT[lang].prompts;
  const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

  async function paint() {
    const { browser, page, app } = await open({ lang });
    await openWidget(page, app);
    await ask(app, P.paint);
    await app.locator(".permission:not(.resolved) button.primary").click({ timeout: 20000 });
    await idle(app);
    await sleep(900);
    await shot(page, "paint");
    await browser.close();
  }

  async function permission() {
    const { browser, page, app } = await open({ lang });
    await page.evaluate(() => window.stage.show("pdf"));
    await openWidget(page, app);
    await ask(app, P.report);
    await app.locator(".permission:not(.resolved)").waitFor({ timeout: 20000 });
    await sleep(600);
    await shot(page, "permission");
    await browser.close();
  }

  async function photos() {
    const { browser, page, app } = await open({ lang });
    await openWidget(page, app);
    await ask(app, P.photos);
    await idle(app);
    await app.locator(".photos-card .photo img[src^='data:image/jpeg']").first().waitFor();
    await sleep(900);
    await shot(page, "photo-search");
    await browser.close();
  }

  async function vision() {
    const { browser, page, app } = await open({ lang });
    await openWidget(page, app);
    await app.locator("#file-attach").setInputFiles(join(PHOTOS, "beach.jpg"));
    await app.locator("#attachments .att img").waitFor();
    await ask(app, P.vision);
    await idle(app);
    await sleep(700);
    await shot(page, "vision");
    await browser.close();
  }

  async function settings(tab, name, prep) {
    const { browser, page, app } = await open({ lang });
    await openWidget(page, app);
    await app.locator("#btn-settings").click();
    await app.locator(`#tab-${tab}`).click();
    await sleep(500);
    if (prep) await prep(page, app);
    await sleep(500);
    await shot(page, name);
    await browser.close();
  }

  async function setup() {
    const { browser, page, app } = await open({ lang });
    await openWidget(page, app);
    await app.locator("#btn-settings").click();
    await app.locator("#btn-open-setup").click();
    await app.locator("#setup:not([hidden]) #step-hw[data-state=done]").waitFor();
    await sleep(600);
    await shot(page, "setup");
    await browser.close();
  }

  // GIF: real-time frames while the paint turn runs (800x600).
  async function gif() {
    const { browser, page, app } = await open({ lang, scale: 0.8 });
    const frames = [];
    let recording = true;
    const loop = (async () => {
      while (recording) {
        const t = Date.now();
        frames.push({ t, buf: await page.screenshot() });
        const spent = Date.now() - t;
        if (spent < 120) await sleep(120 - spent);
      }
    })();
    await sleep(1200);
    await openWidget(page, app);
    await sleep(500);
    // CJK is typed per character too, just a bit slower to read
    await ask(app, P.paint, lang === "zh" ? 110 : 45);
    const allow = app.locator(".permission:not(.resolved) button.primary");
    await allow.waitFor({ timeout: 20000 });
    await sleep(1500);
    await clickAt(page, allow);
    await idle(app);
    await sleep(3000);
    recording = false;
    await loop;
    const dir = join(OUT, "gif-frames");
    mkdirSync(dir, { recursive: true });
    const meta = frames.map((f, i) => {
      const file = `f${String(i).padStart(4, "0")}.png`;
      writeFileSync(join(dir, file), f.buf);
      return { file, ms: (frames[i + 1]?.t ?? f.t + 2500) - f.t };
    });
    writeFileSync(join(dir, "frames.json"), JSON.stringify(meta));
    console.log(`gif ${lang}: ${frames.length} frames`);
    await browser.close();
  }

  return {
    paint, "photo-search": photos, vision, permission,
    extensions: () => settings("extensions", "extensions", async (page, app) => {
      await app.locator("#ext-list .addon").first().waitFor();
      await app.locator("#ext-list .addon", { hasText: /Git[)）]/ }).scrollIntoViewIfNeeded();
    }),
    tools: () => settings("tools", "tools", async (page, app) => {
      const cdt = app.locator("#mcp-catalog .addon", { hasText: "Chrome DevTools" });
      await cdt.locator(".addon-actions button").click();
      await cdt.locator(".mcp-config").waitFor();
      await cdt.scrollIntoViewIfNeeded();
    }),
    "photos-settings": () => settings("photos", "photos-settings", async (page, app) => {
      await app.locator("#photos-pane-body .hint").first().waitFor();
    }),
    setup, gif,
  };
}

// ---------------------------------------------------------------------------

for (const lang of LANGS) {
  if (!TEXT[lang]) throw new Error(`unknown language: ${lang}`);
  for (const [name, run] of Object.entries(scenes(lang))) {
    if (!want(name)) continue;
    console.log(`${lang}: ${name}`);
    await run();
  }
}
console.log("done");
