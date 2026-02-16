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
const SERVER_B64 = "IyEvdXNyL2Jpbi9lbnYgbm9kZQovLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQovLyAgVGVsZWdyYW0gTUNQIEJyaWRnZSBTZXJ2ZXIKLy8gIEJyaWRnZXMgYSBsb25nLXJ1bm5pbmcgQUkgYWdlbnQgc2Vzc2lvbiB3aXRoIGEgaHVtYW4gdmlhIFRlbGVncmFtLgovLyAgVG9vbHM6IHNlbmRfbWVzc2FnZSwgcG9sbF9tZXNzYWdlcywgY2hlY2tfc3RhdHVzCi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Cgpjb25zdCB7IFNlcnZlciB9ID0gcmVxdWlyZSgiQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay9zZXJ2ZXIvaW5kZXguanMiKTsKY29uc3QgeyBTdGRpb1NlcnZlclRyYW5zcG9ydCB9ID0gcmVxdWlyZSgiQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay9zZXJ2ZXIvc3RkaW8uanMiKTsKY29uc3QgewogIENhbGxUb29sUmVxdWVzdFNjaGVtYSwKICBMaXN0VG9vbHNSZXF1ZXN0U2NoZW1hLAp9ID0gcmVxdWlyZSgiQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay90eXBlcy5qcyIpOwpjb25zdCBodHRwcyA9IHJlcXVpcmUoImh0dHBzIik7CmNvbnN0IGZzID0gcmVxdWlyZSgiZnMiKTsKY29uc3QgcGF0aCA9IHJlcXVpcmUoInBhdGgiKTsKCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQovLyBDb25maWcgZnJvbSBlbnYKLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCmNvbnN0IEJPVF9UT0tFTiA9IHByb2Nlc3MuZW52LlRFTEVHUkFNX0JPVF9UT0tFTiB8fCAiIjsKY29uc3QgQ0hBVF9JRCA9IHByb2Nlc3MuZW52LlRFTEVHUkFNX0NIQVRfSUQgfHwgIiI7CmNvbnN0IFFVRVVFX0ZJTEUgPSBwcm9jZXNzLmVudi5URUxFR1JBTV9NQ1BfUVVFVUVfRklMRSB8fAogIHBhdGguam9pbihyZXF1aXJlKCJvcyIpLmhvbWVkaXIoKSwgIi50ZWxlZ3JhbV9tY3BfcXVldWUuanNvbiIpOwpjb25zdCBNQVhfSElTVE9SWSA9IHBhcnNlSW50KHByb2Nlc3MuZW52LlRFTEVHUkFNX01DUF9NQVhfSElTVE9SWSB8fCAiNTAiLCAxMCk7CmNvbnN0IFBPTExfSU5URVJWQUxfTVMgPSBwYXJzZUludChwcm9jZXNzLmVudi5URUxFR1JBTV9QT0xMX0lOVEVSVkFMIHx8ICIyMDAwIiwgMTApOwoKLy8gQmVoYXZpb3IgZmxhZ3MgKHNldCBpbiBNQ1AgY29uZmlnIGVudiBibG9jaykKY29uc3QgQVVUT19TRU5EX1NUQVJUID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fQVVUT19TVEFSVCAhPT0gImZhbHNlIjsgLy8gZGVmYXVsdDogb24KY29uc3QgQVVUT19TRU5EX0VORCA9IHByb2Nlc3MuZW52LlRFTEVHUkFNX0FVVE9fRU5EICE9PSAiZmFsc2UiOyAgICAgLy8gZGVmYXVsdDogb24KY29uc3QgQVVUT19TVU1NQVJZID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fQVVUT19TVU1NQVJZICE9PSAiZmFsc2UiOyAgLy8gZGVmYXVsdDogb24KY29uc3QgQVVUT19QT0xMID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fQVVUT19QT0xMICE9PSAiZmFsc2UiOyAgICAgICAgLy8gZGVmYXVsdDogb24KCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQovLyBMb2dnaW5nIChzdGRlcnIgb25seSDigJQgc3Rkb3V0IGlzIE1DUCBzdGRpbyB0cmFuc3BvcnQpCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQpjb25zdCBsb2cgPSB7CiAgaW5mbzogKC4uLmEpID0+IHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbSU5GT10gJHthLmpvaW4oIiAiKX1cbmApLAogIHdhcm46ICguLi5hKSA9PiBwcm9jZXNzLnN0ZGVyci53cml0ZShgW1dBUk5dICR7YS5qb2luKCIgIil9XG5gKSwKICBlcnJvcjogKC4uLmEpID0+IHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbRVJST1JdICR7YS5qb2luKCIgIil9XG5gKSwKfTsKCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQovLyBUZWxlZ3JhbSBIVFRQIGhlbHBlcnMgKHplcm8gZGVwZW5kZW5jaWVzIOKAlCB1c2VzIGJ1aWx0LWluIGh0dHBzKQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KZnVuY3Rpb24gdGdBcGkobWV0aG9kLCBib2R5KSB7CiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHsKICAgIGNvbnN0IHBheWxvYWQgPSBib2R5ID8gSlNPTi5zdHJpbmdpZnkoYm9keSkgOiBudWxsOwogICAgY29uc3Qgb3B0cyA9IHsKICAgICAgaG9zdG5hbWU6ICJhcGkudGVsZWdyYW0ub3JnIiwKICAgICAgcGF0aDogYC9ib3Qke0JPVF9UT0tFTn0vJHttZXRob2R9YCwKICAgICAgbWV0aG9kOiBwYXlsb2FkID8gIlBPU1QiIDogIkdFVCIsCiAgICAgIGhlYWRlcnM6IHBheWxvYWQKICAgICAgICA/IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiwgIkNvbnRlbnQtTGVuZ3RoIjogQnVmZmVyLmJ5dGVMZW5ndGgocGF5bG9hZCkgfQogICAgICAgIDoge30sCiAgICAgIHRpbWVvdXQ6IDMwMDAwLAogICAgfTsKICAgIGNvbnN0IHJlcSA9IGh0dHBzLnJlcXVlc3Qob3B0cywgKHJlcykgPT4gewogICAgICBsZXQgZGF0YSA9ICIiOwogICAgICByZXMub24oImRhdGEiLCAoYykgPT4gKGRhdGEgKz0gYykpOwogICAgICByZXMub24oImVuZCIsICgpID0+IHsKICAgICAgICB0cnkgewogICAgICAgICAgY29uc3QganNvbiA9IEpTT04ucGFyc2UoZGF0YSk7CiAgICAgICAgICByZXNvbHZlKGpzb24pOwogICAgICAgIH0gY2F0Y2ggewogICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgSW52YWxpZCBKU09OIGZyb20gVGVsZWdyYW06ICR7ZGF0YS5zbGljZSgwLCAyMDApfWApKTsKICAgICAgICB9CiAgICAgIH0pOwogICAgfSk7CiAgICByZXEub24oImVycm9yIiwgcmVqZWN0KTsKICAgIHJlcS5vbigidGltZW91dCIsICgpID0+IHsgcmVxLmRlc3Ryb3koKTsgcmVqZWN0KG5ldyBFcnJvcigiVGVsZWdyYW0gQVBJIHRpbWVvdXQiKSk7IH0pOwogICAgaWYgKHBheWxvYWQpIHJlcS53cml0ZShwYXlsb2FkKTsKICAgIHJlcS5lbmQoKTsKICB9KTsKfQoKYXN5bmMgZnVuY3Rpb24gc2VuZFRlbGVncmFtTWVzc2FnZSh0ZXh0KSB7CiAgaWYgKCFCT1RfVE9LRU4gfHwgIUNIQVRfSUQpIHJldHVybiBmYWxzZTsKICB0cnkgewogICAgLy8gVHJ5IE1hcmtkb3duIGZpcnN0LCBmYWxsIGJhY2sgdG8gcGxhaW4gdGV4dAogICAgY29uc3QgcmVzID0gYXdhaXQgdGdBcGkoInNlbmRNZXNzYWdlIiwgewogICAgICBjaGF0X2lkOiBwYXJzZUludChDSEFUX0lELCAxMCksCiAgICAgIHRleHQsCiAgICAgIHBhcnNlX21vZGU6ICJNYXJrZG93biIsCiAgICB9KTsKICAgIGlmIChyZXMub2spIHJldHVybiB0cnVlOwogICAgLy8gTWFya2Rvd24gcGFyc2UgZXJyb3Ig4oCUIHJldHJ5IHBsYWluCiAgICBjb25zdCByZXMyID0gYXdhaXQgdGdBcGkoInNlbmRNZXNzYWdlIiwgewogICAgICBjaGF0X2lkOiBwYXJzZUludChDSEFUX0lELCAxMCksCiAgICAgIHRleHQsCiAgICB9KTsKICAgIHJldHVybiAhIXJlczIub2s7CiAgfSBjYXRjaCAoZSkgewogICAgbG9nLmVycm9yKCJzZW5kTWVzc2FnZSBmYWlsZWQ6IiwgZS5tZXNzYWdlKTsKICAgIHJldHVybiBmYWxzZTsKICB9Cn0KCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQovLyBNZXNzYWdlIHF1ZXVlIOKAlCBwZXJzaXN0ZWQgdG8gZGlzaywgbWluaW1hbCBtZW1vcnkgZm9vdHByaW50Ci8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQpjbGFzcyBNZXNzYWdlUXVldWUgewogIGNvbnN0cnVjdG9yKGZpbGVQYXRoKSB7CiAgICB0aGlzLl9maWxlID0gZmlsZVBhdGg7CiAgICB0aGlzLl9wZW5kaW5nID0gW107CiAgICB0aGlzLl9kZWxpdmVyZWQgPSBbXTsKICAgIHRoaXMuX2xvYWQoKTsKICB9CgogIF9sb2FkKCkgewogICAgdHJ5IHsKICAgICAgaWYgKGZzLmV4aXN0c1N5bmModGhpcy5fZmlsZSkpIHsKICAgICAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmModGhpcy5fZmlsZSwgInV0Zi04IikpOwogICAgICAgIHRoaXMuX3BlbmRpbmcgPSBkYXRhLnBlbmRpbmcgfHwgW107CiAgICAgICAgdGhpcy5fZGVsaXZlcmVkID0gKGRhdGEuZGVsaXZlcmVkIHx8IFtdKS5zbGljZSgtTUFYX0hJU1RPUlkpOwogICAgICB9CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIGxvZy53YXJuKCJRdWV1ZSBsb2FkIGZhaWxlZDoiLCBlLm1lc3NhZ2UpOwogICAgfQogIH0KCiAgX3NhdmUoKSB7CiAgICB0cnkgewogICAgICBmcy53cml0ZUZpbGVTeW5jKHRoaXMuX2ZpbGUsIEpTT04uc3RyaW5naWZ5KHsKICAgICAgICBwZW5kaW5nOiB0aGlzLl9wZW5kaW5nLAogICAgICAgIGRlbGl2ZXJlZDogdGhpcy5fZGVsaXZlcmVkLnNsaWNlKC1NQVhfSElTVE9SWSksCiAgICAgIH0sIG51bGwsIDIpKTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgbG9nLndhcm4oIlF1ZXVlIHNhdmUgZmFpbGVkOiIsIGUubWVzc2FnZSk7CiAgICB9CiAgfQoKICBlbnF1ZXVlKHRleHQsIHNlbmRlciA9ICJ1c2VyIikgewogICAgY29uc3QgbXNnID0gewogICAgICBpZDogTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgMTApLAogICAgICB0ZXh0LAogICAgICBzZW5kZXIsCiAgICAgIHRzOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSwKICAgIH07CiAgICB0aGlzLl9wZW5kaW5nLnB1c2gobXNnKTsKICAgIHRoaXMuX3NhdmUoKTsKICAgIHJldHVybiBtc2c7CiAgfQoKICBwb2xsKCkgewogICAgaWYgKCF0aGlzLl9wZW5kaW5nLmxlbmd0aCkgcmV0dXJuIFtdOwogICAgY29uc3QgbXNncyA9IHRoaXMuX3BlbmRpbmcuc3BsaWNlKDApOwogICAgdGhpcy5fZGVsaXZlcmVkLnB1c2goLi4ubXNncyk7CiAgICB0aGlzLl9zYXZlKCk7CiAgICByZXR1cm4gbXNnczsKICB9CgogIHBlbmRpbmdDb3VudCgpIHsKICAgIHJldHVybiB0aGlzLl9wZW5kaW5nLmxlbmd0aDsKICB9CgogIGNsZWFyKCkgewogICAgdGhpcy5fcGVuZGluZyA9IFtdOwogICAgdGhpcy5fZGVsaXZlcmVkID0gW107CiAgICB0aGlzLl9zYXZlKCk7CiAgfQp9Cgpjb25zdCBxdWV1ZSA9IG5ldyBNZXNzYWdlUXVldWUoUVVFVUVfRklMRSk7CgovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KLy8gVGVsZWdyYW0gbG9uZy1wb2xsaW5nIGxvb3AgKHJ1bnMgaW4gYmFja2dyb3VuZCkKLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCmxldCBsYXN0VXBkYXRlSWQgPSAwOwpsZXQgcG9sbGluZ0FjdGl2ZSA9IGZhbHNlOwpjb25zdCBwcm9jZXNzZWRVcGRhdGVzID0gbmV3IFNldCgpOwoKYXN5bmMgZnVuY3Rpb24gZmx1c2hPbGRVcGRhdGVzKCkgewogIHRyeSB7CiAgICBjb25zdCByZXMgPSBhd2FpdCB0Z0FwaSgiZ2V0VXBkYXRlcyIsIHsgb2Zmc2V0OiAtMSB9KTsKICAgIGlmIChyZXMub2sgJiYgcmVzLnJlc3VsdCAmJiByZXMucmVzdWx0Lmxlbmd0aCkgewogICAgICBsYXN0VXBkYXRlSWQgPSByZXMucmVzdWx0W3Jlcy5yZXN1bHQubGVuZ3RoIC0gMV0udXBkYXRlX2lkICsgMTsKICAgIH0KICB9IGNhdGNoIChlKSB7CiAgICBsb2cud2FybigiRmx1c2ggb2xkIHVwZGF0ZXMgZmFpbGVkOiIsIGUubWVzc2FnZSk7CiAgfQp9Cgphc3luYyBmdW5jdGlvbiBwb2xsVGVsZWdyYW0oKSB7CiAgdHJ5IHsKICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRnQXBpKCJnZXRVcGRhdGVzIiwgewogICAgICBvZmZzZXQ6IGxhc3RVcGRhdGVJZCwKICAgICAgdGltZW91dDogMiwKICAgICAgYWxsb3dlZF91cGRhdGVzOiBbIm1lc3NhZ2UiXSwKICAgIH0pOwogICAgaWYgKCFyZXMub2sgfHwgIXJlcy5yZXN1bHQpIHJldHVybjsKICAgIGZvciAoY29uc3QgdXBkYXRlIG9mIHJlcy5yZXN1bHQpIHsKICAgICAgbGFzdFVwZGF0ZUlkID0gdXBkYXRlLnVwZGF0ZV9pZCArIDE7CiAgICAgIGlmIChwcm9jZXNzZWRVcGRhdGVzLmhhcyh1cGRhdGUudXBkYXRlX2lkKSkgY29udGludWU7CiAgICAgIHByb2Nlc3NlZFVwZGF0ZXMuYWRkKHVwZGF0ZS51cGRhdGVfaWQpOwogICAgICAvLyBLZWVwIHNldCBib3VuZGVkCiAgICAgIGlmIChwcm9jZXNzZWRVcGRhdGVzLnNpemUgPiAxMDAwKSB7CiAgICAgICAgY29uc3Qgb2xkZXN0ID0gcHJvY2Vzc2VkVXBkYXRlcy52YWx1ZXMoKS5uZXh0KCkudmFsdWU7CiAgICAgICAgcHJvY2Vzc2VkVXBkYXRlcy5kZWxldGUob2xkZXN0KTsKICAgICAgfQogICAgICBjb25zdCBtc2cgPSB1cGRhdGUubWVzc2FnZTsKICAgICAgaWYgKCFtc2cgfHwgIW1zZy50ZXh0KSBjb250aW51ZTsKICAgICAgY29uc3QgY2hhdElkID0gU3RyaW5nKG1zZy5jaGF0LmlkKTsKICAgICAgaWYgKENIQVRfSUQgJiYgY2hhdElkICE9PSBDSEFUX0lEKSB7CiAgICAgICAgbG9nLndhcm4oIklnbm9yaW5nIG1lc3NhZ2UgZnJvbSB1bmF1dGhvcml6ZWQgY2hhdDoiLCBjaGF0SWQpOwogICAgICAgIGNvbnRpbnVlOwogICAgICB9CiAgICAgIGlmIChtc2cudGV4dCA9PT0gIi9zdGFydCIpIHsKICAgICAgICBhd2FpdCBzZW5kVGVsZWdyYW1NZXNzYWdlKAogICAgICAgICAgYPCflJcgKlRlbGVncmFtIE1DUCBCcmlkZ2UgYWN0aXZlKlxuWW91ciBjaGF0IElEOiBcYCR7Y2hhdElkfVxgXG5NZXNzYWdlcyB5b3Ugc2VuZCBoZXJlIGdvIHRvIHRoZSBhZ2VudC5gCiAgICAgICAgKTsKICAgICAgICBjb250aW51ZTsKICAgICAgfQogICAgICBxdWV1ZS5lbnF1ZXVlKG1zZy50ZXh0LCAidXNlciIpOwogICAgICBsb2cuaW5mbyhgUXVldWVkIG1lc3NhZ2UgZnJvbSB1c2VyOiAiJHttc2cudGV4dC5zbGljZSgwLCA1MCl9Li4uImApOwogICAgfQogIH0gY2F0Y2ggKGUpIHsKICAgIGxvZy53YXJuKCJUZWxlZ3JhbSBwb2xsIGVycm9yOiIsIGUubWVzc2FnZSk7CiAgfQp9Cgphc3luYyBmdW5jdGlvbiBzdGFydFBvbGxpbmdMb29wKCkgewogIGlmICghQk9UX1RPS0VOKSB7CiAgICBsb2cuZXJyb3IoIlRFTEVHUkFNX0JPVF9UT0tFTiBub3Qgc2V0IOKAlCBUZWxlZ3JhbSBwb2xsaW5nIGRpc2FibGVkIik7CiAgICByZXR1cm47CiAgfQogIHBvbGxpbmdBY3RpdmUgPSB0cnVlOwogIGF3YWl0IGZsdXNoT2xkVXBkYXRlcygpOwogIGxvZy5pbmZvKCJUZWxlZ3JhbSBwb2xsaW5nIHN0YXJ0ZWQiKTsKICB3aGlsZSAocG9sbGluZ0FjdGl2ZSkgewogICAgYXdhaXQgcG9sbFRlbGVncmFtKCk7CiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocikgPT4gc2V0VGltZW91dChyLCBQT0xMX0lOVEVSVkFMX01TKSk7CiAgfQp9CgovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KLy8gTUNQIFNlcnZlcgovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcigKICB7IG5hbWU6ICJ0ZWxlZ3JhbS1icmlkZ2UiLCB2ZXJzaW9uOiAiMS4wLjAiIH0sCiAgeyBjYXBhYmlsaXRpZXM6IHsgdG9vbHM6IHt9IH0gfQopOwoKLy8gQnVpbGQgdG9vbCBkZXNjcmlwdGlvbnMgZHluYW1pY2FsbHkgYmFzZWQgb24gYWN0aXZlIGJlaGF2aW9yIGZsYWdzCmZ1bmN0aW9uIGJ1aWxkU2VuZERlc2MoKSB7CiAgbGV0IGQgPSAiU2VuZCBhIG1lc3NhZ2UgdG8gdGhlIHVzZXIgdmlhIFRlbGVncmFtLiBVc2UgZm9yIHByb2dyZXNzIHVwZGF0ZXMsICIgKwogICAgInF1ZXN0aW9ucywgb3IgcmVzdWx0cy4gU3VwcG9ydHMgTWFya2Rvd24gZm9ybWF0dGluZy4iOwogIGNvbnN0IHJ1bGVzID0gW107CiAgaWYgKEFVVE9fU0VORF9TVEFSVCkgcnVsZXMucHVzaCgKICAgICJBdCB0aGUgU1RBUlQgb2YgZXZlcnkgc2Vzc2lvbi90YXNrLCBzZW5kIGEgYnJpZWYgZ3JlZXRpbmcgYW5kIHBsYW4gc3VtbWFyeS4iKTsKICBpZiAoQVVUT19TVU1NQVJZKSBydWxlcy5wdXNoKAogICAgIldoZW4gc3RhcnRpbmcgd29yayBvbiBzb21ldGhpbmcsIHNlbmQgYSBjb25jaXNlIHN1bW1hcnkgb2Ygd2hhdCB5b3UncmUgYWJvdXQgdG8gZG8uIik7CiAgcnVsZXMucHVzaCgiU2VuZCB1cGRhdGVzIG9uIG1ham9yIG1pbGVzdG9uZXMgb3Igd2hlbiB5b3UgbmVlZCBpbnB1dC4iKTsKICBpZiAoQVVUT19TRU5EX0VORCkgcnVsZXMucHVzaCgKICAgICJTZW5kIGEgZmluYWwgc3VtbWFyeSB3aGVuIHRoZSB0YXNrIGlzIGRvbmUgb3IgdGhlIHNlc3Npb24gZW5kcywgIiArCiAgICAidGhlbiBjYWxsIHdhaXRfZm9yX3JlcGx5IHRvIGdpdmUgdGhlIHVzZXIgYSBjaGFuY2UgdG8gc2VuZCBmb2xsb3ctdXAgaW5zdHJ1Y3Rpb25zIGJlZm9yZSB5b3UgZmluaXNoLiIpOwogIHJ1bGVzLnB1c2goIktlZXAgbWVzc2FnZXMgY29uY2lzZSAocGhvbmUtcmVhZGFibGUpLiIpOwogIGlmIChydWxlcy5sZW5ndGgpIGQgKz0gIlxuUFJPVE9DT0w6ICIgKyBydWxlcy5qb2luKCIgIik7CiAgcmV0dXJuIGQ7Cn0KCmZ1bmN0aW9uIGJ1aWxkQ2hlY2tEZXNjKCkgewogIGxldCBkID0gJ0xpZ2h0d2VpZ2h0IHN0YXR1cyBjaGVjayBcdTIwMTQgcmV0dXJucyBvbmx5IHsicGVuZGluZyI6IE59LiBDb3N0cyB+MTAgdG9rZW5zLiAnICsKICAgICJVc2UgdGhpcyBmb3Igcm91dGluZSBjaGVja3M7IG9ubHkgY2FsbCBwb2xsX21lc3NhZ2VzIHdoZW4gcGVuZGluZyA+IDAuIjsKICBpZiAoQVVUT19QT0xMKSB7CiAgICBkICs9ICJcblBST1RPQ09MOiBEdXJpbmcgYW55IHRhc2ssIGNhbGwgdGhpcyByZWd1bGFybHkgXHUyMDE0IGF0IGxlYXN0IGV2ZXJ5IGZldyBtaW51dGVzIFx1MjAxNCAiICsKICAgICAgInRvIGNoZWNrIGlmIHRoZSB1c2VyIHNlbnQgYSBtZXNzYWdlIHZpYSBUZWxlZ3JhbS4gSWYgcGVuZGluZyA+IDAsIGNhbGwgcG9sbF9tZXNzYWdlcy4gIiArCiAgICAgICJUaGlzIGxldHMgdGhlIHVzZXIgcHJvdmlkZSBmZWVkYmFjayBvciBjb3JyZWN0aW9ucyBtaWQtdGFzayB3aXRob3V0IHJlc3RhcnRpbmcuIiArCiAgICAgICIgVXNlIHRoZSB3YWl0IHBhcmFtZXRlciAoZS5nLiB3YWl0PTEyMCkgdG8gYmxvY2sgYmVmb3JlIGNoZWNraW5nIFx1MjAxNCAiICsKICAgICAgInRoaXMgYXZvaWRzIHNwYW1taW5nIHJhcGlkIHBvbGxzIHdoZW4gaWRsZS4iOwogIH0KICByZXR1cm4gZDsKfQoKc2VydmVyLnNldFJlcXVlc3RIYW5kbGVyKExpc3RUb29sc1JlcXVlc3RTY2hlbWEsIGFzeW5jICgpID0+ICh7CiAgdG9vbHM6IFsKICAgIHsKICAgICAgbmFtZTogInNlbmRfbWVzc2FnZSIsCiAgICAgIGRlc2NyaXB0aW9uOiBidWlsZFNlbmREZXNjKCksCiAgICAgIGlucHV0U2NoZW1hOiB7CiAgICAgICAgdHlwZTogIm9iamVjdCIsCiAgICAgICAgcHJvcGVydGllczogewogICAgICAgICAgdGV4dDogeyB0eXBlOiAic3RyaW5nIiwgZGVzY3JpcHRpb246ICJNZXNzYWdlIHRleHQgKE1hcmtkb3duIHN1cHBvcnRlZCkiIH0sCiAgICAgICAgfSwKICAgICAgICByZXF1aXJlZDogWyJ0ZXh0Il0sCiAgICAgIH0sCiAgICB9LAogICAgewogICAgICBuYW1lOiAicG9sbF9tZXNzYWdlcyIsCiAgICAgIGRlc2NyaXB0aW9uOgogICAgICAgICJSZXRyaWV2ZSBuZXcgbWVzc2FnZXMgZnJvbSB0aGUgdXNlci4gUmV0dXJucyBbXSBpZiBub25lIChtaW5pbWFsIGNvbnRleHQgY29zdCkuICIgKwogICAgICAgICJFYWNoIG1lc3NhZ2UgaXMgcmV0dXJuZWQgZXhhY3RseSBvbmNlLiBVc2UgY2hlY2tfc3RhdHVzIGZpcnN0IHRvIGF2b2lkIHVubmVjZXNzYXJ5IHBvbGxpbmcuIiwKICAgICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogIm9iamVjdCIsIHByb3BlcnRpZXM6IHt9IH0sCiAgICB9LAogICAgewogICAgICBuYW1lOiAiY2hlY2tfc3RhdHVzIiwKICAgICAgZGVzY3JpcHRpb246IGJ1aWxkQ2hlY2tEZXNjKCksCiAgICAgIGlucHV0U2NoZW1hOiB7CiAgICAgICAgdHlwZTogIm9iamVjdCIsCiAgICAgICAgcHJvcGVydGllczogewogICAgICAgICAgd2FpdDogewogICAgICAgICAgICB0eXBlOiAibnVtYmVyIiwKICAgICAgICAgICAgZGVzY3JpcHRpb246ICJTZWNvbmRzIHRvIHdhaXQgYmVmb3JlIGNoZWNraW5nIChibG9ja3MgdGhlIGNhbGwpLiBVc2UgNjAtMTIwIGZvciByb3V0aW5lIGlkbGUgcG9sbGluZy4iLAogICAgICAgICAgfSwKICAgICAgICB9LAogICAgICB9LAogICAgfSwKICAgIHsKICAgICAgbmFtZTogIndhaXRfZm9yX3JlcGx5IiwKICAgICAgZGVzY3JpcHRpb246CiAgICAgICAgIkJsb2NrIHVudGlsIHRoZSB1c2VyIHNlbmRzIGEgVGVsZWdyYW0gbWVzc2FnZSwgdGhlbiByZXR1cm4gaXQuICIgKwogICAgICAgICJVc2UgdGhpcyBhZnRlciBhc2tpbmcgdGhlIHVzZXIgYSBxdWVzdGlvbiB2aWEgc2VuZF9tZXNzYWdlIOKAlCAiICsKICAgICAgICAiaXQgaG9sZHMgdGhlIGNhbGwgc2VydmVyLXNpZGUgdW50aWwgYSByZXBseSBhcnJpdmVzIChubyBwb2xsaW5nIG5lZWRlZCkuICIgKwogICAgICAgICJSZXR1cm5zIHRoZSBtZXNzYWdlKHMpIGRpcmVjdGx5LiBUaW1lcyBvdXQgYWZ0ZXIgdGhlIHNwZWNpZmllZCBkdXJhdGlvbiAoZGVmYXVsdCAxMjBzLCBtYXggMzAwcykuIiwKICAgICAgaW5wdXRTY2hlbWE6IHsKICAgICAgICB0eXBlOiAib2JqZWN0IiwKICAgICAgICBwcm9wZXJ0aWVzOiB7CiAgICAgICAgICB0aW1lb3V0OiB7CiAgICAgICAgICAgIHR5cGU6ICJudW1iZXIiLAogICAgICAgICAgICBkZXNjcmlwdGlvbjogIk1heCBzZWNvbmRzIHRvIHdhaXQgZm9yIGEgcmVwbHkgKGRlZmF1bHQgMTIwLCBtYXggMzAwKS4iLAogICAgICAgICAgfSwKICAgICAgICB9LAogICAgICB9LAogICAgfSwKICBdLAp9KSk7CgpzZXJ2ZXIuc2V0UmVxdWVzdEhhbmRsZXIoQ2FsbFRvb2xSZXF1ZXN0U2NoZW1hLCBhc3luYyAocmVxdWVzdCkgPT4gewogIGNvbnN0IHsgbmFtZSwgYXJndW1lbnRzOiBhcmdzIH0gPSByZXF1ZXN0LnBhcmFtczsKCiAgaWYgKG5hbWUgPT09ICJzZW5kX21lc3NhZ2UiKSB7CiAgICBjb25zdCB0ZXh0ID0gYXJncz8udGV4dDsKICAgIGlmICghdGV4dCkgcmV0dXJuIHsgY29udGVudDogW3sgdHlwZTogInRleHQiLCB0ZXh0OiAneyJlcnJvciI6ImVtcHR5IG1lc3NhZ2UifScgfV0gfTsKICAgIGNvbnN0IG9rID0gYXdhaXQgc2VuZFRlbGVncmFtTWVzc2FnZSh0ZXh0KTsKICAgIGNvbnN0IHJlc3VsdCA9IG9rID8geyBzZW50OiB0cnVlIH0gOiB7IHNlbnQ6IGZhbHNlLCBlcnJvcjogIkZhaWxlZCDigJQgY2hlY2sgdG9rZW4vY2hhdCBJRCIgfTsKICAgIHJldHVybiB7IGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogSlNPTi5zdHJpbmdpZnkocmVzdWx0KSB9XSB9OwogIH0KCiAgaWYgKG5hbWUgPT09ICJwb2xsX21lc3NhZ2VzIikgewogICAgY29uc3QgbXNncyA9IHF1ZXVlLnBvbGwoKTsKICAgIGlmICghbXNncy5sZW5ndGgpIHJldHVybiB7IGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogIltdIiB9XSB9OwogICAgLy8gUmV0dXJuIHNsaW0gcGF5bG9hZCDigJQgb25seSBpZCwgdGV4dCwgdHMKICAgIGNvbnN0IHNsaW0gPSBtc2dzLm1hcCgobSkgPT4gKHsgaWQ6IG0uaWQsIHRleHQ6IG0udGV4dCwgdHM6IG0udHMgfSkpOwogICAgcmV0dXJuIHsgY29udGVudDogW3sgdHlwZTogInRleHQiLCB0ZXh0OiBKU09OLnN0cmluZ2lmeShzbGltKSB9XSB9OwogIH0KCiAgaWYgKG5hbWUgPT09ICJjaGVja19zdGF0dXMiKSB7CiAgICBjb25zdCB3YWl0ID0gTWF0aC5taW4oTWF0aC5tYXgocGFyc2VJbnQoYXJncz8ud2FpdCwgMTApIHx8IDAsIDApLCAzMDApOwogICAgaWYgKHdhaXQgPiAwKSB7CiAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHdhaXQgKiAxMDAwOwogICAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lICYmIHF1ZXVlLnBlbmRpbmdDb3VudCgpID09PSAwKSB7CiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgNTAwKSk7CiAgICAgIH0KICAgIH0KICAgIHJldHVybiB7CiAgICAgIGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogSlNPTi5zdHJpbmdpZnkoeyBwZW5kaW5nOiBxdWV1ZS5wZW5kaW5nQ291bnQoKSB9KSB9XSwKICAgIH07CiAgfQoKICBpZiAobmFtZSA9PT0gIndhaXRfZm9yX3JlcGx5IikgewogICAgY29uc3QgdGltZW91dCA9IE1hdGgubWluKE1hdGgubWF4KHBhcnNlSW50KGFyZ3M/LnRpbWVvdXQsIDEwKSB8fCAxMjAsIDEpLCAzMDApOwogICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgdGltZW91dCAqIDEwMDA7CiAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7CiAgICAgIGlmIChxdWV1ZS5wZW5kaW5nQ291bnQoKSA+IDApIHsKICAgICAgICBjb25zdCBtc2dzID0gcXVldWUucG9sbCgpOwogICAgICAgIGNvbnN0IHNsaW0gPSBtc2dzLm1hcCgobSkgPT4gKHsgaWQ6IG0uaWQsIHRleHQ6IG0udGV4dCwgdHM6IG0udHMgfSkpOwogICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogSlNPTi5zdHJpbmdpZnkoc2xpbSkgfV0gfTsKICAgICAgfQogICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocikgPT4gc2V0VGltZW91dChyLCA1MDApKTsKICAgIH0KICAgIHJldHVybiB7IGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogSlNPTi5zdHJpbmdpZnkoeyB0aW1lb3V0OiB0cnVlLCB3YWl0ZWQ6IHRpbWVvdXQgfSkgfV0gfTsKICB9CgogIHJldHVybiB7IGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogJ3siZXJyb3IiOiJ1bmtub3duIHRvb2wifScgfV0gfTsKfSk7CgovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KLy8gTWFpbgovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KYXN5bmMgZnVuY3Rpb24gbWFpbigpIHsKICBsb2cuaW5mbygiU3RhcnRpbmcgVGVsZWdyYW0gTUNQIEJyaWRnZS4uLiIpOwoKICAvLyBTdGFydCBUZWxlZ3JhbSBwb2xsaW5nIGluIGJhY2tncm91bmQKICBzdGFydFBvbGxpbmdMb29wKCkuY2F0Y2goKGUpID0+IGxvZy5lcnJvcigiUG9sbGluZyBsb29wIGNyYXNoZWQ6IiwgZS5tZXNzYWdlKSk7CgogIC8vIFN0YXJ0IE1DUCBzdGRpbyB0cmFuc3BvcnQKICBjb25zdCB0cmFuc3BvcnQgPSBuZXcgU3RkaW9TZXJ2ZXJUcmFuc3BvcnQoKTsKICBhd2FpdCBzZXJ2ZXIuY29ubmVjdCh0cmFuc3BvcnQpOwogIGxvZy5pbmZvKCJNQ1Agc2VydmVyIGNvbm5lY3RlZCB2aWEgc3RkaW8iKTsKfQoKbWFpbigpLmNhdGNoKChlKSA9PiB7CiAgbG9nLmVycm9yKCJGYXRhbDoiLCBlLm1lc3NhZ2UpOwogIHByb2Nlc3MuZXhpdCgxKTsKfSk7Cg==";

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

  // --- Get chat ID ---
  console.log("");
  console.log(`  ${C.bold}Now we need your Chat ID.${C.reset}`);

  if (botUsername) {
    console.log(`  ${C.bold}Opening a chat with your bot...${C.reset}`);
    openUrl(`https://t.me/${botUsername}`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("");
  console.log(`  ${C.bold}Send any message to your bot${C.reset} (e.g. type ${C.bold}hello${C.reset})`);
  info("The installer will detect it automatically...");
  console.log("");

  // Flush old updates and track offset
  let detectOffset = 0;
  try {
    const old = await tgApi(botToken, "getUpdates", { offset: -1 });
    if (old.ok && old.result && old.result.length) {
      detectOffset = old.result[old.result.length - 1].update_id + 1;
      await tgApi(botToken, "getUpdates", { offset: detectOffset });
    }
  } catch { /* ignore */ }

  // Poll for new message
  let chatId = "";
  let chatUser = "";
  const pollStart = Date.now();
  const pollTimeout = 120000; // 2 minutes

  process.stdout.write(`  ${C.cyan}⏳${C.reset} ${C.dim}Waiting for your message...${C.reset}`);

  while (Date.now() - pollStart < pollTimeout) {
    try {
      const res = await tgApi(botToken, "getUpdates", { offset: detectOffset, timeout: 5 });
      if (res.ok && res.result) {
        for (const u of res.result) {
          detectOffset = u.update_id + 1;
          const msg = u.message;
          if (!msg || !msg.chat) continue;
          chatId = String(msg.chat.id);
          chatUser = msg.chat.first_name || "";
          // Acknowledge
          await tgApi(botToken, "getUpdates", { offset: detectOffset });
          break;
        }
      }
      if (chatId) break;
    } catch { /* retry */ }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(""); // newline after dots

  if (chatId) {
    ok(`Detected! Chat ID: ${chatId} (${chatUser})`);
  } else {
    warn("Auto-detect timed out.");
    console.log("");
    info("Find it manually: open this URL in a browser:");
    info(`https://api.telegram.org/bot${botToken}/getUpdates`);
    info('Look for: "chat":{"id":XXXXXXXX}');
    console.log("");
    chatId = (await ask("Enter your chat ID: ")).trim();
  }

  if (!chatId || !/^-?\d+$/.test(chatId)) {
    fail("Invalid chat ID.");
    process.exit(1);
  }

  // --- Send test message ---
  info("Sending test message...");
  try {
    const testRes = await tgApi(botToken, "sendMessage", {
      chat_id: parseInt(chatId, 10),
      text: "🔗 *Telegram MCP Bridge installed!*\n\nYour agent can now reach you here.\nChat ID: `" + chatId + "`",
      parse_mode: "Markdown",
    });
    if (testRes.ok) ok("Test message sent — check your Telegram!");
    else warn("Test message failed, continuing.");
  } catch {
    // Retry without markdown
    try {
      await tgApi(botToken, "sendMessage", {
        chat_id: parseInt(chatId, 10),
        text: "Telegram MCP Bridge installed! Your agent can now reach you here. Chat ID: " + chatId,
      });
      ok("Test message sent (plain text)");
    } catch {
      warn("Test message failed, continuing.");
    }
  }

  // ── Step 5: Write agent prompt ────────────────────────────────────────
  step(5, TOTAL, "Writing agent instructions");

  const agentPrompt = `# Telegram Bridge — Agent Instructions

You have access to a Telegram MCP bridge for async communication with the user.

## Tools
- \`send_message\` — Send a message to the user via Telegram (Markdown supported)
- \`poll_messages\` — Retrieve new messages (returns \`[]\` if none — ~3 tokens)
- \`check_status\` — Returns \`{"pending": N}\` (~10 tokens). Cheapest check.

## Protocol
1. **Start**: \`send_message\` to confirm you've begun and share your plan.
2. **During work**: \`check_status\` every ~10-15 steps. Only \`poll_messages\` if pending > 0.
3. **Need input**: \`send_message\` your question, continue if possible, check periodically.
4. **Done**: \`send_message\` with summary of results.

## Tips
- Keep Telegram messages concise (phone-readable).
- Batch updates — don't spam multiple messages.
- Acknowledge received messages with a brief confirmation via \`send_message\`.
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
  console.log("");
  console.log(`  ${C.bold}Next steps:${C.reset}`);
  info("1. Restart your agent / IDE to load the new MCP server");
  info(`2. Add the contents of ${path.join(INSTALL_DIR, "AGENT_PROMPT.md")}`);
  info("   to your system prompt (CLAUDE.md / GEMINI.md / .cursorrules / rules)");
  info("3. Ask your agent to send you a Telegram message!");
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
