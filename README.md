# Telegram MCP Bridge

A Model Context Protocol (MCP) server that lets long-running AI agent sessions communicate with you via Telegram. Send messages to the agent and receive updates — all from your phone.

## Quick Install

```bash
node telegram-mcp-install.js
```

That's it. The installer handles everything:
1. Checks prerequisites (Node.js 18+, npm)
2. Asks which agent/IDE you use (Claude, Windsurf, Cursor, Gemini, VS Code, Cline)
3. Guides you through Telegram bot creation (opens BotFather automatically)
4. Auto-detects your Chat ID (just send a message to your bot)
5. Installs the MCP server + dependencies
6. Injects the config into your agent's MCP config file (with backup)
7. Sends a test message to confirm it works

### Supported Agents
- **Claude Code** — `~/.claude.json`
- **Claude Desktop** — platform-specific config
- **Cursor** — `~/.cursor/mcp.json`
- **Windsurf** — `~/.codeium/windsurf/mcp_config.json`
- **VS Code (Copilot)** — `.vscode/mcp.json` (workspace-level, manual)
- **Gemini CLI** — `~/.gemini/settings.json`
- **Cline** — `~/.cline/mcp_config.json`

## How It Works

### Architecture
```
┌─────────────┐     Telegram API     ┌──────────────┐     MCP stdio     ┌───────────┐
│  You (phone) │ ◄──────────────────► │  MCP Server   │ ◄────────────────► │  AI Agent  │
└─────────────┘                       └──────────────┘                     └───────────┘
```

The MCP server runs alongside your agent and:
- **Polls Telegram** in the background for your messages (long-polling, no webhooks needed)
- **Queues messages** to disk so nothing is lost between polls
- **Exposes 3 tools** to the agent via MCP

### Tools

| Tool | Description | Context Cost |
|------|-------------|-------------|
| `check_status` | Returns `{"pending": N}` | ~10 tokens |
| `poll_messages` | Returns new messages (or `[]`) | ~3 tokens when empty |
| `send_message` | Sends a Telegram message to you | ~15 tokens |

### Polling Protocol (for agents)

The protocol is embedded directly in the tool descriptions — agents follow it automatically:
1. `send_message` at session start with a greeting + plan summary
2. `check_status` at least every few minutes (cheap — just a number)
3. `poll_messages` only when `pending > 0`
4. `send_message` on milestones and when done

This keeps context usage minimal while maintaining responsiveness.

## Agent Prompt

After installing, add the contents of `~/.telegram-mcp-bridge/AGENT_PROMPT.md` to your system prompt (e.g., `CLAUDE.md`, `.cursorrules`, `GEMINI.md`).

## Token Paste Issues

If pasting the bot token crashes your terminal, save it to a text file and enter the file path instead. The installer supports both.

## Development

```
TelegramMCP/
├── server.js          # The MCP server (standalone, readable)
├── install.js         # Installer source (uses adjacent server.js)
├── build.js           # Builds the single-file distributable
└── dist/
    └── telegram-mcp-install.js  # Single-file installer (server.js embedded as base64)
```

To rebuild after editing `server.js`:
```bash
node build.js
```

## Uninstall

- **Windows**: Run `%USERPROFILE%\.telegram-mcp-bridge\uninstall.bat`
- **macOS/Linux**: Run `~/.telegram-mcp-bridge/uninstall.sh`
- Then remove `"telegram-bridge"` from your agent's MCP config

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | (required) | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | (required) | Your Telegram chat ID |
| `TELEGRAM_POLL_INTERVAL` | `2000` | Telegram poll interval in ms |
| `TELEGRAM_MCP_QUEUE_FILE` | `~/.telegram_mcp_queue.json` | Message queue file path |
| `TELEGRAM_MCP_MAX_HISTORY` | `50` | Max delivered messages to keep |

### Behavior Flags

All default to **on**. Set to `"false"` in your MCP config's `env` block to disable.

| Variable | Description |
|----------|-------------|
| `TELEGRAM_AUTO_START` | Send greeting + plan summary at session start |
| `TELEGRAM_AUTO_END` | Send summary when task/session ends |
| `TELEGRAM_AUTO_SUMMARY` | Send summary when starting new work |
| `TELEGRAM_AUTO_POLL` | Auto-poll for user messages regularly |

Example — disable auto-polling but keep start/end messages:
```json
"env": {
  "TELEGRAM_BOT_TOKEN": "...",
  "TELEGRAM_CHAT_ID": "...",
  "TELEGRAM_AUTO_POLL": "false"
}
```

## Updating

After editing `server.js`, rebuild and copy to the deployed location:
```bash
node build.js
copy dist\telegram-mcp-install.js .  # optional, for redistribution
copy server.js %USERPROFILE%\.telegram-mcp-bridge\server.js  # Windows
# cp server.js ~/.telegram-mcp-bridge/server.js  # macOS/Linux
```
No reinstall needed — the agent picks up changes on next MCP server restart.
