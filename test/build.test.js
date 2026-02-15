const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const BUILT_FILE = path.join(DIST, "telegram-mcp-install.js");

describe("build.js", () => {
  it("runs without error", () => {
    execSync("node build.js", { cwd: ROOT, stdio: "pipe" });
    assert.ok(fs.existsSync(BUILT_FILE), "dist/telegram-mcp-install.js should exist");
  });

  it("embeds server.js as base64 (placeholder replaced)", () => {
    const content = fs.readFileSync(BUILT_FILE, "utf-8");
    assert.ok(!content.includes("%%SERVER_B64%%"), "placeholder should be replaced");
  });

  it("embedded base64 decodes to valid server.js", () => {
    const content = fs.readFileSync(BUILT_FILE, "utf-8");
    const match = content.match(/const SERVER_B64 = "([A-Za-z0-9+/=]+)"/);
    assert.ok(match, "should contain a base64 string");
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    assert.ok(decoded.includes("#!/usr/bin/env node"), "decoded should start with shebang");
    assert.ok(decoded.includes("MessageQueue"), "decoded should contain MessageQueue class");
    assert.ok(decoded.includes("send_message"), "decoded should contain send_message tool");
    assert.ok(decoded.includes("check_status"), "decoded should contain check_status tool");
  });

  it("built file has valid JavaScript syntax", () => {
    // Use Node's syntax check (--check flag)
    execSync(`node --check "${BUILT_FILE}"`, { stdio: "pipe" });
  });

  it("built file size is reasonable", () => {
    const stat = fs.statSync(BUILT_FILE);
    // Should be > 10KB (installer + embedded server) and < 500KB
    assert.ok(stat.size > 10000, `file too small: ${stat.size} bytes`);
    assert.ok(stat.size < 500000, `file too large: ${stat.size} bytes`);
  });

  it("server.js source matches decoded base64", () => {
    const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf-8");
    const content = fs.readFileSync(BUILT_FILE, "utf-8");
    const match = content.match(/const SERVER_B64 = "([A-Za-z0-9+/=]+)"/);
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    assert.equal(decoded, serverSrc, "embedded base64 should exactly match server.js");
  });
});
