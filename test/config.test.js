const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// Extract functions from install.js for testing
// We can't require install.js (it starts readline + main), so we extract
// the pure functions we need to test.
// ---------------------------------------------------------------------------

const installSrc = fs.readFileSync(path.join(__dirname, "..", "install.js"), "utf-8");

// Extract makeServerEntry
const makeMatch = installSrc.match(/(function makeServerEntry\([\s\S]*?\n\})/);
if (!makeMatch) throw new Error("Could not extract makeServerEntry from install.js");
const makeServerEntry = new Function(`${makeMatch[1]}; return makeServerEntry;`)();

// Extract injectConfig
const injectMatch = installSrc.match(/(function injectConfig\([\s\S]*?\n\})/);
if (!injectMatch) throw new Error("Could not extract injectConfig from install.js");

const injectConfig = new Function("fs", "path", "info", `${injectMatch[1]}; return injectConfig;`)(fs, path, () => {});

// Extract BEHAVIOR_FLAGS
const flagsMatch = installSrc.match(/(const BEHAVIOR_FLAGS = \[[\s\S]*?\];)/);
if (!flagsMatch) throw new Error("Could not extract BEHAVIOR_FLAGS from install.js");
const BEHAVIOR_FLAGS = new Function(`${flagsMatch[1]}; return BEHAVIOR_FLAGS;`)();

// Extract AGENTS
const agentsMatch = installSrc.match(/(const AGENTS = \[[\s\S]*?\];)/);
if (!agentsMatch) throw new Error("Could not extract AGENTS from install.js");

const AGENTS = new Function("os", "path", "IS_WIN", "IS_MAC", `${agentsMatch[1]}; return AGENTS;`)(
  os, path, process.platform === "win32", process.platform === "darwin"
);

describe("makeServerEntry", () => {
  it("creates valid entry with command, args, and env", () => {
    const entry = makeServerEntry("/home/user/.telegram-mcp-bridge/server.js", "123:ABC", "456");
    assert.equal(entry.command, "node");
    assert.deepEqual(entry.args, ["/home/user/.telegram-mcp-bridge/server.js"]);
    assert.equal(entry.env.TELEGRAM_BOT_TOKEN, "123:ABC");
    assert.equal(entry.env.TELEGRAM_CHAT_ID, "456");
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    const entry = makeServerEntry("C:\\Users\\test\\.telegram-mcp-bridge\\server.js", "t", "c");
    assert.equal(entry.args[0], "C:/Users/test/.telegram-mcp-bridge/server.js");
  });

  it("preserves forward slashes on Unix paths", () => {
    const entry = makeServerEntry("/home/user/server.js", "t", "c");
    assert.equal(entry.args[0], "/home/user/server.js");
  });
});

describe("injectConfig", () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    // Clean up backup files
    const dir = path.dirname(tmpFile);
    const base = path.basename(tmpFile);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(base + ".bak.")) fs.unlinkSync(path.join(dir, f));
      }
    } catch { /* ok */ }
  });

  it("creates config file if it does not exist", () => {
    const entry = { command: "node", args: ["server.js"], env: {} };
    injectConfig(tmpFile, "mcpServers", entry);
    const config = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    assert.deepEqual(config.mcpServers["telegram-bridge"], entry);
  });

  it("preserves existing config entries", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      mcpServers: { "other-server": { command: "python", args: ["other.py"] } }
    }));
    const entry = { command: "node", args: ["server.js"], env: {} };
    injectConfig(tmpFile, "mcpServers", entry);
    const config = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    assert.ok(config.mcpServers["other-server"], "existing entry should be preserved");
    assert.deepEqual(config.mcpServers["telegram-bridge"], entry);
  });

  it("creates backup of existing config", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ mcpServers: {} }));
    const entry = { command: "node", args: ["server.js"], env: {} };
    injectConfig(tmpFile, "mcpServers", entry);
    const dir = path.dirname(tmpFile);
    const base = path.basename(tmpFile);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith(base + ".bak."));
    assert.ok(backups.length > 0, "should create a backup file");
  });

  it("overwrites existing telegram-bridge entry", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      mcpServers: { "telegram-bridge": { command: "old", args: [], env: {} } }
    }));
    const entry = { command: "node", args: ["new-server.js"], env: { TOKEN: "new" } };
    injectConfig(tmpFile, "mcpServers", entry);
    const config = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    assert.equal(config.mcpServers["telegram-bridge"].args[0], "new-server.js");
  });

  it("handles different key names (e.g. 'servers' for VS Code)", () => {
    const entry = { command: "node", args: ["server.js"], env: {} };
    injectConfig(tmpFile, "servers", entry);
    const config = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    assert.deepEqual(config.servers["telegram-bridge"], entry);
  });
});

describe("BEHAVIOR_FLAGS", () => {
  it("has 4 flags defined", () => {
    assert.equal(BEHAVIOR_FLAGS.length, 4);
  });

  it("all flags have key, label, and desc", () => {
    for (const flag of BEHAVIOR_FLAGS) {
      assert.ok(flag.key, "flag should have key");
      assert.ok(flag.label, "flag should have label");
      assert.ok(flag.desc, "flag should have desc");
      assert.ok(flag.key.startsWith("TELEGRAM_"), "key should start with TELEGRAM_");
    }
  });
});

describe("AGENTS", () => {
  it("has 8 agents defined", () => {
    assert.equal(AGENTS.length, 8);
  });

  it("all agents have id, name, configPath, and key", () => {
    for (const agent of AGENTS) {
      assert.ok(typeof agent.id === "number", "agent should have numeric id");
      assert.ok(agent.name, "agent should have name");
      assert.ok(typeof agent.configPath === "function", "agent should have configPath function");
      assert.ok(agent.key, "agent should have key");
    }
  });

  it("agent ids are sequential 1-8", () => {
    const ids = AGENTS.map((a) => a.id);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("configPath returns strings", () => {
    for (const agent of AGENTS) {
      const cp = agent.configPath();
      assert.ok(typeof cp === "string", `${agent.name} configPath should return string`);
    }
  });
});
