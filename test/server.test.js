const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Test MessageQueue by loading server.js internals
// We can't require server.js directly (it starts MCP), so we extract the class
// ---------------------------------------------------------------------------

const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf-8");

// Extract MessageQueue class source and eval it in isolation
const mqMatch = serverSrc.match(/(class MessageQueue \{[\s\S]*?\n\})/);
if (!mqMatch) throw new Error("Could not extract MessageQueue from server.js");

const MAX_HISTORY = 50;
const log = { warn: () => {} };
const MessageQueue = new Function("fs", "path", "crypto", "log", "MAX_HISTORY", `${mqMatch[1]}; return MessageQueue;`)(fs, path, crypto, log, MAX_HISTORY);

describe("MessageQueue", () => {
  let tmpFile;
  let queue;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `mq-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    queue = new MessageQueue(tmpFile);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
  });

  it("starts empty", () => {
    assert.equal(queue.pendingCount(), 0);
    assert.deepEqual(queue.poll(), []);
  });

  it("enqueues and polls messages", () => {
    queue.enqueue("hello", "user");
    queue.enqueue("world", "user");
    assert.equal(queue.pendingCount(), 2);

    const msgs = queue.poll();
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].text, "hello");
    assert.equal(msgs[1].text, "world");
    assert.equal(msgs[0].sender, "user");
    assert.equal(queue.pendingCount(), 0);
  });

  it("returns empty after poll drains", () => {
    queue.enqueue("test", "user");
    queue.poll();
    assert.deepEqual(queue.poll(), []);
  });

  it("persists to disk and reloads", () => {
    queue.enqueue("persist-me", "user");
    // Create new instance from same file
    const queue2 = new MessageQueue(tmpFile);
    assert.equal(queue2.pendingCount(), 1);
    const msgs = queue2.poll();
    assert.equal(msgs[0].text, "persist-me");
  });

  it("clear removes all messages", () => {
    queue.enqueue("a", "user");
    queue.enqueue("b", "user");
    queue.clear();
    assert.equal(queue.pendingCount(), 0);
    assert.deepEqual(queue.poll(), []);
  });

  it("generates unique message ids", () => {
    const m1 = queue.enqueue("a", "user");
    const m2 = queue.enqueue("b", "user");
    assert.notEqual(m1.id, m2.id);
  });

  it("includes timestamp in messages", () => {
    const before = Math.floor(Date.now() / 1000);
    const msg = queue.enqueue("ts-test", "user");
    const after = Math.floor(Date.now() / 1000);
    assert.ok(msg.ts >= before && msg.ts <= after);
  });

  it("pollSince returns only messages newer than sinceTs", () => {
    const m1 = queue.enqueue("old", "user");
    // Manually backdate m1
    queue._pending[0].ts = Math.floor(Date.now() / 1000) - 100;
    queue._save();
    const cutoff = Math.floor(Date.now() / 1000) - 50;
    queue.enqueue("new", "user");

    const fresh = queue.pollSince(cutoff);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0].text, "new");
    // Queue should be empty now (stale moved to delivered)
    assert.equal(queue.pendingCount(), 0);
  });

  it("pendingCountSince counts only messages newer than sinceTs", () => {
    queue.enqueue("old", "user");
    queue._pending[0].ts = Math.floor(Date.now() / 1000) - 100;
    queue._save();
    const cutoff = Math.floor(Date.now() / 1000) - 50;
    queue.enqueue("new", "user");

    assert.equal(queue.pendingCount(), 2);
    assert.equal(queue.pendingCountSince(cutoff), 1);
  });

  it("pendingCountSince with 0 returns all pending", () => {
    queue.enqueue("a", "user");
    queue.enqueue("b", "user");
    assert.equal(queue.pendingCountSince(0), 2);
  });

  it("enqueues message with image data", () => {
    const img = { base64: "abc123", mimeType: "image/jpeg" };
    const msg = queue.enqueue("caption", "user", img);
    assert.equal(msg.text, "caption");
    assert.deepEqual(msg.image, img);
    assert.equal(queue.pendingCount(), 1);
  });

  it("enqueue does not include session_id or thread_id fields", () => {
    const msg = queue.enqueue("plain", "user");
    assert.equal(msg.session_id, undefined);
    assert.equal(msg.thread_id, undefined);
  });

  it("poll returns image data but strips it from delivered", () => {
    const img = { base64: "abc123", mimeType: "image/jpeg" };
    queue.enqueue("photo", "user", img);
    const msgs = queue.poll();
    assert.equal(msgs.length, 1);
    assert.deepEqual(msgs[0].image, img);
    // Reload from disk — delivered should not contain image
    const queue2 = new MessageQueue(tmpFile);
    assert.equal(queue2._delivered.length, 1);
    assert.equal(queue2._delivered[0].image, undefined);
  });

  it("pollSince strips image from delivered", () => {
    const img = { base64: "xyz", mimeType: "image/png" };
    queue.enqueue("pic", "user", img);
    const msgs = queue.pollSince(0);
    assert.equal(msgs.length, 1);
    assert.deepEqual(msgs[0].image, img);
    const queue2 = new MessageQueue(tmpFile);
    assert.equal(queue2._delivered[0].image, undefined);
  });

  it("enqueue without image does not add image field", () => {
    const msg = queue.enqueue("plain", "user");
    assert.equal(msg.image, undefined);
  });

  it("enqueue stores tg_msg_id when provided", () => {
    const msg = queue.enqueue("hello", "user", null, 12345);
    assert.equal(msg.tg_msg_id, 12345);
    const msgs = queue.poll();
    assert.equal(msgs[0].tg_msg_id, 12345);
  });

  it("enqueue omits tg_msg_id when not provided", () => {
    const msg = queue.enqueue("hello", "user");
    assert.equal(msg.tg_msg_id, undefined);
  });

  it("tg_msg_id persists to disk and reloads", () => {
    queue.enqueue("msg", "user", null, 99);
    const queue2 = new MessageQueue(tmpFile);
    assert.equal(queue2._pending[0].tg_msg_id, 99);
  });
});

// ---------------------------------------------------------------------------
// Test interact tool description builder
// ---------------------------------------------------------------------------

describe("buildInteractDesc", () => {
  it("includes protocol rules when all flags are on", () => {
    const d = buildInteractDescWith(true, true, true, true);
    assert.ok(d.includes("PROTOCOL:"));
    assert.ok(d.includes("START of every session"));
    assert.ok(d.includes("starting work"));
    assert.ok(d.includes("final summary"));
    assert.ok(d.includes("periodically"));
  });

  it("omits disabled flag rules", () => {
    const d = buildInteractDescWith(false, false, false, false);
    assert.ok(d.includes("PROTOCOL:"));
    // Should still have the always-on rules
    assert.ok(d.includes("milestones"));
    assert.ok(!d.includes("START of every session"));
    assert.ok(!d.includes("final summary"));
    assert.ok(!d.includes("periodically"));
  });

  it("always includes since_ts documentation", () => {
    const d = buildInteractDescWith(false, false, false, false);
    assert.ok(d.includes("since_ts"));
    assert.ok(d.includes("now"));
  });

  it("describes unified tool behavior", () => {
    const d = buildInteractDescWith(true, true, true, true);
    assert.ok(d.includes("message"));
    assert.ok(d.includes("wait"));
    assert.ok(d.includes("session_id"));
  });

  it("documents session_id as required input", () => {
    const d = buildInteractDescWith(false, false, false, false);
    assert.ok(d.includes("MUST pass `session_id`"));
    assert.ok(d.includes("SESSION ISOLATION"));
  });
});

// ---------------------------------------------------------------------------
// Test session isolation — each queue file is independent
// ---------------------------------------------------------------------------

describe("Session isolation via separate queue files", () => {
  let tmpFile1;
  let tmpFile2;
  let queue1;
  let queue2;

  beforeEach(() => {
    const base = path.join(os.tmpdir(), `mq-iso-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tmpFile1 = `${base}-s1.json`;
    tmpFile2 = `${base}-s2.json`;
    queue1 = new MessageQueue(tmpFile1);
    queue2 = new MessageQueue(tmpFile2);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile1); } catch { /* ok */ }
    try { fs.unlinkSync(tmpFile2); } catch { /* ok */ }
  });

  it("messages enqueued to one session are not visible in another", () => {
    queue1.enqueue("for session 1", "user");
    queue2.enqueue("for session 2", "user");

    const msgs1 = queue1.poll();
    const msgs2 = queue2.poll();

    assert.equal(msgs1.length, 1);
    assert.equal(msgs1[0].text, "for session 1");
    assert.equal(msgs2.length, 1);
    assert.equal(msgs2[0].text, "for session 2");
  });

  it("polling one session does not affect the other", () => {
    queue1.enqueue("msg1", "user");
    queue2.enqueue("msg2", "user");

    queue1.poll();
    assert.equal(queue1.pendingCount(), 0);
    assert.equal(queue2.pendingCount(), 1);

    const msgs2 = queue2.poll();
    assert.equal(msgs2[0].text, "msg2");
  });

  it("broadcast simulation delivers to both queues independently", () => {
    queue1.enqueue("broadcast", "user");
    queue2.enqueue("broadcast", "user");

    const msgs1 = queue1.poll();
    const msgs2 = queue2.poll();
    assert.equal(msgs1.length, 1);
    assert.equal(msgs2.length, 1);
    assert.equal(msgs1[0].text, "broadcast");
    assert.equal(msgs2[0].text, "broadcast");
  });
});

// ---------------------------------------------------------------------------
// Test pause/resume hold behavior
// ---------------------------------------------------------------------------

describe("Pause/resume session hold", () => {
  it("session object starts with paused=false", () => {
    // Simulates getSession() initializer
    const session = { queue: null, topicId: null, paused: false };
    assert.equal(session.paused, false);
  });

  it("paused session holds even when messages are pending", async () => {
    const session = { paused: true };
    const sinceTs = 0;
    let iterations = 0;
    const maxIterations = 5;

    // Simulate the wait loop: while paused, messages don't cause a break
    while (session.paused || false) {
      iterations++;
      if (iterations >= maxIterations) {
        // Simulate /resume
        session.paused = false;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(session.paused, false);
    assert.equal(iterations, maxIterations);
  });

  it("unpaused session exits wait loop when deadline passes", async () => {
    const session = { paused: false };
    const deadline = Date.now() + 50; // 50ms deadline
    let iterations = 0;

    while (session.paused || (deadline && Date.now() < deadline)) {
      iterations++;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(iterations > 0);
    assert.ok(Date.now() >= deadline);
  });

  it("pause/resume toggle works correctly", () => {
    const session = { paused: false };
    assert.equal(session.paused, false);
    session.paused = true;
    assert.equal(session.paused, true);
    session.paused = false;
    assert.equal(session.paused, false);
  });
});

// Replicate the builder function for testing (avoids requiring server.js)
function buildInteractDescWith(autoStart, autoEnd, autoSummary, autoPoll) {
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
  if (autoStart) rules.push(
    "At the START of every session/task, call with a brief greeting and plan summary.");
  if (autoSummary) rules.push(
    "When starting work, call with a concise summary of what you're about to do.");
  rules.push("Call with updates on major milestones or when you need input.");
  if (autoEnd) rules.push(
    "When done, call with a final summary and wait=120 to give user a chance to reply.");
  if (autoPoll) rules.push(
    "During any task, call periodically (every few minutes) with no message to check for user input. " +
    "Use wait=60-120 when idle to avoid rapid polling.");
  rules.push("Keep messages concise (phone-readable).");
  if (rules.length) d += "\n\nPROTOCOL: " + rules.join(" ");
  return d;
}
