#!/usr/bin/env node
// =============================================================================
//  Telegram MCP Bridge — One-File Installer
//  Run: node install.js
//  Works on Windows, macOS, Linux. Requires Node.js 18+.
// =============================================================================

const readline = require("readline");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const INSTALL_DIR = path.join(os.homedir(), ".telegram-mcp-bridge");
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// ---------------------------------------------------------------------------
// Colors (ANSI)
// ---------------------------------------------------------------------------
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m",
};
const ok = (s) => console.log(`  ${C.green}✔${C.reset} ${s}`);
const warn = (s) => console.log(`  ${C.yellow}⚠${C.reset} ${s}`);
const fail = (s) => console.log(`  ${C.red}✘${C.reset} ${s}`);
const info = (s) => console.log(`  ${C.dim}${s}${C.reset}`);
const step = (n, total, s) => console.log(`\n${C.blue}${C.bold}[${n}/${total}]${C.reset} ${C.bold}${s}${C.reset}`);

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(`  ${C.cyan}▸${C.reset} ${q}`, res));

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject).on("timeout", function () { this.destroy(); reject(new Error("timeout")); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: "POST", timeout: 15000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
}

function tgApi(token, method, body) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  return body ? httpPost(url, body).then(JSON.parse) : httpGet(url).then(JSON.parse);
}

// ---------------------------------------------------------------------------
// Open URL cross-platform
// ---------------------------------------------------------------------------
function openUrl(url) {
  try {
    if (IS_WIN) execSync(`start "" "${url}"`, { stdio: "ignore", shell: true });
    else if (IS_MAC) execSync(`open "${url}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null`, { stdio: "ignore", shell: true });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------
const AGENTS = [
  { id: 1, name: "Claude Code", configPath: () => path.join(os.homedir(), ".claude.json"), key: "mcpServers" },
  {
    id: 2, name: "Claude Desktop", key: "mcpServers",
    configPath: () => {
      if (IS_WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      if (IS_MAC) return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
      return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
    },
  },
  { id: 3, name: "Cursor", configPath: () => path.join(os.homedir(), ".cursor", "mcp.json"), key: "mcpServers" },
  { id: 4, name: "Windsurf", configPath: () => path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers" },
  {
    id: 5, name: "VS Code (Copilot)", configPath: () => "__vscode__", key: "servers",
  },
  { id: 6, name: "Gemini CLI", configPath: () => path.join(os.homedir(), ".gemini", "settings.json"), key: "mcpServers" },
  { id: 7, name: "Cline", configPath: () => path.join(os.homedir(), ".cline", "mcp_config.json"), key: "mcpServers" },
  { id: 8, name: "Other / Manual", configPath: () => "__manual__", key: "mcpServers" },
];

// ---------------------------------------------------------------------------
// Server entry JSON for config injection
// ---------------------------------------------------------------------------
function makeServerEntry(serverPath, botToken, chatId) {
  // Normalize to forward slashes for JSON config (Node handles both on Windows)
  const normalizedPath = serverPath.replace(/\\/g, "/");
  return {
    command: "node",
    args: [normalizedPath],
    env: {
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_CHAT_ID: chatId,
    },
  };
}

// ---------------------------------------------------------------------------
// Config injection
// ---------------------------------------------------------------------------
function injectConfig(configPath, key, entry) {
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }
    // Backup
    const bak = configPath + ".bak." + Date.now();
    fs.copyFileSync(configPath, bak);
    info(`Backed up to ${path.basename(bak)}`);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (!config[key]) config[key] = {};
  config[key]["telegram-bridge"] = entry;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Embedded server.js as base64 (injected by build.js, or read from adjacent file)
// ---------------------------------------------------------------------------
const SERVER_B64 = "%%SERVER_B64%%";

function getServerCode() {
  // Prefer adjacent server.js for development
  const localServer = path.join(__dirname, "server.js");
  if (fs.existsSync(localServer)) return fs.readFileSync(localServer, "utf-8");
  // Fall back to embedded base64
  if (SERVER_B64 && SERVER_B64 !== "%%SERVER" + "_B64%%") {
    return Buffer.from(SERVER_B64, "base64").toString("utf-8");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Behavior flag definitions
// ---------------------------------------------------------------------------
const BEHAVIOR_FLAGS = [
  { key: "TELEGRAM_AUTO_START",   label: "Auto-greet",   desc: "Send greeting + plan summary at session start" },
  { key: "TELEGRAM_AUTO_END",     label: "Auto-summary", desc: "Send summary when task/session ends" },
  { key: "TELEGRAM_AUTO_SUMMARY", label: "Work summary", desc: "Send summary when starting new work" },
  { key: "TELEGRAM_AUTO_POLL",    label: "Auto-poll",    desc: "Auto-poll for user messages regularly" },
];

// ---------------------------------------------------------------------------
// Configure command — edit behavior flags on an existing install
// ---------------------------------------------------------------------------
async function runConfigure() {
  console.log("");
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║     📡 Telegram MCP Bridge — Configure          ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log("");

  // Find which agents have telegram-bridge configured
  const found = [];
  for (const agent of AGENTS) {
    const cp = agent.configPath();
    if (cp.startsWith("__")) continue;
    if (!fs.existsSync(cp)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(cp, "utf-8"));
      const entry = config[agent.key]?.["telegram-bridge"];
      if (entry) found.push({ agent, configPath: cp, config, entry });
    } catch { /* skip */ }
  }

  if (!found.length) {
    fail("No existing Telegram MCP Bridge installation found.");
    info("Run without 'configure' to install first.");
    rl.close();
    return;
  }

  // If multiple agents, let user pick
  let target;
  if (found.length === 1) {
    target = found[0];
    ok(`Found config: ${target.agent.name} (${target.configPath})`);
  } else {
    console.log(`  ${C.bold}Found multiple installations:${C.reset}`);
    console.log("");
    found.forEach((f, i) => console.log(`    ${C.bold}${i + 1})${C.reset} ${f.agent.name}`));
    console.log("");
    let choice;
    while (true) {
      const input = (await ask(`Choose [1-${found.length}]: `)).trim();
      const num = parseInt(input, 10);
      if (num >= 1 && num <= found.length) { choice = num - 1; break; }
      warn("Invalid choice.");
    }
    target = found[choice];
  }

  const env = target.entry.env || {};
  console.log("");
  console.log(`  ${C.bold}Current behavior flags:${C.reset}`);
  console.log("");

  for (const flag of BEHAVIOR_FLAGS) {
    const current = env[flag.key] !== "false";
    console.log(`    ${current ? C.green + "✔" : C.red + "✘"}${C.reset} ${C.bold}${flag.label}${C.reset} — ${flag.desc}`);
  }

  console.log("");
  console.log(`  ${C.bold}Toggle flags:${C.reset}`);
  console.log("");
  BEHAVIOR_FLAGS.forEach((f, i) => {
    const current = env[f.key] !== "false";
    console.log(`    ${C.bold}${i + 1})${C.reset} ${f.label} [${current ? "ON" : "OFF"}]`);
  });
  console.log(`    ${C.bold}${BEHAVIOR_FLAGS.length + 1})${C.reset} Update server.js to latest`);
  console.log(`    ${C.bold}0)${C.reset} Save & exit`);
  console.log("");

  let changed = false;
  while (true) {
    const input = (await ask("Toggle [0 to save]: ")).trim();
    const num = parseInt(input, 10);
    if (num === 0) break;
    if (num === BEHAVIOR_FLAGS.length + 1) {
      // Update server.js
      const serverCode = getServerCode();
      if (serverCode) {
        const serverPath = target.entry.args?.[0] || path.join(INSTALL_DIR, "server.js");
        fs.writeFileSync(serverPath, serverCode);
        ok("server.js updated to latest version");
      } else {
        fail("Could not find server.js source");
      }
      continue;
    }
    if (num < 1 || num > BEHAVIOR_FLAGS.length) { warn("Invalid choice."); continue; }
    const flag = BEHAVIOR_FLAGS[num - 1];
    const current = env[flag.key] !== "false";
    env[flag.key] = current ? "false" : "true";
    changed = true;
    const newVal = !current;
    ok(`${flag.label}: ${newVal ? "ON" : "OFF"}`);
  }

  if (changed) {
    // Clean up: remove flags that are "true" (default) to keep config clean
    for (const flag of BEHAVIOR_FLAGS) {
      if (env[flag.key] === "true") delete env[flag.key];
    }
    target.entry.env = env;
    target.config[target.agent.key]["telegram-bridge"] = target.entry;
    // Backup
    const bak = target.configPath + ".bak." + Date.now();
    fs.copyFileSync(target.configPath, bak);
    info(`Backed up to ${path.basename(bak)}`);
    fs.writeFileSync(target.configPath, JSON.stringify(target.config, null, 2));
    ok(`Config saved to ${target.configPath}`);
    info("Restart your agent/IDE to apply changes.");
  } else {
    info("No changes made.");
  }

  console.log("");
  rl.close();
}

// ---------------------------------------------------------------------------
// Main installer
// ---------------------------------------------------------------------------
async function main() {
  // Route to configure if requested
  const args = process.argv.slice(2);
  if (args.includes("configure") || args.includes("--configure") || args.includes("-c")) {
    return runConfigure();
  }

  const TOTAL = 6;

  console.log("");
  console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║       📡 Telegram MCP Bridge — Installer        ║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log("");

  // ── Step 1: Prerequisites ─────────────────────────────────────────────
  step(1, TOTAL, "Checking prerequisites");

  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major < 18) {
    fail(`Node.js 18+ required (found v${nodeVersion})`);
    process.exit(1);
  }
  ok(`Node.js v${nodeVersion}`);

  // Check npm
  try {
    execSync("npm --version", { stdio: "pipe" });
    ok("npm available");
  } catch {
    fail("npm not found");
    process.exit(1);
  }

  // ── Step 2: Choose agent ──────────────────────────────────────────────
  step(2, TOTAL, "Choose your AI agent / IDE");
  console.log("");
  for (const a of AGENTS) {
    console.log(`    ${C.bold}${a.id})${C.reset} ${a.name}`);
  }
  console.log("");

  let agentChoice;
  while (true) {
    const input = (await ask("Enter number [1-8]: ")).trim();
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 8) { agentChoice = num; break; }
    warn("Invalid choice, try again.");
  }
  const agent = AGENTS.find((a) => a.id === agentChoice);
  ok(`Selected: ${agent.name}`);

  // ── Step 3: Install npm dependencies ──────────────────────────────────
  step(3, TOTAL, "Installing server & dependencies");

  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  // Write package.json
  const pkg = {
    name: "telegram-mcp-bridge",
    version: "1.0.0",
    private: true,
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.12.1",
    },
  };
  fs.writeFileSync(path.join(INSTALL_DIR, "package.json"), JSON.stringify(pkg, null, 2));

  // Deploy server.js (from adjacent file or embedded base64)
  const serverCode = getServerCode();
  if (!serverCode) {
    fail("server.js not found. If using the dev installer, place server.js next to install.js.");
    fail("If using the built installer, the base64 embedding is missing — re-run build.js.");
    process.exit(1);
  }
  fs.writeFileSync(path.join(INSTALL_DIR, "server.js"), serverCode);
  ok("Server deployed");

  // npm install
  info("Installing @modelcontextprotocol/sdk (this may take a moment)...");
  try {
    execSync("npm install --production", {
      cwd: INSTALL_DIR,
      stdio: "pipe",
      timeout: 120000,
    });
    ok("Dependencies installed");
  } catch (e) {
    fail("npm install failed: " + (e.stderr?.toString().slice(0, 200) || e.message));
    process.exit(1);
  }

  // ── Step 4: Telegram bot setup ────────────────────────────────────────
  step(4, TOTAL, "Telegram Bot setup");
  console.log("");
  console.log(`  ${C.bold}Do you already have a Telegram bot token?${C.reset}`);
  console.log(`    ${C.bold}1)${C.reset} No, I need to create a new bot`);
  console.log(`    ${C.bold}2)${C.reset} Yes, I have a token ready`);
  console.log("");

  const hasToken = (await ask("Enter choice [1-2]: ")).trim();

  if (hasToken !== "2") {
    console.log("");
    console.log(`  ${C.bold}Opening BotFather in Telegram...${C.reset}`);
    info("If it doesn't open, go to: https://t.me/BotFather");
    console.log("");
    openUrl("https://t.me/BotFather");

    console.log(`  ${C.bold}In the BotFather chat:${C.reset}`);
    console.log("");
    console.log(`  ${C.cyan}1.${C.reset} Click ${C.bold}Start${C.reset} (or type /start)`);
    console.log(`  ${C.cyan}2.${C.reset} Type: ${C.bold}/newbot${C.reset}`);
    console.log(`  ${C.cyan}3.${C.reset} Enter any name, e.g.: ${C.bold}Agent Bridge${C.reset}`);
    console.log(`  ${C.cyan}4.${C.reset} Enter a username ending in 'bot', e.g.: ${C.bold}my_agent_bridge_bot${C.reset}`);
    console.log(`  ${C.cyan}5.${C.reset} BotFather gives you a token like: ${C.bold}7123456789:AAHfG3kB3x_example${C.reset}`);
    console.log("");
  }

  // --- Token input (robust: sanitize to avoid paste issues) ---
  console.log("");
  info("Tip: If pasting crashes, save the token to a file and enter the file path instead.");
  console.log("");
  const rawToken = (await ask("Paste your bot token (or path to a file containing it): ")).trim();

  let botToken;
  // Check if user gave a file path
  if (fs.existsSync(rawToken)) {
    botToken = fs.readFileSync(rawToken, "utf-8").trim();
    info("Read token from file");
  } else {
    botToken = rawToken;
  }
  // Sanitize: keep only valid token chars
  botToken = botToken.replace(/[^a-zA-Z0-9:_-]/g, "");

  if (!botToken) {
    fail("Token is empty. Please try again.");
    process.exit(1);
  }

  // Mask for display
  const masked = botToken.length > 10
    ? botToken.slice(0, 4) + "*".repeat(botToken.length - 8) + botToken.slice(-4)
    : botToken.slice(0, 2) + "****" + botToken.slice(-2);
  ok(`Token received: ${masked}`);

  if (!/^\d+:.+$/.test(botToken)) {
    warn("Token format looks unusual (expected 123456:ABC...). Continuing anyway.");
  }

  // --- Verify token ---
  info("Verifying bot token with Telegram...");
  let botUsername = "";
  try {
    const me = await tgApi(botToken, "getMe");
    if (me.ok) {
      const b = me.result;
      ok(`Bot verified: ${b.first_name} (@${b.username})`);
      botUsername = b.username;
    } else {
      warn("Token verification failed: " + JSON.stringify(me));
      const cont = (await ask("Continue anyway? [y/N]: ")).trim().toLowerCase();
      if (cont !== "y") process.exit(1);
    }
  } catch (e) {
    warn("Verification error: " + e.message);
    const cont = (await ask("Continue anyway? [y/N]: ")).trim().toLowerCase();
    if (cont !== "y") process.exit(1);
  }

  // --- Get chat ID (Forum Group setup) ---
  console.log("");
  console.log(`  ${C.bold}Now we need a Telegram group with Topics enabled.${C.reset}`);
  console.log(`  ${C.bold}Each agent session gets its own topic — full isolation.${C.reset}`);
  console.log("");
  console.log(`  ${C.bold}Do you already have a forum group set up?${C.reset}`);
  console.log(`    ${C.bold}1)${C.reset} No, help me create one`);
  console.log(`    ${C.bold}2)${C.reset} Yes, I have the group Chat ID ready`);
  console.log("");

  const hasGroup = (await ask("Enter choice [1-2]: ")).trim();

  if (hasGroup !== "2") {
    console.log("");
    console.log(`  ${C.cyan}${C.bold}Follow these steps in Telegram:${C.reset}`);
    console.log("");
    console.log(`  ${C.cyan}1.${C.reset} Open Telegram and tap ${C.bold}New Group${C.reset}`);
    console.log(`  ${C.cyan}2.${C.reset} Add your bot ${C.bold}@${botUsername || "your_bot"}${C.reset} as a member`);
    console.log(`  ${C.cyan}3.${C.reset} Name it something like ${C.bold}Agent Bridge${C.reset} and create it`);
    console.log(`  ${C.cyan}4.${C.reset} Open ${C.bold}Group Settings${C.reset} (tap group name at top)`);
    console.log(`  ${C.cyan}5.${C.reset} Tap ${C.bold}Edit${C.reset} (pencil icon) → scroll down`);
    console.log(`  ${C.cyan}6.${C.reset} Enable ${C.bold}Topics${C.reset} (this converts it to a forum supergroup)`);
    console.log(`  ${C.cyan}7.${C.reset} Go to ${C.bold}Administrators${C.reset} → tap your bot → enable:`);
    console.log(`     • ${C.bold}Manage Topics${C.reset}`);
    console.log(`     • ${C.bold}Delete Messages${C.reset} (optional but recommended)`);
    console.log(`  ${C.cyan}8.${C.reset} Send any message in the group (e.g. ${C.bold}hello${C.reset})`);
    console.log("");
    info("The installer will detect the group automatically...");
    console.log("");
  }

  // Flush old updates and track offset
  let detectOffset = 0;
  try {
    const old = await tgApi(botToken, "getUpdates", { offset: -1 });
    if (old.ok && old.result && old.result.length) {
      detectOffset = old.result[old.result.length - 1].update_id + 1;
      await tgApi(botToken, "getUpdates", { offset: detectOffset });
    }
  } catch { /* ignore */ }

  let chatId = "";
  let chatTitle = "";

  if (hasGroup === "2") {
    chatId = (await ask("Enter your group Chat ID (starts with -): ")).trim();
  } else {
    // Poll for new message from the group
    const pollStart = Date.now();
    const pollTimeout = 180000; // 3 minutes

    process.stdout.write(`  ${C.cyan}⏳${C.reset} ${C.dim}Waiting for a message in the group...${C.reset}`);

    while (Date.now() - pollStart < pollTimeout) {
      try {
        const res = await tgApi(botToken, "getUpdates", { offset: detectOffset, timeout: 5 });
        if (res.ok && res.result) {
          for (const u of res.result) {
            detectOffset = u.update_id + 1;
            const msg = u.message;
            if (!msg || !msg.chat) continue;
            // Look for supergroup (forum groups are supergroups)
            if (msg.chat.type === "supergroup" || msg.chat.type === "group") {
              chatId = String(msg.chat.id);
              chatTitle = msg.chat.title || "";
              await tgApi(botToken, "getUpdates", { offset: detectOffset });
              break;
            }
          }
        }
        if (chatId) break;
      } catch { /* retry */ }
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(""); // newline after dots

    if (!chatId) {
      warn("Auto-detect timed out.");
      console.log("");
      info("Find it manually: open this URL in a browser:");
      info(`https://api.telegram.org/bot${botToken}/getUpdates`);
      info('Look for: "chat":{"id":-100XXXXXXXXXX,"type":"supergroup"}');
      console.log("");
      chatId = (await ask("Enter your group Chat ID: ")).trim();
    }
  }

  if (chatId) {
    ok(`Detected! Chat ID: ${chatId}${chatTitle ? ` (${chatTitle})` : ""}`);
  }

  if (!chatId || !/^-?\d+$/.test(chatId)) {
    fail("Invalid chat ID. Group IDs typically start with -100...");
    process.exit(1);
  }

  // --- Verify it's a forum group (handle migration) ---
  info("Verifying group setup...");
  let isForumGroup = false;
  try {
    let chatInfo = await tgApi(botToken, "getChat", { chat_id: parseInt(chatId, 10) });

    // Handle migration: old group → supergroup
    if (!chatInfo.ok && chatInfo.parameters?.migrate_to_chat_id) {
      const newId = String(chatInfo.parameters.migrate_to_chat_id);
      info(`Group migrated to supergroup: ${chatId} → ${newId}`);
      chatId = newId;
      chatInfo = await tgApi(botToken, "getChat", { chat_id: parseInt(chatId, 10) });
    }

    if (chatInfo.ok && chatInfo.result) {
      const chat = chatInfo.result;
      // Also handle migration via response (some API versions return it differently)
      if (chat.id && String(chat.id) !== chatId) {
        info(`Chat ID updated: ${chatId} → ${chat.id}`);
        chatId = String(chat.id);
      }
      if (chat.is_forum) {
        ok("Forum topics are enabled ✓");
        isForumGroup = true;
      } else {
        warn("Topics are NOT enabled on this group.");
        console.log("");
        console.log(`  ${C.bold}To enable Topics:${C.reset}`);
        console.log(`  1. Open the group in Telegram`);
        console.log(`  2. Tap the group name → Edit → enable Topics`);
        console.log("");
        const cont = (await ask("Continue anyway? [y/N]: ")).trim().toLowerCase();
        if (cont !== "y") process.exit(1);
      }
    }
  } catch (e) {
    warn("Could not verify group: " + e.message);
  }

  // --- Verify bot is admin with manage_topics ---
  try {
    const me = await tgApi(botToken, "getMe");
    if (me.ok) {
      const member = await tgApi(botToken, "getChatMember", {
        chat_id: parseInt(chatId, 10),
        user_id: me.result.id,
      });
      if (member.ok && member.result) {
        const status = member.result.status;
        if (status === "administrator" || status === "creator") {
          const canManageTopics = member.result.can_manage_topics;
          if (canManageTopics) {
            ok("Bot is admin with Manage Topics permission ✓");
          } else {
            warn("Bot is admin but missing 'Manage Topics' permission.");
            info("Go to Group Settings → Administrators → your bot → enable Manage Topics");
          }
        } else {
          warn("Bot is not an administrator in this group.");
          info("Go to Group Settings → Administrators → Add your bot as admin");
          info("Enable at least: Manage Topics");
        }
      }
    }
  } catch (e) {
    warn("Could not check bot permissions: " + e.message);
  }

  // --- Send test message ---
  info("Sending test message...");
  try {
    const testRes = await tgApi(botToken, "sendMessage", {
      chat_id: parseInt(chatId, 10),
      text: "🔗 *Telegram MCP Bridge installed!*\n\nEach agent session will create its own topic here.\nChat ID: `" + chatId + "`",
      parse_mode: "Markdown",
    });
    if (testRes.ok) ok("Test message sent — check your Telegram group!");
    else warn("Test message failed, continuing.");
  } catch {
    try {
      await tgApi(botToken, "sendMessage", {
        chat_id: parseInt(chatId, 10),
        text: "Telegram MCP Bridge installed! Each agent session will create its own topic here. Chat ID: " + chatId,
      });
      ok("Test message sent (plain text)");
    } catch {
      warn("Test message failed. Make sure the bot is in the group and is an admin.");
    }
  }

  // ── Step 5: Write agent prompt ────────────────────────────────────────
  step(5, TOTAL, "Writing agent instructions");

  const agentPrompt = `# Telegram Bridge — Agent Instructions

You have access to a Telegram MCP bridge for async communication with the user.
Each session has its own topic in a Telegram forum group — your messages are isolated.

## Tool: \`interact\`
Single unified tool for all communication:
- \`interact({message: "text"})\` — Send a message
- \`interact({})\` — Check for new messages
- \`interact({wait: 120})\` — Wait up to 120s for a reply
- \`interact({message: "text", wait: 60, since_ts: N})\` — Send + wait + filter stale

Response: \`{ok, sent?, messages: [{text, ts}], pending, now}\`
Pass \`now\` as \`since_ts\` on next call to only get newer messages.

## Protocol
1. **Start**: \`interact\` with a greeting and plan summary.
2. **During work**: \`interact\` periodically (every few minutes) to check for input.
3. **Need input**: \`interact\` with your question + \`wait: 120\`.
4. **Done**: \`interact\` with a final summary + \`wait: 120\`.

## Tips
- Keep messages concise (phone-readable).
- Use \`since_ts\` to avoid reading stale messages from before your question.
- Batch updates — don't spam multiple messages.
`;
  fs.writeFileSync(path.join(INSTALL_DIR, "AGENT_PROMPT.md"), agentPrompt);
  ok(`Agent prompt saved to ${path.join(INSTALL_DIR, "AGENT_PROMPT.md")}`);

  // Write uninstall script
  if (IS_WIN) {
    fs.writeFileSync(path.join(INSTALL_DIR, "uninstall.bat"),
      `@echo off\r\necho Removing Telegram MCP Bridge...\r\nrd /s /q "%USERPROFILE%\\.telegram-mcp-bridge"\r\ndel /f "%USERPROFILE%\\.telegram_mcp_queue.json" 2>nul\r\necho Done! Remember to remove "telegram-bridge" from your agent's MCP config.\r\npause\r\n`
    );
  } else {
    fs.writeFileSync(path.join(INSTALL_DIR, "uninstall.sh"),
      `#!/bin/bash\necho "Removing Telegram MCP Bridge..."\nrm -rf "${os.homedir()}/.telegram-mcp-bridge"\nrm -f "${os.homedir()}/.telegram_mcp_queue.json"\necho "Done! Remember to remove \\"telegram-bridge\\" from your agent's MCP config."\n`
    );
    try { fs.chmodSync(path.join(INSTALL_DIR, "uninstall.sh"), 0o755); } catch { /* ok */ }
  }

  // ── Step 6: Configure agent ───────────────────────────────────────────
  step(6, TOTAL, `Configuring ${agent.name}`);

  const serverPath = path.join(INSTALL_DIR, "server.js");
  const entry = makeServerEntry(serverPath, botToken, chatId);
  const configPath = agent.configPath();

  if (configPath === "__vscode__") {
    console.log("");
    console.log(`  ${C.yellow}VS Code uses workspace-level MCP config.${C.reset}`);
    console.log(`  Create ${C.bold}.vscode/mcp.json${C.reset} in your project with:`);
    console.log("");
    console.log(JSON.stringify({ servers: { "telegram-bridge": { type: "stdio", ...entry } } }, null, 2)
      .split("\n").map((l) => "  " + l).join("\n"));
    console.log("");
    ok("Copy the JSON above into .vscode/mcp.json");
  } else if (configPath === "__manual__") {
    console.log("");
    console.log(`  ${C.bold}Add this to your agent's MCP config:${C.reset}`);
    console.log("");
    console.log(JSON.stringify({ "telegram-bridge": entry }, null, 2)
      .split("\n").map((l) => "  " + l).join("\n"));
    console.log("");
    ok("Copy the JSON above into your config");
  } else {
    try {
      injectConfig(configPath, agent.key, entry);
      ok(`Config written to ${configPath}`);
    } catch (e) {
      fail(`Auto-config failed: ${e.message}`);
      console.log("");
      console.log(`  ${C.bold}Add this manually to ${configPath}:${C.reset}`);
      console.log(JSON.stringify({ "telegram-bridge": entry }, null, 2)
        .split("\n").map((l) => "  " + l).join("\n"));
    }
  }

  // ── Done! ─────────────────────────────────────────────────────────────
  console.log("");
  console.log(`${C.green}${C.bold}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.green}${C.bold}║           ✅ Installation complete!              ║${C.reset}`);
  console.log(`${C.green}${C.bold}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log("");
  console.log(`  ${C.bold}Server:${C.reset}       ${serverPath}`);
  console.log(`  ${C.bold}Agent:${C.reset}        ${agent.name}`);
  if (configPath !== "__vscode__" && configPath !== "__manual__") {
    console.log(`  ${C.bold}Config:${C.reset}       ${configPath}`);
  }
  console.log(`  ${C.bold}Bot:${C.reset}          @${botUsername || "unknown"}`);
  console.log(`  ${C.bold}Chat ID:${C.reset}      ${chatId}`);
  console.log(`  ${C.bold}Mode:${C.reset}         Forum Topics (per-session isolation)`);
  console.log("");
  console.log(`  ${C.bold}Next steps:${C.reset}`);
  info("1. Restart your agent / IDE to load the new MCP server");
  info(`2. Add the contents of ${path.join(INSTALL_DIR, "AGENT_PROMPT.md")}`);
  info("   to your system prompt (CLAUDE.md / GEMINI.md / .cursorrules / rules)");
  info("3. Ask your agent to send you a Telegram message!");
  info("   → It will auto-create a topic in your forum group");
  console.log("");
  if (IS_WIN) {
    console.log(`  ${C.bold}Uninstall:${C.reset}  ${C.dim}${path.join(INSTALL_DIR, "uninstall.bat")}${C.reset}`);
  } else {
    console.log(`  ${C.bold}Uninstall:${C.reset}  ${C.dim}${path.join(INSTALL_DIR, "uninstall.sh")}${C.reset}`);
  }
  console.log("");

  rl.close();
}

main().catch((e) => {
  console.error(`\n${C.red}Fatal error:${C.reset} ${e.message}`);
  process.exit(1);
});
