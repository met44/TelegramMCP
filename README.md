# Telegram MCP Bridge v2

[![CI](https://github.com/met44/telegram-mcp-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/met44/telegram-mcp-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen.svg)](https://nodejs.org)

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets AI agents communicate with you via Telegram. Supports **multiple machines and agents** simultaneously with session isolation. Includes a **Telegram Mini App** for managing sessions from your phone.

**Zero config needed** — the installer handles everything, including Telegram bot creation.

## What's New in v2.1

- **Session isolation** — Each MCP server instance gets a unique `session_id` and its own Telegram topic + queue file. Multiple agents in the same software (e.g. Windsurf) no longer share messages.
- **`session_id` in responses** — Every `interact()` response includes `session_id` so agents always know which session they belong to.
- **Topic-based routing** — Incoming Telegram messages are routed to the correct session's queue based on their forum topic, preventing cross-session leakage.

## What's New in v2

- **Single `interact` tool** — replaces 4 separate tools (send/poll/check/wait). One call does it all.
- **Multi-machine support** — run agents on multiple machines, each with its own session. Messages are broadcast to all active sessions.
- **Timestamp-aware polling** — agents can distinguish fresh replies from stale messages using `since_ts`.
- **Telegram Mini App** — manage sessions, view chat history, and send messages from a web UI inside Telegram.
- **Auto CI/CD** — GitHub Actions runs tests on 3 OSes × 3 Node versions, then deploys the webapp to GitHub Pages.

## Quick Install

Download [`telegram-mcp-install.js`](dist/telegram-mcp-install.js) and run:

```bash
node telegram-mcp-install.js
```

The installer will:
1. Check prerequisites (Node.js 18+, npm)
2. Ask which agent/IDE you use
3. Walk you through Telegram bot creation (opens BotFather)
4. Auto-detect your Chat ID
5. Install the MCP server + dependencies
6. Inject config into your agent's MCP config (with backup)
7. Send a test message to confirm it works

### Supported Agents

| Agent | Config Location |
|-------|----------------|
| **Claude Code** | `~/.claude.json` |
| **Claude Desktop** | Platform-specific |
| **Cursor** | `~/.cursor/mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code (Copilot)** | `.vscode/mcp.json` (workspace-level) |
| **Gemini CLI** | `~/.gemini/settings.json` |
| **Cline** | `~/.cline/mcp_config.json` |

## How It Works

```
                                    Forum Group (Topics)
                                    ┌──────────────────────────┐
┌─────────────┐   Telegram API      │  📋 General (broadcast)   │
│  You (phone) │ ◄────────────────► │  💬 Topic: PC-A/cascade   │ ◄──► MCP Server A ◄──► Agent A
│              │                    │  💬 Topic: Laptop/agent   │ ◄──► MCP Server B ◄──► Agent B
│  Mini App    │                    │  💬 Topic: Server/worker  │ ◄──► MCP Server C ◄──► Agent C
└─────────────┘                    └──────────────────────────┘
```

Each agent session gets its own **Telegram Forum Topic**:
- **Reply in a topic** → only that agent receives your message
- **Post in General** → broadcast to all active agents
- **Full isolation** — no message mixing between sessions
- **Native Telegram UI** — topics are a built-in Telegram feature

## The `interact` Tool

One tool replaces the old send/poll/check/wait pattern:

```
interact({ message?, wait?, since_ts? })
→ { ok, now, session_id, messages: [{text, ts}] }
```

| Parameter | Description |
|-----------|-------------|
| `message` | *(optional)* Text to send to user via Telegram (Markdown) |
| `wait` | *(optional)* Seconds to block waiting for a reply (0–300) |
| `since_ts` | *(optional)* Only return messages newer than this timestamp |

| Response field | Description |
|----------------|-------------|
| `now` | Server timestamp — pass as `since_ts` on next call |
| `session_id` | Your unique session identifier (stable across calls) |
| `messages` | Array of new messages `[{text, ts}]` |
| `pending` | Remaining unread messages after this call |
| `sent` | Whether the message was sent (only if `message` was provided) |

### Why One Tool?

- **No forgotten polls** — every call checks for messages, even when sending
- **No stale messages** — `since_ts` lets agents ignore messages from before their question
- **Minimal context** — empty check costs ~15 tokens; no separate check→poll dance
- **Blocking waits** — `wait=120` holds the call server-side, no rapid polling loops

### Example Agent Flow

```
1. interact({message: "Starting task: refactor auth module"})
   → {ok:true, sent:true, messages:[], pending:0, now:1700000000}

2. ... agent works for a while ...

3. interact({since_ts: 1700000000})                    // routine check
   → {ok:true, messages:[], pending:0, now:1700000060}

4. interact({message: "Done! Summary: ...", wait: 120, since_ts: 1700000060})
   → {ok:true, sent:true, messages:[{text:"looks good!", ts:1700000100}], pending:0, now:1700000120}
```

## Multi-Machine Support

Each MCP server instance registers as a **session** and auto-creates its own **Forum Topic** in the group. The topic is named after the machine/agent label (e.g. `🤖 WorkPC/cascade`).

Configure per-instance identity via env vars:

```json
"env": {
  "TELEGRAM_BOT_TOKEN": "...",
  "TELEGRAM_CHAT_ID": "...",
  "TELEGRAM_MACHINE_LABEL": "WorkPC",
  "TELEGRAM_AGENT_LABEL": "cascade"
}
```

- **Reply in a topic** → only that session's agent receives the message
- **Post in General** → broadcast to all active sessions
- Topics are reused across restarts (same machine/agent label = same topic)

### Telegram Commands (in General topic)

- `/start` — Show bridge info and active sessions
- `/sessions` — List all sessions with status

### Setup Requirements

The bot needs to be in a **supergroup with Topics enabled** and have **admin rights** with at least:
- **Manage Topics** — to create topics for new sessions
- The installer guides you through this setup step-by-step

## Telegram Mini App

A lightweight dashboard deployed to GitHub Pages, accessible as a Telegram Mini App.

**Features:**
- View group connection status
- Send messages to specific session topics or broadcast to General
- Quick-access control panel inside Telegram
- Native Telegram Mini App integration (theme colors, safe areas)

Per-session conversations happen natively in Telegram Topics — the Mini App is a convenience overlay for quick actions.

Access it by setting up a [Telegram Mini App](https://core.telegram.org/bots/webapps) via BotFather, pointing to your GitHub Pages URL.

## Configure

After installation, use the configure command to toggle behavior flags:

```bash
node telegram-mcp-install.js configure
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | *(required)* | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | *(required)* | Your Telegram chat ID |
| `TELEGRAM_SESSION_ID` | *(auto-generated)* | Unique session identifier |
| `TELEGRAM_MACHINE_LABEL` | *(hostname)* | Machine name shown in messages |
| `TELEGRAM_AGENT_LABEL` | `agent` | Agent name shown in messages |
| `TELEGRAM_MCP_DATA_DIR` | `~/.telegram-mcp-bridge/data` | Data directory for queues |
| `TELEGRAM_POLL_INTERVAL` | `2000` | Telegram poll interval (ms) |
| `TELEGRAM_MCP_MAX_HISTORY` | `200` | Delivered messages to retain |

### Behavior Flags

All default to **on**. Set to `"false"` to disable.

| Variable | Description |
|----------|-------------|
| `TELEGRAM_AUTO_START` | Greet + plan summary at session start |
| `TELEGRAM_AUTO_END` | Summary when task/session ends |
| `TELEGRAM_AUTO_SUMMARY` | Summary when starting new work |
| `TELEGRAM_AUTO_POLL` | Poll for user messages regularly |

### Legacy Compatibility

The old 4-tool interface (`send_message`, `poll_messages`, `check_status`, `wait_for_reply`) still works via built-in legacy handlers. Existing agents will continue to function without changes.

## Development

```
telegram-mcp-bridge/
├── server.js          # MCP server (standalone, unified interact tool)
├── install.js         # Installer + configure command
├── build.js           # Builds single-file distributable
├── verify.js          # Verifies embedded base64 matches source
├── webapp/            # Telegram Mini App (static SPA)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── test/              # Automated tests
│   ├── server.test.js
│   ├── build.test.js
│   └── config.test.js
├── .github/workflows/
│   └── ci.yml         # CI + GitHub Pages deploy
└── dist/
    ├── telegram-mcp-install.js
    └── server.js.sha256
```

```bash
npm install            # Install dev dependencies
npm test               # Run all tests (46 tests)
npm run build          # Rebuild distributable
npm run verify         # Verify embedded code matches source
```

### Quick Deploy

Run the interactive installer:

```bash
# Windows
deploy.bat

# macOS/Linux  
./deploy.sh
```

The installer will walk you through:
- Bot token creation (or existing token)
- Chat ID detection
- Agent configuration

### CI/CD

On push to `main`:
1. **Tests** run on Ubuntu/Windows/macOS × Node 18/20/22
2. **Syntax check** validates all JS files
3. **Webapp deploys** to GitHub Pages automatically

## Uninstall

- **Windows**: `%USERPROFILE%\.telegram-mcp-bridge\uninstall.bat`
- **macOS/Linux**: `~/.telegram-mcp-bridge/uninstall.sh`
- Then remove `"telegram-bridge"` from your agent's MCP config

## Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Run `npm test` to verify
4. Submit a PR

## License

[MIT](LICENSE)
