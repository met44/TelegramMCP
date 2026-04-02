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

// Session identity — fallback when agent doesn't pass session_id
const DEFAULT_SESSION_ID = process.env.TELEGRAM_SESSION_ID ||
  `s-${crypto.randomUUID()?.slice(0, 8) || crypto.randomBytes(4).toString("hex")}`;
const MACHINE_LABEL = process.env.TELEGRAM_MACHINE_LABEL ||
  os.hostname().slice(0, 20);
function deriveAgentLabel() {
  try {
    const cwd = process.cwd();
    const base = path.basename(cwd);
    if (base && base.length > 1 && !/^[A-Z]:?$/i.test(base)) return base.slice(0, 30);
  } catch { /* ignore */ }
  return "cascade";
}
const AGENT_LABEL = process.env.TELEGRAM_AGENT_LABEL || deriveAgentLabel();

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
// Telegram file helpers (download + multipart upload)
// ---------------------------------------------------------------------------
function downloadTgFile(filePath) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`, { timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject).on("timeout", function () { this.destroy(); reject(new Error("timeout")); });
  });
}

function tgApiMultipart(method, fields, fileField, filePath, fileName) {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${crypto.randomBytes(8).toString("hex")}`;
    const fileData = fs.readFileSync(filePath);
    let preamble = "";
    for (const [key, val] of Object.entries(fields)) {
      preamble += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`;
    }
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const payload = Buffer.concat([Buffer.from(preamble + header), fileData, Buffer.from(footer)]);
    const opts = {
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": payload.length },
      timeout: 60000,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); } });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Telegram feedback helpers — reactions + typing indicator
// ---------------------------------------------------------------------------
async function setReaction(messageId, emoji) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await tgApi("setMessageReaction", {
      chat_id: parseInt(CHAT_ID, 10),
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
  } catch (e) {
    log.warn(`setReaction(${emoji}) failed:`, e.message);
  }
}

async function sendTypingAction(sessionTopicId) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const body = { chat_id: parseInt(CHAT_ID, 10), action: "typing" };
    if (sessionTopicId) body.message_thread_id = sessionTopicId;
    await tgApi("sendChatAction", body);
  } catch (e) {
    log.warn("sendChatAction(typing) failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Topic management — persisted map of sessionId → topicId
// ---------------------------------------------------------------------------
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

async function ensureTopicForSession(sessionId) {
  if (!BOT_TOKEN || !CHAT_ID) return null;

  const map = loadTopicMap();
  if (map[sessionId]) {
    log.info(`Reusing topic ${map[sessionId]} for ${sessionId}`);
    return map[sessionId];
  }

  // Create a new topic
  const label = `${MACHINE_LABEL}/${sessionId.slice(0, 12)}`;
  try {
    let chatIdNum = parseInt(CHAT_ID, 10);
    let res = await tgApi("createForumTopic", {
      chat_id: chatIdNum,
      name: `🤖 ${label}`,
    });

    // Handle chat migration (group upgraded to supergroup)
    if (!res.ok && res.parameters?.migrate_to_chat_id) {
      const newId = String(res.parameters.migrate_to_chat_id);
      log.info(`Chat migrated: ${CHAT_ID} → ${newId}`);
      CHAT_ID = newId;
      chatIdNum = parseInt(CHAT_ID, 10);
      res = await tgApi("createForumTopic", {
        chat_id: chatIdNum,
        name: `🤖 ${label}`,
      });
    }

    if (res.ok && res.result) {
      const tid = res.result.message_thread_id;
      map[sessionId] = tid;
      saveTopicMap(map);
      log.info(`Created topic ${tid} for ${sessionId}`);
      return tid;
    }
    log.warn("createForumTopic failed:", JSON.stringify(res));
  } catch (e) {
    log.warn("createForumTopic error:", e.message);
  }

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
// Session manager — multiplexes multiple agent sessions in one process
// ---------------------------------------------------------------------------
const sessions = new Map(); // sessionId → { queue, topicId }

function getSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  const queueFile = path.join(DATA_DIR, `queue-${sessionId}.json`);
  const q = new MessageQueue(queueFile);
  const topicMap = loadTopicMap();
  const s = { queue: q, topicId: topicMap[sessionId] || null, paused: false };
  sessions.set(sessionId, s);
  return s;
}

async function ensureSessionReady(sessionId) {
  const s = getSession(sessionId);
  if (!s.topicId) {
    s.topicId = await ensureTopicForSession(sessionId);
  }
  registry.register(sessionId, MACHINE_LABEL, AGENT_LABEL, s.topicId);
  return s;
}

// ---------------------------------------------------------------------------
// Send message to a session's topic (or General as fallback)
// ---------------------------------------------------------------------------
async function sendToSession(text, sessionTopicId) {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  const body = {
    chat_id: parseInt(CHAT_ID, 10),
    text,
    parse_mode: "Markdown",
  };
  if (sessionTopicId) body.message_thread_id = sessionTopicId;
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

// Send photo to a session's topic (or General as fallback)
// ---------------------------------------------------------------------------
async function sendPhotoToSession(imageSource, caption, sessionTopicId) {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  const chatIdNum = parseInt(CHAT_ID, 10);
  try {
    if (imageSource.startsWith("http://") || imageSource.startsWith("https://")) {
      const body = { chat_id: chatIdNum, photo: imageSource };
      if (caption) { body.caption = caption; body.parse_mode = "Markdown"; }
      if (sessionTopicId) body.message_thread_id = sessionTopicId;
      const res = await tgApi("sendPhoto", body);
      if (res.ok) return true;
      if (caption) { delete body.parse_mode; return !!(await tgApi("sendPhoto", body)).ok; }
      return false;
    }
    if (fs.existsSync(imageSource)) {
      const fields = { chat_id: String(chatIdNum) };
      if (caption) fields.caption = caption;
      if (sessionTopicId) fields.message_thread_id = String(sessionTopicId);
      const res = await tgApiMultipart("sendPhoto", fields, "photo", imageSource, path.basename(imageSource));
      return !!res.ok;
    }
    log.error("Image source not found:", imageSource);
    return false;
  } catch (e) {
    log.error("sendPhoto failed:", e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
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

  enqueue(text, sender = "user", image = null, tgMessageId = null) {
    const msg = {
      id: crypto.randomBytes(4).toString("hex"),
      text,
      sender,
      ts: Math.floor(Date.now() / 1000),
    };
    if (image) msg.image = image;
    if (tgMessageId) msg.tg_msg_id = tgMessageId;
    this._pending.push(msg);
    this._save();
    return msg;
  }

  poll() {
    if (!this._pending.length) return [];
    const msgs = this._pending.splice(0);
    this._delivered.push(...msgs.map(m => { const { image, ...rest } = m; return rest; }));
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
    const strip = (m) => { const { image, ...rest } = m; return rest; };
    if (stale.length) this._delivered.push(...stale.map(strip));
    if (fresh.length) this._delivered.push(...fresh.map(strip));
    this._pending = [];
    this._save();
    return fresh;
  }

  pendingCount() {
    return this._pending.length;
  }

  pendingCountSince(sinceTs) {
    if (!sinceTs) return this._pending.length;
    return this._pending.filter(m => m.ts > sinceTs).length;
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
// Initialize registry
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
const registry = new SessionRegistry(DATA_DIR);

// ---------------------------------------------------------------------------
// Route incoming messages by topic → session
// ---------------------------------------------------------------------------
function routeMessageToSession(text, sender, msgTopicId, image = null, tgMessageId = null) {
  if (msgTopicId) {
    const topicToSession = buildTopicToSessionMap();
    const targetSessionId = topicToSession[String(msgTopicId)];
    if (targetSessionId) {
      const s = getSession(targetSessionId);
      s.queue.enqueue(text, sender, image, tgMessageId);
      return true;
    }
    return false;
  }

  // Message in General topic — broadcast to all known sessions
  broadcastToAllSessions(text, sender, image, tgMessageId);
  return true;
}

function broadcastToAllSessions(text, sender, image = null, tgMessageId = null) {
  // Broadcast to all sessions in the in-memory map
  for (const [, s] of sessions) {
    s.queue.enqueue(text, sender, image, tgMessageId);
  }
  // Also broadcast to active registry sessions not yet in memory
  const activeIds = registry.getActiveSessionIds();
  for (const sid of activeIds) {
    if (!sessions.has(sid)) {
      const s = getSession(sid);
      s.queue.enqueue(text, sender, image, tgMessageId);
    }
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
      if (!msg) continue;
      const chatId = String(msg.chat.id);
      if (CHAT_ID && chatId !== CHAT_ID) continue;

      // Skip bot's own messages
      if (msg.from && msg.from.is_bot) continue;

      const msgTopicId = msg.message_thread_id || null;

      // Handle /pause and /resume in any topic (session-specific or General for all)
      if (msg.text === "/pause" || msg.text === "/resume") {
        const isPause = msg.text === "/pause";
        if (msgTopicId) {
          const topicToSession = buildTopicToSessionMap();
          const targetSid = topicToSession[String(msgTopicId)];
          if (targetSid && sessions.has(targetSid)) {
            sessions.get(targetSid).paused = isPause;
            await sendToSession(isPause ? "⏸ *Session paused* — agent is held until you /resume" : "▶️ *Session resumed* — agent released", msgTopicId);
          }
        } else {
          let count = 0;
          for (const [, s] of sessions) {
            s.paused = isPause;
            count++;
          }
          await sendToGeneral(isPause ? `⏸ *All sessions paused* (${count}) — agents held until /resume` : `▶️ *All sessions resumed* (${count})`);
        }
        continue;
      }

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

      // Handle photos
      let image = null;
      if (msg.photo && msg.photo.length > 0) {
        try {
          const photo = msg.photo[msg.photo.length - 1];
          const fileInfo = await tgApi("getFile", { file_id: photo.file_id });
          if (fileInfo.ok && fileInfo.result.file_path) {
            const buf = await downloadTgFile(fileInfo.result.file_path);
            const ext = path.extname(fileInfo.result.file_path).toLowerCase();
            image = { base64: buf.toString("base64"), mimeType: ext === ".png" ? "image/png" : "image/jpeg" };
          }
        } catch (e) { log.warn("Photo download failed:", e.message); }
      }

      const text = msg.text || msg.caption || "";
      if (!text && !image) continue;

      // Route message based on topic (pass Telegram message_id for reaction tracking)
      routeMessageToSession(text, "user", msgTopicId, image, msg.message_id);
      log.info(`Message from user in topic ${msgTopicId || "General"}: "${(text || "[photo]").slice(0, 50)}"`);
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

  log.info(`Telegram polling started (default_session=${DEFAULT_SESSION_ID})`);

  while (pollingActive) {
    await pollTelegram();
    // Heartbeat all active sessions
    for (const [sid] of sessions) {
      registry.heartbeat(sid);
    }
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
    "• Use `since_ts` to ignore messages older than a timestamp (avoids reading stale messages)\n" +
    "• MUST pass `session_id` on every call — this is how the server knows which session you are\n\n" +
    "Response format: {ok, now, session_id, messages: [{text, ts, image?}]}\n" +
    "- `now`: current server timestamp — pass as `since_ts` on next call to only get newer messages\n" +
    "- `session_id`: your session identifier (echoed back for context)\n" +
    "- `messages`: new messages from user (empty array if none)\n\n" +
    "IMPORTANT: Each message has a `ts` (unix timestamp). Compare with your last call's `now` " +
    "to know if a message is a fresh reply or was pending from before your question.\n\n" +
    "SESSION ISOLATION: Pass the same `session_id` on every call within a conversation.\n" +
    "Each session_id gets its own Telegram topic and message queue.\n" +
    "Multiple agents in the same software are isolated by their session_id.";

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
          session_id: {
            type: "string",
            description: "Your unique session identifier. MUST be passed on every call. Use a stable ID for your conversation (e.g. generate one at start and reuse it).",
          },
          message: {
            type: "string",
            description: "Message to send to user via Telegram (Markdown). Omit to just check for messages.",
          },
          image: {
            type: "string",
            description: "Image to send: URL (https://...) or local file path. If message is also provided, it becomes the caption.",
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
    const sessionId = args?.session_id || DEFAULT_SESSION_ID;
    const message = args?.message || null;
    const wait = Math.min(Math.max(parseInt(args?.wait, 10) || 0, 0), 300);
    const sinceTs = parseInt(args?.since_ts, 10) || 0;
    const imageArg = args?.image || null;

    // Ensure session has a topic and queue
    const session = await ensureSessionReady(sessionId);

    // Step 1: Send message/image if provided
    if (imageArg) {
      const ok = await sendPhotoToSession(imageArg, message || "", session.topicId);
      if (!ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "image send failed", now, session_id: sessionId }) }] };
      }
    } else if (message) {
      const ok = await sendToSession(message, session.topicId);
      if (!ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "send failed", now, session_id: sessionId }) }] };
      }
    }

    // React ✅ on previously-read messages when agent sends a reply
    if (message && session.readMsgIds && session.readMsgIds.length > 0) {
      for (const mid of session.readMsgIds) {
        setReaction(mid, "✅");
      }
      session.readMsgIds = [];
    }

    // Step 2: Wait / pause hold — send typing indicator periodically
    // When paused, hold indefinitely (even if wait=0) until resumed or a message arrives.
    // When not paused, normal deadline applies.
    {
      const deadline = wait > 0 ? Date.now() + wait * 1000 : 0;
      let lastTyping = 0;
      while (session.paused || (deadline && Date.now() < deadline)) {
        if (Date.now() - lastTyping > 4000) {
          sendTypingAction(session.topicId);
          lastTyping = Date.now();
        }
        const count = sinceTs ? session.queue.pendingCountSince(sinceTs) : session.queue.pendingCount();
        if (count > 0 && !session.paused) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Step 3: Collect messages
    let msgs;
    if (sinceTs) {
      msgs = session.queue.pollSince(sinceTs);
    } else {
      msgs = session.queue.poll();
    }

    // React 👀 on messages the agent just read — track for later ✅
    if (!session.readMsgIds) session.readMsgIds = [];
    for (const m of msgs) {
      if (m.tg_msg_id) {
        setReaction(m.tg_msg_id, "👀");
        session.readMsgIds.push(m.tg_msg_id);
      }
    }

    const slim = msgs.map((m) => {
      const entry = { text: m.text, ts: m.ts };
      if (m.image) entry.image = true;
      return entry;
    });

    const result = { ok: true, now, session_id: sessionId, messages: slim, paused: session.paused };
    const content = [{ type: "text", text: JSON.stringify(result) }];

    // Append image content blocks for received photos
    for (const m of msgs) {
      if (m.image) {
        content.push({ type: "image", data: m.image.base64, mimeType: m.image.mimeType });
      }
    }

    return { content };
  }

  // Legacy tool support — uses default session
  if (name === "send_message") {
    const text = args?.text;
    if (!text) return { content: [{ type: "text", text: '{"error":"empty message"}' }] };
    const s = await ensureSessionReady(DEFAULT_SESSION_ID);
    const ok = await sendToSession(text, s.topicId);
    return { content: [{ type: "text", text: JSON.stringify({ sent: ok, now: Math.floor(Date.now() / 1000) }) }] };
  }

  if (name === "poll_messages") {
    const s = getSession(DEFAULT_SESSION_ID);
    const msgs = s.queue.poll();
    const slim = msgs.map((m) => ({ text: m.text, ts: m.ts }));
    return { content: [{ type: "text", text: JSON.stringify({ messages: slim, now: Math.floor(Date.now() / 1000) }) }] };
  }

  if (name === "check_status") {
    const s = getSession(DEFAULT_SESSION_ID);
    const wait = Math.min(Math.max(parseInt(args?.wait, 10) || 0, 0), 300);
    if (wait > 0) {
      const deadline = Date.now() + wait * 1000;
      while (Date.now() < deadline && s.queue.pendingCount() === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ pending: s.queue.pendingCount(), now: Math.floor(Date.now() / 1000) }) }],
    };
  }

  if (name === "wait_for_reply") {
    const s = getSession(DEFAULT_SESSION_ID);
    const timeout = Math.min(Math.max(parseInt(args?.timeout, 10) || 120, 1), 300);
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      if (s.queue.pendingCount() > 0) {
        const msgs = s.queue.poll();
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
  for (const [sid] of sessions) {
    registry.deactivate(sid);
  }
  log.info(`All sessions deactivated (${sessions.size} total)`);
}
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
process.on("exit", shutdown);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log.info(`Starting Telegram MCP Bridge v2 (default_session=${DEFAULT_SESSION_ID}, machine=${MACHINE_LABEL})`);

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
