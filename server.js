#!/usr/bin/env node
// =============================================================================
//  Telegram MCP Bridge Server
//  Bridges a long-running AI agent session with a human via Telegram.
//  Tools: send_message, poll_messages, check_status
// =============================================================================

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const QUEUE_FILE = process.env.TELEGRAM_MCP_QUEUE_FILE ||
  path.join(require("os").homedir(), ".telegram_mcp_queue.json");
const MAX_HISTORY = parseInt(process.env.TELEGRAM_MCP_MAX_HISTORY || "50", 10);
const POLL_INTERVAL_MS = parseInt(process.env.TELEGRAM_POLL_INTERVAL || "2000", 10);

// Behavior flags (set in MCP config env block)
const AUTO_SEND_START = process.env.TELEGRAM_AUTO_START !== "false"; // default: on
const AUTO_SEND_END = process.env.TELEGRAM_AUTO_END !== "false";     // default: on
const AUTO_SUMMARY = process.env.TELEGRAM_AUTO_SUMMARY !== "false";  // default: on
const AUTO_POLL = process.env.TELEGRAM_AUTO_POLL !== "false";        // default: on

// ---------------------------------------------------------------------------
// Logging (stderr only — stdout is MCP stdio transport)
// ---------------------------------------------------------------------------
const log = {
  info: (...a) => process.stderr.write(`[INFO] ${a.join(" ")}\n`),
  warn: (...a) => process.stderr.write(`[WARN] ${a.join(" ")}\n`),
  error: (...a) => process.stderr.write(`[ERROR] ${a.join(" ")}\n`),
};

// ---------------------------------------------------------------------------
// Telegram HTTP helpers (zero dependencies — uses built-in https)
// ---------------------------------------------------------------------------
function tgApi(method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: payload ? "POST" : "GET",
      headers: payload
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {},
      timeout: 30000,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          reject(new Error(`Invalid JSON from Telegram: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Telegram API timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    // Try Markdown first, fall back to plain text
    const res = await tgApi("sendMessage", {
      chat_id: parseInt(CHAT_ID, 10),
      text,
      parse_mode: "Markdown",
    });
    if (res.ok) return true;
    // Markdown parse error — retry plain
    const res2 = await tgApi("sendMessage", {
      chat_id: parseInt(CHAT_ID, 10),
      text,
    });
    return !!res2.ok;
  } catch (e) {
    log.error("sendMessage failed:", e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Message queue — persisted to disk, minimal memory footprint
// ---------------------------------------------------------------------------
class MessageQueue {
  constructor(filePath) {
    this._file = filePath;
    this._pending = [];
    this._delivered = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._file)) {
        const data = JSON.parse(fs.readFileSync(this._file, "utf-8"));
        this._pending = data.pending || [];
        this._delivered = (data.delivered || []).slice(-MAX_HISTORY);
      }
    } catch (e) {
      log.warn("Queue load failed:", e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(this._file, JSON.stringify({
        pending: this._pending,
        delivered: this._delivered.slice(-MAX_HISTORY),
      }, null, 2));
    } catch (e) {
      log.warn("Queue save failed:", e.message);
    }
  }

  enqueue(text, sender = "user") {
    const msg = {
      id: Math.random().toString(36).slice(2, 10),
      text,
      sender,
      ts: Math.floor(Date.now() / 1000),
    };
    this._pending.push(msg);
    this._save();
    return msg;
  }

  poll() {
    if (!this._pending.length) return [];
    const msgs = this._pending.splice(0);
    this._delivered.push(...msgs);
    this._save();
    return msgs;
  }

  pendingCount() {
    return this._pending.length;
  }

  clear() {
    this._pending = [];
    this._delivered = [];
    this._save();
  }
}

const queue = new MessageQueue(QUEUE_FILE);

// ---------------------------------------------------------------------------
// Telegram long-polling loop (runs in background)
// ---------------------------------------------------------------------------
let lastUpdateId = 0;
let pollingActive = false;
const processedUpdates = new Set();

async function flushOldUpdates() {
  try {
    const res = await tgApi("getUpdates", { offset: -1 });
    if (res.ok && res.result && res.result.length) {
      lastUpdateId = res.result[res.result.length - 1].update_id + 1;
    }
  } catch (e) {
    log.warn("Flush old updates failed:", e.message);
  }
}

async function pollTelegram() {
  try {
    const res = await tgApi("getUpdates", {
      offset: lastUpdateId,
      timeout: 10,
      allowed_updates: ["message"],
    });
    if (!res.ok || !res.result) return;
    for (const update of res.result) {
      lastUpdateId = update.update_id + 1;
      if (processedUpdates.has(update.update_id)) continue;
      processedUpdates.add(update.update_id);
      // Keep set bounded
      if (processedUpdates.size > 1000) {
        const oldest = processedUpdates.values().next().value;
        processedUpdates.delete(oldest);
      }
      const msg = update.message;
      if (!msg || !msg.text) continue;
      const chatId = String(msg.chat.id);
      if (CHAT_ID && chatId !== CHAT_ID) {
        log.warn("Ignoring message from unauthorized chat:", chatId);
        continue;
      }
      if (msg.text === "/start") {
        await sendTelegramMessage(
          `🔗 *Telegram MCP Bridge active*\nYour chat ID: \`${chatId}\`\nMessages you send here go to the agent.`
        );
        continue;
      }
      queue.enqueue(msg.text, "user");
      log.info(`Queued message from user: "${msg.text.slice(0, 50)}..."`);
    }
  } catch (e) {
    log.warn("Telegram poll error:", e.message);
  }
}

async function startPollingLoop() {
  if (!BOT_TOKEN) {
    log.error("TELEGRAM_BOT_TOKEN not set — Telegram polling disabled");
    return;
  }
  pollingActive = true;
  await flushOldUpdates();
  log.info("Telegram polling started");
  while (pollingActive) {
    await pollTelegram();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "telegram-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Build tool descriptions dynamically based on active behavior flags
function buildSendDesc() {
  let d = "Send a message to the user via Telegram. Use for progress updates, " +
    "questions, or results. Supports Markdown formatting.";
  const rules = [];
  if (AUTO_SEND_START) rules.push(
    "At the START of every session/task, send a brief greeting and plan summary.");
  if (AUTO_SUMMARY) rules.push(
    "When starting work on something, send a concise summary of what you're about to do.");
  rules.push("Send updates on major milestones or when you need input.");
  if (AUTO_SEND_END) rules.push(
    "Send a final summary when the task is done or the session ends.");
  rules.push("Keep messages concise (phone-readable).");
  if (rules.length) d += "\nPROTOCOL: " + rules.join(" ");
  return d;
}

function buildCheckDesc() {
  let d = 'Lightweight status check \u2014 returns only {"pending": N}. Costs ~10 tokens. ' +
    "Use this for routine checks; only call poll_messages when pending > 0.";
  if (AUTO_POLL) {
    d += "\nPROTOCOL: During any task, call this regularly \u2014 at least every few minutes \u2014 " +
      "to check if the user sent a message via Telegram. If pending > 0, call poll_messages. " +
      "This lets the user provide feedback or corrections mid-task without restarting.";
  }
  return d;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send_message",
      description: buildSendDesc(),
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text (Markdown supported)" },
        },
        required: ["text"],
      },
    },
    {
      name: "poll_messages",
      description:
        "Retrieve new messages from the user. Returns [] if none (minimal context cost). " +
        "Each message is returned exactly once. Use check_status first to avoid unnecessary polling.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "check_status",
      description: buildCheckDesc(),
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "send_message") {
    const text = args?.text;
    if (!text) return { content: [{ type: "text", text: '{"error":"empty message"}' }] };
    const ok = await sendTelegramMessage(text);
    const result = ok ? { sent: true } : { sent: false, error: "Failed — check token/chat ID" };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  if (name === "poll_messages") {
    const msgs = queue.poll();
    if (!msgs.length) return { content: [{ type: "text", text: "[]" }] };
    // Return slim payload — only id, text, ts
    const slim = msgs.map((m) => ({ id: m.id, text: m.text, ts: m.ts }));
    return { content: [{ type: "text", text: JSON.stringify(slim) }] };
  }

  if (name === "check_status") {
    return {
      content: [{ type: "text", text: JSON.stringify({ pending: queue.pendingCount() }) }],
    };
  }

  return { content: [{ type: "text", text: '{"error":"unknown tool"}' }] };
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log.info("Starting Telegram MCP Bridge...");

  // Start Telegram polling in background
  startPollingLoop().catch((e) => log.error("Polling loop crashed:", e.message));

  // Start MCP stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server connected via stdio");
}

main().catch((e) => {
  log.error("Fatal:", e.message);
  process.exit(1);
});
