# Telegram MCP Bridge

[![CI](https://github.com/met44/telegram-mcp-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/met44/telegram-mcp-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen.svg)](https://nodejs.org)

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets long-running AI agent sessions communicate with you via Telegram. Send messages to the agent and receive updates — all from your phone.

**Zero config needed** — the installer handles everything, including Telegram bot creation.

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
┌─────────────┐     Telegram API     ┌──────────────┐     MCP stdio     ┌───────────┐
│  You (phone) │ ◄──────────────────► │  MCP Server   │ ◄────────────────► │  AI Agent  │
└─────────────┘                       └──────────────┘                     └───────────┘
```

The server runs alongside your agent and:
- **Polls Telegram** in the background (long-polling, no webhooks)
- **Queues messages** to disk so nothing is lost
- **Exposes 3 tools** to the agent via MCP

### Tools

| Tool | What it does | Context Cost |
|------|-------------|-------------|
| `check_status` | Returns `{"pending": N}` | ~10 tokens |
| `poll_messages` | Returns new messages (or `[]`) | ~3 tokens when empty |
| `send_message` | Sends a Telegram message to you | ~15 tokens |

### Agent Protocol

The protocol is **embedded in the tool descriptions** — agents follow it automatically with no extra prompting:

1. **Session start** — send a greeting + plan summary
2. **During work** — `check_status` every few minutes; `poll_messages` only when `pending > 0`
3. **Milestones** — send progress updates
4. **Done** — send a final summary

This keeps context usage minimal (~10 tokens per check) while staying responsive.

## Configure

After installation, use the configure command to toggle behavior flags:

```bash
node telegram-mcp-install.js configure
```

This will auto-detect your existing installation and let you interactively toggle:
- **Auto-greet** — send greeting at session start
- **Auto-summary** — send summary when starting new work
- **Auto-end** — send summary when done
- **Auto-poll** — regularly check for user messages

You can also update `server.js` to the latest version from here.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | *(required)* | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | *(required)* | Your Telegram chat ID |
| `TELEGRAM_POLL_INTERVAL` | `2000` | Telegram poll interval (ms) |
| `TELEGRAM_MCP_QUEUE_FILE` | `~/.telegram_mcp_queue.json` | Queue file path |
| `TELEGRAM_MCP_MAX_HISTORY` | `50` | Delivered messages to retain |

### Behavior Flags

All default to **on**. Set to `"false"` in your MCP config's `env` block to disable, or use `node telegram-mcp-install.js configure`.

| Variable | Description |
|----------|-------------|
| `TELEGRAM_AUTO_START` | Greet + plan summary at session start |
| `TELEGRAM_AUTO_END` | Summary when task/session ends |
| `TELEGRAM_AUTO_SUMMARY` | Summary when starting new work |
| `TELEGRAM_AUTO_POLL` | Poll for user messages regularly |

Example — disable auto-polling but keep start/end messages:
```json
"env": {
  "TELEGRAM_BOT_TOKEN": "...",
  "TELEGRAM_CHAT_ID": "...",
  "TELEGRAM_AUTO_POLL": "false"
}
```

## Token Paste Issues

If pasting the bot token crashes your terminal, save it to a text file and enter the file path instead. The installer supports both.

## Development

```
telegram-mcp-bridge/
├── server.js          # MCP server (standalone)
├── install.js         # Installer + configure command
├── build.js           # Builds single-file distributable
├── test/              # Automated tests
│   ├── server.test.js
│   ├── build.test.js
│   └── config.test.js
└── dist/
    └── telegram-mcp-install.js  # Single-file installer (server.js embedded)
```

```bash
npm install            # Install dev dependencies
npm test               # Run all tests
npm run build          # Rebuild distributable
```

### Updating a deployed install

```bash
npm run build
# Windows:
copy server.js %USERPROFILE%\.telegram-mcp-bridge\server.js
# macOS/Linux:
cp server.js ~/.telegram-mcp-bridge/server.js
```

Or use `node telegram-mcp-install.js configure` and select "Update server.js to latest".

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
