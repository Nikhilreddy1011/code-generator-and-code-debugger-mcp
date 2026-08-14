# AI Code Generator & Debugger (MCP Server)

An AI-powered **Model Context Protocol (MCP) server** that gives any MCP-compatible AI client — **Cursor**, **Claude Desktop**, **Claude Code** — two reliable tools backed by **Google Gemini**: generate code from a plain-English task, and debug broken code with an explanation and a fix.

It runs as a local Node.js process, talks to your AI editor over stdio using the MCP protocol, and calls the Gemini API on your behalf using your own API key. Nothing runs on a remote server — the only network call it makes is to Google's Gemini API.

---

## 📖 Table of Contents

- [What is MCP?](#-what-is-mcp)
- [What does this particular server do?](#-what-does-this-particular-server-do)
- [Features](#-features)
- [Available Tools](#-available-tools)
- [Architecture](#-architecture)
- [Reliability Details](#-reliability-details)
- [Project Structure](#-project-structure)
- [How to Clone This Repo](#-how-to-clone-this-repo)
- [Installation](#️-installation)
- [Environment Setup](#-environment-setup)
- [How to Run the Server](#️-how-to-run-the-server)
- [How to Use It](#-how-to-use-it)
- [Cursor MCP Configuration](#-cursor-mcp-configuration)
- [Claude Desktop MCP Configuration](#-claude-desktop-mcp-configuration)
- [Troubleshooting](#-troubleshooting)
- [Tech Stack](#-tech-stack)
- [Future Improvements](#-future-improvements)
- [License](#-license)
- [Author](#-author)

---

## 🧩 What is MCP?

**Model Context Protocol (MCP)** is an open protocol (created by Anthropic) that standardizes how AI applications connect to external tools, data, and services. Before MCP, every AI app invented its own plugin format; a tool built for one app couldn't be reused in another.

MCP fixes that with a simple client/server split:

- An **MCP server** exposes a fixed set of **tools** (functions) with a name, description, and JSON input schema.
- An **MCP client** (built into apps like Cursor, Claude Desktop, or Claude Code) discovers those tools, lets the AI model call them with structured arguments, and feeds the result back into the conversation.

Communication happens over a transport — most commonly **stdio** (the client spawns the server as a subprocess and talks to it over stdin/stdout using JSON-RPC 2.0), which is exactly what this project uses.

```
AI Client  <── JSON-RPC over stdio ──>  MCP Server  <── HTTPS ──>  External API / data / tool
(Cursor)                                (this project)             (Google Gemini)
```

Because the protocol is standardized, **you write the server once** and it works in any MCP-compatible client, without changing a line of the server's code.

---

## 🎯 What does this particular server do?

This server plugs Google Gemini into your editor's AI chat as two purpose-built tools, instead of relying on whatever the editor's built-in model does by default:

1. **`generate_code`** — turn a plain-English task description into clean, commented, working code.
2. **`debug_code`** — take broken code (optionally with an error message) and get back an explanation of the bug plus a corrected version.

Why use an MCP server for this instead of just asking the chat directly?

- **Consistent prompting** — every call goes through the same carefully-worded prompt template, so results are more structured and predictable than ad-hoc chat messages.
- **Your own model/key** — you control exactly which Gemini model is used (`gemini-2.5-flash` by default) and your usage is billed to your own API key, independent of the editor's built-in AI subscription.
- **Built-in reliability** — automatic retries on transient Gemini errors, timeouts, and clear error messages instead of the request silently failing (see [Reliability Details](#-reliability-details)).
- **Reusable across clients** — the same server works in Cursor, Claude Desktop, or any other MCP client, with no code changes.

---

## 🚀 Features

- 🔧 **Code Generation** — clean, well-commented code for any programming task, in any language.
- 🐞 **Code Debugging** — analyzes buggy code, explains the root cause, and returns a corrected version.
- 🤖 **AI Powered** — uses Google Gemini (`gemini-2.5-flash` by default, configurable).
- 🔌 **MCP Compatible** — works with any MCP client (Cursor, Claude Desktop, Claude Code, etc.).
- 🔁 **Automatic retries** — transient Gemini `429`/`5xx` errors are retried with exponential backoff instead of failing the request.
- ⏱ **Request timeout** — a hung call is aborted instead of blocking the client indefinitely.
- ✅ **Input validation** — malformed tool calls fail fast with a clear message via [Zod](https://zod.dev/).
- 🧯 **Fail-fast startup** — the server refuses to start (with a clear message) if `GEMINI_API_KEY` is missing.

---

## 🧠 Available Tools

### 1. `generate_code`

Generates code for a given programming task.

**Input schema**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | ✅ | The programming task to generate code for. |

**Example call**

```json
{
  "prompt": "Write a Python binary search function"
}
```

**Example output**

```python
def binary_search(arr, target):
    left = 0
    right = len(arr) - 1

    while left <= right:
        mid = (left + right) // 2

        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1

    return -1
```

---

### 2. `debug_code`

Analyzes faulty code and provides a corrected version with an explanation.

**Input schema**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `code` | string | ✅ | The code that needs debugging. |
| `errorMessage` | string | ❌ | The error message you got, if any — helps the model pinpoint the bug faster. |

**Example call**

```json
{
  "code": "def add(a,b)\nreturn a+b",
  "errorMessage": "SyntaxError expected ':'"
}
```

**Example output**

```
The error `SyntaxError: expected ':'` occurs because Python requires a colon
after a function signature to begin its body.

def add(a, b):
    return a + b
```

---

## 🏗 Architecture

```
Your AI Client (Cursor / Claude Desktop / Claude Code)
        │
        │  spawns as a subprocess, talks over stdin/stdout
        ▼
MCP Server — mcp-server.js (Node.js, this repo)
        │  1. Validates the tool call arguments (Zod)
        │  2. Builds a Gemini prompt
        │  3. Calls the Gemini API (with retry + timeout)
        │  4. Extracts the text from the response
        ▼
Google Gemini API (gemini-2.5-flash by default)
        │
        ▼
Generated / debugged code, returned to the client
```

The server only speaks the MCP protocol over **stdio** — it does not open an HTTP port and does not accept connections from the network. The only outbound call it ever makes is to `generativelanguage.googleapis.com` (the Gemini API), authenticated with your `GEMINI_API_KEY`.

---

## 🛡 Reliability Details

Earlier versions of this server would silently fail or return nothing under two common conditions. Both are now handled:

1. **Transient Gemini errors (`429` rate limit, `500`/`502`/`503`/`504`)** — automatically retried up to `GEMINI_MAX_ATTEMPTS` times (default `4`) with exponential backoff and jitter (~1s, 2s, 4s). Non-retryable errors (bad API key, invalid model, safety block) fail immediately with a clear message instead of retrying pointlessly.
2. **Empty responses (`response.text` is `undefined`)** — this happens when Gemini's "thinking" step consumes the whole output token budget before writing any visible text, or when a request is blocked by safety filters. The server now detects each case and returns a specific, actionable error (e.g. *"the model hit the output limit... raise GEMINI_MAX_OUTPUT_TOKENS"*) instead of sending an invalid empty tool result.

A per-request timeout (`GEMINI_TIMEOUT_MS`, default 120s) also guarantees a hung request can never block your editor's chat indefinitely.

---

## 📁 Project Structure

```
mcp-code-assistant
│
├── mcp-server.js       # The MCP server — entry point, all tool logic
├── package.json        # Dependencies + npm start script
├── package-lock.json
├── .env                # Your local secrets (GEMINI_API_KEY) — never committed
├── .gitignore
└── README.md
```

---

## 📥 How to Clone This Repo

You need [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) (v18 or later — this project uses native `fetch`/ESM) installed first.

**1. Clone it:**

```bash
git clone https://github.com/Nikhilreddy1011/code-generator-and-code-debugger-mcp.git
```

**2. Move into the project folder:**

```bash
cd code-generator-and-code-debugger-mcp
```

**3. Confirm you're in the right place** — you should see `mcp-server.js` and `package.json`:

```bash
ls
```

That's it — you now have a local copy. Continue to [Installation](#️-installation) below.

> To get your own copy under your GitHub account instead of cloning this one directly, click **Fork** on the GitHub repo page first, then clone your fork's URL instead.

---

## ⚙️ Installation

Install the project's dependencies with npm:

```bash
npm install
```

This installs:

| Package | Purpose |
| --- | --- |
| `@modelcontextprotocol/sdk` | Implements the MCP server protocol (stdio transport, JSON-RPC). |
| `@google/genai` | Official Google Gemini SDK. |
| `dotenv` | Loads `GEMINI_API_KEY` / `GEMINI_MODEL` from a local `.env` file. |
| `zod` | Validates tool call arguments at runtime. |

---

## 🔑 Environment Setup

Create a file named **`.env`** in the project root (same folder as `mcp-server.js`):

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

**Where to get a Gemini API key:** [Google AI Studio](https://aistudio.google.com/apikey) → "Create API key" → copy it into `.env`.

The server checks for `GEMINI_API_KEY` at startup and exits immediately with a clear message if it's missing — it will never silently run without one.

> **⚠️ Never commit your `.env` file.** It's already listed in `.gitignore`, so `git add .` won't pick it up — but always double-check `git status` before pushing if you ever add secrets by hand.

### Optional tuning variables

All of these are optional — sensible defaults are used if you don't set them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Which Gemini model to use. |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192` | Output cap per response. Raise it if long files get cut off. |
| `GEMINI_THINKING_BUDGET` | `2048` | Tokens Gemini 2.5 may spend on internal reasoning before writing the answer. |
| `GEMINI_TIMEOUT_MS` | `120000` | Milliseconds before a stuck request is aborted. |
| `GEMINI_MAX_ATTEMPTS` | `4` | Retry attempts for transient `429`/`5xx` errors, with exponential backoff. |

---

## ▶️ How to Run the Server

**Standalone (to confirm it starts correctly):**

```bash
npm start
```

or directly:

```bash
node mcp-server.js
```

You should see:

```
MCP Code Assistant Server Started (model: gemini-2.5-flash, maxOutputTokens: 8192, thinkingBudget: 2048)
```

This means the server booted, loaded your API key, and is now idle, waiting on stdin for an MCP client to connect. **This is normal** — it's not meant to print anything else or accept typed input; it only speaks JSON-RPC to a real MCP client. Press `Ctrl+C` to stop it.

> In everyday use you will **not** run this command yourself — your AI editor (Cursor, Claude Desktop) spawns the server automatically once it's registered in its MCP config, and manages its lifecycle for you.

---

## 🧑‍💻 How to Use It

Once the server is registered with your client (see the config sections below), you use it entirely through your editor's normal AI chat — there is no separate UI.

1. **Open your AI client's chat** (e.g. Cursor's chat/agent panel).
2. **Ask for what you want in plain English.** The AI recognizes when a request matches one of this server's tools (based on the tool's name/description) and calls it automatically:
   - *"Generate a Python binary search function"* → calls `generate_code`.
   - *"Debug this code"* + pasted/selected broken code → calls `debug_code`.
3. **Watch for the tool-call indicator** — most clients show a small card like `code-assistant: generate_code` in the chat before the result appears, confirming the request went through your Gemini-backed server rather than the editor's built-in model.
4. **Explicit invocation** also works if the client supports it, e.g. *"Use the debug_code tool on this snippet: ..."*.

**Tips for `debug_code`:** pasting the actual error message/stack trace alongside the code (the `errorMessage` field) produces much more accurate fixes than code alone.

---

## 🔗 Cursor MCP Configuration

1. Open Cursor → **Settings → MCP** (or edit `~/.cursor/mcp.json` directly).
2. Add this entry, replacing the path with the actual location of your cloned `mcp-server.js`:

```json
{
  "mcpServers": {
    "code-assistant": {
      "command": "node",
      "args": [
        "C:\\path\\to\\mcp-code-assistant\\mcp-server.js"
      ]
    }
  }
}
```

3. **Restart Cursor.** You should see `code-assistant` listed as connected in the MCP settings panel, with `generate_code` and `debug_code` shown as its available tools.

---

## 🖥 Claude Desktop MCP Configuration

The same server works unchanged in Claude Desktop. Edit its config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "code-assistant": {
      "command": "node",
      "args": [
        "C:\\path\\to\\mcp-code-assistant\\mcp-server.js"
      ]
    }
  }
}
```

Restart Claude Desktop, then look for the 🔌/tools icon in the chat box to confirm `code-assistant` is connected.

---

## 🩺 Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Server exits immediately with `FATAL: GEMINI_API_KEY is not set` | Missing/misnamed `.env` | Create `.env` in the project root with `GEMINI_API_KEY=...`. |
| Tool call returns `Debugging failed: {"error":{"code":503...}}` | Gemini is temporarily overloaded | The server already retries this automatically (up to `GEMINI_MAX_ATTEMPTS` times); if it still fails, wait a minute and try again. |
| `...the model hit the output limit (8192 tokens)...` | Response was too long/complex for the token cap | Ask for a smaller piece of code, or raise `GEMINI_MAX_OUTPUT_TOKENS` in `.env`. |
| `...the request was blocked by Gemini safety filters...` | Prompt or code tripped Gemini's safety filters | Rephrase the request. |
| Client shows the server as disconnected/red | Wrong path in the MCP config, or Node.js not on `PATH` | Verify the `args` path points at your actual `mcp-server.js`, and that `node --version` works from a regular terminal. |
| `npm audit` reports vulnerabilities | Transitive dependencies of `@modelcontextprotocol/sdk`'s optional HTTP transport (unused by this server, which is stdio-only) | Run `npm audit fix` — safe, does not change direct dependency versions. |

---

## 🛠 Tech Stack

- **Node.js** (ESM, native `fetch`)
- **Model Context Protocol** (`@modelcontextprotocol/sdk`)
- **Google Gemini API** (`@google/genai`)
- **Zod** for runtime input validation
- Works with **Cursor**, **Claude Desktop**, **Claude Code**, and any other MCP-compatible client

---

## 📌 Future Improvements

- Code explanation tool
- Code optimization tool
- Language conversion (Python ⇄ Java ⇄ C++)
- Unit test generation

---

## 📄 License

This project is open-source and available under the **MIT License**.

---

## 👨‍💻 Author

Developed by **Nikhil Reddy**
Computer Science Engineering Student
