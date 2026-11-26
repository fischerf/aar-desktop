import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];
import {
  AcpClient,
  RpcError,
  type ConfigOption,
  type McpServer,
  type PermissionOption,
  type PermissionRequest,
  type SessionUpdate,
  type ToolCallInfo,
} from "./acp";
import { Mascot, moodLabel, type Mood } from "./mascot";
import { renderMarkdown } from "./markdown";
import { describeTool, filePathsIn, forgetDesktop, learnFromTool, prettyJson, toolFileCandidates, toolOutputText } from "./tools";
import { fmtBytes, hasModel, SetupWizard, type CloudSetupResult, type OllamaStatus } from "./setup";
import { AddonsView, splitArgs, type AddonSettings } from "./addons";
import { photoResultCard, PhotosView } from "./photos";
import { applyStatic, lang, LANG_NAMES, LANGS, locale, onLangChange, resolveLang, setLang, strings } from "./i18n";
import { Grants, isRisky, permText, renderGrantList, toolLabel } from "./permissions";
import { HistoryView } from "./history";

interface CustomProvider {
  id: string;
  name: string;
  kind: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface Settings {
  agentCommand: string;
  agentArgs: string[];
  workingDir: string;
  hotkey: string;
  provider: string;
  model: string;
  baseUrl: string;
  configPath: string;
  desktopControl: boolean;
  /** Start with Windows (HKCU Run key). */
  autostart: boolean;
  /** Tokens for the model (aar --context-window); 0 = profile / Ollama default. */
  contextWindow?: number;
  /** UI language "de" | "en" | "zh"; "" = Windows display language. */
  language?: string;
  disabledExtensions?: AddonSettings["disabledExtensions"];
  mcpServers?: AddonSettings["mcpServers"];
  photoFolders?: string[];
  photoModel?: string;
  /** API keys per cloud provider type (anthropic, openai, gemini, generic). */
  apiKeys?: Record<string, string>;
  /** Named custom providers (e.g. corporate Gemini or OpenAI-compatible gateways). */
  customProviders?: CustomProvider[];
  /** Tools allowed permanently (the widget answers aar's permission requests). */
  allowedTools?: string[];
  anchorRight?: number | null;
  anchorBottom?: number | null;
}

const t = strings({
  de: {
    // static (index.html)
    bubbleAria: "Chat mit Aar",
    tipResize: "Größe ändern",
    newChat: "Neues Gespräch",
    settings: "Einstellungen",
    tipCollapse: "Einklappen (Esc)",
    collapse: "Einklappen",
    tabGeneral: "Allgemein",
    tabExtensions: "Erweiterungen",
    tabTools: "Werkzeuge",
    thisConversation: "Dieses Gespräch",
    abilities: "Fähigkeiten",
    desktopControl: "Programme auf diesem PC bedienen",
    desktopControlHint: "Aar kann Fenster lesen, Programme starten, klicken und tippen – und fragt vor jeder Änderung um Erlaubnis.",
    autostart: "Beim Anmelden an Windows starten",
    languageHead: "Sprache",
    languageLabel: "Sprache der Oberfläche",
    languageAuto: "Automatisch (wie Windows)",
    connectionHead: "Sprachmodell-Verbindung",
    profile: "Profil / Anbieter",
    serverAddress: "Server-Adresse",
    emptyFromProfile: "(leer = aus Profil)",
    test: "Testen",
    tipTest: "Prüft, ob der Server erreichbar ist und welche Modelle er hat",
    model: "Modell",
    openSetup: "Einrichtungsassistent …",
    tipSetup: "Ollama installieren und ein passendes Modell herunterladen",
    advanced: "Erweitert",
    configFile: "aar-Konfigurationsdatei",
    configFileDefault: "(leer = ~/.aar/config.json)",
    agentProgram: "Agent-Programm",
    agentProgramAuto: "automatisch (mitgeliefertes aar)",
    arguments: "Argumente",
    argumentsHint: "(ACP-Modus, normalerweise „acp“)",
    workingDir: "Arbeitsordner",
    workingDirDefault: "(leer = Benutzerordner)",
    hotkey: "Tastenkürzel",
    troubleshooting: "Fehlersuche",
    showSessions: "Gesprächsverläufe anzeigen",
    tipSessions: "Ordner mit den gespeicherten Gesprächen im Explorer öffnen",
    showLog: "Protokoll anzeigen",
    tipLog: "Protokoll von Aar (Warnungen und Fehler) im Explorer zeigen",
    copy: "Kopieren",
    copied: "Kopiert ✓",
    tipCopyVersion: "Versionsangaben kopieren, z. B. für eine Fehlermeldung",
    quit: "Aar beenden",
    back: "Zurück",
    save: "Speichern",
    done: "Fertig",
    extIntro: "Erweiterungen bringen Aar neue Fähigkeiten bei oder ändern, wie Aar arbeitet. Sie stammen aus dem aar-Erweiterungsverzeichnis.",
    extTrust: "⚠️ Erweiterungen laufen mit deinen Rechten auf diesem PC und können Aars Verhalten stark verändern. Lies die Hinweise und installiere nur, was du wirklich brauchst.",
    reload: "Liste neu laden",
    mcpIntro: "Werkzeug-Server (MCP) geben Aar zusätzliche Werkzeuge, z. B. zum Lesen von Webseiten oder Dokumenten.",
    mcpMine: "Meine Werkzeug-Server",
    mcpCatalog: "Zum Hinzufügen",
    mcpCustom: "Eigenen Server hinzufügen",
    mcpName: "Name",
    mcpNamePlaceholder: "z. B. Firmen-Wiki",
    mcpKind: "Art",
    mcpKindCommand: "Programm auf diesem PC",
    mcpKindHttp: "Internet-Adresse",
    mcpCommand: "Programm",
    mcpArgs: "Argumente",
    mcpArgsHint: "(durch Leerzeichen getrennt)",
    mcpEnv: "Umgebungsvariablen",
    mcpEnvHint: "(eine pro Zeile: NAME=Wert)",
    mcpUrl: "Adresse",
    mcpHeaders: "HTTP-Header",
    mcpHeadersHint: "(eine pro Zeile: Name: Wert)",
    mcpAdd: "Hinzufügen",
    setupTitle: "Einrichtung",
    setupIntro: "Aar nutzt ein Sprachmodell, das direkt auf diesem Computer läuft – deine Daten bleiben hier. Ich richte alles automatisch ein.",
    setupTabLocal: "Lokal (Ollama)",
    setupTabCloud: "Cloud / Eigener Anbieter",
    stepHw: "Computer prüfen",
    stepModel: "Sprachmodell wählen",
    stepOllama: "Modell-Server (Ollama)",
    stepPull: "Modell herunterladen",
    later: "Später",
    setUp: "Einrichten",
    tipGrip: "Ziehen: Eingabefeld größer/kleiner · Doppelklick: zurücksetzen",
    mascotAria: "Aar – klicken zum Öffnen, ziehen zum Verschieben",
    // dynamic
    connecting: "verbinde…",
    checkingModel: "prüfe Sprachmodell…",
    startingOllama: "starte Ollama…",
    notReady: "nicht bereit",
    ollamaStarted: "Der lokale Modell-Server (Ollama) lief nicht – ich habe ihn gestartet.",
    ollamaStartFailed: "Der lokale Modell-Server (Ollama) ist installiert, ließ sich aber nicht starten. Ich kann ihn neu einrichten.",
    cancelling: "breche ab…",
    agentEnded: "Der Agent wurde beendet.",
    agentCrashed: "Der Agent ist abgestürzt (Code {code}).",
    connectFailed: "Verbindung zu Aar fehlgeschlagen: {error}",
    welcomeSetup: "Willkommen! Bevor es losgeht, richte ich das Sprachmodell auf diesem Computer ein.",
    setupNow: "Jetzt einrichten",
    ollamaDown: "Der lokale Modell-Server (Ollama) läuft nicht oder ist nicht installiert. Ich kann ihn für dich einrichten.",
    endpointDown: "Das Sprachmodell ist nicht erreichbar ({url}). Läuft der Server? Adresse und Profil kannst du unter ⚙ → Sprachmodell-Verbindung ändern.",
    modelMissing: "Das Modell „{model}“ gibt es auf dem Server nicht. Wähle unter ⚙ → Sprachmodell-Verbindung ein anderes Profil oder Modell.",
    modelMissingLocal: "Das Modell „{model}“ gibt es auf dem Server nicht. Wähle unter ⚙ → Sprachmodell-Verbindung ein anderes Profil oder Modell – oder lass mich ein passendes Modell herunterladen.",
    availableModels: "Vorhandene Modelle: {models}",
    newChatFailed: "Neues Gespräch fehlgeschlagen: {error}",
    greeting: "Hallo! Ich bin Aar 🦅 – frag mich einfach, ich helfe dir gern.",
    cancelled: "Abgebrochen.",
    limitReached: "Ich musste hier aufhören (Limit erreicht). Schreib „weiter“, dann mache ich weiter.",
    refusal: "Dabei kann ich leider nicht helfen.",
    somethingWrong: "Etwas ist schiefgelaufen: {error}",
    noAnswerProvider: "Ich habe keine Antwort vom Sprachmodell bekommen. Läuft es (z. B. Ollama) und stimmt die Adresse in der aar-Konfiguration?",
    noAnswer: "Ich habe keine Antwort bekommen. Versuch es bitte noch einmal oder wähle in den Einstellungen ein anderes Modell.",
    thinking: "denkt nach…",
    thoughts: "Gedanken",
    input: "Eingabe",
    result: "Ergebnis",
    toolImage: "Bild vom Werkzeug",
    allowOnce: "Erlauben",
    allowAlways: "Immer erlauben",
    rejectOnce: "Ablehnen",
    rejectAlways: "Nie erlauben",
    mayI: "Darf ich das tun?",
    details: "Details",
    aborted: "Abgebrochen",
    rejected: "✗ Abgelehnt",
    newFile: "📄 Neue Datei",
    newFiles: "📄 Neue Dateien ({n})",
    open: "Öffnen",
    showInFolder: "Im Ordner zeigen",
    techDetails: "Technische Details",
    reconnect: "Neu verbinden",
    tipCancel: "Abbrechen",
    tipSend: "Senden (Enter) · neue Zeile: Umschalt+Enter",
    send: "Senden",
    working: "Aar arbeitet…",
    askMe: "Frag mich etwas… (Diktieren: Win+H)",
    notConnected: "Nicht verbunden",
    optModel: "Modell (nur dieses Gespräch)",
    optMode: "Arbeitsweise",
    optEffort: "Gründlichkeit",
    modeReview: "Vorher fragen (empfohlen)",
    modeAuto: "Ohne Nachfrage arbeiten",
    modeReadOnly: "Nur lesen, nichts ändern",
    modelLabel: "Modell {model}",
    diagPaths: "Gespräche: {sessions}\nProtokoll: {log}",
    ctxText: "{used} / {size}",
    ctxTip: "Kontext: {used} von {size} Tokens belegt – so viel vom Gespräch hat das Modell gerade im Blick. Ist er voll, lässt Aar ältere Teile weg (oder starte ein neues Gespräch).",
    ctxTipSize: "Kontextgröße: {size} Tokens – so viel vom Gespräch kann das Modell auf einmal im Blick behalten.",
    ctxTipUsed: "Kontext: {used} Tokens belegt (Größe unbekannt).",
    standard: "Standard",
    providerType: "{name} (Provider-Typ)",
    groupCustom: "Eigene Anbieter",
    groupProfiles: "Profile aus der aar-Konfiguration",
    groupProviders: "Anbieter",
    addCustomProvider: "+ Eigener Anbieter",
    customName: "Name",
    customNamePlaceholder: "z. B. gemini 3.1",
    customType: "Anbieter-Typ",
    deleteCustom: "Entfernen",
    customNameRequired: "Bitte einen Namen für den Anbieter eintragen.",
    baseUrlRequired: "Bitte die Server-Adresse eintragen.",
    kindOllama: "Ollama – Modell auf diesem PC",
    kindAnthropic: "Anthropic Claude – Cloud",
    kindOpenai: "OpenAI – Cloud",
    kindGemini: "Google Gemini – Cloud",
    kindGeneric: "Anderer Dienst (OpenAI-kompatibel)",
    apiKey: "API-Schlüssel",
    apiKeyHint: "(bleibt auf diesem PC)",
    cloudNote: "☁ Mit {name} gehen deine Nachrichten und alles, was Aar liest (Fenster, Dateien, Webseiten), an diesen Dienst. Die Nutzung kostet dort meist Geld.",
    providerDefaultUrl: "leer = Standardadresse des Anbieters",
    geminiUrl: "leer = Google Gemini, oder eigene Gateway-URL",
    genericUrl: "z. B. https://example.com/v1/chat/completions",
    modelPick: "nach „Testen“ aus der Liste wählen",
    modelRequired: "Bitte ein Modell eintragen (die Liste gibt es über „Testen“).",
    apiKeyRequired: "Bitte den API-Schlüssel für {name} eintragen.",
    apiKeyMissing: "Für {name} fehlt der API-Schlüssel. Trag ihn unter ⚙ → Sprachmodell-Verbindung ein.",
    providerProblem: "Die Verbindung zu {name} klappt nicht. Prüfe den API-Schlüssel unter ⚙ → Sprachmodell-Verbindung.",
    toSettings: "Einstellungen öffnen",
    egUrl: "z. B. http://localhost:11434",
    noServerAddress: "Keine Server-Adresse – das Profil nutzt die Standardadresse des Anbieters.",
    checking: "Prüfe {url} …",
    models: "Modelle: {models}",
    modelNotOnServer: "⚠ „{model}“ ist auf diesem Server nicht vorhanden.",
    sessionOptionsOffline: "Nicht verbunden – Sitzungsoptionen nicht verfügbar.",
    optionChangeFailed: "Konnte {name} nicht ändern: {error}",
    reconnecting: "Verbinde neu …",
    setupDone: "Fertig eingerichtet – ich nutze jetzt {model}. Frag mich etwas!",
    mcpUnavailable: "Der Werkzeug-Server „{name}“ ist nicht verfügbar. Prüfe ihn unter ⚙ → Werkzeuge.",
    mcpFailed: "Die Werkzeug-Server konnten nicht gestartet werden.",
    tabPhotos: "Fotos",
    photosIntro: "Aar kann deine Fotos nach Inhalt durchsuchen, z. B. „Zeig alle Fotos mit Tischen“. Dazu beschreibt das Sprachmodell jedes Foto in den gewählten Ordnern einmal (ca. 2–5 s pro Foto). Nur diese Ordner werden durchsucht.",
    photosPrivacy: "🔒 Fotos und Beschreibungen bleiben auf diesem PC – das Modell läuft lokal (Ollama).",
    tipAttach: "Bild anhängen (auch per Ziehen oder Einfügen)",
    attach: "Bild anhängen",
    attachUnsupported: "„{name}“ kann ich nicht als Bild öffnen.",
    attachTooMany: "Höchstens {n} Bilder pro Nachricht.",
    removeImage: "Bild entfernen",
    tipHistory: "Frühere Gespräche",
    notifyPermTitle: "Aar braucht deine Erlaubnis",
    notifyDoneTitle: "Aar ist fertig",
    useInstead: "Stattdessen {model} nehmen",
    downloadModel: "{model} herunterladen",
    downloadingModel: "Lade {model} herunter …",
    modelDownloaded: "{model} ist heruntergeladen – ich bin bereit.",
    modelDownloadFailed: "Download fehlgeschlagen: {error}",
    switchedModel: "Ich nutze jetzt {model}.",
    loadFailed: "Dieses Gespräch konnte ich nicht öffnen.",
    sugNews: "📰 Nachrichten von heute",
    sugNewsPrompt: "Such im Internet nach den wichtigsten Nachrichten von heute und fass sie in fünf kurzen Punkten zusammen.",
    sugPaint: "🎨 In Paint malen",
    sugPaintPrompt: "Öffne Paint und male einen Sonnenuntergang über dem Meer.",
    sugDownloads: "📁 Download-Ordner ansehen",
    sugDownloadsPrompt: "Welche Dateien liegen in meinem Download-Ordner? Mach mir einen Vorschlag, wie ich dort aufräumen kann – noch nichts löschen oder verschieben.",
    sugLetter: "✉️ Einladung schreiben",
    sugLetterPrompt: "Schreib eine kurze, freundliche Einladung zum Teamfrühstück am Freitag um 9 Uhr und speichere sie als Datei auf meinem Desktop.",
    sugPhotos: "🖼️ Fotos suchen",
    sugPhotosPrompt: "Zeig mir meine Fotos vom Strand.",
  },
  en: {
    bubbleAria: "Chat with Aar",
    tipResize: "Resize",
    newChat: "New conversation",
    settings: "Settings",
    tipCollapse: "Collapse (Esc)",
    collapse: "Collapse",
    tabGeneral: "General",
    tabExtensions: "Extensions",
    tabTools: "Tools",
    thisConversation: "This conversation",
    abilities: "Abilities",
    desktopControl: "Operate programs on this PC",
    desktopControlHint: "Aar can read windows, start programs, click and type – and asks for permission before every change.",
    autostart: "Start when signing in to Windows",
    languageHead: "Language",
    languageLabel: "Display language",
    languageAuto: "Automatic (same as Windows)",
    connectionHead: "Language model connection",
    profile: "Profile / provider",
    serverAddress: "Server address",
    emptyFromProfile: "(empty = from profile)",
    test: "Test",
    tipTest: "Checks whether the server can be reached and which models it has",
    model: "Model",
    openSetup: "Setup assistant …",
    tipSetup: "Install Ollama and download a suitable model",
    advanced: "Advanced",
    configFile: "aar configuration file",
    configFileDefault: "(empty = ~/.aar/config.json)",
    agentProgram: "Agent program",
    agentProgramAuto: "automatic (bundled aar)",
    arguments: "Arguments",
    argumentsHint: "(ACP mode, normally “acp”)",
    workingDir: "Working folder",
    workingDirDefault: "(empty = user folder)",
    hotkey: "Keyboard shortcut",
    troubleshooting: "Troubleshooting",
    showSessions: "Show conversation history",
    tipSessions: "Open the folder with the saved conversations in Explorer",
    showLog: "Show log",
    tipLog: "Show Aar's log (warnings and errors) in Explorer",
    copy: "Copy",
    copied: "Copied ✓",
    tipCopyVersion: "Copy the version details, e.g. for a bug report",
    quit: "Quit Aar",
    back: "Back",
    save: "Save",
    done: "Done",
    extIntro: "Extensions teach Aar new abilities or change how Aar works. They come from the aar extension registry.",
    extTrust: "⚠️ Extensions run with your permissions on this PC and can change Aar's behaviour a lot. Read the notes and only install what you really need.",
    reload: "Reload list",
    mcpIntro: "Tool servers (MCP) give Aar additional tools, e.g. for reading web pages or documents.",
    mcpMine: "My tool servers",
    mcpCatalog: "Available to add",
    mcpCustom: "Add your own server",
    mcpName: "Name",
    mcpNamePlaceholder: "e.g. company wiki",
    mcpKind: "Type",
    mcpKindCommand: "Program on this PC",
    mcpKindHttp: "Web address",
    mcpCommand: "Program",
    mcpArgs: "Arguments",
    mcpArgsHint: "(separated by spaces)",
    mcpEnv: "Environment variables",
    mcpEnvHint: "(one per line: NAME=value)",
    mcpUrl: "Address",
    mcpHeaders: "HTTP headers",
    mcpHeadersHint: "(one per line: Name: value)",
    mcpAdd: "Add",
    setupTitle: "Setup",
    setupIntro: "Aar uses a language model that runs right on this computer – your data stays here. I'll set everything up automatically.",
    setupTabLocal: "Local (Ollama)",
    setupTabCloud: "Cloud / Custom provider",
    stepHw: "Check computer",
    stepModel: "Choose language model",
    stepOllama: "Model server (Ollama)",
    stepPull: "Download model",
    later: "Later",
    setUp: "Set up",
    tipGrip: "Drag: make the input bigger/smaller · double-click: reset",
    mascotAria: "Aar – click to open, drag to move",
    connecting: "connecting…",
    checkingModel: "checking language model…",
    startingOllama: "starting Ollama…",
    notReady: "not ready",
    ollamaStarted: "The local model server (Ollama) was not running – I started it.",
    ollamaStartFailed: "The local model server (Ollama) is installed but could not be started. I can set it up again.",
    cancelling: "cancelling…",
    agentEnded: "The agent has stopped.",
    agentCrashed: "The agent crashed (code {code}).",
    connectFailed: "Could not connect to Aar: {error}",
    welcomeSetup: "Welcome! Before we start, I'll set up the language model on this computer.",
    setupNow: "Set up now",
    ollamaDown: "The local model server (Ollama) is not running or not installed. I can set it up for you.",
    endpointDown: "The language model cannot be reached ({url}). Is the server running? You can change the address and profile under ⚙ → Language model connection.",
    modelMissing: "The model “{model}” does not exist on the server. Choose another profile or model under ⚙ → Language model connection.",
    modelMissingLocal: "The model “{model}” does not exist on the server. Choose another profile or model under ⚙ → Language model connection – or let me download a suitable model.",
    availableModels: "Available models: {models}",
    newChatFailed: "Could not start a new conversation: {error}",
    greeting: "Hello! I'm Aar 🦅 – just ask me, I'm happy to help.",
    cancelled: "Cancelled.",
    limitReached: "I had to stop here (limit reached). Write “continue” and I'll carry on.",
    refusal: "Sorry, I can't help with that.",
    somethingWrong: "Something went wrong: {error}",
    noAnswerProvider: "I didn't get an answer from the language model. Is it running (e.g. Ollama) and is the address in the aar configuration correct?",
    noAnswer: "I didn't get an answer. Please try again or choose a different model in the settings.",
    thinking: "thinking…",
    thoughts: "Thoughts",
    input: "Input",
    result: "Result",
    toolImage: "Image from the tool",
    allowOnce: "Allow",
    allowAlways: "Always allow",
    rejectOnce: "Deny",
    rejectAlways: "Never allow",
    mayI: "May I do this?",
    details: "Details",
    aborted: "Cancelled",
    rejected: "✗ Denied",
    newFile: "📄 New file",
    newFiles: "📄 New files ({n})",
    open: "Open",
    showInFolder: "Show in folder",
    techDetails: "Technical details",
    reconnect: "Reconnect",
    tipCancel: "Cancel",
    tipSend: "Send (Enter) · new line: Shift+Enter",
    send: "Send",
    working: "Aar is working…",
    askMe: "Ask me something… (dictate: Win+H)",
    notConnected: "Not connected",
    optModel: "Model (this conversation only)",
    optMode: "Way of working",
    optEffort: "Thoroughness",
    modeReview: "Ask first (recommended)",
    modeAuto: "Work without asking",
    modeReadOnly: "Read only, change nothing",
    modelLabel: "Model {model}",
    diagPaths: "Conversations: {sessions}\nLog: {log}",
    ctxText: "{used} / {size}",
    ctxTip: "Context: {used} of {size} tokens in use – that much of the conversation the model currently keeps in view. When it is full, Aar leaves out older parts (or start a new conversation).",
    ctxTipSize: "Context size: {size} tokens – that much of the conversation the model can keep in view at once.",
    ctxTipUsed: "Context: {used} tokens in use (size unknown).",
    standard: "Default",
    providerType: "{name} (provider type)",
    groupCustom: "Custom providers",
    groupProfiles: "Profiles from the aar configuration",
    groupProviders: "Providers",
    addCustomProvider: "+ Custom provider",
    customName: "Name",
    customNamePlaceholder: "e.g. gemini 3.1",
    customType: "Provider type",
    deleteCustom: "Remove",
    customNameRequired: "Please enter a name for the provider.",
    baseUrlRequired: "Please enter the server address.",
    kindOllama: "Ollama – model on this PC",
    kindAnthropic: "Anthropic Claude – cloud",
    kindOpenai: "OpenAI – cloud",
    kindGemini: "Google Gemini – cloud",
    kindGeneric: "Other service (OpenAI-compatible)",
    apiKey: "API key",
    apiKeyHint: "(stays on this PC)",
    cloudNote: "☁ With {name}, your messages and everything Aar reads (windows, files, web pages) go to that service. Using it usually costs money there.",
    providerDefaultUrl: "empty = the provider's default address",
    geminiUrl: "empty = Google Gemini, or custom gateway URL",
    genericUrl: "e.g. https://example.com/v1/chat/completions",
    modelPick: "pick one from the list after “Test”",
    modelRequired: "Please enter a model (“Test” shows the list).",
    apiKeyRequired: "Please enter the API key for {name}.",
    apiKeyMissing: "The API key for {name} is missing. Enter it under ⚙ → Language model connection.",
    providerProblem: "The connection to {name} does not work. Check the API key under ⚙ → Language model connection.",
    toSettings: "Open settings",
    egUrl: "e.g. http://localhost:11434",
    noServerAddress: "No server address – the profile uses the provider's default address.",
    checking: "Checking {url} …",
    models: "Models: {models}",
    modelNotOnServer: "⚠ “{model}” is not available on this server.",
    sessionOptionsOffline: "Not connected – conversation options are not available.",
    optionChangeFailed: "Could not change {name}: {error}",
    reconnecting: "Reconnecting …",
    setupDone: "All set – I'm now using {model}. Ask me something!",
    mcpUnavailable: "The tool server “{name}” is not available. Check it under ⚙ → Tools.",
    mcpFailed: "The tool servers could not be started.",
    tabPhotos: "Photos",
    photosIntro: "Aar can search your photos by what is on them, e.g. “Show all photos with tables”. For this the language model describes every photo in the chosen folders once (about 2–5 s per photo). Only these folders are searched.",
    photosPrivacy: "🔒 Photos and descriptions stay on this PC – the model runs locally (Ollama).",
    tipAttach: "Attach an image (also by dragging or pasting)",
    attach: "Attach image",
    attachUnsupported: "I can't open “{name}” as an image.",
    attachTooMany: "At most {n} images per message.",
    removeImage: "Remove image",
    tipHistory: "Earlier conversations",
    notifyPermTitle: "Aar needs your permission",
    notifyDoneTitle: "Aar is done",
    useInstead: "Use {model} instead",
    downloadModel: "Download {model}",
    downloadingModel: "Downloading {model} …",
    modelDownloaded: "{model} is downloaded – I'm ready.",
    modelDownloadFailed: "Download failed: {error}",
    switchedModel: "I'm using {model} now.",
    loadFailed: "I could not open this conversation.",
    sugNews: "📰 Today's news",
    sugNewsPrompt: "Search the internet for today's most important news and summarise them in five short points.",
    sugPaint: "🎨 Paint a picture",
    sugPaintPrompt: "Open Paint and paint a sunset over the sea.",
    sugDownloads: "📁 Look at my downloads",
    sugDownloadsPrompt: "Which files are in my Downloads folder? Suggest how I could tidy it up – don't delete or move anything yet.",
    sugLetter: "✉️ Write an invitation",
    sugLetterPrompt: "Write a short, friendly invitation to a team breakfast on Friday at 9 am and save it as a file on my desktop.",
    sugPhotos: "🖼️ Find photos",
    sugPhotosPrompt: "Show me my photos from the beach.",
  },
  zh: {
    bubbleAria: "与 Aar 聊天",
    tipResize: "调整大小",
    newChat: "新对话",
    settings: "设置",
    tipCollapse: "收起（Esc）",
    collapse: "收起",
    tabGeneral: "常规",
    tabExtensions: "扩展",
    tabTools: "工具",
    thisConversation: "当前对话",
    abilities: "能力",
    desktopControl: "操作这台电脑上的程序",
    desktopControlHint: "Aar 可以读取窗口、启动程序、点击和输入 – 每次更改前都会征求你的同意。",
    autostart: "登录 Windows 时启动",
    languageHead: "语言",
    languageLabel: "界面语言",
    languageAuto: "自动（与 Windows 相同）",
    connectionHead: "语言模型连接",
    profile: "配置 / 提供方",
    serverAddress: "服务器地址",
    emptyFromProfile: "（留空 = 使用配置中的值）",
    test: "测试",
    tipTest: "检查服务器能否连接以及有哪些模型",
    model: "模型",
    openSetup: "设置向导…",
    tipSetup: "安装 Ollama 并下载合适的模型",
    advanced: "高级",
    configFile: "aar 配置文件",
    configFileDefault: "（留空 = ~/.aar/config.json）",
    agentProgram: "代理程序",
    agentProgramAuto: "自动（随附的 aar）",
    arguments: "参数",
    argumentsHint: "（ACP 模式，通常为“acp”）",
    workingDir: "工作文件夹",
    workingDirDefault: "（留空 = 用户文件夹）",
    hotkey: "快捷键",
    troubleshooting: "故障排查",
    showSessions: "显示对话记录",
    tipSessions: "在资源管理器中打开保存对话的文件夹",
    showLog: "显示日志",
    tipLog: "在资源管理器中显示 Aar 的日志（警告和错误）",
    copy: "复制",
    copied: "已复制 ✓",
    tipCopyVersion: "复制版本信息，例如用于报告问题",
    quit: "退出 Aar",
    back: "返回",
    save: "保存",
    done: "完成",
    extIntro: "扩展可以让 Aar 学会新能力，或改变 Aar 的工作方式。它们来自 aar 扩展目录。",
    extTrust: "⚠️ 扩展会以你的权限在这台电脑上运行，并可能大幅改变 Aar 的行为。请阅读提示，只安装真正需要的扩展。",
    reload: "重新加载列表",
    mcpIntro: "工具服务器（MCP）为 Aar 提供更多工具，例如读取网页或文档。",
    mcpMine: "我的工具服务器",
    mcpCatalog: "可添加",
    mcpCustom: "添加自己的服务器",
    mcpName: "名称",
    mcpNamePlaceholder: "例如 公司知识库",
    mcpKind: "类型",
    mcpKindCommand: "这台电脑上的程序",
    mcpKindHttp: "网址",
    mcpCommand: "程序",
    mcpArgs: "参数",
    mcpArgsHint: "（以空格分隔）",
    mcpEnv: "环境变量",
    mcpEnvHint: "（每行一个：名称=值）",
    mcpUrl: "地址",
    mcpHeaders: "HTTP 请求头",
    mcpHeadersHint: "（每行一个：名称: 值）",
    mcpAdd: "添加",
    setupTitle: "设置",
    setupIntro: "Aar 使用直接运行在这台电脑上的语言模型 – 你的数据不会离开这里。我会自动完成所有设置。",
    setupTabLocal: "本地 (Ollama)",
    setupTabCloud: "云端 / 自定义提供方",
    stepHw: "检查电脑",
    stepModel: "选择语言模型",
    stepOllama: "模型服务器（Ollama）",
    stepPull: "下载模型",
    later: "稍后",
    setUp: "开始设置",
    tipGrip: "拖动：调整输入框大小 · 双击：恢复",
    mascotAria: "Aar – 点击打开，拖动移动",
    connecting: "连接中…",
    checkingModel: "正在检查语言模型…",
    startingOllama: "正在启动 Ollama…",
    notReady: "未就绪",
    ollamaStarted: "本地模型服务器（Ollama）没有运行 – 我已经启动了它。",
    ollamaStartFailed: "本地模型服务器（Ollama）已安装，但无法启动。我可以重新设置它。",
    cancelling: "正在取消…",
    agentEnded: "代理已停止。",
    agentCrashed: "代理崩溃了（代码 {code}）。",
    connectFailed: "无法连接 Aar：{error}",
    welcomeSetup: "欢迎！开始之前，我先在这台电脑上设置语言模型。",
    setupNow: "立即设置",
    ollamaDown: "本地模型服务器（Ollama）未运行或未安装。我可以帮你设置。",
    endpointDown: "无法连接语言模型（{url}）。服务器在运行吗？你可以在 ⚙ → 语言模型连接 中更改地址和配置。",
    modelMissing: "服务器上没有模型“{model}”。请在 ⚙ → 语言模型连接 中选择其他配置或模型。",
    modelMissingLocal: "服务器上没有模型“{model}”。请在 ⚙ → 语言模型连接 中选择其他配置或模型 – 或者让我下载一个合适的模型。",
    availableModels: "现有模型：{models}",
    newChatFailed: "无法开始新对话：{error}",
    greeting: "你好！我是 Aar 🦅 – 有问题尽管问，我很乐意帮忙。",
    cancelled: "已取消。",
    limitReached: "我不得不在这里停下（已达上限）。输入“继续”，我就接着做。",
    refusal: "抱歉，这件事我帮不上忙。",
    somethingWrong: "出了点问题：{error}",
    noAnswerProvider: "没有收到语言模型的回答。它在运行吗（例如 Ollama）？aar 配置中的地址正确吗？",
    noAnswer: "没有收到回答。请再试一次，或在设置中选择其他模型。",
    thinking: "思考中…",
    thoughts: "思考过程",
    input: "输入",
    result: "结果",
    toolImage: "工具返回的图片",
    allowOnce: "允许",
    allowAlways: "始终允许",
    rejectOnce: "拒绝",
    rejectAlways: "永不允许",
    mayI: "可以这样做吗？",
    details: "详情",
    aborted: "已取消",
    rejected: "✗ 已拒绝",
    newFile: "📄 新文件",
    newFiles: "📄 新文件（{n} 个）",
    open: "打开",
    showInFolder: "在文件夹中显示",
    techDetails: "技术细节",
    reconnect: "重新连接",
    tipCancel: "取消",
    tipSend: "发送（Enter）· 换行：Shift+Enter",
    send: "发送",
    working: "Aar 正在工作…",
    askMe: "问我点什么…（语音输入：Win+H）",
    notConnected: "未连接",
    optModel: "模型（仅当前对话）",
    optMode: "工作方式",
    optEffort: "细致程度",
    modeReview: "先询问（推荐）",
    modeAuto: "无需询问直接工作",
    modeReadOnly: "只读，不做更改",
    modelLabel: "模型 {model}",
    diagPaths: "对话：{sessions}\n日志：{log}",
    ctxText: "{used} / {size}",
    ctxTip: "上下文：已使用 {used} / {size} 个词元 – 模型当前能看到的对话内容。用满后，Aar 会省略较早的部分（也可以开始新对话）。",
    ctxTipSize: "上下文大小：{size} 个词元 – 模型一次能记住的对话内容。",
    ctxTipUsed: "上下文：已使用 {used} 个词元（大小未知）。",
    standard: "默认",
    providerType: "{name}（提供方类型）",
    groupCustom: "自定义提供方",
    groupProfiles: "aar 配置中的配置",
    groupProviders: "提供方",
    addCustomProvider: "+ 自定义提供方",
    customName: "名称",
    customNamePlaceholder: "例如 gemini 3.1",
    customType: "提供方类型",
    deleteCustom: "删除",
    customNameRequired: "请填写提供方名称。",
    baseUrlRequired: "请填写服务器地址。",
    kindOllama: "Ollama – 本机模型",
    kindAnthropic: "Anthropic Claude – 云端",
    kindOpenai: "OpenAI – 云端",
    kindGemini: "Google Gemini – 云端",
    kindGeneric: "其他服务（兼容 OpenAI）",
    apiKey: "API 密钥",
    apiKeyHint: "（仅保存在本机）",
    cloudNote: "☁ 使用 {name} 时，你的消息以及 Aar 读取的所有内容（窗口、文件、网页）都会发送到该服务。该服务通常需要付费。",
    providerDefaultUrl: "留空 = 提供方的默认地址",
    geminiUrl: "留空 = Google Gemini，或自定义网关地址",
    genericUrl: "例如 https://example.com/v1/chat/completions",
    modelPick: "点击“测试”后从列表中选择",
    modelRequired: "请填写模型（点击“测试”可查看列表）。",
    apiKeyRequired: "请填写 {name} 的 API 密钥。",
    apiKeyMissing: "缺少 {name} 的 API 密钥。请在 ⚙ → 语言模型连接 中填写。",
    providerProblem: "无法连接到 {name}。请在 ⚙ → 语言模型连接 中检查 API 密钥。",
    toSettings: "打开设置",
    egUrl: "例如 http://localhost:11434",
    noServerAddress: "没有服务器地址 – 配置将使用提供方的默认地址。",
    checking: "正在检查 {url} …",
    models: "模型：{models}",
    modelNotOnServer: "⚠ 此服务器上没有“{model}”。",
    sessionOptionsOffline: "未连接 – 无法使用对话选项。",
    optionChangeFailed: "无法更改{name}：{error}",
    reconnecting: "正在重新连接…",
    setupDone: "设置完成 – 我现在使用 {model}。问我点什么吧！",
    mcpUnavailable: "工具服务器“{name}”不可用。请在 ⚙ → 工具 中检查。",
    mcpFailed: "无法启动工具服务器。",
    tabPhotos: "照片",
    photosIntro: "Aar 可以按内容搜索你的照片，例如“显示所有有桌子的照片”。为此，语言模型会把所选文件夹中的每张照片描述一次（每张约 2–5 秒）。只搜索这些文件夹。",
    photosPrivacy: "🔒 照片和描述都保留在这台电脑上 – 模型在本地运行（Ollama）。",
    tipAttach: "附加图片（也可拖放或粘贴）",
    attach: "附加图片",
    attachUnsupported: "无法将“{name}”作为图片打开。",
    attachTooMany: "每条消息最多 {n} 张图片。",
    removeImage: "移除图片",
    tipHistory: "以前的对话",
    notifyPermTitle: "Aar 需要你的许可",
    notifyDoneTitle: "Aar 完成了",
    useInstead: "改用 {model}",
    downloadModel: "下载 {model}",
    downloadingModel: "正在下载 {model} …",
    modelDownloaded: "{model} 已下载 – 我准备好了。",
    modelDownloadFailed: "下载失败：{error}",
    switchedModel: "我现在使用 {model}。",
    loadFailed: "我无法打开这个对话。",
    sugNews: "📰 今日新闻",
    sugNewsPrompt: "在网上搜索今天最重要的新闻，并用五个简短的要点总结。",
    sugPaint: "🎨 用画图画画",
    sugPaintPrompt: "打开画图，画一幅海上日落。",
    sugDownloads: "📁 查看下载文件夹",
    sugDownloadsPrompt: "我的下载文件夹里有哪些文件？给我一个整理建议 – 先不要删除或移动任何东西。",
    sugLetter: "✉️ 写一封邀请",
    sugLetterPrompt: "写一份简短友好的邀请，邀请大家周五上午 9 点参加团队早餐，并保存为桌面上的文件。",
    sugPhotos: "🖼️ 查找照片",
    sugPhotosPrompt: "给我看看我在海滩拍的照片。",
  },
});

interface AarProfile {
  key: string;
  kind: string;
  model: string;
  baseUrl: string;
  /** Context size in tokens (0 = unknown). */
  contextWindow: number;
}

interface AarConfigInfo {
  path: string;
  found: boolean;
  error: string | null;
  defaultProfile: string;
  defaultInline: AarProfile | null;
  profiles: AarProfile[];
  contextWindow: number;
}

interface EndpointCheck {
  reachable: boolean;
  message: string;
  models: string[];
}

const LAST_SESSION_KEY = "aar-ui:last-session";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const app = $("app");
const messages = $("messages");
const input = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("btn-send");
const statusText = $("status-text");
const connDot = $("conn-dot");
const badge = $("badge");
const settingsView = $("settings");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let expanded = false;
let connected = false;
let connecting = false;
let busy = false;
/** Did the current turn answer or act (text, tool calls)? Thoughts alone do not
 * count: small models sometimes stop mid-thought without a word for the user. */
let turnOutput = false;
let sessionId: string | null = null;
let configOptions: ConfigOption[] = [];
let streamingMsg: { el: HTMLElement; text: string } | null = null;
let thought: { el: HTMLDetailsElement; body: HTMLElement; text: string } | null = null;
const tools = new Map<string, { el: HTMLDetailsElement; info: ToolCallInfo }>();
/** Tool calls of the running turn (for the "new files" card). */
const turnTools = new Set<string>();
const pendingPermissions = new Set<(optionId: string | null) => void>();
/** Updates that arrive while session/new|load is still pending (sessionId not
 * known yet), e.g. aar's notice that a tool server failed to start. */
let early: Array<{ sid: string; update: SessionUpdate }> | null = null;
/** Context of the session: size reported by aar (usage_update) or configured,
 * used = prompt tokens of the last model call (null = not known yet). */
const ctx = { size: 0, used: null as number | null };
/** Language model state after connecting: the status only says "ready" once the
 * preflight found the model server and model. `check` = what is being checked
 * right now (shown as status), `problem` = preflight or a turn found it broken. */
const llm = { check: "", problem: false };
/** Counts connects, so a preflight of an earlier connection does not touch the status. */
let connectGen = 0;
/** Permissions the user granted (this conversation / always). */
const grants = new Grants();
/** Tools allowed without asking in the running turn → their note (counts repeats). */
const autoNotes = new Map<string, { el: HTMLElement; n: number }>();
/** Saved settings as of the last load (start suggestions depend on them). */
let uiSettings: Settings | null = null;

const mascot = new Mascot($("mascot"), (m) => refreshStatus(m));

const client = new AcpClient({
  onUpdate: (sid, update) => {
    if (sid === sessionId) handleUpdate(update);
    else if (early && early.length < 2000) early.push({ sid, update });
  },
  onPermission: (req) => askPermission(req),
  onExit: (code, stderr) => {
    connected = false;
    busy = false;
    finishStreaming();
    resolveAllPermissions(null);
    updateComposer();
    mascot.set("offline");
    addError(code === 0 ? t("agentEnded") : t("agentCrashed", { code: code ?? "?" }), stderr, true);
  },
});

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function connect(resume = true) {
  if (connecting) return;
  connecting = true;
  connected = false;
  sessionId = null;
  ctx.size = 0;
  ctx.used = null;
  renderContext();
  updateComposer();
  mascot.set("offline");
  setStatus(t("connecting"), "busy");
  llm.check = "";
  llm.problem = false;
  early = [];
  try {
    await client.start();
    const cwd = await invoke<string>("agent_working_dir");
    const last = resume ? localStorage.getItem(LAST_SESSION_KEY) : null;
    let info = null;
    if (last) {
      clearMessages();
      try {
        info = await client.loadSession(last, cwd, await mcpServers());
      } catch (e) {
        console.warn("session/load failed", e);
      }
      finishStreaming();
      if (!info) clearMessages();
    }
    if (!info) {
      info = await client.newSession(cwd, await mcpServers());
      greet();
    }
    sessionId = info.sessionId;
    configOptions = info.configOptions;
    flushEarly();
    finishStreaming();
    localStorage.setItem(LAST_SESSION_KEY, sessionId);
    llm.check = t("checkingModel");
    llm.problem = false;
    connected = true;
    mascot.set("idle");
    const gen = ++connectGen;
    const mine = () => gen === connectGen && connected;
    void preflight((text) => {
      if (!mine()) return;
      llm.check = text;
      refreshStatus(mascot.current);
    }).then((ok) => {
      if (!mine()) return;
      llm.check = "";
      llm.problem = !ok;
      refreshStatus(mascot.current);
    });
  } catch (e) {
    mascot.set("offline");
    const stderr = await invoke<string>("agent_stderr").catch(() => "");
    addError(t("connectFailed", { error: errText(e) }), stderr, true);
  } finally {
    early = null;
    connecting = false;
    updateComposer();
    refreshStatus(mascot.current);
  }
}

/** Replay updates that arrived before the session id was known. */
function flushEarly() {
  const list = early ?? [];
  early = null;
  for (const e of list) if (e.sid === sessionId) handleUpdate(e.update);
}

/** aar only notices an unreachable model server on the first prompt (and then
 * stays silent), so check the configured endpoint right after connecting.
 * Starts an installed but stopped local Ollama. Resolves to false when the
 * language model is not usable (a card explains why). */
async function preflight(status: (text: string) => void): Promise<boolean> {
  try {
    const s = await invoke<Settings>("get_settings");
    const info = await invoke<AarConfigInfo>("aar_config_info", { configPath: null });
    const profile = s.provider
      ? info.profiles.find((p) => p.key === s.provider)
      : (info.profiles.find((p) => p.key === info.defaultProfile) ?? info.defaultInline ?? undefined);
    if (!ctx.size) {
      ctx.size = s.contextWindow || profile?.contextWindow || info.contextWindow || 0;
      renderContext();
    }
    // Fresh machine without any aar configuration: guide through the setup.
    if (!info.found && !s.provider && !s.baseUrl) {
      addSystem(t("welcomeSetup"));
      void openSetup();
      return false;
    }
    // Saved custom provider chosen in the settings: check its key and endpoint.
    const customProv = findCustomProvider(s.customProviders, s.provider);
    if (customProv) {
      const name = customProv.name || kindName(customProv.kind);
      const toSettings: ErrorAction[] = [{ label: t("toSettings"), primary: true, run: () => void openSettings() }];
      if (!customProv.apiKey.trim()) {
        addError(t("apiKeyMissing", { name }), "", toSettings);
        mascot.set("error", 5000);
        return false;
      }
      const r = await invoke<EndpointCheck>("check_provider", {
        kind: customProv.kind,
        baseUrl: customProv.baseUrl,
        apiKey: customProv.apiKey,
        model: customProv.model,
      });
      if (!r.reachable) {
        addError(t("providerProblem", { name }), r.message, toSettings);
        mascot.set("error", 5000);
        return false;
      }
      if (customProv.model && r.models.length && !r.models.includes(customProv.model)) {
        addError(t("modelMissing", { model: customProv.model }), t("availableModels", { models: r.models.join(", ") }), toSettings);
        return false;
      }
      return true;
    }
    // Cloud provider chosen in the settings (not a profile): is the key there and valid?
    if (!profile && isCloud(s.provider)) {
      const name = kindName(s.provider);
      const toSettings: ErrorAction[] = [{ label: t("toSettings"), primary: true, run: () => void openSettings() }];
      const key = s.apiKeys?.[s.provider] ?? "";
      if (!key.trim()) {
        addError(t("apiKeyMissing", { name }), "", toSettings);
        mascot.set("error", 5000);
        return false;
      }
      const r = await invoke<EndpointCheck>("check_provider", { kind: s.provider, baseUrl: s.baseUrl, apiKey: key, model: s.model });
      if (!r.reachable) {
        addError(t("providerProblem", { name }), r.message, toSettings);
        mascot.set("error", 5000);
        return false;
      }
      if (s.model && r.models.length && !r.models.includes(s.model)) {
        addError(t("modelMissing", { model: s.model }), t("availableModels", { models: r.models.join(", ") }), toSettings);
        return false;
      }
      return true;
    }
    const url = s.baseUrl || profile?.baseUrl;
    if (!url) return true;
    let r = await invoke<EndpointCheck>("check_endpoint", { url });
    const model = s.model || profile?.model || "";
    const local = isLocalUrl(url);
    const setupAction: ErrorAction[] = local
      ? [{ label: t("setupNow"), primary: true, run: () => void openSetup() }]
      : [];
    // Ollama installed but not running (e.g. its tray app was closed): start it.
    let startError = "";
    if (!r.reachable && local && /:11434(\/|$)/.test(url)) {
      const st = await invoke<OllamaStatus>("setup_ollama_status").catch(() => null);
      if (st?.installed && !st.running) {
        status(t("startingOllama"));
        try {
          await invoke<OllamaStatus>("setup_ollama_start");
          r = await invoke<EndpointCheck>("check_endpoint", { url });
          if (r.reachable) addSystem(t("ollamaStarted"));
        } catch (e) {
          startError = errText(e);
        }
        status(t("checkingModel"));
      }
    }
    if (!r.reachable) {
      addError(
        startError ? t("ollamaStartFailed") : local ? t("ollamaDown") : t("endpointDown", { url }),
        startError ? `${startError}\n${r.message}` : r.message,
        setupAction,
      );
      mascot.set("error", 5000);
      return false;
    }
    if (model && r.models.length && !hasModel(r.models, model)) {
      addError(
        t(local ? "modelMissingLocal" : "modelMissing", { model }),
        `${r.message}\n${t("availableModels", { models: r.models.join(", ") })}`,
        modelActions(model, r.models, local && /:11434(\/|$)/.test(url)),
      );
      mascot.set("error", 5000);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("preflight failed", e);
    return true;
  }
}

const isLocalUrl = (url: string) => /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);

/** Server address + model aar talks to (settings, else the profile). */
async function currentEndpoint(): Promise<{ url: string; model: string }> {
  const s = await invoke<Settings>("get_settings");
  const customProv = findCustomProvider(s.customProviders, s.provider);
  if (customProv) return { url: customProv.baseUrl, model: customProv.model };
  const info = await invoke<AarConfigInfo>("aar_config_info", { configPath: null });
  const profile = s.provider
    ? info.profiles.find((p) => p.key === s.provider)
    : (info.profiles.find((p) => p.key === info.defaultProfile) ?? info.defaultInline ?? undefined);
  return { url: s.baseUrl || profile?.baseUrl || "", model: s.model || profile?.model || "" };
}

/** Buttons for a model the server does not have: use one that is there
 * (same family first), or download it (local Ollama). */
function modelActions(model: string, available: string[], canPull: boolean): ErrorAction[] {
  const family = (m: string) => m.split(":")[0];
  const same = (m: string) => Number(family(m) === family(model));
  const picks = [...available].sort((a, b) => same(b) - same(a)).slice(0, 2);
  const out: ErrorAction[] = picks.map((m, i) => ({
    label: t("useInstead", { model: m }),
    primary: i === 0,
    run: () => void useModel(m),
  }));
  if (canPull) out.push({ label: t("downloadModel", { model }), primary: !out.length, run: (card) => void downloadModel(model, card) });
  return out;
}

/** Keep the connection (profile), but with another model. */
async function useModel(model: string) {
  const s = await invoke<Settings>("get_settings");
  const next = { ...s, model };
  await invoke("save_settings", { settings: next });
  uiSettings = next;
  await restartAgent();
  addSystem(t("switchedModel", { model }));
}

/** `ollama pull` with progress inside the error card. */
async function downloadModel(model: string, card: HTMLElement) {
  const buttons = [...card.querySelectorAll<HTMLButtonElement>(".actions-row button")];
  for (const b of buttons) b.disabled = true;
  card.querySelector(".progress-row")?.remove();
  const row = document.createElement("div");
  row.className = "progress-row";
  const text = document.createElement("span");
  text.textContent = t("downloadingModel", { model });
  const bar = document.createElement("progress");
  bar.max = 1;
  row.append(text, bar);
  card.appendChild(row);
  scrollDown();
  const unlisten = await listen<{ phase: string; done: number; total: number }>("setup://progress", (e) => {
    const p = e.payload;
    if (p.phase !== "pull") return;
    if (p.total > 0) {
      bar.value = p.done / p.total;
      text.textContent = `${t("downloadingModel", { model })} ${fmtBytes(p.done)} / ${fmtBytes(p.total)}`;
    }
  });
  try {
    await invoke("setup_ollama_pull", { model });
    bar.remove();
    text.textContent = t("modelDownloaded", { model });
    llm.problem = false;
    mascot.set("happy", 2500);
    refreshStatus(mascot.current);
  } catch (e) {
    bar.remove();
    text.textContent = t("modelDownloadFailed", { error: errText(e) });
    for (const b of buttons) b.disabled = false;
  } finally {
    unlisten();
  }
}

/** Tool servers the widget brings along (e.g. Windows desktop control). */
async function mcpServers(): Promise<McpServer[]> {
  return invoke<McpServer[]>("agent_mcp_servers").catch(() => []);
}

async function newChat() {
  if (busy && sessionId) client.cancel(sessionId);
  resolveAllPermissions(null);
  localStorage.removeItem(LAST_SESSION_KEY);
  clearMessages();
  ctx.used = null;
  renderContext();
  if (!client.running) return connect(false);
  try {
    const cwd = await invoke<string>("agent_working_dir");
    early = [];
    const info = await client.newSession(cwd, await mcpServers());
    sessionId = info.sessionId;
    configOptions = info.configOptions;
    localStorage.setItem(LAST_SESSION_KEY, sessionId);
    busy = false;
    greet();
    flushEarly();
    mascot.set("idle");
  } catch (e) {
    early = null;
    addError(t("newChatFailed", { error: errText(e) }));
  }
  updateComposer();
}

function greet() {
  addSystem(t("greeting"));
  showSuggestions();
}

/** Clickable example tasks in an empty conversation (what can Aar do at all?). */
function showSuggestions() {
  removeSuggestions();
  const s = uiSettings;
  const list: Array<[string, string]> = [
    [t("sugNews"), t("sugNewsPrompt")],
    [t("sugLetter"), t("sugLetterPrompt")],
    [t("sugDownloads"), t("sugDownloadsPrompt")],
  ];
  if (s?.desktopControl !== false) list.splice(1, 0, [t("sugPaint"), t("sugPaintPrompt")]);
  if (s?.photoFolders?.length) list.push([t("sugPhotos"), t("sugPhotosPrompt")]);
  const row = document.createElement("div");
  row.className = "suggestions";
  row.id = "suggestions";
  for (const [label, prompt] of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = prompt;
    b.addEventListener("click", () => {
      if (!connected || busy) return;
      input.value = prompt;
      void send();
    });
    row.appendChild(b);
  }
  messages.appendChild(row);
}

function removeSuggestions() {
  document.getElementById("suggestions")?.remove();
}

/** Turns longer than this get a Windows notification when they end (if the
 * user is not looking at the widget). */
const LONG_TURN_MS = 20_000;

function notifyDone(firstOfTurn: number) {
  const answer = [...messages.children]
    .slice(firstOfTurn)
    .filter((el) => el.classList.contains("agent"))
    .map((el) => (el as HTMLElement).innerText.trim())
    .filter(Boolean)
    .pop();
  const body = (answer ?? "").replace(/\s+/g, " ").slice(0, 140);
  void invoke("notify_user", { title: t("notifyDoneTitle"), body, show: false }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

async function send() {
  const text = input.value.trim();
  const images = attachments.splice(0);
  if ((!text && !images.length) || !connected || !sessionId || busy) {
    attachments.unshift(...images);
    return;
  }
  attachError = "";
  renderAttachments();
  input.value = "";
  autoGrow();
  removeSuggestions();
  addUser(text, images.map((i) => i.url));
  busy = true;
  turnOutput = false;
  turnTools.clear();
  autoNotes.clear();
  const turnStart = Date.now();
  const firstOfTurn = messages.childElementCount;
  updateComposer();
  mascot.set("thinking");
  const stderrBefore = await invoke<string>("agent_stderr").catch(() => "");
  try {
    const reason = await client.prompt(sessionId, text, images);
    finishStreaming();
    switch (reason) {
      case "end_turn":
        if (!turnOutput) {
          // aar ends the turn normally even when the provider failed (the
          // error only goes to its log) or the model stopped mid-thought.
          await reportSilentTurn(stderrBefore);
          break;
        }
        llm.problem = false;
        mascot.set("happy", 2500);
        if (!expanded) badge.hidden = false;
        void showTurnFiles(turnStart, firstOfTurn);
        if (Date.now() - turnStart > LONG_TURN_MS) notifyDone(firstOfTurn);
        break;
      case "cancelled":
        addSystem(t("cancelled"));
        mascot.set("idle");
        break;
      case "max_tokens":
      case "max_turn_requests":
        addSystem(t("limitReached"));
        mascot.set("idle");
        break;
      case "refusal":
        addSystem(t("refusal"));
        mascot.set("idle");
        break;
      default:
        mascot.set("idle");
    }
  } catch (e) {
    finishStreaming();
    if (client.running) {
      addError(t("somethingWrong", { error: errText(e) }));
      mascot.set("error", 4000);
    }
  } finally {
    busy = false;
    resolveAllPermissions(null);
    updateComposer();
  }
}

async function reportSilentTurn(stderrBefore: string) {
  const after = await invoke<string>("agent_stderr").catch(() => "");
  // Only the log lines written during this turn (the buffer is a rolling tail).
  const fresh = after.startsWith(stderrBefore) ? after.slice(stderrBefore.length) : after;
  const lines = fresh.split("\n").filter((l) => /error|warn|fail|exception|refused/i.test(l));
  const details = lines.slice(-8).join("\n");
  const providerDown = /connect|connection|refused|timed? ?out|unreachable/i.test(details);
  // Ollama: HTTP 404 {"error":"model 'gemma4:e4b' not found"}
  const missing = /model ['"]?([^'"\s]+)['"]? not found/i.exec(details)?.[1];
  let actions: ErrorAction[] = [];
  if (missing) {
    // Offer the models the server has (and a download for a local Ollama).
    const ep = await currentEndpoint().catch(() => ({ url: "", model: "" }));
    const r = ep.url ? await invoke<EndpointCheck>("check_endpoint", { url: ep.url }).catch(() => null) : null;
    if (r?.reachable) actions = modelActions(missing, r.models, isLocalUrl(ep.url) && /:11434(\/|$)/.test(ep.url));
  }
  addError(
    missing ? t("modelMissing", { model: missing }) : providerDown ? t("noAnswerProvider") : t("noAnswer"),
    details,
    actions,
  );
  llm.problem = true;
  mascot.set("error", 5000);
}

function stop() {
  if (busy && sessionId) {
    client.cancel(sessionId);
    resolveAllPermissions(null);
    setStatus(t("cancelling"), "busy");
  }
}

// ---------------------------------------------------------------------------
// session/update rendering
// ---------------------------------------------------------------------------

function handleUpdate(u: SessionUpdate) {
  if (["agent_message_chunk", "tool_call"].includes(u.sessionUpdate)) turnOutput = true;
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const c = (u as { content: { type: string; text?: string } }).content;
      if (!busy && c?.type === "text" && c.text && reportMcpFailure(c.text)) break;
      if (c?.type === "text" && c.text) appendAgentText(c.text);
      if (busy && mascot.current !== "asking") mascot.set("talking");
      break;
    }
    case "agent_thought_chunk": {
      const c = (u as { content: { type: string; text?: string } }).content;
      if (c?.type === "text" && c.text) appendThought(c.text);
      if (busy && mascot.current !== "asking") mascot.set("thinking");
      break;
    }
    case "user_message_chunk": {
      // Only sent while replaying a loaded session.
      const c = (u as { content: { type: string; text?: string } }).content;
      if (c?.type === "text" && c.text) {
        finishStreaming();
        addUser(c.text);
      }
      break;
    }
    case "tool_call":
      upsertTool(u as unknown as ToolCallInfo);
      if (busy && mascot.current !== "asking") mascot.set("working");
      break;
    case "tool_call_update":
      upsertTool(u as unknown as ToolCallInfo);
      break;
    case "config_option_update": {
      const opts = (u as { configOptions?: ConfigOption[] }).configOptions;
      if (opts) configOptions = opts;
      break;
    }
    case "usage_update": {
      const { size, used } = u as { size?: number; used?: number };
      if (typeof used === "number" && used > 0) ctx.used = used;
      // Without a configured window aar reports size = used; keep the known size then.
      if (typeof size === "number" && size > (used ?? 0)) ctx.size = size;
      renderContext();
      break;
    }
    default:
      break; // plan, session_info_update, available_commands_update …
  }
}

/** aar tells about tool servers that failed to start with a plain agent
 * message outside of a turn ("MCP server 'x' unavailable (…)"). */
function reportMcpFailure(text: string): boolean {
  if (!/^MCP (server '|setup failed)/.test(text)) return false;
  const names = [...text.matchAll(/MCP server '([^']+)' unavailable/g)].map((m) => m[1]);
  addError(names.length ? t("mcpUnavailable", { name: names.join(", ") }) : t("mcpFailed"), text);
  return true;
}

function appendAgentText(text: string) {
  thought = null;
  if (!streamingMsg) {
    const el = document.createElement("div");
    el.className = "msg agent streaming";
    messages.appendChild(el);
    streamingMsg = { el, text: "" };
  }
  streamingMsg.text += text;
  streamingMsg.el.innerHTML = renderMarkdown(streamingMsg.text);
  scrollDown();
}

function appendThought(text: string) {
  if (!thought) {
    finishStreaming();
    const el = document.createElement("details");
    el.className = "thought";
    el.innerHTML = `<summary></summary><div class="body"></div>`;
    el.querySelector("summary")!.textContent = t("thinking");
    messages.appendChild(el);
    thought = { el, body: el.querySelector(".body")!, text: "" };
  }
  thought.text += text;
  thought.body.textContent = thought.text;
  scrollDown();
}

function finishStreaming() {
  if (streamingMsg) {
    streamingMsg.el.classList.remove("streaming");
    if (!streamingMsg.text.trim()) streamingMsg.el.remove();
  }
  streamingMsg = null;
  if (thought) thought.el.querySelector("summary")!.textContent = t("thoughts");
  thought = null;
}

function upsertTool(update: ToolCallInfo) {
  let entry = tools.get(update.toolCallId);
  if (!entry) {
    finishStreaming();
    const el = document.createElement("details");
    el.className = "tool running";
    messages.appendChild(el);
    entry = { el, info: { ...update } };
    tools.set(update.toolCallId, entry);
    turnTools.add(update.toolCallId);
  } else {
    // Merge: fields present in the update replace the old ones.
    for (const [k, v] of Object.entries(update)) if (v !== undefined && v !== null) (entry.info as any)[k] = v;
  }
  renderTool(entry.el, entry.info);
  maybePhotoCard(entry.el, entry.info);
  scrollDown();
}

/** Thumbnails of the photos a photo_search found, right under the tool chip. */
function maybePhotoCard(el: HTMLDetailsElement, tc: ToolCallInfo) {
  if (el.dataset.photoCard || tc.status !== "completed") return;
  if (!/(^|__)photo_search$/.test((tc.title ?? "").trim())) return;
  el.dataset.photoCard = "1";
  const card = photoResultCard(toolOutputText(tc), (msg) => addError(msg));
  if (card) el.after(card);
}

function renderTool(el: HTMLDetailsElement, tc: ToolCallInfo) {
  learnFromTool(tc);
  const { verb, detail, icon } = describeTool(tc);
  const status = tc.status === "completed" ? "completed" : tc.status === "failed" ? "failed" : "running";
  el.className = `tool ${status}`;
  const out = toolOutputText(tc);
  el.innerHTML = "";
  const summary = document.createElement("summary");
  summary.innerHTML = `<span>${icon}</span><span class="verb"></span><span class="detail"></span><span class="state"></span>`;
  summary.querySelector(".verb")!.textContent = verb;
  summary.querySelector(".detail")!.textContent = detail;
  el.appendChild(summary);
  const pre = document.createElement("pre");
  pre.textContent =
    (tc.rawInput !== undefined ? `${t("input")}:\n${prettyJson(tc.rawInput)}\n` : "") +
    (out ? `\n${t("result")}:\n${out.slice(0, 4000)}` : "");
  el.appendChild(pre);
  const images = toolImages(tc);
  for (const src of images) {
    const img = document.createElement("img");
    img.className = "tool-image";
    img.alt = t("toolImage");
    img.src = src;
    el.appendChild(img);
  }
  // Show what Aar "saw" (e.g. a screenshot) without an extra click.
  if (images.length && !el.dataset.autoOpened) {
    el.open = true;
    el.dataset.autoOpened = "1";
  }
  if (status === "failed" && busy) mascot.set("error", 2500);
}

/** Image blocks of a tool result as data: URLs (only safe raster types). */
function toolImages(tc: ToolCallInfo): string[] {
  const out: string[] = [];
  for (const c of tc.content ?? []) {
    const b = c.content as { type?: string; mimeType?: string; data?: string } | undefined;
    if (c.type !== "content" || b?.type !== "image" || !b.data) continue;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(b.mimeType ?? "")) continue;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b.data)) continue;
    out.push(`data:${b.mimeType};base64,${b.data.replace(/\s/g, "")}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const optionLabel = (kind: string): string | undefined =>
  ({ allow_once: t("allowOnce"), allow_always: t("allowAlways"), reject_once: t("rejectOnce"), reject_always: t("rejectAlways") })[
    kind
  ];

function askPermission(req: PermissionRequest): Promise<string | null> {
  const tc = req.toolCall;
  const tool = (tc.title ?? "").trim();
  // allow_once also for granted tools: aar forgets its own "always" after the answer.
  const allowOpt = req.options.find((o) => o.kind === "allow_once") ?? req.options.find((o) => o.kind === "allow_always");
  if (allowOpt && grants.allowed(req.sessionId, tool)) {
    noteAutoAllowed(req.sessionId, tc);
    return Promise.resolve(allowOpt.optionId);
  }
  return new Promise((resolve) => {
    finishStreaming();
    const { verb, detail, icon } = describeTool(tc);

    const card = document.createElement("div");
    card.className = "permission";
    card.innerHTML = `
      <div class="q"></div>
      <div class="verb-line"></div>
      <div class="what"></div>
      <details><summary></summary><pre></pre></details>
      <div class="actions"></div>
      <div class="result" hidden></div>`;
    card.querySelector(".q")!.textContent = `${icon} ${t("mayI")}`;
    card.querySelector("summary")!.textContent = t("details");
    card.querySelector(".verb-line")!.textContent = verb;
    const what = card.querySelector<HTMLElement>(".what")!;
    if (detail) what.textContent = detail;
    else what.remove();
    card.querySelector("pre")!.textContent = `${tc.title ?? ""}\n${prettyJson(tc.rawInput)}`;

    const actions = card.querySelector(".actions")!;
    // aar's own "allow always" only lasts until the end of the answer; the
    // widget offers its own scopes instead (see permissions.ts).
    const order = ["allow_once", "reject_once"];
    const opts: PermissionOption[] = [...req.options]
      .filter((o) => order.includes(o.kind))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const risky = isRisky(tool, tc.kind);

    const finish = (optionId: string | null, label: string) => {
      if (!pendingPermissions.has(done)) return;
      pendingPermissions.delete(done);
      card.classList.add("resolved");
      const r = card.querySelector<HTMLElement>(".result")!;
      r.hidden = false;
      r.textContent = label;
      if (busy) mascot.set(optionId?.startsWith("allow") ? "working" : "thinking");
      resolve(optionId);
    };
    const done = (optionId: string | null) => finish(optionId, optionId ? "" : t("aborted"));
    pendingPermissions.add(done);

    for (const o of opts) {
      const b = document.createElement("button");
      b.textContent = optionLabel(o.kind) ?? o.name;
      b.className = o.kind === "allow_once" ? "primary" : o.kind.startsWith("reject") ? "danger" : "secondary";
      b.addEventListener("click", () =>
        finish(o.optionId, o.kind.startsWith("allow") ? `✓ ${b.textContent}` : t("rejected")),
      );
      actions.appendChild(b);
    }
    if (allowOpt && tool) {
      const scopes: Array<["conversation" | "always", string, string]> = [
        ["conversation", permText("allowConversation"), permText("allowedConversation")],
      ];
      if (!risky) scopes.push(["always", permText("allowAlways"), permText("allowedAlways")]);
      for (const [scope, label, result] of scopes) {
        const b = document.createElement("button");
        b.className = "secondary";
        b.dataset.scope = scope;
        b.textContent = label;
        b.addEventListener("click", () => {
          void grants.grant(req.sessionId, tool, scope, tc.kind).catch((e) => addError(errText(e)));
          finish(allowOpt.optionId, result);
        });
        actions.appendChild(b);
      }
      if (risky) {
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = permText("riskyNote");
        actions.after(note);
      }
    }

    messages.appendChild(card);
    mascot.set("asking");
    setExpanded(true);
    scrollDown();
    (actions.querySelector("button.primary") as HTMLButtonElement | null)?.focus();
    // Windows notification when the user is somewhere else (shows a hidden widget).
    void invoke("notify_user", { title: t("notifyPermTitle"), body: detail ? `${verb}: ${detail}` : verb, show: true }).catch(
      () => undefined,
    );
  });
}

/** A granted tool was allowed without asking: a small note with "Zurücknehmen";
 * repeats within the turn only count up. */
function noteAutoAllowed(sid: string, tc: ToolCallInfo) {
  const tool = (tc.title ?? "").trim();
  const what = toolLabel(tool, tc.kind);
  const known = autoNotes.get(tool);
  if (known) {
    known.n += 1;
    known.el.querySelector(".text")!.textContent = permText("autoAllowedN", { what, n: known.n });
    return;
  }
  const el = document.createElement("div");
  el.className = "auto-allowed";
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = permText("autoAllowed", { what });
  const b = document.createElement("button");
  b.type = "button";
  b.className = "link";
  b.textContent = permText("revoke");
  b.addEventListener("click", () => {
    void grants.revoke(sid, tool).then(
      () => {
        text.textContent = permText("revoked");
        b.remove();
        autoNotes.delete(tool);
      },
      (e) => addError(errText(e)),
    );
  });
  el.append(text, b);
  const chip = tc.toolCallId ? tools.get(tc.toolCallId)?.el : undefined;
  if (chip) chip.after(el);
  else messages.appendChild(el);
  autoNotes.set(tool, { el, n: 1 });
  scrollDown();
}

function resolveAllPermissions(optionId: string | null) {
  for (const fn of [...pendingPermissions]) fn(optionId);
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

function addUser(text: string, images: string[] = []) {
  const el = document.createElement("div");
  el.className = "msg user";
  if (images.length) {
    const row = document.createElement("div");
    row.className = "user-images";
    for (const src of images) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      row.appendChild(img);
    }
    el.appendChild(row);
  }
  el.appendChild(document.createTextNode(text));
  messages.appendChild(el);
  scrollDown(true);
}

// ---------------------------------------------------------------------------
// Files the agent created: "Öffnen" / "Im Ordner zeigen" under the answer
// ---------------------------------------------------------------------------

interface TurnFile {
  path: string;
  name: string;
  openable: boolean;
}

async function showTurnFiles(since: number, firstOfTurn: number) {
  const candidates: string[] = [];
  for (const id of turnTools) {
    const t = tools.get(id);
    if (t) candidates.push(...toolFileCandidates(t.info));
  }
  for (const el of [...messages.children].slice(firstOfTurn)) {
    if (el.classList.contains("agent")) candidates.push(...filePathsIn((el as HTMLElement).innerText));
  }
  let files: TurnFile[] = [];
  try {
    files = await invoke<TurnFile[]>("turn_files", { sinceMs: since, candidates: [...new Set(candidates)] });
  } catch (e) {
    console.warn("turn_files failed", e);
  }
  if (!files.length) return;
  const card = document.createElement("div");
  card.className = "files";
  const head = document.createElement("div");
  head.className = "q";
  head.textContent = files.length === 1 ? t("newFile") : t("newFiles", { n: files.length });
  card.appendChild(head);
  const error = document.createElement("div");
  error.className = "file-error";
  for (const f of files) {
    const row = document.createElement("div");
    row.className = "file";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.name;
    name.title = f.path;
    row.appendChild(name);
    const open = (reveal: boolean) => async () => {
      error.textContent = "";
      try {
        await invoke("open_file", { path: f.path, reveal });
      } catch (e) {
        error.textContent = errText(e);
      }
    };
    if (f.openable) row.appendChild(fileButton(t("open"), "primary", open(false)));
    row.appendChild(fileButton(t("showInFolder"), "secondary", open(true)));
    card.appendChild(row);
  }
  card.appendChild(error);
  messages.appendChild(card);
  scrollDown();
}

function fileButton(label: string, cls: string, run: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", run);
  return b;
}

function addSystem(text: string) {
  const el = document.createElement("div");
  el.className = "msg system";
  el.textContent = text;
  messages.appendChild(el);
  scrollDown();
}

interface ErrorAction {
  label: string;
  primary?: boolean;
  /** `card` = the error card (e.g. to show progress in it). */
  run: (card: HTMLElement) => void;
}

function addError(text: string, details = "", actions: ErrorAction[] | boolean = false) {
  const el = document.createElement("div");
  el.className = "msg error";
  const p = document.createElement("p");
  p.textContent = text;
  el.appendChild(p);
  if (details.trim()) {
    const d = document.createElement("details");
    d.innerHTML = "<summary></summary><pre></pre>";
    d.querySelector("summary")!.textContent = t("techDetails");
    d.querySelector("pre")!.textContent = details.trim();
    el.appendChild(d);
  }
  const list: ErrorAction[] =
    actions === true ? [{ label: t("reconnect"), run: () => void connect() }] : actions || [];
  if (list.length) {
    const row = document.createElement("div");
    row.className = "actions-row";
    for (const a of list) {
      const b = document.createElement("button");
      b.className = a.primary ? "primary" : "secondary";
      b.textContent = a.label;
      b.addEventListener("click", () => a.run(el));
      row.appendChild(b);
    }
    el.appendChild(row);
  }
  messages.appendChild(el);
  scrollDown();
}

function clearMessages() {
  messages.innerHTML = "";
  tools.clear();
  forgetDesktop();
  streamingMsg = null;
  thought = null;
}

function scrollDown(force = false) {
  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 120;
  if (force || nearBottom) messages.scrollTop = messages.scrollHeight;
}

function errText(e: unknown): string {
  if (e instanceof RpcError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---------------------------------------------------------------------------
// Status / composer
// ---------------------------------------------------------------------------

/** 32768 → "32k", 12345 → "12k", 1500 → "1,5k", 800 → "800". */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n % 1024 === 0) return `${n / 1024}k`;
  if (n < 10000) return `${(n / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })}k`;
  return `${Math.round(n / 1000)}k`;
}

function renderContext() {
  const el = $("ctx-meter");
  const { size, used } = ctx;
  const num = (n: number) => n.toLocaleString(locale());
  const both = size > 0 && used !== null;
  el.hidden = !size && used === null;
  el.classList.toggle("size-only", !both);
  const frac = both ? Math.min(1, used! / size) : 0;
  el.classList.toggle("warn", frac >= 0.7 && frac < 0.9);
  el.classList.toggle("full", frac >= 0.9);
  $("ctx-fill").style.width = `${Math.round(frac * 100)}%`;
  $("ctx-text").textContent = both
    ? t("ctxText", { used: fmtTokens(used!), size: fmtTokens(size) })
    : fmtTokens(size || used || 0);
  const tip = both
    ? t("ctxTip", { used: num(used!), size: num(size) })
    : size
      ? t("ctxTipSize", { size: num(size) })
      : t("ctxTipUsed", { used: num(used ?? 0) });
  el.dataset.tip = tip;
  el.setAttribute("aria-label", tip);
  el.setAttribute("aria-valuemax", String(size || used || 0));
  el.setAttribute("aria-valuenow", String(used ?? 0));
}

function setStatus(text: string, dot: "ready" | "busy" | "offline" | "warn") {
  statusText.textContent = text;
  connDot.className = `dot ${dot}`;
}

function refreshStatus(m: Mood) {
  if (connecting) return;
  if (!connected) return setStatus(moodLabel("offline"), "offline");
  if (!busy && llm.check) return setStatus(llm.check, "busy");
  // Only claim "ready" when the language model works.
  if (!busy && llm.problem && (m === "idle" || m === "sleeping")) return setStatus(t("notReady"), "warn");
  setStatus(moodLabel(m), busy ? "busy" : llm.problem ? "warn" : "ready");
}

function updateComposer() {
  sendBtn.classList.toggle("stop", busy);
  sendBtn.dataset.tip = busy ? t("tipCancel") : t("tipSend");
  sendBtn.setAttribute("aria-label", busy ? t("tipCancel") : t("send"));
  sendBtn.disabled = !connected && !busy;
  input.disabled = !connected;
  input.placeholder = connected ? (busy ? t("working") : t("askMe")) : t("notConnected");
  refreshStatus(mascot.current);
}

// ---------------------------------------------------------------------------
// Input height: grows with the text; the user can drag the bar above it to
// set a larger minimum height (remembered).
// ---------------------------------------------------------------------------

const INPUT_HEIGHT_KEY = "aar-ui:input-height";
const INPUT_MIN = 38;
let inputHeight = Number(localStorage.getItem(INPUT_HEIGHT_KEY)) || INPUT_MIN;

function inputMax(): number {
  // At most ~60 % of the bubble, so the conversation stays visible.
  return Math.max(INPUT_MIN, Math.floor($("bubble").clientHeight * 0.6));
}

function autoGrow() {
  const floor = Math.min(inputHeight, inputMax());
  const cap = Math.max(floor, Math.min(160, inputMax()));
  input.style.height = "auto";
  input.style.height = Math.max(floor, Math.min(input.scrollHeight + 2, cap)) + "px";
}

function setupComposerGrip() {
  const grip = $("composer-grip");
  let start: { y: number; h: number } | null = null;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start = { y: e.clientY, h: input.offsetHeight };
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!start) return;
    inputHeight = Math.round(Math.max(INPUT_MIN, Math.min(start.h + (start.y - e.clientY), inputMax())));
    input.style.height = inputHeight + "px";
  });
  const end = () => {
    if (!start) return;
    start = null;
    grip.classList.remove("dragging");
    localStorage.setItem(INPUT_HEIGHT_KEY, String(inputHeight));
    autoGrow();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("dblclick", () => {
    inputHeight = INPUT_MIN;
    localStorage.removeItem(INPUT_HEIGHT_KEY);
    autoGrow();
  });
}

/** Grips on the bubble edges resize the native window (OS-driven drag). */
// ---------------------------------------------------------------------------
// Image attachments: 📎, drag & drop, paste. Scaled down in the webview (max
// 1280 px, JPEG): a photo then costs ~1000 model tokens instead of 10 000.
// ---------------------------------------------------------------------------

interface Attachment {
  mimeType: string;
  data: string;
  url: string;
}
const MAX_ATTACH = 4;
const ATTACH_EDGE = 1280;
const attachments: Attachment[] = [];
let attachError = "";

async function addImageFiles(files: Iterable<File>) {
  attachError = "";
  for (const f of files) {
    if (attachments.length >= MAX_ATTACH) {
      attachError = t("attachTooMany", { n: MAX_ATTACH });
      break;
    }
    try {
      attachments.push(await shrinkImage(f));
    } catch {
      attachError = t("attachUnsupported", { name: f.name || "?" });
    }
  }
  renderAttachments();
  input.focus();
}

/** Decode (only data: URLs are allowed by the CSP), scale down, re-encode as JPEG. */
function shrinkImage(file: Blob): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("cannot decode"));
      img.onload = () => {
        const scale = Math.min(1, ATTACH_EDGE / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const g = canvas.getContext("2d");
        if (!g) return reject(new Error("no canvas"));
        g.fillStyle = "#fff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function renderAttachments() {
  const host = $("attachments");
  host.innerHTML = "";
  attachments.forEach((a, i) => {
    const cell = document.createElement("div");
    cell.className = "att";
    const img = document.createElement("img");
    img.src = a.url;
    img.alt = "";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "✕";
    rm.title = t("removeImage");
    rm.setAttribute("aria-label", t("removeImage"));
    rm.addEventListener("click", () => {
      attachments.splice(i, 1);
      attachError = "";
      renderAttachments();
    });
    cell.append(img, rm);
    host.appendChild(cell);
  });
  if (attachError) {
    const err = document.createElement("span");
    err.className = "att-error";
    err.textContent = attachError;
    host.appendChild(err);
  }
  host.hidden = !attachments.length && !attachError;
}

function setupAttachments() {
  const picker = $<HTMLInputElement>("file-attach");
  $("btn-attach").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    void addImageFiles([...(picker.files ?? [])]);
    picker.value = "";
  });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    void addImageFiles(files);
  });
  const bubble = $("bubble");
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  bubble.addEventListener("dragover", (e) => {
    if (!hasFiles(e) || !settingsView.hidden) return;
    e.preventDefault();
    bubble.classList.add("drop-target");
  });
  bubble.addEventListener("dragleave", (e) => {
    if (e.target === bubble) bubble.classList.remove("drop-target");
  });
  bubble.addEventListener("drop", (e) => {
    bubble.classList.remove("drop-target");
    if (!hasFiles(e) || !settingsView.hidden) return;
    e.preventDefault();
    void addImageFiles([...(e.dataTransfer?.files ?? [])]);
  });
}

function setupResizeGrips() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-resize]")) {
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      void getCurrentWindow().startResizeDragging(el.dataset.resize as ResizeDirection);
    });
  }
  // Keep the input within bounds when the window gets smaller.
  window.addEventListener("resize", () => expanded && autoGrow());
}

// ---------------------------------------------------------------------------
// Window: expand / collapse / drag
// ---------------------------------------------------------------------------

async function setExpanded(on: boolean) {
  if (on === expanded) return;
  expanded = on;
  if (on) {
    await invoke("set_expanded", { expanded: true });
    app.classList.remove("collapsed");
    badge.hidden = true;
    mascot.setLookingUp(true);
    mascot.wake();
    setTimeout(() => {
      autoGrow();
      scrollDown(true);
      if (!settingsView.hidden) return;
      input.focus();
    }, 30);
  } else {
    closeSettings();
    app.classList.add("collapsed");
    mascot.setLookingUp(false);
    await invoke("set_expanded", { expanded: false });
  }
}

function setupMascotPointer() {
  const el = $("mascot");
  let down: { x: number; y: number } | null = null;
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY };
  });
  el.addEventListener("mousemove", (e) => {
    if (!down) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) {
      down = null;
      void getCurrentWindow().startDragging();
    }
  });
  el.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !down) return;
    down = null;
    mascot.wake();
    void setExpanded(!expanded);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") void setExpanded(!expanded);
  });
  // Screen readers and UI Automation (Invoke) send a bare click without mouse
  // events (detail 0); real mouse clicks are handled by mouseup above.
  el.addEventListener("click", (e) => {
    if (e.detail === 0) void setExpanded(!expanded);
  });
  el.addEventListener("mouseenter", () => mascot.wake());
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const optionName = (id: string): string | undefined =>
  ({ model: t("optModel"), mode: t("optMode"), reasoning_effort: t("optEffort") })[id];
const modeName = (v: string): string | undefined =>
  ({ review: t("modeReview"), auto: t("modeAuto"), "read-only": t("modeReadOnly") })[v];

let loadedSettings: Settings | null = null;
let aarConfig: AarConfigInfo | null = null;
/** API keys typed in the form (per provider type, saved with "Save"). */
let apiKeys: Record<string, string> = {};
/** Provider type whose key the API key field currently shows. */
let keyKind = "";
/** Draft list of named custom providers while the settings form is open. */
let customProviders: CustomProvider[] = [];
/** ID of the custom provider currently shown in the form ("" if not a custom provider). */
let activeCustomId = "";

const CUSTOM_PREFIX = "custom:";
function findCustomProvider(list: CustomProvider[] | undefined, providerValue: string): CustomProvider | undefined {
  if (!providerValue.startsWith(CUSTOM_PREFIX)) return undefined;
  const id = providerValue.slice(CUSTOM_PREFIX.length);
  return list?.find((p) => p.id === id);
}
function slugifyProviderId(name: string, existing: CustomProvider[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "custom";
  let id = base;
  let n = 2;
  while (existing.some((p) => p.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Provider types offered besides the aar config's profiles (aar --provider <type>). */
const PROVIDER_KINDS = ["ollama", "anthropic", "openai", "gemini", "generic"];
const CLOUD_KINDS = ["anthropic", "openai", "gemini", "generic"];
const isCloud = (kind: string) => CLOUD_KINDS.includes(kind);
const KIND_TEXT: Record<string, "kindOllama" | "kindAnthropic" | "kindOpenai" | "kindGemini" | "kindGeneric"> = {
  ollama: "kindOllama",
  anthropic: "kindAnthropic",
  openai: "kindOpenai",
  gemini: "kindGemini",
  generic: "kindGeneric",
};
/** "Anthropic Claude – Cloud" in the picker, "Anthropic Claude" in messages. */
function kindLabel(kind: string): string {
  return KIND_TEXT[kind] ? t(KIND_TEXT[kind]) : t("providerType", { name: kind });
}
function kindName(kind: string): string {
  return KIND_TEXT[kind] ? t(KIND_TEXT[kind]).replace(/ – .*$/, "") : kind;
}

const field = (id: string) => $<HTMLInputElement>(id);
const providerSelect = $<HTMLSelectElement>("set-provider");
const customKindSelect = $<HTMLSelectElement>("set-custom-kind");

function fillCustomKinds(selected: string) {
  customKindSelect.innerHTML = "";
  for (const k of ["gemini", "openai", "anthropic", "generic"]) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = kindLabel(k);
    customKindSelect.appendChild(o);
  }
  customKindSelect.value = CLOUD_KINDS.includes(selected) ? selected : "gemini";
}

function flushCustomDraft() {
  if (!activeCustomId) return;
  const cp = customProviders.find((p) => p.id === activeCustomId);
  if (!cp) return;
  cp.name = field("set-custom-name").value.trim();
  cp.kind = customKindSelect.value;
  cp.apiKey = field("set-apikey").value.trim();
  cp.baseUrl = field("set-baseurl").value.trim();
  cp.model = field("set-model").value.trim();
  const opt = providerSelect.querySelector<HTMLOptionElement>(`option[value="${CUSTOM_PREFIX}${cp.id}"]`);
  if (opt) opt.textContent = customProviderLabel(cp);
}

function customProviderLabel(cp: CustomProvider): string {
  const where = cp.baseUrl ? ` @ ${cp.baseUrl.replace(/^https?:\/\//, "").split("/")[0]}` : "";
  const model = cp.model ? `/${cp.model}` : "";
  return `${cp.name || t("customNamePlaceholder")} · ${cp.kind}${model}${where}`;
}

async function openSettings() {
  historyView.close();
  await setExpanded(true);
  loadedSettings = await invoke<Settings>("get_settings");
  uiSettings = loadedSettings;
  renderGrantList($("grant-list"), grants, sessionId, (msg) => ($("settings-error").textContent = msg));
  field("set-command").value = loadedSettings.agentCommand;
  field("set-args").value = loadedSettings.agentArgs.join(" ");
  field("set-cwd").value = loadedSettings.workingDir;
  field("set-hotkey").value = loadedSettings.hotkey;
  field("set-config").value = loadedSettings.configPath;
  field("set-baseurl").value = loadedSettings.baseUrl;
  field("set-model").value = loadedSettings.model;
  apiKeys = { ...(loadedSettings.apiKeys ?? {}) };
  keyKind = "";
  customProviders = (loadedSettings.customProviders ?? []).map((p) => ({ ...p }));
  activeCustomId = "";
  fillCustomKinds("gemini");
  field("set-desktop").checked = loadedSettings.desktopControl;
  field("set-autostart").checked = loadedSettings.autostart;
  fillLanguages(loadedSettings.language ?? "");
  setHint("test-result", "");
  $("settings-error").textContent = "";
  addons.open(loadedSettings);
  photos.open(loadedSettings);
  renderSessionOptions();
  void showDiagnosticPaths();
  void showVersion();
  await loadAarConfig(loadedSettings.provider);
  showTab("general");
  settingsView.hidden = false;
  app.classList.add("settings-open");
}

function fillLanguages(selected: string) {
  const sel = $<HTMLSelectElement>("set-language");
  sel.innerHTML = "";
  for (const [value, text] of [["", t("languageAuto")], ...LANGS.map((l) => [l, LANG_NAMES[l]])]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }
  sel.value = selected;
}

type Tab = "general" | "extensions" | "tools" | "photos";

function showTab(tab: Tab) {
  for (const b of document.querySelectorAll<HTMLElement>("#settings [data-tab]")) {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  }
  for (const p of document.querySelectorAll<HTMLElement>("#settings [data-pane]")) p.hidden = p.dataset.pane !== tab;
  // Add-on changes apply immediately; only the general form needs "Save".
  const general = tab === "general";
  $("btn-settings-cancel").hidden = !general;
  $("btn-settings-save").hidden = !general;
  $("btn-settings-done").hidden = general;
  if (tab === "extensions") void addons.showExtensions();
  if (tab === "tools") void addons.showTools();
  if (tab === "photos") void photos.show();
  else photos.hide();
}

/** "Aar Desktop 0.1.0 · aar 0.9.0 · Modell qwen3.8:latest" - what support needs to know. */
async function showVersion() {
  const app = await invoke<string>("app_version").catch(() => "?");
  const opt = configOptions.find((o) => o.id === "model");
  const model = opt?.options?.find((o) => o.value === opt.currentValue)?.name ?? opt?.currentValue;
  const parts = [`Aar Desktop ${app}`];
  if (client.agentVersion) parts.push(`aar ${client.agentVersion}`);
  if (typeof model === "string" && model) parts.push(t("modelLabel", { model }));
  $("version-info").textContent = parts.join(" · ");
  $("btn-copy-version").textContent = t("copy");
}

/** Where conversations and the log live, so users can look up what went wrong. */
async function showDiagnosticPaths() {
  $("diag-error").textContent = "";
  try {
    const p = await invoke<{ sessions: string; log: string; autostartProblem?: string }>("diagnostic_paths");
    $("autostart-problem").textContent = p.autostartProblem ?? "";
    $("diag-paths").textContent = t("diagPaths", { sessions: p.sessions, log: p.log });
  } catch {
    $("diag-paths").textContent = "";
  }
}

async function openDiagnostic(what: "sessions" | "log") {
  $("diag-error").textContent = "";
  try {
    await invoke("open_path", { what });
  } catch (e) {
    $("diag-error").textContent = errText(e);
  }
}

function setHint(id: string, text: string, tone: "" | "ok" | "bad" = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `hint ${tone}`;
}

/** Read the provider profiles from the aar config and fill the profile picker. */
async function loadAarConfig(selected: string) {
  aarConfig = await invoke<AarConfigInfo>("aar_config_info", { configPath: field("set-config").value.trim() });
  providerSelect.innerHTML = "";
  const add = (value: string, text: string, parent: HTMLElement = providerSelect) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    parent.appendChild(o);
  };
  const group = (label: string) => {
    const g = document.createElement("optgroup");
    g.label = label;
    providerSelect.appendChild(g);
    return g;
  };
  const def = defaultProfile();
  add("", `${t("standard")}${def ? ` – ${profileLabel(def)}` : ""}`);
  if (customProviders.length) {
    const g = group(t("groupCustom"));
    for (const cp of customProviders) add(`${CUSTOM_PREFIX}${cp.id}`, customProviderLabel(cp), g);
  }
  if (aarConfig.profiles.length) {
    const g = group(t("groupProfiles"));
    for (const p of aarConfig.profiles) add(p.key, profileLabel(p), g);
  }
  const g = group(t("groupProviders"));
  const isProfile = (k: string) => aarConfig!.profiles.some((p) => p.key === k);
  for (const k of PROVIDER_KINDS) if (!isProfile(k)) add(k, kindLabel(k), g);
  if (selected && !selected.startsWith(CUSTOM_PREFIX) && !isProfile(selected) && !PROVIDER_KINDS.includes(selected)) {
    add(selected, kindLabel(selected), g);
  }
  providerSelect.value = selected;
  setHint("config-hint", aarConfig.error ?? "", aarConfig.error ? "bad" : "");
  updateConnectionPlaceholders();
}

function selectedCustom(): CustomProvider | undefined {
  return findCustomProvider(customProviders, providerSelect.value);
}

/** Provider type chosen in the picker ("" when it is a profile, custom provider, or default). */
function selectedKind(): string {
  const key = providerSelect.value;
  if (!key || key.startsWith(CUSTOM_PREFIX) || aarConfig?.profiles.some((p) => p.key === key)) return "";
  return key;
}

function defaultProfile(): AarProfile | undefined {
  if (!aarConfig) return undefined;
  return aarConfig.profiles.find((p) => p.key === aarConfig!.defaultProfile) ?? aarConfig.defaultInline ?? undefined;
}

function selectedProfile(): AarProfile | undefined {
  const key = providerSelect.value;
  return key ? aarConfig?.profiles.find((p) => p.key === key) : defaultProfile();
}

function profileLabel(p: AarProfile): string {
  const where = p.baseUrl ? ` @ ${p.baseUrl.replace(/^https?:\/\//, "")}` : "";
  return `${p.key || "inline"} · ${p.kind}/${p.model}${where}`;
}

function urlPlaceholderFor(kind: string, profileBaseUrl?: string): string {
  if (kind === "ollama") return "http://localhost:11434";
  if (kind === "generic") return t("genericUrl");
  if (kind === "gemini") return t("geminiUrl");
  if (isCloud(kind)) return t("providerDefaultUrl");
  return profileBaseUrl || t("egUrl");
}

function updateConnectionPlaceholders() {
  if (isCloud(keyKind)) apiKeys[keyKind] = field("set-apikey").value.trim();
  const cp = selectedCustom();
  if (cp) {
    keyKind = "";
    activeCustomId = cp.id;
    $("custom-provider-row").hidden = false;
    field("set-custom-name").value = cp.name;
    fillCustomKinds(cp.kind);
    field("set-apikey").value = cp.apiKey;
    field("set-baseurl").value = cp.baseUrl;
    field("set-model").value = cp.model;
    field("set-baseurl").placeholder = urlPlaceholderFor(cp.kind);
    field("set-model").placeholder = t("modelPick");
    $("apikey-row").hidden = false;
    const note = $("cloud-note");
    note.hidden = false;
    note.textContent = t("cloudNote", { name: cp.name || kindName(cp.kind) });
    return;
  }
  activeCustomId = "";
  $("custom-provider-row").hidden = true;
  const kind = selectedKind();
  keyKind = kind;
  const p = selectedProfile();
  const cloud = isCloud(kind);
  field("set-baseurl").placeholder = urlPlaceholderFor(kind, p?.baseUrl);
  field("set-model").placeholder = cloud ? t("modelPick") : kind ? "" : p?.model || "";
  $("apikey-row").hidden = !cloud;
  field("set-apikey").value = cloud ? (apiKeys[kind] ?? "") : "";
  const note = $("cloud-note");
  note.hidden = !cloud;
  note.textContent = cloud ? t("cloudNote", { name: kindName(kind) }) : "";
}

/** Fill the model suggestions (datalist under the model field). */
function fillModelList(models: string[]) {
  const list = $("model-list");
  list.innerHTML = "";
  for (const m of models) {
    const o = document.createElement("option");
    o.value = m;
    list.appendChild(o);
  }
}

async function testConnection() {
  flushCustomDraft();
  const cp = selectedCustom();
  const kind = cp ? cp.kind : selectedKind();
  if (cp || isCloud(kind)) {
    const label = cp?.name || kindName(kind);
    setHint("test-result", t("checking", { url: label }));
    const model = field("set-model").value.trim();
    const r = await invoke<EndpointCheck>("check_provider", {
      kind,
      baseUrl: field("set-baseurl").value.trim(),
      apiKey: field("set-apikey").value.trim(),
      model,
    });
    fillModelList(r.models);
    let text = r.message;
    if (r.reachable && model && r.models.length && !r.models.includes(model)) text += `\n${t("modelNotOnServer", { model })}`;
    setHint("test-result", text, r.reachable ? "ok" : "bad");
    return;
  }
  const url =
    field("set-baseurl").value.trim() || (kind === "ollama" ? "http://localhost:11434" : selectedProfile()?.baseUrl) || "";
  if (!url) {
    setHint("test-result", t("noServerAddress"), "");
    return;
  }
  setHint("test-result", t("checking", { url }));
  const r = await invoke<EndpointCheck>("check_endpoint", { url });
  fillModelList(r.models);
  let text = r.message;
  let tone: "ok" | "bad" = r.reachable ? "ok" : "bad";
  if (r.models.length) {
    const model = field("set-model").value.trim() || selectedProfile()?.model || "";
    text += `\n${t("models", { models: r.models.join(", ") })}`;
    if (model && !hasModel(r.models, model)) {
      text += `\n${t("modelNotOnServer", { model })}`;
      tone = "bad";
    }
  }
  setHint("test-result", text, tone);
}

/** Extensions or tool servers changed while the settings were open: aar is
 * restarted when they close (extensions load at start, servers per session). */
let addonsChanged = false;
const addons = new AddonsView(() => (addonsChanged = true), errText);
const photos = new PhotosView(() => (addonsChanged = true), errText);

function closeSettings() {
  const wasOpen = !settingsView.hidden;
  photos.hide();
  settingsView.hidden = true;
  app.classList.remove("settings-open");
  if (wasOpen && addonsChanged) {
    addonsChanged = false;
    void restartAgent();
  }
}

/** Restart aar with the current settings; the conversation is resumed. */
async function restartAgent() {
  if (busy && sessionId) client.cancel(sessionId);
  await client.stop();
  busy = false;
  addSystem(t("reconnecting"));
  await connect(true);
}

// ---------------------------------------------------------------------------
// Setup wizard (Ollama + model)
// ---------------------------------------------------------------------------

const setupView = $("setup");
const wizard = new SetupWizard({
  show(on) {
    if (on) closeSettings();
    setupView.hidden = !on;
    app.classList.toggle("setup-open", on);
  },
  async done(model, contextWindow) {
    // Prefer a matching profile from the aar config (keeps its extra options);
    // otherwise drive aar with the plain Ollama provider + model.
    const info = await invoke<AarConfigInfo>("aar_config_info", { configPath: null });
    const local = (u: string) => !u || /localhost|127\.0\.0\.1/.test(u);
    const profile = info.profiles.find(
      (p) => p.kind === "ollama" && hasModel([p.model], model) && local(p.baseUrl),
    );
    const current = await invoke<Settings>("get_settings");
    // A profile brings its own num_ctx; the plain provider gets a context size,
    // otherwise Ollama's small default would cut off the prompt.
    const next: Settings = profile
      ? { ...current, provider: profile.key, model: "", baseUrl: "", contextWindow: 0 }
      : { ...current, provider: "ollama", model, baseUrl: "http://localhost:11434", contextWindow };
    await invoke("save_settings", { settings: next });
    if (busy && sessionId) client.cancel(sessionId);
    await client.stop();
    busy = false;
    await connect(true);
    addSystem(t("setupDone", { model }));
    mascot.set("happy", 3000);
  },
  async doneCloud(cfg: CloudSetupResult) {
    const current = await invoke<Settings>("get_settings");
    let next: Settings;
    if (cfg.name || cfg.baseUrl) {
      const existing = [...(current.customProviders ?? [])];
      const displayName = cfg.name || `${kindName(cfg.kind)} (${cfg.model})`;
      const id = slugifyProviderId(displayName, existing);
      existing.push({
        id,
        name: displayName,
        kind: cfg.kind,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
      });
      next = {
        ...current,
        provider: `${CUSTOM_PREFIX}${id}`,
        model: "",
        baseUrl: "",
        contextWindow: 0,
        customProviders: existing,
      };
    } else {
      next = {
        ...current,
        provider: cfg.kind,
        model: cfg.model,
        baseUrl: "",
        contextWindow: 0,
        apiKeys: { ...(current.apiKeys ?? {}), [cfg.kind]: cfg.apiKey },
      };
    }
    await invoke("save_settings", { settings: next });
    if (busy && sessionId) client.cancel(sessionId);
    await client.stop();
    busy = false;
    await connect(true);
    addSystem(t("setupDone", { model: cfg.name ? `${cfg.name} (${cfg.model})` : cfg.model }));
    mascot.set("happy", 3000);
  },
});

async function openSetup() {
  historyView.close();
  await setExpanded(true);
  await wizard.open();
}

// ---------------------------------------------------------------------------
// Conversation list (🕘)
// ---------------------------------------------------------------------------

const historyView = new HistoryView({
  show(on) {
    if (on) closeSettings();
    $("history").hidden = !on;
    app.classList.toggle("history-open", on);
  },
  load: (id) => loadConversation(id),
  current: () => sessionId,
  deletedCurrent: () => localStorage.removeItem(LAST_SESSION_KEY),
});

/** Continue a saved conversation: aar replays it via session/update. */
async function loadConversation(id: string) {
  if (id === sessionId) return;
  if (!client.running || !connected) {
    localStorage.setItem(LAST_SESSION_KEY, id);
    return connect(true);
  }
  if (busy && sessionId) client.cancel(sessionId);
  resolveAllPermissions(null);
  busy = false;
  clearMessages();
  ctx.used = null;
  renderContext();
  sessionId = null;
  early = [];
  try {
    const cwd = await invoke<string>("agent_working_dir");
    const info = await client.loadSession(id, cwd, await mcpServers());
    if (!info) throw new Error(`unknown session ${id}`);
    sessionId = info.sessionId;
    configOptions = info.configOptions;
    flushEarly();
    finishStreaming();
    localStorage.setItem(LAST_SESSION_KEY, sessionId);
    mascot.set("idle");
    scrollDown(true);
  } catch (e) {
    early = null;
    finishStreaming();
    await newChat();
    addError(t("loadFailed"), errText(e));
  }
  updateComposer();
}

function renderSessionOptions() {
  const host = $("session-options");
  host.innerHTML = "";
  if (!connected || !sessionId) {
    host.innerHTML = `<p class="settings-error"></p>`;
    host.firstElementChild!.textContent = t("sessionOptionsOffline");
    return;
  }
  for (const opt of configOptions) {
    if (opt.type !== "select" || !opt.options?.length) continue;
    const label = document.createElement("label");
    label.textContent = optionName(opt.id) ?? opt.name;
    const sel = document.createElement("select");
    for (const o of opt.options) {
      const el = document.createElement("option");
      el.value = o.value;
      el.textContent = (opt.id === "mode" && modeName(o.value)) || o.name;
      if (o.description) el.title = o.description;
      el.selected = o.value === opt.currentValue;
      sel.appendChild(el);
    }
    sel.disabled = busy;
    sel.addEventListener("change", async () => {
      try {
        const updated = await client.setConfigOption(sessionId!, opt.id, sel.value);
        if (updated.length) configOptions = updated;
        else opt.currentValue = sel.value;
        $("settings-error").textContent = "";
      } catch (e) {
        $("settings-error").textContent = t("optionChangeFailed", { name: label.textContent ?? "", error: errText(e) });
      }
    });
    label.appendChild(sel);
    host.appendChild(label);
  }
}

async function saveSettings() {
  if (!loadedSettings) return;
  flushCustomDraft();
  const cp = selectedCustom();
  const kind = selectedKind();
  if (cp) {
    const problem = !cp.name
      ? t("customNameRequired")
      : !cp.apiKey
        ? t("apiKeyRequired", { name: cp.name })
        : cp.kind === "generic" && !cp.baseUrl
          ? t("baseUrlRequired")
          : !cp.model
            ? t("modelRequired")
            : "";
    if (problem) {
      $("settings-error").textContent = problem;
      return;
    }
  } else if (isCloud(kind)) {
    apiKeys[kind] = field("set-apikey").value.trim();
    const problem = !apiKeys[kind]
      ? t("apiKeyRequired", { name: kindName(kind) })
      : kind === "generic" && !field("set-baseurl").value.trim()
        ? t("baseUrlRequired")
        : !field("set-model").value.trim()
          ? t("modelRequired")
          : "";
    if (problem) {
      $("settings-error").textContent = problem;
      return;
    }
  }
  const next: Settings = {
    ...loadedSettings,
    agentCommand: field("set-command").value.trim(),
    agentArgs: splitArgs(field("set-args").value),
    workingDir: field("set-cwd").value.trim(),
    hotkey: field("set-hotkey").value.trim() || "Ctrl+Alt+A",
    provider: providerSelect.value,
    model: cp ? "" : field("set-model").value.trim(),
    baseUrl: cp ? "" : field("set-baseurl").value.trim(),
    configPath: field("set-config").value.trim(),
    desktopControl: field("set-desktop").checked,
    autostart: field("set-autostart").checked,
    language: $<HTMLSelectElement>("set-language").value,
    apiKeys: Object.fromEntries(Object.entries(apiKeys).filter(([, v]) => v)),
    customProviders,
  };
  try {
    await invoke("save_settings", { settings: next });
  } catch (e) {
    $("settings-error").textContent = errText(e);
    return;
  }
  uiSettings = next;
  const keys: (keyof Settings)[] = ["agentCommand", "workingDir", "provider", "model", "baseUrl", "configPath", "desktopControl"];
  const prevCustom = findCustomProvider(loadedSettings.customProviders, loadedSettings.provider);
  const nextCustom = findCustomProvider(next.customProviders, next.provider);
  const restart =
    keys.some((k) => next[k] !== loadedSettings![k]) ||
    next.agentArgs.join("\u0000") !== loadedSettings.agentArgs.join("\u0000") ||
    (isCloud(kind) && next.apiKeys?.[kind] !== loadedSettings.apiKeys?.[kind]) ||
    JSON.stringify(prevCustom ?? null) !== JSON.stringify(nextCustom ?? null);
  applyLanguage(next.language ?? "");
  if (restart) addonsChanged = false; // restarted right below anyway
  closeSettings();
  // Restart aar with the new connection; the conversation is resumed.
  if (restart) await restartAgent();
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function applyLanguage(setting: string) {
  setLang(resolveLang(setting));
}

function translateStatic() {
  applyStatic(t);
  void invoke("set_ui_language", { lang: lang() }).catch(() => undefined);
}

onLangChange(() => {
  translateStatic();
  updateComposer();
  renderContext();
  historyView.rerender();
  if (document.getElementById("suggestions")) showSuggestions();
  if (!settingsView.hidden) {
    renderGrantList($("grant-list"), grants, sessionId, (msg) => ($("settings-error").textContent = msg));
    renderSessionOptions();
    void showVersion();
    void showDiagnosticPaths();
    fillLanguages($<HTMLSelectElement>("set-language").value);
    if (aarConfig) void loadAarConfig(providerSelect.value);
    addons.rerender();
    photos.rerender();
  }
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

sendBtn.addEventListener("click", () => (busy ? stop() : send()));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
});
input.addEventListener("input", () => {
  autoGrow();
  if (!busy && connected && (mascot.current === "idle" || mascot.current === "sleeping")) {
    mascot.set("listening");
  } else if (!busy && !input.value && mascot.current === "listening") {
    mascot.set("idle");
  }
});
input.addEventListener("blur", () => mascot.current === "listening" && mascot.set("idle"));

$("btn-new").addEventListener("click", () => {
  historyView.close();
  void newChat();
});
$("btn-history").addEventListener("click", () => void historyView.toggle());
$("btn-settings").addEventListener("click", () => (settingsView.hidden ? openSettings() : closeSettings()));
$("btn-close").addEventListener("click", () => void setExpanded(false));
$("btn-settings-cancel").addEventListener("click", closeSettings);
$("btn-settings-save").addEventListener("click", () => void saveSettings());
$("btn-settings-done").addEventListener("click", closeSettings);
for (const b of document.querySelectorAll<HTMLElement>("#settings [data-tab]")) {
  b.addEventListener("click", () => showTab(b.dataset.tab as Tab));
}
$("btn-quit").addEventListener("click", () => void invoke("quit_app"));
$("btn-open-sessions").addEventListener("click", () => void openDiagnostic("sessions"));
$("btn-copy-version").addEventListener("click", () => {
  void navigator.clipboard?.writeText($("version-info").textContent ?? "").then(
    () => ($("btn-copy-version").textContent = t("copied")),
    () => undefined,
  );
});
$("btn-open-log").addEventListener("click", () => void openDiagnostic("log"));
$("btn-test").addEventListener("click", () => void testConnection());
$("btn-open-setup").addEventListener("click", () => void openSetup());
$("btn-add-custom").addEventListener("click", () => {
  flushCustomDraft();
  const id = slugifyProviderId("custom", customProviders);
  customProviders.push({ id, name: "", kind: "gemini", model: "", baseUrl: "", apiKey: "" });
  void loadAarConfig(`${CUSTOM_PREFIX}${id}`).then(() => {
    setHint("test-result", "");
    $("settings-error").textContent = "";
    field("set-custom-name").focus();
  });
});
$("btn-delete-custom").addEventListener("click", () => {
  if (!activeCustomId) return;
  customProviders = customProviders.filter((p) => p.id !== activeCustomId);
  activeCustomId = "";
  field("set-model").value = "";
  field("set-baseurl").value = "";
  field("set-apikey").value = "";
  setHint("test-result", "");
  void loadAarConfig("");
});
customKindSelect.addEventListener("change", () => {
  flushCustomDraft();
  const cp = selectedCustom();
  if (!cp) return;
  field("set-baseurl").placeholder = urlPlaceholderFor(cp.kind);
  $("cloud-note").textContent = t("cloudNote", { name: cp.name || kindName(cp.kind) });
});
for (const id of ["set-custom-name", "set-apikey", "set-baseurl", "set-model"]) {
  field(id).addEventListener("input", () => flushCustomDraft());
}
providerSelect.addEventListener("change", () => {
  flushCustomDraft();
  setHint("test-result", "");
  // Model and address belong to the previous choice.
  field("set-model").value = "";
  field("set-baseurl").value = "";
  fillModelList([]);
  updateConnectionPlaceholders();
});
field("set-config").addEventListener("change", () => void loadAarConfig(providerSelect.value));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (historyView.isOpen) historyView.close();
    else if (!setupView.hidden) wizard.close();
    else if (!settingsView.hidden) closeSettings();
    else void setExpanded(false);
  }
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

void listen("ui://toggle", () => void setExpanded(!expanded));
void listen("ui://open", () => void setExpanded(true));
void listen("ui://new-chat", () => void newChat());
void listen("ui://settings", () => void openSettings());
void listen("ui://restart-agent", async () => {
  await client.stop();
  clearMessages();
  void connect();
});

translateStatic();
setupMascotPointer();
setupComposerGrip();
setupResizeGrips();
setupAttachments();
updateComposer();
autoGrow();
// The saved language may differ from the cached one (first start, other PC):
// settle it before the first texts (greeting, errors) are written.
void invoke<Settings>("get_settings")
  .then(async (s) => {
    uiSettings = s;
    grants.load(s.allowedTools);
    applyLanguage(s.language ?? "");
    // aar's rules name the UI language: Rust must know it before aar starts.
    await invoke("set_ui_language", { lang: lang() });
  })
  .catch(() => undefined)
  .finally(() => void connect());
