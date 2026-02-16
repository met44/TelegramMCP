const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
const MessageQueue = new Function("fs", "log", "MAX_HISTORY", `${mqMatch[1]}; return MessageQueue;`)(fs, log, MAX_HISTORY);

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
});

// ---------------------------------------------------------------------------
// Test behavior flag description builders
// ---------------------------------------------------------------------------

describe("buildSendDesc", () => {
  it("includes protocol rules when all flags are on", () => {
    const d = buildSendDescWith(true, true, true);
    assert.ok(d.includes("PROTOCOL:"));
    assert.ok(d.includes("START of every session"));
    assert.ok(d.includes("starting work on something"));
    assert.ok(d.includes("final summary"));
    assert.ok(d.includes("wait_for_reply"));
  });

  it("omits disabled flag rules", () => {
    const d = buildSendDescWith(false, false, false);
    assert.ok(d.includes("PROTOCOL:"));
    assert.ok(!d.includes("START of every session"));
    assert.ok(!d.includes("summary when starting"));
    assert.ok(!d.includes("final summary"));
    // Should still have the always-on rules
    assert.ok(d.includes("milestones"));
  });
});

describe("buildCheckDesc", () => {
  it("includes polling protocol when AUTO_POLL is on", () => {
    const d = buildCheckDescWith(true);
    assert.ok(d.includes("PROTOCOL:"));
    assert.ok(d.includes("every few minutes"));
  });

  it("omits polling protocol when AUTO_POLL is off", () => {
    const d = buildCheckDescWith(false);
    assert.ok(!d.includes("PROTOCOL:"));
  });

  it("mentions wait parameter when AUTO_POLL is on", () => {
    const d = buildCheckDescWith(true);
    assert.ok(d.includes("wait"));
  });
});

// Replicate the builder functions for testing (avoids requiring server.js)
function buildSendDescWith(autoStart, autoEnd, autoSummary) {
  let d = "Send a message to the user via Telegram. Use for progress updates, " +
    "questions, or results. Supports Markdown formatting.";
  const rules = [];
  if (autoStart) rules.push(
    "At the START of every session/task, send a brief greeting and plan summary.");
  if (autoSummary) rules.push(
    "When starting work on something, send a concise summary of what you're about to do.");
  rules.push("Send updates on major milestones or when you need input.");
  if (autoEnd) rules.push(
    "Send a final summary when the task is done or the session ends, " +
    "then call wait_for_reply to give the user a chance to send follow-up instructions before you finish.");
  rules.push("Keep messages concise (phone-readable).");
  if (rules.length) d += "\nPROTOCOL: " + rules.join(" ");
  return d;
}

function buildCheckDescWith(autoPoll) {
  let d = 'Lightweight status check \u2014 returns only {"pending": N}. Costs ~10 tokens. ' +
    "Use this for routine checks; only call poll_messages when pending > 0.";
  if (autoPoll) {
    d += "\nPROTOCOL: During any task, call this regularly \u2014 at least every few minutes \u2014 " +
      "to check if the user sent a message via Telegram. If pending > 0, call poll_messages. " +
      "This lets the user provide feedback or corrections mid-task without restarting." +
      " Use the wait parameter (e.g. wait=120) to block before checking \u2014 " +
      "this avoids spamming rapid polls when idle.";
  }
  return d;
}
