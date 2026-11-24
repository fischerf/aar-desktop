# Aar Desktop – User Manual

This manual explains everything Aar Desktop can do and every setting it offers. For a quick overview,
see the [README](../README.md).

**Contents**

1. [Getting started](#1-getting-started)
2. [Talking to Aar](#2-talking-to-aar)
3. [Permissions and working modes](#3-permissions-and-working-modes)
4. [What Aar can do](#4-what-aar-can-do)
5. [Photo search](#5-photo-search)
6. [Extensions](#6-extensions)
7. [Tool servers (MCP)](#7-tool-servers-mcp)
8. [Language models and providers](#8-language-models-and-providers)
9. [All settings at a glance](#9-all-settings-at-a-glance)
10. [Where Aar keeps its data](#10-where-aar-keeps-its-data)
11. [Advanced: using your own aar installation](#11-advanced-using-your-own-aar-installation)
12. [Command line and silent installation](#12-command-line-and-silent-installation)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Getting started

### Installing

> [!WARNING]
> Aar Desktop is an early preview and will contain bugs. Use it only in a virtual machine or test environment
> without productive or personal data.

Download `Aar_<version>_x64-setup.exe` from the [Releases page](../../../releases) and run it.

- The installer first shows the **disclaimer and license** (Apache License 2.0). You use Aar Desktop at your
  own risk; installation continues only after you accept.
- The installer works **for your user account only** and does not need administrator rights.
  The program goes to `%LOCALAPPDATA%\Aar`.
- It brings along **everything Aar needs**: the aar agent, its own Python 3.13 and all required libraries.
  aar is not installed system-wide, so it will not interfere with other Python installations on your PC.
- Aar Desktop needs **Windows 11** (64-bit). WebView2, which draws the chat window, is already part of
  Windows 11.

### The setup assistant

On the first start the setup assistant opens by itself. It goes through four steps:

1. **Check computer** – reads how much memory (RAM) your PC has and which graphics card it uses, including the
   real amount of video memory.
2. **Choose language model** – recommends a model that suits your computer (see
   [Choosing a model](#choosing-a-local-model)). You can pick a different one from the list.
3. **Model server (Ollama)** – if [Ollama](https://ollama.com/) is not installed yet, the assistant installs it
   quietly for your user account (about 2 GB download) and starts it.
4. **Download model** – downloads the chosen model and shows the progress.

You can close the assistant with *Later* and open it again at any time under ⚙ → *General* →
*Setup assistant …*. If you would rather use a cloud provider, skip the assistant and enter your API key under
⚙ → *Language model connection* instead (see [section 8](#8-language-models-and-providers)).

### Starting with Windows

Aar starts automatically when you sign in to Windows. You can turn this off under ⚙ → *General* →
*Start when signing in to Windows*. The uninstaller removes the autostart entry.

### Uninstalling

Open *Settings → Apps → Installed apps* in Windows, find **Aar** and choose *Uninstall*. Data that Aar
downloaded later (extensions, tool servers, the photo index) lives in `%LOCALAPPDATA%\de.aar.ui` and can be
deleted by hand afterwards (see [section 10](#10-where-aar-keeps-its-data)).

---

## 2. Talking to Aar

### The mascot

The eagle sits in the bottom-right corner of your screen, always on top of other windows but not in the
taskbar.

- **Click** the eagle to open or close the chat bubble. **Ctrl+Alt+A** does the same from anywhere
  (the shortcut can be changed under ⚙ → *General* → *Advanced*).
- **Drag** the eagle to move it. Aar remembers the position.
- **Resize** the chat bubble by dragging its edges or the top-left corner.
- **Esc** collapses the chat bubble.

The mascot shows what Aar is doing at the moment. It has ten moods: *ready*, *listening*, *thinking*,
*answering*, *working*, *asking for permission*, *happy*, *problem*, *sleeping* and *offline*.

### The tray icon

Aar also has an icon in the notification area of the taskbar. Its menu offers *Open / close Aar*,
*New conversation*, *Restart agent*, *Settings…* and *Quit*. Only one copy of Aar runs at a time – starting it
again simply brings up the running one.

### Chatting

Type your request into the input field and press **Enter** (**Shift+Enter** starts a new line). You can drag
the small handle above the input field to make it bigger. To speak instead of typing, press **Win+H** – Windows
dictation writes into the input field.

A new conversation shows a few **suggestions** (for example *Today's news* or *Write an invitation*). Click one
to send it right away – a good way to find out what Aar can do.

While Aar works, you see:

- **Its answer**, appearing word by word, with formatting such as lists, tables and code.
- **Thoughts** – what the model is thinking. They are collapsed; click to read them.
- **Tool calls in plain language**, for example *Click "Brush" in Paint* or *Read a file*. Click one to see
  its details (input and result).
- **New files** – when Aar creates or saves files during an answer, they are listed below the answer with
  *Open* and *Show in folder*.

The red stop button cancels the current task. The **＋** button in the header starts a new conversation.
When you start Aar, it continues the last conversation.

**Earlier conversations:** the **☰** button in the header lists your saved conversations, newest first, each
with its first question. Click one to continue it. The 🗑 button deletes a conversation (click twice – the first
click asks *Really delete?*).

**Notifications:** if Aar needs your permission or finishes a longer task (over 20 seconds) while you are
working in another program, Windows shows a notification. Nothing is shown while you are looking at Aar.

### The context indicator

Next to the **＋** button, the header shows the size of the model's memory ("context", e.g. `64k` tokens) and,
after each answer, a bar showing how much of it the current conversation uses. Hover over it for the exact
numbers. The bar turns amber at 70 % and red at 90 %. When the context is full, Aar leaves out older parts of
the conversation – for a fresh start, begin a new conversation.

---

## 3. Permissions and working modes

Aar never changes anything behind your back. Whenever it wants to click, type, start a program, write a file or
run a command, a **permission card** appears:

- **Allow** – do it this one time.
- **Deny** – do not do it; Aar will look for another way or ask you.
- **Allow for this conversation** – Aar may do this kind of action (e.g. *Click*) without asking until you
  start a new conversation.
- **Always allow** – Aar may do this kind of action without asking from now on, also in later conversations.
  Commands, scripts and deleting are never allowed permanently – for them only *Allow for this conversation*
  is offered.

When Aar does something without asking because you allowed it, a small line *Allowed without asking* appears
below the action, with *Revoke* to take the permission back. All permissions are listed under ⚙ → *General* →
*Permissions*, each with *Revoke*, plus *Revoke all*.

Under ⚙ → *General* → *This conversation* you can choose how Aar works in the current conversation:

| Working mode | What happens |
|---|---|
| **Ask first** (recommended) | Aar asks before every change. Reading and looking is allowed without asking. |
| **Work without asking** | Aar carries out all steps on its own. Use this only for tasks you trust. |
| **Read only, change nothing** | Aar may look and read, but must not change anything. |

The same section lets you switch the model and, where the model supports it, how much effort it puts into
reasoning.

---

## 4. What Aar can do

### Operate programs

Aar can see and operate the programs on your PC: start them, read their windows, click buttons, choose menu
entries and type text. It does this through Windows UI Automation – the same interface that screen readers
use. For this, Aar Desktop brings a Windows desktop tool server along and hands it to the agent in every
conversation.

You can switch this ability off under ⚙ → *General* → *Abilities* → *Operate programs on this PC*. Aar can
then still chat, read files and use other tools, but no longer controls your programs.

### Images in the chat

Click 📎, drag an image onto the chat or paste it from the clipboard, then ask about it – *"What is in this
picture?"*, *"Write a caption for my holiday album"*. Up to four images fit into one message. Aar Desktop scales
them down to at most 1280 pixels before sending, which keeps things fast.

The model must be able to understand images. Qwen 3.8, Qwen 3.5 and Gemma 4 can; most cloud models can as well.

### Read documents and web pages

With the optional tool servers *Read documents* and *Read web pages* (see [section 7](#7-tool-servers-mcp))
Aar can read PDF, Word, Excel and PowerPoint files and fetch the text of web pages. With *Operate websites
(Playwright)* or *Chrome DevTools* it can even use a browser for you.

---

## 5. Photo search

Aar can find photos by what is in them: *"Show me all photos with tables"*, *"Find the pictures with a dog"*,
*"Photos taken outdoors with more than three people"*. Results appear as thumbnails in the chat; click one to
open it.

### How it works

1. Under ⚙ → *Photos* choose **Add folder …** and pick the folders Aar may search. Subfolders are included.
   **Only these folders are ever searched.**
2. Click **Describe photos now**. The language model looks at every photo once and writes a short description:
   a sentence, the objects it sees, the number of people, indoors or outdoors, and any visible text.
3. The descriptions are stored in an index on your PC. From then on Aar searches this index, which is fast.

Describing takes a while the first time. As a rough guide from our own tests on a fast graphics card: about
5 seconds per photo with Qwen 3.8 and about 2 seconds with Qwen 3.5 (4B). On a computer without a suitable
graphics card it is considerably slower. You can interrupt at any time with *Pause* – the next run continues
where it left off. New or changed photos are picked up on the next run; photos you deleted disappear from the index.

### Which model describes the photos

By default the chat model also describes the photos. Under *Model that describes the photos* you can pick
another one. Two small models can be downloaded right there, both of which also run without a graphics card:

- **Qwen 3.5 (4B)** – writes detailed, structured descriptions.
- **Moondream 2 (1.8B)** – very small and fast; its descriptions are simpler.

Photos are always described **locally** with Ollama, even if you use a cloud provider for the chat. Your photos
never leave your PC.

### Small images, removing folders, privacy

- Tiny images such as icons, sprites and tiles (any side shorter than 64 pixels) are skipped and counted
  separately. Small screenshots are enlarged for the model so they can still be described.
- **Removing a folder** immediately deletes its entries and thumbnails from the index.
  **Delete index** removes everything.
- Aar does **not** recognize faces. It can count people, but not tell who they are.

The index lives in `%LOCALAPPDATA%\de.aar.ui\photos`.

---

## 6. Extensions

Extensions teach aar new abilities or change how it works – for example a safety gate for risky commands,
automatic Git checkpoints, or extra tools. Under ⚙ → *Extensions* you see the list from the
[aar extension registry](https://github.com/fischerf/aar-extensions-registry) and can install, switch on/off
and remove them.

> ⚠️ Extensions run with your permissions on this PC and can change Aar's behaviour a lot. Only install what
> you really need.

To help you decide, every extension shows **warnings**: curated notes from the registry plus what the
extension actually registers once installed – whether it intervenes in actions, messages or the conversation
history, adds instructions for the model, brings tools with side effects (writing files, running programs) or
adds chat commands. Extensions with risky abilities require a second confirmation.

Extensions are installed into `%LOCALAPPDATA%\de.aar.ui\extensions`, so program updates do not remove them.

---

## 7. Tool servers (MCP)

Tool servers give Aar additional tools using the [Model Context Protocol](https://modelcontextprotocol.io/).
Under ⚙ → *Tools* you find a catalog of ready-to-use servers. Each one opens a small settings dialog when you
add it; you can change the settings later with *Adjust*.

| Tool server | What Aar can do with it |
|---|---|
| **Read web pages** | Fetch web pages and read their text. |
| **Read documents** | Turn PDF, Word, Excel and PowerPoint files into text (large download, about 150 MB). |
| **Time and time zones** | Know the current time and convert between time zones. |
| **Operate websites (Playwright)** | Control a browser (Edge or Chrome): open pages, click, fill in forms. |
| **Chrome DevTools** | Control and inspect Chrome like with the developer tools: pages, console, network, performance. |
| **Memory** | Remember facts across conversations. |

Some servers are written in Python, others in Node.js. For Node.js servers, Aar downloads a portable Node.js
the first time it is needed (checked with a SHA-256 checksum) – you do not need to install it yourself.

**Your own servers:** under *Add your own server* you can add any MCP server, either as a *Program on this PC*
(program, arguments, environment variables) or as a *Web address* (URL and HTTP headers).

If a tool server fails to start, the others keep working and Aar tells you in the chat which one is
unavailable.

> Text on web pages may try to give Aar instructions. Check results from the web critically.

---

## 8. Language models and providers

### Choosing a local model

The setup assistant recommends one of these models:

| Model | Download | Recommended for |
|---|---|---|
| **Qwen 3.8 (27B)** | about 18 GB | Best quality. Needs a graphics card with at least 20 GB of video memory. |
| **Gemma 4 (E4B)** | about 7 GB | Balanced. Runs on a graphics card with 8 GB or without one on a PC with 12 GB of RAM or more. |
| **Qwen 3.5 (4B)** | about 3 GB | Small and fast, for less powerful computers. |

Larger models handle complex desktop tasks much more reliably. How fast a model answers depends strongly on
your hardware; the figures above are guidelines, not guarantees.

We tested the four start suggestions of the empty chat with each model:

| Suggestion | Gemma 4 (E4B) | Qwen 3.5 (4B) | Qwen 3.8 (27B) |
|---|---|---|---|
| 📰 Today's news | ✅ | ✅ | ✅ |
| 🎨 Paint a picture | sometimes | sometimes | ✅ |
| 📁 Look at my downloads | ✅ | ✅ | ✅ |
| ✉️ Write an invitation | ✅ | ✅ | ✅ |

The small models are fine for looking things up, listing files and writing texts. For operating programs such as
Paint, use Qwen 3.8. With a graphics card, a request takes from a few seconds to a few minutes. Without one, the small
models take about 4 to 30 times longer.

### Using a cloud provider

Under ⚙ → *General* → *Language model connection* → *Profile / provider* you can choose:

- a **profile** from your aar configuration (`~/.aar/config.json`), or
- a **provider**: Ollama, Anthropic, OpenAI, Google Gemini or any OpenAI-compatible service.

For cloud providers, enter your **API key**. *Test* checks the key and lists the available models; for Ollama it
checks that the server is reachable and which models are installed. You can also override the server address
and the model.

Your API key is stored in Aar's settings and passed to the agent only as an environment variable
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or `GENERIC_API_KEY`). Aar Desktop never changes your
aar configuration file.

---

## 9. All settings at a glance

Open the settings with ⚙ in the header of the chat bubble.

**General**

| Section | Settings |
|---|---|
| This conversation | Working mode, model and reasoning effort for the current conversation |
| Abilities | *Operate programs on this PC*; *Start when signing in to Windows* |
| Permissions | What Aar may do without asking (always / this conversation), each with *Revoke*; *Revoke all* |
| Language | Display language: automatic (same as Windows), English, German or Simplified Chinese |
| Language model connection | Profile / provider, API key, server address, model, *Test*, *Setup assistant …* |
| Advanced | aar configuration file, agent program, arguments, working folder, keyboard shortcut |
| Troubleshooting | *Show conversation history*, *Show log*, copy version details, *Quit Aar* |

**Extensions** – install, switch on/off and remove extensions ([section 6](#6-extensions)).

**Tools** – your tool servers, the catalog and your own servers ([section 7](#7-tool-servers-mcp)).

**Photos** – photo folders, the describing model and the photo index ([section 5](#5-photo-search)).

The settings are saved in `%APPDATA%\de.aar.ui\settings.json`.

---

## 10. Where Aar keeps its data

| What | Where |
|---|---|
| The program | `%LOCALAPPDATA%\Aar` |
| Settings | `%APPDATA%\de.aar.ui\settings.json` |
| Your own instructions for Aar (optional) | `%APPDATA%\de.aar.ui\rules.md` – plain text, e.g. "Address me formally" or "Save documents in D:\Office"; used from the next start |
| Conversations | `<working folder>\.agent\sessions` (by default in your user folder) |
| Log (warnings and errors) | `%LOCALAPPDATA%\de.aar.ui\logs\aar.log` |
| Extensions | `%LOCALAPPDATA%\de.aar.ui\extensions` |
| Tool servers | `%LOCALAPPDATA%\de.aar.ui\mcp\<id>` |
| Tool server data (e.g. Memory) | `%LOCALAPPDATA%\de.aar.ui\mcp-data\<id>` – deleted when you remove the server |
| Portable Node.js | `%LOCALAPPDATA%\de.aar.ui\node` |
| Photo index and thumbnails | `%LOCALAPPDATA%\de.aar.ui\photos` |

Everything Aar downloads after installation lives outside the program folder, so updates keep it.

**Privacy:** with a local model, nothing you type, no file and no photo leaves your PC. With a cloud provider,
your messages and the content Aar reads for a task are sent to that provider. Photo descriptions are always
made locally.

---

## 11. Advanced: using your own aar installation

By default Aar Desktop uses the aar that comes with it. If you develop aar yourself or want a specific version,
enter your own program under ⚙ → *General* → *Advanced* → *Agent program*, for example
`C:\Python312\Scripts\aar.exe`. Leave the field empty to use the bundled aar again.

Extensions and tool servers are always installed with **the Python that runs aar** – the bundled one, or the
Python that belongs to your agent program (`…\Scripts\aar.exe` → `…\python.exe`). The *Extensions* tab then
shows which Python is used. The small helper programs Aar Desktop needs for this are built into the program and
written to `%LOCALAPPDATA%\de.aar.ui\helpers` when required.

---

## 12. Command line and silent installation

| Command | Purpose |
|---|---|
| `Aar_<version>_x64-setup.exe /S` | Install silently, without any dialogs |
| `aar-desktop.exe --diagnose <file.json>` | Write a diagnosis (hardware, Ollama, agent) to a JSON file |
| `aar-desktop.exe --setup <log> [model]` | Run the setup unattended (install Ollama, download the model) and log to `<log>` |

---

## 13. Troubleshooting

**Aar does not answer or says the language model cannot be reached.**
After starting, Aar checks the language model first (*checking language model…*) and only then says *ready*;
if something is wrong, the header shows *not ready* and a card explains why. If Ollama is installed but not
running, Aar starts it by itself (only its icon appears in the notification area). Otherwise open the setup
assistant again. For cloud providers, check the API key with *Test* under ⚙ → *Language model connection*.

**"The model … does not exist on the server."**
The card offers *Use … instead* for models that are on the server, and for a local Ollama *Download …* with
a progress bar. You can also choose another model under ⚙ → *Language model connection*.

**Aar stopped in the middle of a task.**
It may have reached its step limit. Write *continue* and it carries on.

**A tool server is reported as unavailable.**
Open ⚙ → *Tools*, check its settings with *Adjust* or remove and add it again.

**Aar is slow.**
Use a smaller model, or check that the model runs on the graphics card (the setup assistant shows it). While
photos are being described, chat answers can be slower.

**Reporting a problem.**
Under ⚙ → *General* → *Troubleshooting* you can open the log and copy the version details. Please include both
when you report a problem.
