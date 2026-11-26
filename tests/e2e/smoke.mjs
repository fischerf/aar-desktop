// UI smoke test: real frontend in headless Chromium with a fake Tauri/ACP backend.
// Run via scripts/wsl/e2e.sh (starts Vite, then this script).
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.AAR_UI_URL ?? "http://localhost:1420/";
const OUT = process.env.AAR_UI_SHOTS ?? "screenshots";
mkdirSync(OUT, { recursive: true });
const shim = readFileSync(new URL("./tauri-shim.js", import.meta.url), "utf8");

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function run(colorScheme) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 640 }, colorScheme });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(shim);
  await page.goto(BASE);

  // Connected + collapsed.
  await page.waitForFunction(() => document.querySelector("#mascot")?.classList.contains("mood-idle"));
  check(await page.locator("#app.collapsed").count() === 1, `[${colorScheme}] starts collapsed, mascot idle`);

  // Expand by clicking the mascot.
  await page.mouse.move(330, 580);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector("#app:not(.collapsed)");
  check(await page.locator(".msg.system").first().innerText().then((t) => t.includes("Hallo")), "greeting shown");
  const sugs = await page.locator("#suggestions button").allInnerTexts();
  check(sugs.length === 4 && sugs.some((s) => s.includes("Paint")), `start suggestions shown: ${sugs.join(" | ")}`);
  check((await page.getAttribute("#input", "placeholder")).includes("Win+H"), "placeholder mentions dictation");
  const calls = await page.evaluate(() => window.__shim.calls.map((c) => c[0]));
  check(calls.includes("set_expanded"), "set_expanded invoked");
  // Context size of the default profile next to "New conversation" (before any prompt).
  await page.waitForFunction(() => document.querySelector("#ctx-text")?.textContent === "64k");
  check(await page.isVisible("#ctx-meter.size-only"), "context size shown before the first prompt");

  // Tooltips on header buttons (custom, after a short delay).
  await page.hover("#btn-settings");
  await page.waitForTimeout(700);
  const tip = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector("#btn-settings"), "::after");
    return { text: s.content, opacity: s.opacity };
  });
  check(tip.text.includes("Einstellungen") && tip.opacity === "1", `tooltip on hover ${JSON.stringify(tip)}`);

  // Composer grip: drag up -> taller input, remembered.
  const h0 = await page.evaluate(() => document.querySelector("#input").offsetHeight);
  const g = await page.locator("#composer-grip").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y - 100, { steps: 5 });
  await page.mouse.up();
  const h1 = await page.evaluate(() => document.querySelector("#input").offsetHeight);
  const saved = await page.evaluate(() => localStorage.getItem("aar-ui:input-height"));
  check(h1 >= h0 + 90 && Number(saved) === h1, `input grows by dragging (${h0} -> ${h1}, saved ${saved})`);
  await page.screenshot({ path: `${OUT}/tall-input-${colorScheme}.png` });
  await page.dblclick("#composer-grip");
  const h2 = await page.evaluate(() => document.querySelector("#input").offsetHeight);
  check(h2 < h1 && !(await page.evaluate(() => localStorage.getItem("aar-ui:input-height"))), "double click resets input height");

  // Window resize grip -> native resize drag.
  const nw = await page.locator(".grip-nw").boundingBox();
  await page.mouse.move(nw.x + 4, nw.y + 4);
  await page.mouse.down();
  await page.mouse.up();
  const resizeCall = await page.evaluate(() =>
    window.__shim.calls.find((c) => c[0] === "plugin:window|start_resize_dragging"),
  );
  check(resizeCall?.[1]?.value === "NorthWest", `resize grip starts native resize ${JSON.stringify(resizeCall?.[1])}`);

  // Plain answer, markdown + no HTML injection.
  await page.fill("#input", "Was kannst du?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop") && document.querySelector(".msg.agent"));
  const agentHtml = await page.locator(".msg.agent").last().innerHTML();
  check(agentHtml.includes("<li>") && agentHtml.includes("<code>datei</code>"), "markdown rendered");
  check(!agentHtml.includes("<b>") && agentHtml.includes("&lt;b&gt;"), "HTML from agent is escaped");
  check(await page.locator(".thought").count() === 1, "thought block shown");
  const ctxText = await page.innerText("#ctx-text");
  const ctxTip = await page.getAttribute("#ctx-meter", "data-tip");
  const ctxFill = await page.evaluate(() => document.querySelector("#ctx-fill").style.width);
  check(ctxText === "13k / 64k" && ctxTip.includes("12.500 von 65.536") && ctxFill === "19%",
    `context fill from usage_update: ${ctxText} | ${ctxTip} | ${ctxFill}`);
  await page.locator("#bubble-header").screenshot({ path: `${OUT}/header-context-${colorScheme}.png` });

  // Provider unreachable: aar ends the turn silently -> widget must explain.
  await page.fill("#input", "offline test");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".msg.error");
  const errMsg = await page.locator(".msg.error").last().innerText();
  check(errMsg.includes("Sprachmodell") && errMsg.includes("Technische Details"), "silent provider failure explained");
  check(await page.locator("#mascot.mood-error").count() === 1, "mascot shows error");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));

  // Stopped mid-thought (no answer, no tool): explained, not a silent "done".
  const errorsBefore = await page.locator(".msg.error").count();
  await page.fill("#input", "bitte nur denken");
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll(".msg.error").length > n, errorsBefore);
  check((await page.locator(".msg.error").last().innerText()).includes("keine Antwort"), "thought-only turn explained");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));

  // Windows desktop control: MCP server passed with the session, plain-language card.
  const newSess = await page.evaluate(() => window.__shim.sent.find((m) => m.method === "session/new"));
  check(newSess?.params?.mcpServers?.[0]?.name === "windows", "windows MCP server passed in session/new");
  await page.fill("#input", "Öffne das Programm Excel");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".permission:not(.resolved)");
  const appCard = await page.locator(".permission:not(.resolved)").innerText();
  check(appCard.includes("Programm starten") && appCard.includes("excel"), `desktop tool in plain language: ${appCard.replace(/\s+/g, " ").slice(0, 80)}`);
  await page.click(".permission:not(.resolved) button.primary");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));

  // Desktop chips name the window and control, not handle "262714" / id "e22".
  await page.fill("#input", "Male etwas in Paint");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".tool summary")].slice(-3).map((s) => s.innerText.replace(/\s+/g, " ").trim()));
  check(chips[0].includes("Unbenannt - Paint") && !chips[0].includes("262714"), `tree chip names the window: ${chips[0]}`);
  check(chips[1].includes("„Bleistift“ in Unbenannt - Paint"), `click chip names the control: ${chips[1]}`);
  check(chips[2].includes("Mit der Maus ziehen") && chips[2].includes("„Zeichenbereich“"), `drag chip: ${chips[2]}`);

  // Screenshot tool: image shown as thumbnail, unsafe types ignored.
  await page.fill("#input", "Mach ein Bildschirmfoto");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".tool.completed img.tool-image");
  const imgs = await page.evaluate(() => [...document.querySelectorAll("img.tool-image")].map((i) => i.src.slice(0, 22)));
  check(imgs.length === 1 && imgs[0] === "data:image/png;base64,", `screenshot thumbnail only for safe types ${JSON.stringify(imgs)}`);
  check(await page.evaluate(() => document.querySelector("img.tool-image").closest("details").open), "screenshot details auto-open");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  await page.screenshot({ path: `${OUT}/screenshot-tool-${colorScheme}.png` });

  // Tool call with permission -> allow.
  await page.fill("#input", "Schreib eine datei");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".permission:not(.resolved)");
  check(await page.locator("#mascot.mood-asking").count() === 1, "mascot asks for permission");
  const labels = await page.locator(".permission:not(.resolved) .actions button").allInnerTexts();
  check(JSON.stringify(labels) === JSON.stringify(["Erlauben", "Ablehnen", "Für dieses Gespräch erlauben", "Immer erlauben"]),
    `permission buttons ${labels}`);
  check(await page.locator("#suggestions").count() === 0, "suggestions gone after the first message");
  const note = await page.evaluate(() => window.__shim.notifications.at(-1));
  check(note?.title === "Aar braucht deine Erlaubnis" && note.body.includes("Datei schreiben") && note.show, `notification for permission ${JSON.stringify(note)}`);
  await page.screenshot({ path: `${OUT}/permission-${colorScheme}.png` });
  await page.click(".permission:not(.resolved) button.primary");
  await page.waitForSelector(".tool.completed");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  const outcome = await page.evaluate(() => window.__shim.permissionOutcome);
  check(outcome?.optionId === "allow_once", "allow_once sent to agent");
  check(await page.locator(".tool.completed .verb").last().innerText() === "Datei schreiben", "tool shown in plain language");
  check(await page.locator("#mascot.mood-happy").count() === 1, "mascot happy after end_turn");
  // The written file is offered under the answer.
  await page.waitForSelector(".files .file");
  const cands = await page.evaluate(() => window.__shim.turnCandidates);
  check(cands.includes("C:/Users/Demo/Desktop/notiz.txt"), "write_file path is a candidate");
  check(cands.includes("C:\\Users\\Demo\\Desktop\\notiz.txt"), `path in the answer is a candidate: ${JSON.stringify(cands)}`);
  const fileRow = await page.locator(".files .file").first().innerText();
  check(fileRow.includes("notiz.txt") && fileRow.includes("Öffnen") && fileRow.includes("Im Ordner zeigen"), `new file card: ${fileRow.replace(/\s+/g, " ")}`);
  await page.click(".files .file button.primary");
  check((await page.evaluate(() => window.__shim.openedFile))?.reveal === false, "Öffnen opens the file");
  await page.screenshot({ path: `${OUT}/done-${colorScheme}.png` });

  // Deny path.
  await page.fill("#input", "noch eine datei bitte");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".permission:not(.resolved)");
  await page.click(".permission:not(.resolved) button.danger");
  await page.waitForSelector(".tool.failed");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  check((await page.evaluate(() => window.__shim.permissionOutcome))?.optionId === "reject_once", "reject_once sent");
  check(await page.locator(".files").count() === 1, "no file card when nothing was written");

  // Cancel while waiting for permission.
  await page.fill("#input", "fehler provozieren datei");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".permission:not(.resolved)");
  await page.click("#btn-send"); // acts as stop
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  check((await page.evaluate(() => window.__shim.permissionOutcome))?.outcome === "cancelled", "stop cancels pending permission");
  check(await page.locator(".msg.system", { hasText: "Abgebrochen" }).count() >= 1, "cancel message shown");

  // Risky tools (commands) can only be allowed for the conversation.
  await page.fill("#input", "fehler provozieren datei");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".permission:not(.resolved)");
  const riskyLabels = await page.locator(".permission:not(.resolved) .actions button").allInnerTexts();
  check(!riskyLabels.includes("Immer erlauben") && riskyLabels.includes("Für dieses Gespräch erlauben") &&
    await page.locator(".permission:not(.resolved) .note").count() === 1, `command: no "always" ${riskyLabels}`);
  await page.click(".permission:not(.resolved) button.danger");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));

  // "Immer erlauben": saved, the next request is answered without a card.
  const clickTurn = async (text) => {
    await page.fill("#input", text);
    await page.keyboard.press("Enter");
  };
  await clickTurn("klick auf den Bleistift");
  await page.waitForSelector(".permission:not(.resolved)");
  await page.click(".permission:not(.resolved) button[data-scope=always]");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  check(JSON.stringify(await page.evaluate(() => window.__shim.settings.allowedTools)) === '["windows__click_element"]',
    "always-grant saved in the settings");
  check((await page.evaluate(() => window.__shim.permissionOutcome))?.optionId === "allow_once", "granted: allow_once sent");
  const cardsBefore = await page.locator(".permission").count();
  await clickTurn("klick nochmal");
  await page.waitForSelector(".auto-allowed");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  check(await page.locator(".permission").count() === cardsBefore, "granted tool: no permission card");
  check((await page.locator(".auto-allowed").last().innerText()).includes("Ohne Nachfrage erlaubt: 🖱️ Klicken"),
    `auto-allowed note: ${await page.locator(".auto-allowed").last().innerText()}`);
  await page.screenshot({ path: `${OUT}/auto-allowed-${colorScheme}.png` });

  // Settings list: revoke -> asks again.
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden]) .grant");
  const grantRow = await page.locator("#grant-list .grant").first().innerText();
  check(grantRow.includes("Klicken") && grantRow.includes("immer"), `grant listed: ${grantRow.replace(/\s+/g, " ")}`);
  await page.screenshot({ path: `${OUT}/grants-${colorScheme}.png` });
  await page.click("#grant-list .grant button");
  await page.waitForFunction(() => window.__shim.settings.allowedTools.length === 0);
  check((await page.innerText("#grant-list")).includes("Aar fragt vor jeder Änderung"), "revoked: list empty");
  await page.click("#btn-settings-cancel");
  await clickTurn("klick drei");
  await page.waitForSelector(".permission:not(.resolved)");
  check(true, "revoked tool asks again");
  // "Für dieses Gespräch": no card in this conversation, but in a new one.
  await page.click(".permission:not(.resolved) button[data-scope=conversation]");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  check((await page.evaluate(() => window.__shim.settings.allowedTools)).length === 0, "conversation grant not saved");
  const cards2 = await page.locator(".permission").count();
  await clickTurn("klick vier");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop") && document.querySelectorAll(".msg.agent").length > 0);
  await page.waitForTimeout(100);
  check(await page.locator(".permission").count() === cards2, "conversation grant answers in the same conversation");

  // Conversation list: open, continue an old one, delete one.
  await page.click("#btn-history");
  await page.waitForSelector("#history:not([hidden]) .history-item");
  const items = await page.locator("#history-list .history-title").allInnerTexts();
  check(JSON.stringify(items) === JSON.stringify(["Wie steht die NVIDIA-Aktie?", "Schreib ein Gedicht"]), `history list ${items}`);
  check(await page.isHidden("#composer"), "history replaces the chat");
  await page.screenshot({ path: `${OUT}/history-${colorScheme}.png` });
  await page.click("#history-list .history-item:nth-child(2) .history-delete");
  check((await page.locator("#history-list .history-item:nth-child(2) .history-delete").innerText()) === "Wirklich löschen?", "delete asks first");
  await page.click("#history-list .history-item:nth-child(2) .history-delete");
  await page.waitForFunction(() => document.querySelectorAll("#history-list .history-item").length === 1);
  check((await page.evaluate(() => window.__shim.deletedSession)) === "old-2", "conversation deleted");
  await page.click("#history-list .history-entry");
  await page.waitForSelector("#history", { state: "hidden" });
  await page.waitForSelector(".msg.agent >> text=180 Dollar");
  check((await page.locator(".msg.user").allInnerTexts()).join("|") === "Wie steht die NVIDIA-Aktie?", "old conversation replayed");
  check((await page.evaluate(() => localStorage.getItem("aar-ui:last-session"))) === "old-1", "continued conversation remembered");
  // Conversation grants belong to their conversation.
  await clickTurn("klick fünf");
  await page.waitForSelector(".permission:not(.resolved)");
  await page.click(".permission:not(.resolved) button.primary");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  check(true, "other conversation asks again");
  // Back to a fresh conversation for the rest of the test.
  await page.click("#btn-new");
  await page.waitForFunction(() => localStorage.getItem("aar-ui:last-session")?.startsWith("s-"));

  // Settings: mode select with friendly names, change is sent.
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  const modeTexts = await page.locator("#session-options select").nth(1).locator("option").allInnerTexts();
  check(modeTexts.includes("Vorher fragen (empfohlen)"), "friendly mode names");
  check((await page.innerText("#version-info")).startsWith("Aar Desktop 0.1.0"), `version shown: ${await page.innerText("#version-info")}`);
  check(await page.isChecked("#set-autostart"), "autostart on by default");
  // Troubleshooting: paths shown, buttons open fixed targets only, errors explained.
  check((await page.innerText("#diag-paths")).includes("aar.log"), "settings show the log path");
  await page.click("#btn-open-log");
  check((await page.evaluate(() => window.__shim.opened)) === "log", "log link opens the log");
  await page.click("#btn-open-sessions");
  await page.waitForFunction(() => document.querySelector("#diag-error").textContent.length > 0);
  check((await page.innerText("#diag-error")).includes("noch keine gespeicherten Gespräche"), "missing sessions folder explained");
  await page.locator("#session-options select").nth(1).selectOption("read-only");
  await page.waitForTimeout(100);
  const sent = await page.evaluate(() => window.__shim.sent.filter((m) => m.method === "session/set_config_option"));
  check(sent.length === 1 && sent[0].params.value === "read-only", "set_config_option sent");
  await page.screenshot({ path: `${OUT}/settings-${colorScheme}.png` });

  // LLM connection: profiles from the aar config, endpoint test.
  const profiles = await page.locator("#set-provider option").allInnerTexts();
  const groups = await page.locator("#set-provider optgroup").evaluateAll((g) => g.map((x) => `${x.label}:${x.children.length}`));
  check(profiles.length === 9 && profiles[0].startsWith("Standard – qwen3.8") && profiles.includes("Anthropic Claude – Cloud"),
    `profile picker ${profiles}`);
  check(groups.join("|") === "Profile aus der aar-Konfiguration:3|Anbieter:5", `profiles + providers grouped: ${groups}`);
  check(await page.isHidden("#apikey-row") && await page.isHidden("#cloud-note"), "no API key field for profiles");
  check((await page.getAttribute("#set-baseurl", "placeholder")) === "http://localhost:11434", "base URL placeholder from profile");
  await page.click("#btn-test");
  await page.waitForSelector("#test-result.ok");
  check((await page.innerText("#test-result")).includes("qwen3.5:4b"), "endpoint test lists Ollama models");
  await page.fill("#set-model", "gibtsnicht");
  await page.click("#btn-test");
  await page.waitForSelector("#test-result.bad");
  check((await page.innerText("#test-result")).includes("nicht vorhanden"), "warns about missing model");
  await page.fill("#set-model", "");

  // Cloud provider: API key + model required, "Test" checks the key and lists the models.
  await page.selectOption("#set-provider", "anthropic");
  check(await page.isVisible("#apikey-row") && (await page.innerText("#cloud-note")).includes("Anthropic Claude"),
    "cloud provider asks for an API key and says where the data goes");
  check((await page.getAttribute("#set-baseurl", "placeholder")).includes("Standardadresse"), "cloud provider: default address");
  await page.click("#btn-settings-save");
  check((await page.innerText("#settings-error")).includes("API-Schlüssel"), "saving without a key is refused");
  await page.fill("#set-apikey", "sk-bad");
  await page.click("#btn-test");
  await page.waitForSelector("#test-result.bad");
  check((await page.innerText("#test-result")).includes("abgelehnt"), "wrong key reported by the test");
  await page.fill("#set-apikey", "sk-test");
  await page.click("#btn-test");
  await page.waitForSelector("#test-result.ok");
  const cloudModels = await page.locator("#model-list option").evaluateAll((o) => o.map((x) => x.value));
  check(cloudModels.includes("claude-sonnet-4-6"), `test lists the provider's models: ${cloudModels}`);
  await page.click("#btn-settings-save");
  check((await page.innerText("#settings-error")).includes("Modell"), "saving without a model is refused");
  await page.screenshot({ path: `${OUT}/connection-cloud-${colorScheme}.png` });
  await page.fill("#set-model", "claude-sonnet-4-6");
  const startsCloud = await page.evaluate(() => window.__shim.starts.length);
  await page.click("#btn-settings-save");
  await page.waitForFunction((n) => window.__shim.starts.length > n, startsCloud);
  const cloud = await page.evaluate(() => window.__shim.starts.at(-1));
  check(cloud.provider === "anthropic" && cloud.model === "claude-sonnet-4-6" && cloud.apiKeys?.anthropic === "sk-test",
    `agent restarted with the cloud provider: ${JSON.stringify({ p: cloud.provider, m: cloud.model, k: cloud.apiKeys })}`);
  await page.waitForFunction(() => (window.__shim.providerChecks ?? []).length >= 3);
  await page.waitForTimeout(200);
  check(await page.locator(".msg.error", { hasText: "Anthropic" }).count() === 0, "preflight checks the key, no warning");
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  check((await page.inputValue("#set-provider")) === "anthropic" && (await page.inputValue("#set-apikey")) === "sk-test",
    "settings reopen with provider and key");

  // Switch to an unreachable profile + save -> agent restarts with it, preflight warns.
  await page.selectOption("#set-provider", "remote");
  check((await page.inputValue("#set-model")) === "" && await page.isHidden("#apikey-row"), "switching clears the cloud model");
  check((await page.getAttribute("#set-baseurl", "placeholder")) === "http://127.0.0.1:11435", "placeholder follows profile");
  await page.fill("#set-baseurl", "");
  await page.screenshot({ path: `${OUT}/connection-${colorScheme}.png` });
  const startsBefore = await page.evaluate(() => window.__shim.starts.length);
  const newsBeforeRemote = await page.evaluate(() => window.__shim.sent.filter((m) => m.method === "session/new").length);
  await page.click("#btn-settings-save");
  await page.waitForFunction((n) => window.__shim.starts.length > n, startsBefore);
  const started = await page.evaluate(() => window.__shim.starts.at(-1));
  check(started.provider === "remote", "agent restarted with new provider");
  await page.waitForFunction((n) => window.__shim.sent.filter((m) => m.method === "session/new").length > n, newsBeforeRemote);
  const order = await page.evaluate(() => window.__shim.sent.map((m) => m.method).filter((m) => m?.startsWith("session/")));
  check(order.lastIndexOf("session/new") > order.lastIndexOf("session/load"), "unknown session ({}) falls back to session/new");
  await page.waitForSelector(".msg.error >> text=läuft nicht");
  check(true, "preflight warns about unreachable local model server");
  check(await page.locator(".msg.error button.primary", { hasText: "Jetzt einrichten" }).count() >= 1, "offers setup for local server");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "nicht bereit");
  check(await page.locator("#conn-dot.warn").count() === 1, "status says not ready instead of ready");
  await page.screenshot({ path: `${OUT}/preflight-${colorScheme}.png` });

  // Reachable server but the profile's model is not installed.
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  await page.selectOption("#set-provider", "gemma");
  await page.click("#btn-settings-save");
  await page.waitForFunction(() => window.__shim.starts.at(-1).provider === "gemma");
  await page.waitForSelector(".msg.error >> text=gibt es auf dem Server nicht");
  check(true, "preflight warns about missing model");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "nicht bereit");
  check(true, "missing model -> not ready");
  const modelCard = page.locator(".msg.error", { hasText: "gibt es auf dem Server nicht" }).last();
  const modelButtons = await modelCard.locator(".actions-row button").allInnerTexts();
  check(modelButtons.includes("Stattdessen qwen3.8:latest nehmen") && modelButtons.includes("gemma4:e4b herunterladen"),
    `missing model offers alternatives + download: ${modelButtons}`);
  await page.evaluate(() => { window.__shim.slow = 150; });
  await modelCard.locator("button", { hasText: "herunterladen" }).click();
  await modelCard.locator("progress").waitFor();
  check(true, "download progress inside the card");
  await modelCard.locator(".progress-row", { hasText: "ist heruntergeladen" }).waitFor();
  check((await page.evaluate(() => window.__shim.pulled)) === "gemma4:e4b", "missing model downloaded from the card");
  await page.waitForFunction(() => document.getElementById("status-text").textContent !== "nicht bereit");
  check(true, "ready after the download");
  await page.evaluate(() => { delete window.__shim.slow; });

  // Ollama installed but stopped -> started automatically, then ready.
  await page.evaluate(() => { window.__shim.ollamaStopped = true; window.__shim.slow = 300; });
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  await page.selectOption("#set-provider", "qwen3.8");
  await page.click("#btn-settings-save");
  await page.waitForFunction(() => window.__shim.starts.at(-1).provider === "qwen3.8");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "starte Ollama…");
  check(true, "status shows Ollama being started instead of ready");
  await page.waitForSelector(".msg.system >> text=ich habe ihn gestartet");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "bereit");
  check(!(await page.evaluate(() => window.__shim.ollamaStopped)), "stopped Ollama started automatically, then ready");
  await page.evaluate(() => { delete window.__shim.slow; });

  // Switch desktop control off -> restart, sessions without MCP servers.
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  check(await page.isChecked("#set-desktop"), "desktop control on by default");
  const newCount = () => page.evaluate(() => window.__shim.sent.filter((m) => m.method === "session/new").length);
  const newsBefore = await newCount();
  await page.uncheck("#set-desktop");
  await page.click("#btn-settings-save");
  await page.waitForFunction((n) => window.__shim.sent.filter((m) => m.method === "session/new").length > n, newsBefore);
  const lastNew = await page.evaluate(() => window.__shim.sent.filter((m) => m.method === "session/new").at(-1));
  check(lastNew.params.mcpServers.length === 0, "desktop control off -> no MCP servers");
  await page.click("#btn-settings");
  await page.check("#set-desktop");
  await page.click("#btn-settings-save");
  await page.waitForTimeout(300);

  // Setup wizard: strong GPU -> qwen3.8 recommended (already present -> "Übernehmen").
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  await page.click("#btn-open-setup");
  await page.waitForSelector("#setup:not([hidden]) #step-hw[data-state=done]");
  check((await page.inputValue("#setup-model")) === "qwen3.8:latest", "wizard recommends qwen3.8 for 24 GB GPU");
  check((await page.innerText("#step-hw .d")).includes("7900 XTX (24 GB)"), "wizard shows GPU with real VRAM");
  check((await page.innerText("#btn-setup-start")) === "Übernehmen", "present model -> no download needed");
  await page.screenshot({ path: `${OUT}/setup-gpu-${colorScheme}.png` });
  check(!(await page.$("#step-model-note .eu-flag")), "no EU flag for a non-EU model");
  await page.selectOption("#setup-model", "ministral-3:14b");
  check((await page.innerText("#setup-model option[value='ministral-3:14b']")).includes("EU-Modell"), "EU model tagged in the list");
  check(!!(await page.$("#step-model-note svg.eu-flag")), "EU model shows the EU flag");
  check((await page.innerText("#step-model-note")).includes("Mistral AI"), "EU model note names Mistral AI");
  await page.screenshot({ path: `${OUT}/setup-eu-${colorScheme}.png` });
  await page.click("#btn-setup-cancel");

  // 16 GB GPU: the EU model fits but is only offered, Gemma 4 stays the suggestion.
  const sysBefore = await page.evaluate(() => window.__shim.sys);
  await page.evaluate(() => {
    window.__shim.sys = { ramMb: 32768, cpuThreads: 12, gpus: [{ name: "Radeon RX 7800 XT", vendor: "amd", vramMb: 16384 }] };
  });
  await page.click("#btn-settings");
  await page.click("#btn-open-setup");
  await page.waitForSelector("#setup:not([hidden]) #step-hw[data-state=done]");
  check((await page.inputValue("#setup-model")) === "gemma4:e4b", "16 GB GPU -> gemma4 suggested, EU model only offered");
  check(!(await page.innerText("#setup-model option[value='ministral-3:14b']")).includes("empfohlen"), "EU model not marked recommended");
  await page.click("#btn-setup-cancel");
  await page.evaluate((s) => { window.__shim.sys = s; }, sysBefore);

  // CPU-only office PC, Ollama missing -> gemma4:e4b, install + download.
  await page.evaluate(() => {
    window.__shim.sys = { ramMb: 16384, cpuThreads: 8, gpus: [{ name: "Intel(R) UHD Graphics", vendor: "intel", vramMb: 128 }] };
    window.__shim.ollama = { installed: false, exe: null, running: false, version: null, models: [] };
    window.__shim.slow = 400;
  });
  await page.click("#btn-settings");
  await page.click("#btn-open-setup");
  await page.waitForSelector("#setup:not([hidden]) #step-hw[data-state=done]");
  check((await page.inputValue("#setup-model")) === "gemma4:e4b", "wizard recommends gemma4:e4b for CPU-only PC");
  check((await page.innerText("#step-ollama .d")).includes("automatisch installiert"), "wizard announces Ollama install");
  const startsBeforeSetup = await page.evaluate(() => window.__shim.starts.length);
  await page.click("#btn-setup-start");
  await page.waitForSelector("#step-pull[data-state=active]");
  await page.screenshot({ path: `${OUT}/setup-progress-${colorScheme}.png` });
  await page.waitForFunction((n) => window.__shim.starts.length > n, startsBeforeSetup);
  check((await page.evaluate(() => window.__shim.ollamaInstalled)) === "setup_ollama_install", "Ollama installed");
  check((await page.evaluate(() => window.__shim.pulled)) === "gemma4:e4b", "model pulled");
  check((await page.evaluate(() => window.__shim.starts.at(-1).provider)) === "gemma", "agent restarted with matching aar profile");
  check((await page.evaluate(() => window.__shim.starts.at(-1).contextWindow)) === 0, "profile keeps its own num_ctx (no --context-window)");
  await page.waitForSelector(".msg.system >> text=Fertig eingerichtet");
  check(await page.locator("#setup[hidden]").count() === 1, "wizard closes after success");
  await page.evaluate(() => { delete window.__shim.sys; delete window.__shim.ollama; delete window.__shim.slow; });

  // Setup wizard: Cloud / Custom provider (e.g. custom Gemini gateway).
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  await page.click("#btn-open-setup");
  await page.waitForSelector("#setup:not([hidden])");
  await page.click("#setup-tab-cloud");
  check(await page.isVisible("#setup-cloud") && await page.isHidden("#setup-local"), "wizard switches to cloud/custom tab");
  await page.selectOption("#setup-cloud-kind", "gemini");
  await page.fill("#setup-cloud-name", "gemini 3.1");
  await page.fill("#setup-cloud-apikey", "sk-test");
  await page.fill("#setup-cloud-baseurl", "https://gateway.example/gemini/gemini-3.x-flash-lite");
  await page.fill("#setup-cloud-model", "gemini-3.1-flash-lite");
  await page.click("#btn-setup-cloud-test");
  await page.waitForSelector("#setup-cloud-test-result.ok");
  const startsBeforeCloudSetup = await page.evaluate(() => window.__shim.starts.length);
  await page.click("#btn-setup-start");
  await page.waitForFunction((n) => window.__shim.starts.length > n, startsBeforeCloudSetup);
  const cloudSetupStart = await page.evaluate(() => window.__shim.starts.at(-1));
  check(
    cloudSetupStart.provider === "custom:gemini-3-1" &&
      cloudSetupStart.customProviders?.some((p) => p.id === "gemini-3-1" && p.kind === "gemini" && p.model === "gemini-3.1-flash-lite"),
    `wizard saved custom Gemini provider: ${JSON.stringify(cloudSetupStart.customProviders)}`,
  );

  // Settings -> General: custom provider is listed, editable, and removable.
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  check((await page.inputValue("#set-provider")) === "custom:gemini-3-1", "settings select saved custom provider");
  check(await page.isVisible("#custom-provider-row") && (await page.inputValue("#set-custom-name")) === "gemini 3.1",
    "custom provider fields shown in settings");
  await page.click("#btn-delete-custom");
  await page.click("#btn-settings-save");
  await page.waitForFunction(() => window.__shim.starts.at(-1).provider === "");

  // Extensions: registry + installed, warnings, install with confirmation, switch off.
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  await page.click("#tab-extensions");
  await page.waitForSelector("#ext-list .addon");
  check(await page.isHidden("#btn-settings-save") && await page.isVisible("#btn-settings-done"), "add-on tabs only offer “Fertig”");
  const cards = await page.locator("#ext-list .addon").allInnerTexts();
  check(cards.length === 4, `registry cards without builtin companion: ${cards.length}`);
  const gate = cards.find((c) => c.includes("Schutz vor gefährlichen Befehlen")) ?? "";
  check(gate.includes("aktiv") && gate.includes("Blockiert bestimmte Befehle") && gate.includes("Prüft jede Aktion"),
    `curated + inspected warnings: ${gate.replace(/\s+/g, " ").slice(0, 160)}`);
  check(cards.some((c) => c.includes("brand-new") && c.includes("nach der Installation")), "unknown extension gets a generic note");
  check(cards.some((c) => c.includes("geplant")) && (await page.locator("#ext-list .addon", { hasText: "Laya" }).locator("button").count()) === 0,
    "planned extension cannot be installed");
  const gitCard = page.locator("#ext-list .addon", { hasText: "Sicherungspunkte" });
  await gitCard.locator("button", { hasText: "Installieren" }).click();
  check(await gitCard.locator("button", { hasText: "Trotzdem installieren" }).count() === 1, "risky extension asks again before installing");
  await gitCard.locator("button", { hasText: "Trotzdem installieren" }).click();
  await page.waitForSelector("#ext-status .hint.ok");
  check((await page.evaluate(() => window.__shim.extInstalled)) === "aar-ext-git-checkpoint", "extension installed from the registry");
  const gitText = await page.locator("#ext-list .addon", { hasText: "Sicherungspunkte" }).innerText();
  check(gitText.includes("Dateien ändern") && gitText.includes("git_rollback") && gitText.includes("zusätzliche Anweisungen"),
    `installed extension shows what it registers: ${gitText.replace(/\s+/g, " ").slice(0, 200)}`);
  await page.locator("#ext-list .addon", { hasText: "Schutz vor" }).locator("input[type=checkbox]").uncheck();
  await page.waitForFunction(() => window.__shim.settings.disabledExtensions.includes("permission_gate"));
  check(true, "switching an extension off is saved");
  await page.screenshot({ path: `${OUT}/extensions-${colorScheme}.png`, fullPage: true });

  // Tools: catalog server (installed by pip) + own HTTP server; restart when closing.
  await page.click("#tab-tools");
  await page.locator("#mcp-catalog .addon", { hasText: "Webseiten lesen" }).locator("button").click();
  await page.waitForSelector("#mcp-status .hint.ok");
  check((await page.evaluate(() => window.__shim.mcpInstalledReq)) === "mcp-server-fetch", "catalog server installed");
  await page.fill("#mcp-name", "Broken Wiki");
  await page.selectOption("#mcp-kind", "http");
  await page.fill("#mcp-url", "kein-link");
  await page.click("#btn-mcp-add");
  check((await page.innerText("#mcp-form-error")).includes("http"), "invalid server address rejected");
  await page.fill("#mcp-url", "https://wiki.example.com/mcp");
  await page.fill("#mcp-headers", "Authorization: Bearer x");
  await page.click("#btn-mcp-add");
  await page.waitForFunction(() => window.__shim.settings.mcpServers.length === 2);
  const servers = await page.evaluate(() => window.__shim.settings.mcpServers);
  check(servers[1].id === "broken-wiki" && servers[1].headers[0].name === "Authorization", `own server saved: ${JSON.stringify(servers[1])}`);
  await page.screenshot({ path: `${OUT}/tools-${colorScheme}.png`, fullPage: true });
  const startsBeforeDone = await page.evaluate(() => window.__shim.starts.length);
  await page.click("#btn-settings-done");
  await page.waitForFunction((n) => window.__shim.starts.length > n, startsBeforeDone);
  check(true, "closing the settings restarts aar after add-on changes");
  await page.waitForSelector(".msg.error >> text=broken-wiki");
  const sessMcp = await page.evaluate(() => window.__shim.sent.filter((m) => m.method === "session/new").at(-1).params.mcpServers);
  check(sessMcp.map((m) => m.name).join(",") === "windows,fetch,broken-wiki" && sessMcp[2].type === "http",
    `user servers passed with the session: ${JSON.stringify(sessMcp.map((m) => m.name))}`);
  check((await page.locator(".msg.error", { hasText: "broken-wiki" }).innerText()).includes("Werkzeuge"),
    "failed tool server reported (sent before session/new answered)");

  // Language: English and Chinese, then back.
  for (const [code, settingsWord, greetingWord] of [["en", "Settings", "Hello"], ["zh", "设置", "你好"]]) {
    await page.click("#btn-settings");
    await page.waitForSelector("#settings:not([hidden])");
    await page.selectOption("#set-language", code);
    await page.click("#btn-settings-save");
    await page.waitForTimeout(150);
    check((await page.getAttribute("#btn-settings", "aria-label")) === settingsWord, `[${code}] static texts translated`);
    check((await page.evaluate(() => window.__shim.uiLangs.at(-1))) === code, `[${code}] tray language reported`);
    await page.click("#btn-new");
    await page.waitForSelector(`.msg.system >> text=${greetingWord}`);
    check(true, `[${code}] greeting translated`);
    await page.click("#btn-settings");
    await page.click("#tab-extensions");
    await page.waitForSelector("#ext-list .addon");
    await page.screenshot({ path: `${OUT}/extensions-${code}-${colorScheme}.png`, fullPage: true });
    await page.click("#tab-general");
    await page.screenshot({ path: `${OUT}/settings-${code}-${colorScheme}.png` });
    await page.click("#btn-settings-cancel");
  }
  await page.click("#btn-settings");
  await page.selectOption("#set-language", "de");
  await page.click("#btn-settings-save");
  await page.waitForTimeout(150);
  check((await page.getAttribute("#btn-settings", "aria-label")) === "Einstellungen", "back to German");

  // Catalog server with a settings dialog (npm, portable Node.js): Chrome DevTools.
  await page.click("#btn-settings");
  await page.click("#tab-tools");
  await page.waitForSelector("#mcp-catalog .addon");
  const cdt = page.locator("#mcp-catalog .addon", { hasText: "Chrome DevTools" });
  await cdt.locator("button", { hasText: "Hinzufügen" }).click();
  await cdt.locator(".mcp-config").waitFor();
  check((await cdt.locator("select[data-key=browser]").inputValue()) === "edge", "no Chrome installed -> Edge preselected");
  check(await cdt.locator("input[data-key=isolated]").isChecked() && !(await cdt.locator("input[data-key=stats]").isChecked()),
    "safe defaults: own profile, no usage statistics");
  await cdt.locator("select[data-key=tools]").selectOption("slim");
  await page.screenshot({ path: `${OUT}/mcp-config-${colorScheme}.png` });
  await cdt.locator("button", { hasText: "Installieren" }).click();
  await page.waitForSelector("#mcp-status .hint.ok");
  const inst = await page.evaluate(() => window.__shim.mcpInstallArgs);
  check(inst.runtime === "node" && inst.requirement === "chrome-devtools-mcp@latest" && inst.bin === "chrome-devtools-mcp",
    `installed via npm: ${JSON.stringify(inst)}`);
  let srv = await page.evaluate(() => window.__shim.settings.mcpServers.at(-1));
  check(srv.kind === "node" && srv.args.join(" ") === "--executablePath {edge} --slim --isolated --no-usage-statistics"
    && srv.env.some((e) => e.name === "CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS"), `arguments from the dialog: ${srv.args.join(" ")}`);
  const mine = page.locator("#mcp-list .addon", { hasText: "Chrome DevTools" });
  await mine.locator("button", { hasText: "Anpassen" }).click();
  check((await mine.locator("select[data-key=tools]").inputValue()) === "slim", "dialog reopens with the saved values");
  await mine.locator("input[data-key=stats]").check();
  await mine.locator("select[data-key=browser]").selectOption("chrome");
  await mine.locator("button", { hasText: "Übernehmen" }).click();
  await page.waitForFunction(() => window.__shim.settings.mcpServers.at(-1).args.includes("--channel"));
  srv = await page.evaluate(() => window.__shim.settings.mcpServers.at(-1));
  check(!srv.args.includes("--no-usage-statistics") && srv.args.includes("stable"), `adjusted: ${srv.args.join(" ")}`);
  await page.click("#btn-settings-done");
  await page.waitForFunction(() => window.__shim.sent.filter((m) => m.method === "session/new").at(-1)?.params.mcpServers.some((m) => m.name === "chrome-devtools"));
  check(true, "npm server passed to aar after the restart");

  // Tools of catalog servers in plain language.
  await page.fill("#input", "Öffne die Webseite");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop") && document.querySelector(".tool.completed"));
  const webChip = await page.locator(".tool summary").last().innerText();
  check(webChip.includes("Webseite öffnen") && webChip.includes("example.com") && webChip.includes("🌐"), `browser tool chip: ${webChip.replace(/\s+/g, " ")}`);

  // Attach an image (picker): scaled JPEG goes along as an ACP image block.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANBQEBVb6ZbgAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#file-attach", [{ name: "foto.png", mimeType: "image/png", buffer: png }]);
  await page.waitForSelector("#attachments:not([hidden]) .att img");
  await page.setInputFiles("#file-attach", [{ name: "kaputt.heic", mimeType: "image/heic", buffer: Buffer.from("not an image") }]);
  await page.waitForSelector("#attachments .att-error");
  check((await page.innerText("#attachments .att-error")).includes("kaputt.heic"), "undecodable image explained");
  await page.screenshot({ path: `${OUT}/attachment-${colorScheme}.png` });
  await page.fill("#input", "Was ist darauf?");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".msg.agent >> text=Ich sehe ein Bild");
  const imgs2 = await page.evaluate(() => window.__shim.lastPromptImages);
  check(imgs2.length === 1 && imgs2[0].mimeType === "image/jpeg" && imgs2[0].data.length > 20, `image sent as ACP block: ${JSON.stringify(imgs2.map((i) => i.mimeType))}`);
  check(await page.locator(".msg.user .user-images img").count() >= 1 && await page.isHidden("#attachments"), "image shown in the message, strip cleared");

  // Photo search settings: folder picker, status, start indexing.
  await page.click("#btn-settings");
  await page.click("#tab-photos");
  await page.waitForSelector("#photos-pane-body .hint");
  check((await page.innerText("#photos-pane-body")).includes("Noch keine Fotoordner"), "no photo folders by default");
  // Small vision models: offered, downloadable from here.
  await page.waitForFunction(() => [...document.querySelectorAll("#photo-model option")].some((o) => o.textContent.includes("Moondream")));
  const photoOpts = await page.locator("#photo-model option").allInnerTexts();
  check(photoOpts.includes("Qwen 3.5 (4B)") && photoOpts.includes("Moondream 2 (1.8B) – 1,7 GB herunterladen"),
    `small vision models offered: ${photoOpts}`);
  await page.selectOption("#photo-model", "moondream:1.8b");
  await page.waitForSelector("#photos-pane-body button >> text=Herunterladen (1,7 GB)");
  check((await page.innerText("#photos-pane-body")).includes("noch nicht auf diesem PC"), "missing model needs a download");
  check(await page.locator("#photos-pane-body button", { hasText: "Fotos jetzt beschreiben" }).isDisabled(), "no indexing before the download");
  await page.evaluate(() => { window.__shim.slow = 300; });
  await page.locator("#photos-pane-body button", { hasText: "Herunterladen" }).click();
  await page.waitForSelector("#photos-pane-body progress");
  await page.screenshot({ path: `${OUT}/photos-download-${colorScheme}.png` });
  await page.waitForSelector("#photos-pane-body >> text=Moondream 2 (1.8B) ist bereit.");
  await page.evaluate(() => { delete window.__shim.slow; });
  check((await page.evaluate(() => [window.__shim.pulled, window.__shim.settings.photoModel])).join() === "moondream:1.8b,moondream:1.8b",
    "photo model downloaded and chosen");
  check(!(await page.locator("#photo-model option").allInnerTexts()).some((o) => o.includes("Moondream") && o.includes("herunterladen")),
    "downloaded model no longer offers a download");
  // PC without a graphics card: the small models are marked.
  await page.evaluate(() => { window.__shim.sys = { ramMb: 16384, cpuThreads: 8, gpus: [] }; });
  await page.click("#tab-general");
  await page.click("#tab-photos");
  await page.waitForSelector("#photos-pane-body >> text=keine passende Grafikkarte");
  check((await page.locator("#photo-model option").allInnerTexts()).some((o) => o.includes("gut ohne Grafikkarte")), "CPU-only PC: models marked");
  await page.screenshot({ path: `${OUT}/photos-cpu-${colorScheme}.png` });
  await page.evaluate(() => { delete window.__shim.sys; });
  await page.selectOption("#photo-model", "");
  await page.waitForFunction(() => window.__shim.settings.photoModel === "");
  await page.locator("#photos-pane-body button", { hasText: "Ordner hinzufügen" }).click();
  await page.waitForFunction(() => window.__shim.settings.photoFolders?.length === 1);
  await page.waitForSelector("#photos-pane-body >> text=12 von 40 Fotos beschrieben");
  check(true, "folder added, index status shown");
  await page.locator("#photos-pane-body button", { hasText: "Fotos jetzt beschreiben" }).click();
  await page.waitForSelector("#photos-pane-body progress");
  check(await page.evaluate(() => window.__shim.photoIndexing === true), "indexing started from the settings");
  await page.screenshot({ path: `${OUT}/photos-${colorScheme}.png` });
  await page.locator("#photos-pane-body button", { hasText: "Anhalten" }).click();
  check((await page.innerText("#photos-pane-body")).includes("5 sehr kleine Bilder"), "skipped tiny images are reported");
  await page.locator("#photos-pane-body .photo-folder button", { hasText: "Entfernen" }).click();
  await page.waitForSelector("#photos-pane-body >> text=Index der entfernten Ordner gelöscht (12 Einträge)");
  check((await page.evaluate(() => window.__shim.settings.photoFolders.length)) === 0, "removing a folder deletes its index entries");
  const startsBeforePhotos = await page.evaluate(() => window.__shim.starts.length);
  await page.click("#btn-settings-done");
  await page.waitForFunction((n) => window.__shim.starts.length > n, startsBeforePhotos);
  check(true, "aar restarts after changing photo folders");

  // Photo search in the chat: result card with thumbnails.
  await page.fill("#input", "Zeig alle Fotos mit Tischen");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".photos-card .photo img[src^='data:image/jpeg']");
  check(await page.locator(".photos-card .photo").count() === 2, "photo results shown as thumbnails");
  check((await page.locator(".tool summary").last().innerText()).includes("Fotos durchsuchen"), "photo tool in plain language");
  await page.locator(".photos-card .photo img").first().click();
  check((await page.evaluate(() => window.__shim.openedFile))?.path.endsWith("esszimmer.jpg"), "clicking a thumbnail opens the photo");
  await page.waitForFunction(() => !document.querySelector("#btn-send.stop"));
  await page.screenshot({ path: `${OUT}/photo-results-${colorScheme}.png` });

  // New chat clears messages.
  await page.click("#btn-new");
  await page.waitForTimeout(100);
  check(await page.locator(".msg.user").count() === 0, "new chat clears history");

  // Collapse with Escape.
  await page.keyboard.press("Escape");
  check(await page.locator("#app.collapsed").count() === 1, "Escape collapses");

  check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  await browser.close();
}

await run("dark");
await run("light");

// First run on a fresh PC (no aar config): the wizard opens by itself.
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 640 } });
  await page.addInitScript(() => { window.__shimFirstRun = true; });
  await page.addInitScript(shim);
  await page.goto(BASE);
  await page.waitForSelector("#setup:not([hidden]) #step-hw[data-state=done]", { timeout: 5000 }).catch(() => {});
  check(await page.locator("#setup:not([hidden])").count() === 1, "first run opens setup wizard automatically");
  check(await page.locator("#app.collapsed").count() === 0, "first run expands the bubble");
  await page.screenshot({ path: `${OUT}/first-run.png` });
  await browser.close();
}

// Linux: no desktop control (no Paint suggestion, no checkbox), no Win+H, hotkey hint.
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 640 } });
  await page.addInitScript(() => { window.__shimPlatform = "linux"; });
  await page.addInitScript(shim);
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector("#mascot")?.classList.contains("mood-idle"));
  check(await page.evaluate(() => document.documentElement.dataset.os) === "linux", "linux: <html data-os> set");
  await page.mouse.move(330, 580);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector("#suggestions button");
  const sugs = await page.locator("#suggestions button").allInnerTexts();
  check(sugs.length === 3 && !sugs.some((s) => s.includes("Paint")), `linux: no Paint suggestion: ${sugs.join(" | ")}`);
  const ph = await page.getAttribute("#input", "placeholder");
  check(!ph.includes("Win+H") && ph.length > 0, `linux: placeholder without Win+H: ${ph}`);
  await page.click("#btn-settings");
  await page.waitForSelector("#settings:not([hidden])");
  check(await page.isHidden("#set-desktop") && await page.isVisible("#set-autostart"), "linux: desktop control hidden, autostart shown");
  await page.locator("[data-i18n=hotkeyLinuxHint]").evaluate((el) => { el.closest("details").open = true; });
  check(await page.isVisible("[data-i18n=hotkeyLinuxHint]"), "linux: hotkey hint shown");
  await page.screenshot({ path: `${OUT}/linux-settings.png` });
  await browser.close();
}

// Mascot moods sheet.
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 170 } });
  await page.addInitScript(shim);
  await page.goto(BASE);
  await page.waitForSelector("#mascot svg");
  await page.evaluate(() => {
    const moods = ["idle", "listening", "thinking", "talking", "working", "asking", "happy", "error", "sleeping", "offline"];
    const svg = document.querySelector("#mascot").innerHTML;
    document.body.innerHTML = `<div style="display:flex;gap:2px;padding:8px;background:#3b82f6">${moods
      .map((m) => `<div style="text-align:center;color:#fff;font:12px sans-serif"><div class="mascot mood-${m}" style="width:120px;height:120px">${svg}</div>${m}</div>`)
      .join("")}</div>`;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/moods.png` });
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
