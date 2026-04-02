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

// Extract Windows/home config path helpers used by AGENTS
const helperMatch = installSrc.match(/(function uniqueNonEmpty\([\s\S]*?function resolveWindowsRoamingConfigPath\([\s\S]*?\n\})/);
if (!helperMatch) throw new Error("Could not extract config path helpers from install.js");

function createPathHelpers({ env = process.env, homedir = os.homedir(), isWin = process.platform === "win32" } = {}) {
  return new Function("fs", "os", "path", "process", "IS_WIN", `${helperMatch[1]}; return { uniqueNonEmpty, getWindowsHomeCandidates, getHomeCandidates, pickConfigPath, resolveHomeConfigPath, resolveWindowsRoamingConfigPath };`) (
    fs,
    { homedir: () => homedir },
    path,
    { env },
    isWin
  );
}

// Extract BEHAVIOR_FLAGS
const flagsMatch = installSrc.match(/(const BEHAVIOR_FLAGS = \[[\s\S]*?\];)/);
if (!flagsMatch) throw new Error("Could not extract BEHAVIOR_FLAGS from install.js");
const BEHAVIOR_FLAGS = new Function(`${flagsMatch[1]}; return BEHAVIOR_FLAGS;`)();

// Extract AGENTS
const agentsMatch = installSrc.match(/(const AGENTS = \[[\s\S]*?\];)/);
if (!agentsMatch) throw new Error("Could not extract AGENTS from install.js");

const defaultPathHelpers = createPathHelpers();
const AGENTS = new Function("resolveHomeConfigPath", "resolveWindowsRoamingConfigPath", "os", "path", "IS_WIN", "IS_MAC", `${agentsMatch[1]}; return AGENTS;`)(
  defaultPathHelpers.resolveHomeConfigPath,
  defaultPathHelpers.resolveWindowsRoamingConfigPath,
  os,
  path,
  process.platform === "win32",
  process.platform === "darwin"
);

// Extract installer flow helpers
const tokenChoiceMatch = installSrc.match(/(function resolveTokenSetupChoice\([\s\S]*?\n\})/);
if (!tokenChoiceMatch) throw new Error("Could not extract resolveTokenSetupChoice from install.js");
const resolveTokenSetupChoice = new Function(`${tokenChoiceMatch[1]}; return resolveTokenSetupChoice;`)();

const chatChoiceMatch = installSrc.match(/(function resolveChatSetupChoice\([\s\S]*?\n\})/);
if (!chatChoiceMatch) throw new Error("Could not extract resolveChatSetupChoice from install.js");
const resolveChatSetupChoice = new Function(`${chatChoiceMatch[1]}; return resolveChatSetupChoice;`)();

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

describe("installer selection helpers", () => {
  it("treats option 2 as using an existing bot token", () => {
    assert.equal(resolveTokenSetupChoice("2"), "existing");
  });

  it("treats non-2 token choices as creating a bot", () => {
    assert.equal(resolveTokenSetupChoice("1"), "create");
    assert.equal(resolveTokenSetupChoice(""), "create");
  });

  it("treats option 3 as manual chat id entry", () => {
    assert.equal(resolveChatSetupChoice("3"), "manual");
  });

  it("treats non-3 chat choices as auto detection", () => {
    assert.equal(resolveChatSetupChoice("1"), "auto");
    assert.equal(resolveChatSetupChoice("2"), "auto");
    assert.equal(resolveChatSetupChoice(""), "auto");
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

describe("config path helpers", () => {
  it("prefers a real roaming config under the user profile when APPDATA is sandboxed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-path-test-"));
    try {
      const realHome = path.join(root, "real-home");
      const fakeHome = path.join(root, "fake-home");
      const fakeAppData = path.join(root, "fake-appdata");
      const realConfig = path.join(realHome, "AppData", "Roaming", "Claude", "claude_desktop_config.json");

      fs.mkdirSync(path.dirname(realConfig), { recursive: true });
      fs.mkdirSync(fakeAppData, { recursive: true });
      fs.writeFileSync(realConfig, "{}", "utf-8");

      const helpers = createPathHelpers({
        env: {
          APPDATA: fakeAppData,
          USERPROFILE: realHome,
          HOME: fakeHome,
          HOMEDRIVE: path.parse(realHome).root.replace(/\\$/, ""),
          HOMEPATH: realHome.slice(path.parse(realHome).root.length - 1),
        },
        homedir: fakeHome,
        isWin: true,
      });

      const resolved = helpers.resolveWindowsRoamingConfigPath("Claude", "claude_desktop_config.json");
      assert.equal(resolved, realConfig);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// Extract validateExistingSetup
const validateMatch = installSrc.match(/(function validateExistingSetup\([\s\S]*?\n\})/);
if (!validateMatch) throw new Error("Could not extract validateExistingSetup from install.js");

describe("validateExistingSetup", () => {
  let tmpDir;
  let origAgents;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createValidator(installDir, agents) {
    return new Function("fs", "path", "INSTALL_DIR", "AGENTS",
      `${validateMatch[1]}; return validateExistingSetup;`
    )(fs, path, installDir, agents);
  }

  it("returns invalid when server.js does not exist", () => {
    const validate = createValidator(tmpDir, []);
    const result = validate();
    assert.equal(result.valid, false);
    assert.equal(result.agents.length, 0);
  });

  it("returns invalid when no agent configs have telegram-bridge", () => {
    fs.writeFileSync(path.join(tmpDir, "server.js"), "// server");
    const configPath = path.join(tmpDir, "mcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
    const agents = [{ id: 1, name: "Test", configPath: () => configPath, key: "mcpServers" }];
    const validate = createValidator(tmpDir, agents);
    const result = validate();
    assert.equal(result.valid, false);
  });

  it("returns valid when agent config has token and chatId", () => {
    fs.writeFileSync(path.join(tmpDir, "server.js"), "// server");
    const configPath = path.join(tmpDir, "mcp.json");
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        "telegram-bridge": {
          command: "node",
          args: ["server.js"],
          env: { TELEGRAM_BOT_TOKEN: "123456:ABCDEF", TELEGRAM_CHAT_ID: "-100123" },
        },
      },
    }));
    const agents = [{ id: 1, name: "TestAgent", configPath: () => configPath, key: "mcpServers" }];
    const validate = createValidator(tmpDir, agents);
    const result = validate();
    assert.equal(result.valid, true);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].name, "TestAgent");
    assert.equal(result.agents[0].chatId, "-100123");
    assert.ok(result.agents[0].maskedToken.includes("****"));
  });

  it("returns invalid when token is missing", () => {
    fs.writeFileSync(path.join(tmpDir, "server.js"), "// server");
    const configPath = path.join(tmpDir, "mcp.json");
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        "telegram-bridge": {
          command: "node",
          args: ["server.js"],
          env: { TELEGRAM_CHAT_ID: "-100123" },
        },
      },
    }));
    const agents = [{ id: 1, name: "Test", configPath: () => configPath, key: "mcpServers" }];
    const validate = createValidator(tmpDir, agents);
    const result = validate();
    assert.equal(result.valid, false);
  });

  it("skips agents with __special__ config paths", () => {
    fs.writeFileSync(path.join(tmpDir, "server.js"), "// server");
    const agents = [
      { id: 1, name: "VSCode", configPath: () => "__vscode__", key: "servers" },
      { id: 2, name: "Manual", configPath: () => "__manual__", key: "mcpServers" },
    ];
    const validate = createValidator(tmpDir, agents);
    const result = validate();
    assert.equal(result.valid, false);
    assert.equal(result.agents.length, 0);
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
