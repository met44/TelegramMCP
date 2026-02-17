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
    assert.ok(d.includes("pending"));
  });
});

// Replicate the builder function for testing (avoids requiring server.js)
function buildInteractDescWith(autoStart, autoEnd, autoSummary, autoPoll) {
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
