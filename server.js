#!/usr/bin/env node
// =============================================================================
//  Telegram MCP Bridge Server v2
//  Bridges AI agent sessions with a human via Telegram Forum Topics.
//  Each session gets its own topic — full per-agent isolation.
//  Single unified tool: interact
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
const os = require("os");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
let CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DATA_DIR = process.env.TELEGRAM_MCP_DATA_DIR ||
  path.join(os.homedir(), ".telegram-mcp-bridge", "data");
const MAX_HISTORY = parseInt(process.env.TELEGRAM_MCP_MAX_HISTORY || "200", 10);
const POLL_INTERVAL_MS = parseInt(process.env.TELEGRAM_POLL_INTERVAL || "2000", 10);

// Session identity — each MCP server instance is one session
const SESSION_ID = process.env.TELEGRAM_SESSION_ID ||
  `s-${crypto.randomBytes(3).toString("hex")}`;
const MACHINE_LABEL = process.env.TELEGRAM_MACHINE_LABEL ||
  os.hostname().slice(0, 20);
const AGENT_LABEL = process.env.TELEGRAM_AGENT_LABEL || "agent";
const SESSION_LABEL = `${MACHINE_LABEL}/${AGENT_LABEL}`;

// Behavior flags (set in MCP config env block)
const AUTO_SEND_START = process.env.TELEGRAM_AUTO_START !== "false";
const AUTO_SEND_END = process.env.TELEGRAM_AUTO_END !== "false";
const AUTO_SUMMARY = process.env.TELEGRAM_AUTO_SUMMARY !== "false";
const AUTO_POLL = process.env.TELEGRAM_AUTO_POLL !== "false";

// Legacy compat: old QUEUE_FILE env still works for single-session setups
const LEGACY_QUEUE_FILE = process.env.TELEGRAM_MCP_QUEUE_FILE || "";

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

// ---------------------------------------------------------------------------
// Topic management — each session gets its own forum topic
// ---------------------------------------------------------------------------
let topicId = null; // message_thread_id for this session's topic

// Persisted topic map: { sessionId: topicId }
function getTopicMapFile() { return path.join(DATA_DIR, "_topics.json"); }

function loadTopicMap() {
  try {
    if (fs.existsSync(getTopicMapFile())) {
      return JSON.parse(fs.readFileSync(getTopicMapFile(), "utf-8"));
    }
  } catch { /* ok */ }
  return {};
}

function saveTopicMap(map) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(getTopicMapFile(), JSON.stringify(map, null, 2));
  } catch (e) {
    log.warn("Topic map save failed:", e.message);
  }
}

async function ensureTopic() {
  if (!BOT_TOKEN || !CHAT_ID) return null;

  // Check if we already have a topic for this session
  const map = loadTopicMap();
  if (map[SESSION_ID]) {
    topicId = map[SESSION_ID];
    log.info(`Reusing topic ${topicId} for ${SESSION_ID} (${SESSION_LABEL})`);
    return topicId;
  }

  // Create a new topic
  try {
    let chatIdNum = parseInt(CHAT_ID, 10);
    let res = await tgApi("createForumTopic", {
      chat_id: chatIdNum,
      name: `🤖 ${SESSION_LABEL} [${SESSION_ID}]`,
    });

    // Handle chat migration (group upgraded to supergroup)
    if (!res.ok && res.parameters?.migrate_to_chat_id) {
      const newId = String(res.parameters.migrate_to_chat_id);
      log.info(`Chat migrated: ${CHAT_ID} → ${newId}`);
      CHAT_ID = newId;
      chatIdNum = parseInt(CHAT_ID, 10);
      res = await tgApi("createForumTopic", {
        chat_id: chatIdNum,
        name: `🤖 ${SESSION_LABEL} [${SESSION_ID}]`,
      });
    }

    if (res.ok && res.result) {
      topicId = res.result.message_thread_id;
      map[SESSION_ID] = topicId;
      saveTopicMap(map);
      log.info(`Created topic ${topicId} for ${SESSION_ID} (${SESSION_LABEL})`);
      return topicId;
    }
    log.warn("createForumTopic failed:", JSON.stringify(res));
  } catch (e) {
    log.warn("createForumTopic error:", e.message);
  }

  // Fallback: no topic (send to General)
  return null;
}

// Build reverse map: topicId → sessionId (for routing incoming messages)
function buildTopicToSessionMap() {
  const map = loadTopicMap();
  const reverse = {};
  for (const [sid, tid] of Object.entries(map)) {
    reverse[String(tid)] = sid;
  }
  return reverse;
}

// ---------------------------------------------------------------------------
// Send message to this session's topic (or General as fallback)
// ---------------------------------------------------------------------------
async function sendToTopic(text) {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  const body = {
    chat_id: parseInt(CHAT_ID, 10),
    text,
    parse_mode: "Markdown",
  };
  if (topicId) body.message_thread_id = topicId;
  try {
    const res = await tgApi("sendMessage", body);
    if (res.ok) return true;
    // Markdown parse error — retry plain
    delete body.parse_mode;
    const res2 = await tgApi("sendMessage", body);
    return !!res2.ok;
  } catch (e) {
    log.error("sendMessage failed:", e.message);
    return false;
  }
}

// Send to General topic (no message_thread_id)
async function sendToGeneral(text) {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    const res = await tgApi("sendMessage", {
      chat_id: parseInt(CHAT_ID, 10),
      text,
      parse_mode: "Markdown",
    });
    if (res.ok) return true;
    const res2 = await tgApi("sendMessage", {
      chat_id: parseInt(CHAT_ID, 10),
      text,
    });
    return !!res2.ok;
  } catch (e) {
    log.error("sendToGeneral failed:", e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Message queue — persisted to disk, minimal memory footprint
// Each session has its own queue. Messages routed by topic.
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
      fs.mkdirSync(path.dirname(this._file), { recursive: true });
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
      id: crypto.randomBytes(4).toString("hex"),
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

  // Poll only messages with ts > sinceTs (for timestamp-aware polling)
  pollSince(sinceTs) {
    if (!this._pending.length) return [];
    const fresh = [];
    const stale = [];
    for (const m of this._pending) {
      if (m.ts > sinceTs) fresh.push(m);
      else stale.push(m);
    }
    // Move stale to delivered (agent already saw them before)
    if (stale.length) this._delivered.push(...stale);
    // Move fresh to delivered too (being returned now)
    if (fresh.length) this._delivered.push(...fresh);
    this._pending = [];
    this._save();
    return fresh;
  }

  pendingCount() {
    return this._pending.length;
  }

  pendingCountSince(sinceTs) {
    if (!sinceTs) return this._pending.length;
    return this._pending.filter((m) => m.ts > sinceTs).length;
  }

  clear() {
    this._pending = [];
    this._delivered = [];
    this._save();
  }
}

// ---------------------------------------------------------------------------
// Session registry — tracks all active sessions across machines
// ---------------------------------------------------------------------------
class SessionRegistry {
  constructor(dataDir) {
    this._dir = dataDir;
    this._file = path.join(dataDir, "_sessions.json");
    this._sessions = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._file)) {
        this._sessions = JSON.parse(fs.readFileSync(this._file, "utf-8"));
      }
    } catch { /* ok */ }
  }

  _save() {
    try {
      fs.mkdirSync(this._dir, { recursive: true });
      fs.writeFileSync(this._file, JSON.stringify(this._sessions, null, 2));
    } catch (e) {
      log.warn("Session registry save failed:", e.message);
    }
  }

  register(sessionId, machine, agent, topicId) {
    this._sessions[sessionId] = {
      machine,
      agent,
      label: `${machine}/${agent}`,
      topicId: topicId || null,
      startedAt: Math.floor(Date.now() / 1000),
      lastSeen: Math.floor(Date.now() / 1000),
      active: true,
    };
    this._save();
  }

  updateTopicId(sessionId, tid) {
    if (this._sessions[sessionId]) {
      this._sessions[sessionId].topicId = tid;
      this._save();
    }
  }

  heartbeat(sessionId) {
    if (this._sessions[sessionId]) {
      this._sessions[sessionId].lastSeen = Math.floor(Date.now() / 1000);
      this._save();
    }
  }

  deactivate(sessionId) {
    if (this._sessions[sessionId]) {
      this._sessions[sessionId].active = false;
      this._save();
    }
  }

  getActive() {
    const now = Math.floor(Date.now() / 1000);
    const result = {};
    for (const [id, s] of Object.entries(this._sessions)) {
      if (s.active && (now - s.lastSeen) < 600) {
        result[id] = s;
      }
    }
    return result;
  }

  getAll() {
    return { ...this._sessions };
  }

  getActiveSessionIds() {
    return Object.keys(this.getActive());
  }

  // Find session by topic ID
  findByTopicId(tid) {
    for (const [id, s] of Object.entries(this._sessions)) {
      if (s.topicId === tid && s.active) return id;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Initialize queue and registry
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });

const queueFile = LEGACY_QUEUE_FILE ||
  path.join(DATA_DIR, `queue-${SESSION_ID}.json`);
const queue = new MessageQueue(queueFile);
const registry = new SessionRegistry(DATA_DIR);

// Register this session (topicId set later after ensureTopic)
registry.register(SESSION_ID, MACHINE_LABEL, AGENT_LABEL, null);

// ---------------------------------------------------------------------------
// Route incoming messages by topic
// ---------------------------------------------------------------------------
function routeMessageToSession(text, sender, msgTopicId) {
  // If message is in a specific topic, route to that session only
  if (msgTopicId) {
    const topicToSession = buildTopicToSessionMap();
    const targetSessionId = topicToSession[String(msgTopicId)];

    if (targetSessionId === SESSION_ID) {
      // This message is for us
      queue.enqueue(text, sender);
      return true;
    }
    // Not for us — check if it's for another session on this machine
    // (other sessions will pick it up from their own polling)
    return false;
  }

  // Message in General topic (no thread_id) — broadcast to all sessions
  broadcastToAllSessions(text, sender);
  return true;
}

function broadcastToAllSessions(text, sender) {
  const activeIds = registry.getActiveSessionIds();
  for (const sid of activeIds) {
    if (sid === SESSION_ID) {
      queue.enqueue(text, sender);
    } else {
      const otherFile = path.join(DATA_DIR, `queue-${sid}.json`);
      try {
        const otherQueue = new MessageQueue(otherFile);
        otherQueue.enqueue(text, sender);
      } catch (e) {
        log.warn(`Failed to broadcast to session ${sid}:`, e.message);
      }
    }
  }
  if (!activeIds.includes(SESSION_ID)) {
    queue.enqueue(text, sender);
  }
}

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
      timeout: 2,
      allowed_updates: ["message"],
    });
    if (!res.ok || !res.result) return;
    for (const update of res.result) {
      lastUpdateId = update.update_id + 1;
      if (processedUpdates.has(update.update_id)) continue;
      processedUpdates.add(update.update_id);
      if (processedUpdates.size > 1000) {
        const oldest = processedUpdates.values().next().value;
        processedUpdates.delete(oldest);
      }
      const msg = update.message;
      if (!msg || !msg.text) continue;
      const chatId = String(msg.chat.id);
      if (CHAT_ID && chatId !== CHAT_ID) continue;

      // Skip bot's own messages
      if (msg.from && msg.from.is_bot) continue;

      const msgTopicId = msg.message_thread_id || null;

      // Handle commands in General topic
      if (!msgTopicId || msg.is_topic_message === false) {
        if (msg.text === "/start") {
          const activeSessions = registry.getActive();
          const sessionList = Object.entries(activeSessions)
            .map(([id, s]) => `• *${s.label}* — ${s.active ? "🟢" : "🔴"}`)
            .join("\n") || "None";
          await sendToGeneral(
            `🔗 *Telegram MCP Bridge v2*\nChat ID: \`${chatId}\`\n\n*Active sessions:*\n${sessionList}\n\n_Each session has its own topic. Reply in a topic to message that specific agent._`
          );
          continue;
        }
        if (msg.text === "/sessions") {
          const all = registry.getAll();
          const lines = Object.entries(all).map(([id, s]) => {
            const status = s.active ? "🟢" : "🔴";
            const ago = Math.floor(Date.now() / 1000) - s.lastSeen;
            return `${status} *${s.label}* (${id}) — ${ago}s ago`;
          });
          await sendToGeneral(`*Sessions:*\n${lines.join("\n") || "None"}`);
          continue;
        }
      }

      // Route message based on topic
      routeMessageToSession(msg.text, "user", msgTopicId);
      log.info(`Message from user in topic ${msgTopicId || "General"}: "${msg.text.slice(0, 50)}"`);
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

  // Ensure this session has a topic
  await ensureTopic();
  if (topicId) {
    registry.updateTopicId(SESSION_ID, topicId);
  }

  log.info(`Telegram polling started (session=${SESSION_ID}, label=${SESSION_LABEL}, topic=${topicId})`);

  // Send startup message to our topic
  if (AUTO_SEND_START && topicId) {
    await sendToTopic(`🟢 *Session started*\n_${SESSION_LABEL}_`);
  }

  while (pollingActive) {
    await pollTelegram();
    registry.heartbeat(SESSION_ID);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "telegram-bridge", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// Build interact tool description dynamically
function buildInteractDesc() {
  let d = "Unified Telegram communication tool. Does everything in one call:\n" +
    "• If `message` is provided: sends it to the user via Telegram (Markdown supported)\n" +
    "• Always checks for and returns any pending user messages\n" +
    "• If `wait` > 0: blocks up to that many seconds for a user reply before returning\n" +
    "• Use `since_ts` to ignore messages older than a timestamp (avoids reading stale messages)\n\n" +
    "Response format: {ok, sent?, messages: [{text, ts}], pending, now}\n" +
    "- `now`: current server timestamp — pass as `since_ts` on next call to only get newer messages\n" +
    "- `messages`: new messages from user (empty array if none)\n" +
    "- `pending`: count of remaining unread messages after this call\n\n" +
    "IMPORTANT: Each message has a `ts` (unix timestamp). Compare with your last call's `now` " +
    "to know if a message is a fresh reply or was pending from before your question.";

  const rules = [];
  if (AUTO_SEND_START) rules.push(
    "At the START of every session/task, call with a brief greeting and plan summary.");
  if (AUTO_SUMMARY) rules.push(
    "When starting work, call with a concise summary of what you're about to do.");
  rules.push("Call with updates on major milestones or when you need input.");
  if (AUTO_SEND_END) rules.push(
    "When done, call with a final summary and wait=120 to give user a chance to reply.");
  if (AUTO_POLL) rules.push(
    "During any task, call periodically (every few minutes) with no message to check for user input. " +
    "Use wait=60-120 when idle to avoid rapid polling.");
  rules.push("Keep messages concise (phone-readable).");
  if (rules.length) d += "\n\nPROTOCOL: " + rules.join(" ");
  return d;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "interact",
      description: buildInteractDesc(),
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Message to send to user via Telegram (Markdown). Omit to just check for messages.",
          },
          wait: {
            type: "number",
            description: "Seconds to wait for user reply (0=instant check, 60-120 for idle polling, up to 300). Default 0.",
          },
          since_ts: {
            type: "number",
            description: "Unix timestamp — only return messages newer than this. Use the `now` value from the previous response.",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "interact") {
    const now = Math.floor(Date.now() / 1000);
    const message = args?.message || null;
    const wait = Math.min(Math.max(parseInt(args?.wait, 10) || 0, 0), 300);
    const sinceTs = parseInt(args?.since_ts, 10) || 0;

    // Step 1: Send message if provided — goes to this session's topic
    let sent = null;
    if (message) {
      const ok = await sendToTopic(message);
      sent = ok;
      if (!ok) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, error: "send failed", now }),
          }],
        };
      }
    }

    // Step 2: Wait if requested
    if (wait > 0) {
      const deadline = Date.now() + wait * 1000;
      while (Date.now() < deadline) {
        const count = sinceTs ? queue.pendingCountSince(sinceTs) : queue.pendingCount();
        if (count > 0) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Step 3: Collect messages
    let msgs;
    if (sinceTs) {
      msgs = queue.pollSince(sinceTs);
    } else {
      msgs = queue.poll();
    }

    const slim = msgs.map((m) => ({ text: m.text, ts: m.ts }));

    const result = {
      ok: true,
      now,
      messages: slim,
      pending: queue.pendingCount(),
    };
    if (sent !== null) result.sent = sent;

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  // Legacy tool support
  if (name === "send_message") {
    const text = args?.text;
    if (!text) return { content: [{ type: "text", text: '{"error":"empty message"}' }] };
    const ok = await sendToTopic(text);
    return { content: [{ type: "text", text: JSON.stringify({ sent: ok, now: Math.floor(Date.now() / 1000) }) }] };
  }

  if (name === "poll_messages") {
    const msgs = queue.poll();
    const slim = msgs.map((m) => ({ text: m.text, ts: m.ts }));
    return { content: [{ type: "text", text: JSON.stringify({ messages: slim, now: Math.floor(Date.now() / 1000) }) }] };
  }

  if (name === "check_status") {
    const wait = Math.min(Math.max(parseInt(args?.wait, 10) || 0, 0), 300);
    if (wait > 0) {
      const deadline = Date.now() + wait * 1000;
      while (Date.now() < deadline && queue.pendingCount() === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ pending: queue.pendingCount(), now: Math.floor(Date.now() / 1000) }) }],
    };
  }

  if (name === "wait_for_reply") {
    const timeout = Math.min(Math.max(parseInt(args?.timeout, 10) || 120, 1), 300);
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      if (queue.pendingCount() > 0) {
        const msgs = queue.poll();
        const slim = msgs.map((m) => ({ text: m.text, ts: m.ts }));
        return { content: [{ type: "text", text: JSON.stringify({ messages: slim, now: Math.floor(Date.now() / 1000) }) }] };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { content: [{ type: "text", text: JSON.stringify({ timeout: true, waited: timeout, now: Math.floor(Date.now() / 1000) }) }] };
  }

  return { content: [{ type: "text", text: '{"error":"unknown tool"}' }] };
});

// ---------------------------------------------------------------------------
// Graceful shutdown — mark session inactive, notify topic
// ---------------------------------------------------------------------------
let shutdownDone = false;
function shutdown() {
  if (shutdownDone) return;
  shutdownDone = true;
  pollingActive = false;
  registry.deactivate(SESSION_ID);
  log.info(`Session ${SESSION_ID} deactivated`);
}
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
process.on("exit", shutdown);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log.info(`Starting Telegram MCP Bridge v2 (session=${SESSION_ID}, label=${SESSION_LABEL})`);

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
