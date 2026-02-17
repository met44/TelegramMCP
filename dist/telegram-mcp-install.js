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
const SERVER_B64 = "IyEvdXNyL2Jpbi9lbnYgbm9kZQ0KLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0NCi8vICBUZWxlZ3JhbSBNQ1AgQnJpZGdlIFNlcnZlciB2Mg0KLy8gIEJyaWRnZXMgQUkgYWdlbnQgc2Vzc2lvbnMgd2l0aCBhIGh1bWFuIHZpYSBUZWxlZ3JhbS4NCi8vICBTdXBwb3J0cyBtdWx0aXBsZSBtYWNoaW5lcy9hZ2VudHMgd2l0aCBzZXNzaW9uIGlzb2xhdGlvbi4NCi8vICBTaW5nbGUgdW5pZmllZCB0b29sOiBpbnRlcmFjdA0KLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0NCg0KY29uc3QgeyBTZXJ2ZXIgfSA9IHJlcXVpcmUoIkBtb2RlbGNvbnRleHRwcm90b2NvbC9zZGsvc2VydmVyL2luZGV4LmpzIik7DQpjb25zdCB7IFN0ZGlvU2VydmVyVHJhbnNwb3J0IH0gPSByZXF1aXJlKCJAbW9kZWxjb250ZXh0cHJvdG9jb2wvc2RrL3NlcnZlci9zdGRpby5qcyIpOw0KY29uc3Qgew0KICBDYWxsVG9vbFJlcXVlc3RTY2hlbWEsDQogIExpc3RUb29sc1JlcXVlc3RTY2hlbWEsDQp9ID0gcmVxdWlyZSgiQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay90eXBlcy5qcyIpOw0KY29uc3QgaHR0cHMgPSByZXF1aXJlKCJodHRwcyIpOw0KY29uc3QgZnMgPSByZXF1aXJlKCJmcyIpOw0KY29uc3QgcGF0aCA9IHJlcXVpcmUoInBhdGgiKTsNCmNvbnN0IG9zID0gcmVxdWlyZSgib3MiKTsNCmNvbnN0IGNyeXB0byA9IHJlcXVpcmUoImNyeXB0byIpOw0KDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCi8vIENvbmZpZyBmcm9tIGVudg0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQpjb25zdCBCT1RfVE9LRU4gPSBwcm9jZXNzLmVudi5URUxFR1JBTV9CT1RfVE9LRU4gfHwgIiI7DQpjb25zdCBDSEFUX0lEID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fQ0hBVF9JRCB8fCAiIjsNCmNvbnN0IERBVEFfRElSID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fTUNQX0RBVEFfRElSIHx8DQogIHBhdGguam9pbihvcy5ob21lZGlyKCksICIudGVsZWdyYW0tbWNwLWJyaWRnZSIsICJkYXRhIik7DQpjb25zdCBNQVhfSElTVE9SWSA9IHBhcnNlSW50KHByb2Nlc3MuZW52LlRFTEVHUkFNX01DUF9NQVhfSElTVE9SWSB8fCAiMjAwIiwgMTApOw0KY29uc3QgUE9MTF9JTlRFUlZBTF9NUyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LlRFTEVHUkFNX1BPTExfSU5URVJWQUwgfHwgIjIwMDAiLCAxMCk7DQoNCi8vIFNlc3Npb24gaWRlbnRpdHkg4oCUIGVhY2ggTUNQIHNlcnZlciBpbnN0YW5jZSBpcyBvbmUgc2Vzc2lvbg0KY29uc3QgU0VTU0lPTl9JRCA9IHByb2Nlc3MuZW52LlRFTEVHUkFNX1NFU1NJT05fSUQgfHwNCiAgYHMtJHtjcnlwdG8ucmFuZG9tQnl0ZXMoMykudG9TdHJpbmcoImhleCIpfWA7DQpjb25zdCBNQUNISU5FX0xBQkVMID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fTUFDSElORV9MQUJFTCB8fA0KICBvcy5ob3N0bmFtZSgpLnNsaWNlKDAsIDIwKTsNCmNvbnN0IEFHRU5UX0xBQkVMID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fQUdFTlRfTEFCRUwgfHwgImFnZW50IjsNCg0KLy8gQmVoYXZpb3IgZmxhZ3MgKHNldCBpbiBNQ1AgY29uZmlnIGVudiBibG9jaykNCmNvbnN0IEFVVE9fU0VORF9TVEFSVCA9IHByb2Nlc3MuZW52LlRFTEVHUkFNX0FVVE9fU1RBUlQgIT09ICJmYWxzZSI7DQpjb25zdCBBVVRPX1NFTkRfRU5EID0gcHJvY2Vzcy5lbnYuVEVMRUdSQU1fQVVUT19FTkQgIT09ICJmYWxzZSI7DQpjb25zdCBBVVRPX1NVTU1BUlkgPSBwcm9jZXNzLmVudi5URUxFR1JBTV9BVVRPX1NVTU1BUlkgIT09ICJmYWxzZSI7DQpjb25zdCBBVVRPX1BPTEwgPSBwcm9jZXNzLmVudi5URUxFR1JBTV9BVVRPX1BPTEwgIT09ICJmYWxzZSI7DQoNCi8vIExlZ2FjeSBjb21wYXQ6IG9sZCBRVUVVRV9GSUxFIGVudiBzdGlsbCB3b3JrcyBmb3Igc2luZ2xlLXNlc3Npb24gc2V0dXBzDQpjb25zdCBMRUdBQ1lfUVVFVUVfRklMRSA9IHByb2Nlc3MuZW52LlRFTEVHUkFNX01DUF9RVUVVRV9GSUxFIHx8ICIiOw0KDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCi8vIExvZ2dpbmcgKHN0ZGVyciBvbmx5IOKAlCBzdGRvdXQgaXMgTUNQIHN0ZGlvIHRyYW5zcG9ydCkNCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KY29uc3QgbG9nID0gew0KICBpbmZvOiAoLi4uYSkgPT4gcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtJTkZPXSAke2Euam9pbigiICIpfVxuYCksDQogIHdhcm46ICguLi5hKSA9PiBwcm9jZXNzLnN0ZGVyci53cml0ZShgW1dBUk5dICR7YS5qb2luKCIgIil9XG5gKSwNCiAgZXJyb3I6ICguLi5hKSA9PiBwcm9jZXNzLnN0ZGVyci53cml0ZShgW0VSUk9SXSAke2Euam9pbigiICIpfVxuYCksDQp9Ow0KDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCi8vIFRlbGVncmFtIEhUVFAgaGVscGVycyAoemVybyBkZXBlbmRlbmNpZXMg4oCUIHVzZXMgYnVpbHQtaW4gaHR0cHMpDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCmZ1bmN0aW9uIHRnQXBpKG1ldGhvZCwgYm9keSkgew0KICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gew0KICAgIGNvbnN0IHBheWxvYWQgPSBib2R5ID8gSlNPTi5zdHJpbmdpZnkoYm9keSkgOiBudWxsOw0KICAgIGNvbnN0IG9wdHMgPSB7DQogICAgICBob3N0bmFtZTogImFwaS50ZWxlZ3JhbS5vcmciLA0KICAgICAgcGF0aDogYC9ib3Qke0JPVF9UT0tFTn0vJHttZXRob2R9YCwNCiAgICAgIG1ldGhvZDogcGF5bG9hZCA/ICJQT1NUIiA6ICJHRVQiLA0KICAgICAgaGVhZGVyczogcGF5bG9hZA0KICAgICAgICA/IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiwgIkNvbnRlbnQtTGVuZ3RoIjogQnVmZmVyLmJ5dGVMZW5ndGgocGF5bG9hZCkgfQ0KICAgICAgICA6IHt9LA0KICAgICAgdGltZW91dDogMzAwMDAsDQogICAgfTsNCiAgICBjb25zdCByZXEgPSBodHRwcy5yZXF1ZXN0KG9wdHMsIChyZXMpID0+IHsNCiAgICAgIGxldCBkYXRhID0gIiI7DQogICAgICByZXMub24oImRhdGEiLCAoYykgPT4gKGRhdGEgKz0gYykpOw0KICAgICAgcmVzLm9uKCJlbmQiLCAoKSA9PiB7DQogICAgICAgIHRyeSB7DQogICAgICAgICAgY29uc3QganNvbiA9IEpTT04ucGFyc2UoZGF0YSk7DQogICAgICAgICAgcmVzb2x2ZShqc29uKTsNCiAgICAgICAgfSBjYXRjaCB7DQogICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgSW52YWxpZCBKU09OIGZyb20gVGVsZWdyYW06ICR7ZGF0YS5zbGljZSgwLCAyMDApfWApKTsNCiAgICAgICAgfQ0KICAgICAgfSk7DQogICAgfSk7DQogICAgcmVxLm9uKCJlcnJvciIsIHJlamVjdCk7DQogICAgcmVxLm9uKCJ0aW1lb3V0IiwgKCkgPT4geyByZXEuZGVzdHJveSgpOyByZWplY3QobmV3IEVycm9yKCJUZWxlZ3JhbSBBUEkgdGltZW91dCIpKTsgfSk7DQogICAgaWYgKHBheWxvYWQpIHJlcS53cml0ZShwYXlsb2FkKTsNCiAgICByZXEuZW5kKCk7DQogIH0pOw0KfQ0KDQphc3luYyBmdW5jdGlvbiBzZW5kVGVsZWdyYW1NZXNzYWdlKHRleHQpIHsNCiAgaWYgKCFCT1RfVE9LRU4gfHwgIUNIQVRfSUQpIHJldHVybiBmYWxzZTsNCiAgdHJ5IHsNCiAgICBjb25zdCByZXMgPSBhd2FpdCB0Z0FwaSgic2VuZE1lc3NhZ2UiLCB7DQogICAgICBjaGF0X2lkOiBwYXJzZUludChDSEFUX0lELCAxMCksDQogICAgICB0ZXh0LA0KICAgICAgcGFyc2VfbW9kZTogIk1hcmtkb3duIiwNCiAgICB9KTsNCiAgICBpZiAocmVzLm9rKSByZXR1cm4gdHJ1ZTsNCiAgICAvLyBNYXJrZG93biBwYXJzZSBlcnJvciDigJQgcmV0cnkgcGxhaW4NCiAgICBjb25zdCByZXMyID0gYXdhaXQgdGdBcGkoInNlbmRNZXNzYWdlIiwgew0KICAgICAgY2hhdF9pZDogcGFyc2VJbnQoQ0hBVF9JRCwgMTApLA0KICAgICAgdGV4dCwNCiAgICB9KTsNCiAgICByZXR1cm4gISFyZXMyLm9rOw0KICB9IGNhdGNoIChlKSB7DQogICAgbG9nLmVycm9yKCJzZW5kTWVzc2FnZSBmYWlsZWQ6IiwgZS5tZXNzYWdlKTsNCiAgICByZXR1cm4gZmFsc2U7DQogIH0NCn0NCg0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQovLyBNZXNzYWdlIHF1ZXVlIOKAlCBwZXJzaXN0ZWQgdG8gZGlzaywgbWluaW1hbCBtZW1vcnkgZm9vdHByaW50DQovLyBTdXBwb3J0cyBtdWx0aS1zZXNzaW9uOiBlYWNoIHNlc3Npb24gaGFzIGl0cyBvd24gcGVuZGluZyBxdWV1ZSwNCi8vIGJ1dCB1c2VyIG1lc3NhZ2VzIGFyZSBicm9hZGNhc3QgdG8gYWxsIGFjdGl2ZSBzZXNzaW9ucy4NCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KY2xhc3MgTWVzc2FnZVF1ZXVlIHsNCiAgY29uc3RydWN0b3IoZmlsZVBhdGgpIHsNCiAgICB0aGlzLl9maWxlID0gZmlsZVBhdGg7DQogICAgdGhpcy5fcGVuZGluZyA9IFtdOw0KICAgIHRoaXMuX2RlbGl2ZXJlZCA9IFtdOw0KICAgIHRoaXMuX2xvYWQoKTsNCiAgfQ0KDQogIF9sb2FkKCkgew0KICAgIHRyeSB7DQogICAgICBpZiAoZnMuZXhpc3RzU3luYyh0aGlzLl9maWxlKSkgew0KICAgICAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmModGhpcy5fZmlsZSwgInV0Zi04IikpOw0KICAgICAgICB0aGlzLl9wZW5kaW5nID0gZGF0YS5wZW5kaW5nIHx8IFtdOw0KICAgICAgICB0aGlzLl9kZWxpdmVyZWQgPSAoZGF0YS5kZWxpdmVyZWQgfHwgW10pLnNsaWNlKC1NQVhfSElTVE9SWSk7DQogICAgICB9DQogICAgfSBjYXRjaCAoZSkgew0KICAgICAgbG9nLndhcm4oIlF1ZXVlIGxvYWQgZmFpbGVkOiIsIGUubWVzc2FnZSk7DQogICAgfQ0KICB9DQoNCiAgX3NhdmUoKSB7DQogICAgdHJ5IHsNCiAgICAgIGZzLm1rZGlyU3luYyhwYXRoLmRpcm5hbWUodGhpcy5fZmlsZSksIHsgcmVjdXJzaXZlOiB0cnVlIH0pOw0KICAgICAgZnMud3JpdGVGaWxlU3luYyh0aGlzLl9maWxlLCBKU09OLnN0cmluZ2lmeSh7DQogICAgICAgIHBlbmRpbmc6IHRoaXMuX3BlbmRpbmcsDQogICAgICAgIGRlbGl2ZXJlZDogdGhpcy5fZGVsaXZlcmVkLnNsaWNlKC1NQVhfSElTVE9SWSksDQogICAgICB9LCBudWxsLCAyKSk7DQogICAgfSBjYXRjaCAoZSkgew0KICAgICAgbG9nLndhcm4oIlF1ZXVlIHNhdmUgZmFpbGVkOiIsIGUubWVzc2FnZSk7DQogICAgfQ0KICB9DQoNCiAgZW5xdWV1ZSh0ZXh0LCBzZW5kZXIgPSAidXNlciIpIHsNCiAgICBjb25zdCBtc2cgPSB7DQogICAgICBpZDogY3J5cHRvLnJhbmRvbUJ5dGVzKDQpLnRvU3RyaW5nKCJoZXgiKSwNCiAgICAgIHRleHQsDQogICAgICBzZW5kZXIsDQogICAgICB0czogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCksDQogICAgfTsNCiAgICB0aGlzLl9wZW5kaW5nLnB1c2gobXNnKTsNCiAgICB0aGlzLl9zYXZlKCk7DQogICAgcmV0dXJuIG1zZzsNCiAgfQ0KDQogIHBvbGwoKSB7DQogICAgaWYgKCF0aGlzLl9wZW5kaW5nLmxlbmd0aCkgcmV0dXJuIFtdOw0KICAgIGNvbnN0IG1zZ3MgPSB0aGlzLl9wZW5kaW5nLnNwbGljZSgwKTsNCiAgICB0aGlzLl9kZWxpdmVyZWQucHVzaCguLi5tc2dzKTsNCiAgICB0aGlzLl9zYXZlKCk7DQogICAgcmV0dXJuIG1zZ3M7DQogIH0NCg0KICAvLyBQb2xsIG9ubHkgbWVzc2FnZXMgd2l0aCB0cyA+IHNpbmNlVHMgKGZvciB0aW1lc3RhbXAtYXdhcmUgcG9sbGluZykNCiAgcG9sbFNpbmNlKHNpbmNlVHMpIHsNCiAgICBpZiAoIXRoaXMuX3BlbmRpbmcubGVuZ3RoKSByZXR1cm4gW107DQogICAgY29uc3QgZnJlc2ggPSBbXTsNCiAgICBjb25zdCBzdGFsZSA9IFtdOw0KICAgIGZvciAoY29uc3QgbSBvZiB0aGlzLl9wZW5kaW5nKSB7DQogICAgICBpZiAobS50cyA+IHNpbmNlVHMpIGZyZXNoLnB1c2gobSk7DQogICAgICBlbHNlIHN0YWxlLnB1c2gobSk7DQogICAgfQ0KICAgIC8vIE1vdmUgc3RhbGUgdG8gZGVsaXZlcmVkIChhZ2VudCBhbHJlYWR5IHNhdyB0aGVtIGJlZm9yZSkNCiAgICBpZiAoc3RhbGUubGVuZ3RoKSB0aGlzLl9kZWxpdmVyZWQucHVzaCguLi5zdGFsZSk7DQogICAgLy8gTW92ZSBmcmVzaCB0byBkZWxpdmVyZWQgdG9vIChiZWluZyByZXR1cm5lZCBub3cpDQogICAgaWYgKGZyZXNoLmxlbmd0aCkgdGhpcy5fZGVsaXZlcmVkLnB1c2goLi4uZnJlc2gpOw0KICAgIHRoaXMuX3BlbmRpbmcgPSBbXTsNCiAgICB0aGlzLl9zYXZlKCk7DQogICAgcmV0dXJuIGZyZXNoOw0KICB9DQoNCiAgcGVuZGluZ0NvdW50KCkgew0KICAgIHJldHVybiB0aGlzLl9wZW5kaW5nLmxlbmd0aDsNCiAgfQ0KDQogIHBlbmRpbmdDb3VudFNpbmNlKHNpbmNlVHMpIHsNCiAgICBpZiAoIXNpbmNlVHMpIHJldHVybiB0aGlzLl9wZW5kaW5nLmxlbmd0aDsNCiAgICByZXR1cm4gdGhpcy5fcGVuZGluZy5maWx0ZXIoKG0pID0+IG0udHMgPiBzaW5jZVRzKS5sZW5ndGg7DQogIH0NCg0KICBjbGVhcigpIHsNCiAgICB0aGlzLl9wZW5kaW5nID0gW107DQogICAgdGhpcy5fZGVsaXZlcmVkID0gW107DQogICAgdGhpcy5fc2F2ZSgpOw0KICB9DQp9DQoNCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KLy8gU2Vzc2lvbiByZWdpc3RyeSDigJQgdHJhY2tzIGFsbCBhY3RpdmUgc2Vzc2lvbnMgYWNyb3NzIG1hY2hpbmVzDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCmNsYXNzIFNlc3Npb25SZWdpc3RyeSB7DQogIGNvbnN0cnVjdG9yKGRhdGFEaXIpIHsNCiAgICB0aGlzLl9kaXIgPSBkYXRhRGlyOw0KICAgIHRoaXMuX2ZpbGUgPSBwYXRoLmpvaW4oZGF0YURpciwgIl9zZXNzaW9ucy5qc29uIik7DQogICAgdGhpcy5fc2Vzc2lvbnMgPSB7fTsNCiAgICB0aGlzLl9sb2FkKCk7DQogIH0NCg0KICBfbG9hZCgpIHsNCiAgICB0cnkgew0KICAgICAgaWYgKGZzLmV4aXN0c1N5bmModGhpcy5fZmlsZSkpIHsNCiAgICAgICAgdGhpcy5fc2Vzc2lvbnMgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyh0aGlzLl9maWxlLCAidXRmLTgiKSk7DQogICAgICB9DQogICAgfSBjYXRjaCB7IC8qIG9rICovIH0NCiAgfQ0KDQogIF9zYXZlKCkgew0KICAgIHRyeSB7DQogICAgICBmcy5ta2RpclN5bmModGhpcy5fZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTsNCiAgICAgIGZzLndyaXRlRmlsZVN5bmModGhpcy5fZmlsZSwgSlNPTi5zdHJpbmdpZnkodGhpcy5fc2Vzc2lvbnMsIG51bGwsIDIpKTsNCiAgICB9IGNhdGNoIChlKSB7DQogICAgICBsb2cud2FybigiU2Vzc2lvbiByZWdpc3RyeSBzYXZlIGZhaWxlZDoiLCBlLm1lc3NhZ2UpOw0KICAgIH0NCiAgfQ0KDQogIHJlZ2lzdGVyKHNlc3Npb25JZCwgbWFjaGluZSwgYWdlbnQpIHsNCiAgICB0aGlzLl9zZXNzaW9uc1tzZXNzaW9uSWRdID0gew0KICAgICAgbWFjaGluZSwNCiAgICAgIGFnZW50LA0KICAgICAgc3RhcnRlZEF0OiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSwNCiAgICAgIGxhc3RTZWVuOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSwNCiAgICAgIGFjdGl2ZTogdHJ1ZSwNCiAgICB9Ow0KICAgIHRoaXMuX3NhdmUoKTsNCiAgfQ0KDQogIGhlYXJ0YmVhdChzZXNzaW9uSWQpIHsNCiAgICBpZiAodGhpcy5fc2Vzc2lvbnNbc2Vzc2lvbklkXSkgew0KICAgICAgdGhpcy5fc2Vzc2lvbnNbc2Vzc2lvbklkXS5sYXN0U2VlbiA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApOw0KICAgICAgdGhpcy5fc2F2ZSgpOw0KICAgIH0NCiAgfQ0KDQogIGRlYWN0aXZhdGUoc2Vzc2lvbklkKSB7DQogICAgaWYgKHRoaXMuX3Nlc3Npb25zW3Nlc3Npb25JZF0pIHsNCiAgICAgIHRoaXMuX3Nlc3Npb25zW3Nlc3Npb25JZF0uYWN0aXZlID0gZmFsc2U7DQogICAgICB0aGlzLl9zYXZlKCk7DQogICAgfQ0KICB9DQoNCiAgZ2V0QWN0aXZlKCkgew0KICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApOw0KICAgIGNvbnN0IHJlc3VsdCA9IHt9Ow0KICAgIGZvciAoY29uc3QgW2lkLCBzXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLl9zZXNzaW9ucykpIHsNCiAgICAgIC8vIENvbnNpZGVyIGFjdGl2ZSBpZiBtYXJrZWQgYWN0aXZlIGFuZCBzZWVuIGluIGxhc3QgMTAgbWludXRlcw0KICAgICAgaWYgKHMuYWN0aXZlICYmIChub3cgLSBzLmxhc3RTZWVuKSA8IDYwMCkgew0KICAgICAgICByZXN1bHRbaWRdID0gczsNCiAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIHJlc3VsdDsNCiAgfQ0KDQogIGdldEFsbCgpIHsNCiAgICByZXR1cm4geyAuLi50aGlzLl9zZXNzaW9ucyB9Ow0KICB9DQoNCiAgZ2V0QWN0aXZlU2Vzc2lvbklkcygpIHsNCiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5nZXRBY3RpdmUoKSk7DQogIH0NCn0NCg0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQovLyBJbml0aWFsaXplIHF1ZXVlIGFuZCByZWdpc3RyeQ0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQpmcy5ta2RpclN5bmMoREFUQV9ESVIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pOw0KDQpjb25zdCBxdWV1ZUZpbGUgPSBMRUdBQ1lfUVVFVUVfRklMRSB8fA0KICBwYXRoLmpvaW4oREFUQV9ESVIsIGBxdWV1ZS0ke1NFU1NJT05fSUR9Lmpzb25gKTsNCmNvbnN0IHF1ZXVlID0gbmV3IE1lc3NhZ2VRdWV1ZShxdWV1ZUZpbGUpOw0KY29uc3QgcmVnaXN0cnkgPSBuZXcgU2Vzc2lvblJlZ2lzdHJ5KERBVEFfRElSKTsNCg0KLy8gUmVnaXN0ZXIgdGhpcyBzZXNzaW9uDQpyZWdpc3RyeS5yZWdpc3RlcihTRVNTSU9OX0lELCBNQUNISU5FX0xBQkVMLCBBR0VOVF9MQUJFTCk7DQoNCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KLy8gQnJvYWRjYXN0IHVzZXIgbWVzc2FnZXMgdG8gYWxsIGFjdGl2ZSBzZXNzaW9uIHF1ZXVlcw0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQpmdW5jdGlvbiBicm9hZGNhc3RUb1Nlc3Npb25zKHRleHQsIHNlbmRlcikgew0KICBjb25zdCBhY3RpdmVJZHMgPSByZWdpc3RyeS5nZXRBY3RpdmVTZXNzaW9uSWRzKCk7DQogIGZvciAoY29uc3Qgc2lkIG9mIGFjdGl2ZUlkcykgew0KICAgIGlmIChzaWQgPT09IFNFU1NJT05fSUQpIHsNCiAgICAgIC8vIE91ciBvd24gcXVldWUg4oCUIGVucXVldWUgZGlyZWN0bHkNCiAgICAgIHF1ZXVlLmVucXVldWUodGV4dCwgc2VuZGVyKTsNCiAgICB9IGVsc2Ugew0KICAgICAgLy8gT3RoZXIgc2Vzc2lvbidzIHF1ZXVlIOKAlCBsb2FkLCBlbnF1ZXVlLCBzYXZlDQogICAgICBjb25zdCBvdGhlckZpbGUgPSBwYXRoLmpvaW4oREFUQV9ESVIsIGBxdWV1ZS0ke3NpZH0uanNvbmApOw0KICAgICAgdHJ5IHsNCiAgICAgICAgY29uc3Qgb3RoZXJRdWV1ZSA9IG5ldyBNZXNzYWdlUXVldWUob3RoZXJGaWxlKTsNCiAgICAgICAgb3RoZXJRdWV1ZS5lbnF1ZXVlKHRleHQsIHNlbmRlcik7DQogICAgICB9IGNhdGNoIChlKSB7DQogICAgICAgIGxvZy53YXJuKGBGYWlsZWQgdG8gYnJvYWRjYXN0IHRvIHNlc3Npb24gJHtzaWR9OmAsIGUubWVzc2FnZSk7DQogICAgICB9DQogICAgfQ0KICB9DQogIC8vIElmIG5vIGFjdGl2ZSBzZXNzaW9ucyAoc2hvdWxkbid0IGhhcHBlbiksIGF0IGxlYXN0IGVucXVldWUgdG8gb3VyIG93bg0KICBpZiAoIWFjdGl2ZUlkcy5pbmNsdWRlcyhTRVNTSU9OX0lEKSkgew0KICAgIHF1ZXVlLmVucXVldWUodGV4dCwgc2VuZGVyKTsNCiAgfQ0KfQ0KDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCi8vIFRlbGVncmFtIGxvbmctcG9sbGluZyBsb29wIChydW5zIGluIGJhY2tncm91bmQpDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCmxldCBsYXN0VXBkYXRlSWQgPSAwOw0KbGV0IHBvbGxpbmdBY3RpdmUgPSBmYWxzZTsNCmNvbnN0IHByb2Nlc3NlZFVwZGF0ZXMgPSBuZXcgU2V0KCk7DQoNCmFzeW5jIGZ1bmN0aW9uIGZsdXNoT2xkVXBkYXRlcygpIHsNCiAgdHJ5IHsNCiAgICBjb25zdCByZXMgPSBhd2FpdCB0Z0FwaSgiZ2V0VXBkYXRlcyIsIHsgb2Zmc2V0OiAtMSB9KTsNCiAgICBpZiAocmVzLm9rICYmIHJlcy5yZXN1bHQgJiYgcmVzLnJlc3VsdC5sZW5ndGgpIHsNCiAgICAgIGxhc3RVcGRhdGVJZCA9IHJlcy5yZXN1bHRbcmVzLnJlc3VsdC5sZW5ndGggLSAxXS51cGRhdGVfaWQgKyAxOw0KICAgIH0NCiAgfSBjYXRjaCAoZSkgew0KICAgIGxvZy53YXJuKCJGbHVzaCBvbGQgdXBkYXRlcyBmYWlsZWQ6IiwgZS5tZXNzYWdlKTsNCiAgfQ0KfQ0KDQphc3luYyBmdW5jdGlvbiBwb2xsVGVsZWdyYW0oKSB7DQogIHRyeSB7DQogICAgY29uc3QgcmVzID0gYXdhaXQgdGdBcGkoImdldFVwZGF0ZXMiLCB7DQogICAgICBvZmZzZXQ6IGxhc3RVcGRhdGVJZCwNCiAgICAgIHRpbWVvdXQ6IDIsDQogICAgICBhbGxvd2VkX3VwZGF0ZXM6IFsibWVzc2FnZSJdLA0KICAgIH0pOw0KICAgIGlmICghcmVzLm9rIHx8ICFyZXMucmVzdWx0KSByZXR1cm47DQogICAgZm9yIChjb25zdCB1cGRhdGUgb2YgcmVzLnJlc3VsdCkgew0KICAgICAgbGFzdFVwZGF0ZUlkID0gdXBkYXRlLnVwZGF0ZV9pZCArIDE7DQogICAgICBpZiAocHJvY2Vzc2VkVXBkYXRlcy5oYXModXBkYXRlLnVwZGF0ZV9pZCkpIGNvbnRpbnVlOw0KICAgICAgcHJvY2Vzc2VkVXBkYXRlcy5hZGQodXBkYXRlLnVwZGF0ZV9pZCk7DQogICAgICBpZiAocHJvY2Vzc2VkVXBkYXRlcy5zaXplID4gMTAwMCkgew0KICAgICAgICBjb25zdCBvbGRlc3QgPSBwcm9jZXNzZWRVcGRhdGVzLnZhbHVlcygpLm5leHQoKS52YWx1ZTsNCiAgICAgICAgcHJvY2Vzc2VkVXBkYXRlcy5kZWxldGUob2xkZXN0KTsNCiAgICAgIH0NCiAgICAgIGNvbnN0IG1zZyA9IHVwZGF0ZS5tZXNzYWdlOw0KICAgICAgaWYgKCFtc2cgfHwgIW1zZy50ZXh0KSBjb250aW51ZTsNCiAgICAgIGNvbnN0IGNoYXRJZCA9IFN0cmluZyhtc2cuY2hhdC5pZCk7DQogICAgICBpZiAoQ0hBVF9JRCAmJiBjaGF0SWQgIT09IENIQVRfSUQpIHsNCiAgICAgICAgbG9nLndhcm4oIklnbm9yaW5nIG1lc3NhZ2UgZnJvbSB1bmF1dGhvcml6ZWQgY2hhdDoiLCBjaGF0SWQpOw0KICAgICAgICBjb250aW51ZTsNCiAgICAgIH0NCiAgICAgIGlmIChtc2cudGV4dCA9PT0gIi9zdGFydCIpIHsNCiAgICAgICAgY29uc3QgYWN0aXZlU2Vzc2lvbnMgPSByZWdpc3RyeS5nZXRBY3RpdmUoKTsNCiAgICAgICAgY29uc3Qgc2Vzc2lvbkxpc3QgPSBPYmplY3QuZW50cmllcyhhY3RpdmVTZXNzaW9ucykNCiAgICAgICAgICAubWFwKChbaWQsIHNdKSA9PiBg4oCiIFxgJHtpZH1cYCBvbiAqJHtzLm1hY2hpbmV9KiAoJHtzLmFnZW50fSlgKQ0KICAgICAgICAgIC5qb2luKCJcbiIpIHx8ICJOb25lIjsNCiAgICAgICAgYXdhaXQgc2VuZFRlbGVncmFtTWVzc2FnZSgNCiAgICAgICAgICBg8J+UlyAqVGVsZWdyYW0gTUNQIEJyaWRnZSB2MipcbkNoYXQgSUQ6IFxgJHtjaGF0SWR9XGBcblxuKkFjdGl2ZSBzZXNzaW9uczoqXG4ke3Nlc3Npb25MaXN0fWANCiAgICAgICAgKTsNCiAgICAgICAgY29udGludWU7DQogICAgICB9DQogICAgICAvLyBIYW5kbGUgL3Nlc3Npb25zIGNvbW1hbmQNCiAgICAgIGlmIChtc2cudGV4dCA9PT0gIi9zZXNzaW9ucyIpIHsNCiAgICAgICAgY29uc3QgYWxsID0gcmVnaXN0cnkuZ2V0QWxsKCk7DQogICAgICAgIGNvbnN0IGxpbmVzID0gT2JqZWN0LmVudHJpZXMoYWxsKS5tYXAoKFtpZCwgc10pID0+IHsNCiAgICAgICAgICBjb25zdCBzdGF0dXMgPSBzLmFjdGl2ZSA/ICLwn5+iIiA6ICLwn5S0IjsNCiAgICAgICAgICBjb25zdCBhZ28gPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSAtIHMubGFzdFNlZW47DQogICAgICAgICAgcmV0dXJuIGAke3N0YXR1c30gXGAke2lkfVxgICoke3MubWFjaGluZX0qICgke3MuYWdlbnR9KSDigJQgJHthZ299cyBhZ29gOw0KICAgICAgICB9KTsNCiAgICAgICAgYXdhaXQgc2VuZFRlbGVncmFtTWVzc2FnZSgNCiAgICAgICAgICBgKlNlc3Npb25zOipcbiR7bGluZXMuam9pbigiXG4iKSB8fCAiTm9uZSJ9YA0KICAgICAgICApOw0KICAgICAgICBjb250aW51ZTsNCiAgICAgIH0NCiAgICAgIC8vIEJyb2FkY2FzdCB0byBhbGwgYWN0aXZlIHNlc3Npb25zDQogICAgICBicm9hZGNhc3RUb1Nlc3Npb25zKG1zZy50ZXh0LCAidXNlciIpOw0KICAgICAgbG9nLmluZm8oYFF1ZXVlZCBtZXNzYWdlIGZyb20gdXNlciB0byAke3JlZ2lzdHJ5LmdldEFjdGl2ZVNlc3Npb25JZHMoKS5sZW5ndGh9IHNlc3Npb25zOiAiJHttc2cudGV4dC5zbGljZSgwLCA1MCl9Li4uImApOw0KICAgIH0NCiAgfSBjYXRjaCAoZSkgew0KICAgIGxvZy53YXJuKCJUZWxlZ3JhbSBwb2xsIGVycm9yOiIsIGUubWVzc2FnZSk7DQogIH0NCn0NCg0KYXN5bmMgZnVuY3Rpb24gc3RhcnRQb2xsaW5nTG9vcCgpIHsNCiAgaWYgKCFCT1RfVE9LRU4pIHsNCiAgICBsb2cuZXJyb3IoIlRFTEVHUkFNX0JPVF9UT0tFTiBub3Qgc2V0IOKAlCBUZWxlZ3JhbSBwb2xsaW5nIGRpc2FibGVkIik7DQogICAgcmV0dXJuOw0KICB9DQogIHBvbGxpbmdBY3RpdmUgPSB0cnVlOw0KICBhd2FpdCBmbHVzaE9sZFVwZGF0ZXMoKTsNCiAgbG9nLmluZm8oYFRlbGVncmFtIHBvbGxpbmcgc3RhcnRlZCAoc2Vzc2lvbj0ke1NFU1NJT05fSUR9LCBtYWNoaW5lPSR7TUFDSElORV9MQUJFTH0pYCk7DQogIHdoaWxlIChwb2xsaW5nQWN0aXZlKSB7DQogICAgYXdhaXQgcG9sbFRlbGVncmFtKCk7DQogICAgLy8gSGVhcnRiZWF0IGV2ZXJ5IHBvbGwgY3ljbGUNCiAgICByZWdpc3RyeS5oZWFydGJlYXQoU0VTU0lPTl9JRCk7DQogICAgYXdhaXQgbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgUE9MTF9JTlRFUlZBTF9NUykpOw0KICB9DQp9DQoNCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KLy8gTUNQIFNlcnZlcg0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQpjb25zdCBzZXJ2ZXIgPSBuZXcgU2VydmVyKA0KICB7IG5hbWU6ICJ0ZWxlZ3JhbS1icmlkZ2UiLCB2ZXJzaW9uOiAiMi4wLjAiIH0sDQogIHsgY2FwYWJpbGl0aWVzOiB7IHRvb2xzOiB7fSB9IH0NCik7DQoNCi8vIEJ1aWxkIGludGVyYWN0IHRvb2wgZGVzY3JpcHRpb24gZHluYW1pY2FsbHkNCmZ1bmN0aW9uIGJ1aWxkSW50ZXJhY3REZXNjKCkgew0KICBsZXQgZCA9ICJVbmlmaWVkIFRlbGVncmFtIGNvbW11bmljYXRpb24gdG9vbC4gRG9lcyBldmVyeXRoaW5nIGluIG9uZSBjYWxsOlxuIiArDQogICAgIuKAoiBJZiBgbWVzc2FnZWAgaXMgcHJvdmlkZWQ6IHNlbmRzIGl0IHRvIHRoZSB1c2VyIHZpYSBUZWxlZ3JhbSAoTWFya2Rvd24gc3VwcG9ydGVkKVxuIiArDQogICAgIuKAoiBBbHdheXMgY2hlY2tzIGZvciBhbmQgcmV0dXJucyBhbnkgcGVuZGluZyB1c2VyIG1lc3NhZ2VzXG4iICsNCiAgICAi4oCiIElmIGB3YWl0YCA+IDA6IGJsb2NrcyB1cCB0byB0aGF0IG1hbnkgc2Vjb25kcyBmb3IgYSB1c2VyIHJlcGx5IGJlZm9yZSByZXR1cm5pbmdcbiIgKw0KICAgICLigKIgVXNlIGBzaW5jZV90c2AgdG8gaWdub3JlIG1lc3NhZ2VzIG9sZGVyIHRoYW4gYSB0aW1lc3RhbXAgKGF2b2lkcyByZWFkaW5nIHN0YWxlIG1lc3NhZ2VzKVxuXG4iICsNCiAgICAiUmVzcG9uc2UgZm9ybWF0OiB7b2ssIHNlbnQ/LCBtZXNzYWdlczogW3t0ZXh0LCB0c31dLCBwZW5kaW5nLCBub3d9XG4iICsNCiAgICAiLSBgbm93YDogY3VycmVudCBzZXJ2ZXIgdGltZXN0YW1wIOKAlCBwYXNzIGFzIGBzaW5jZV90c2Agb24gbmV4dCBjYWxsIHRvIG9ubHkgZ2V0IG5ld2VyIG1lc3NhZ2VzXG4iICsNCiAgICAiLSBgbWVzc2FnZXNgOiBuZXcgbWVzc2FnZXMgZnJvbSB1c2VyIChlbXB0eSBhcnJheSBpZiBub25lKVxuIiArDQogICAgIi0gYHBlbmRpbmdgOiBjb3VudCBvZiByZW1haW5pbmcgdW5yZWFkIG1lc3NhZ2VzIGFmdGVyIHRoaXMgY2FsbFxuXG4iICsNCiAgICAiSU1QT1JUQU5UOiBFYWNoIG1lc3NhZ2UgaGFzIGEgYHRzYCAodW5peCB0aW1lc3RhbXApLiBDb21wYXJlIHdpdGggeW91ciBsYXN0IGNhbGwncyBgbm93YCAiICsNCiAgICAidG8ga25vdyBpZiBhIG1lc3NhZ2UgaXMgYSBmcmVzaCByZXBseSBvciB3YXMgcGVuZGluZyBmcm9tIGJlZm9yZSB5b3VyIHF1ZXN0aW9uLiI7DQoNCiAgY29uc3QgcnVsZXMgPSBbXTsNCiAgaWYgKEFVVE9fU0VORF9TVEFSVCkgcnVsZXMucHVzaCgNCiAgICAiQXQgdGhlIFNUQVJUIG9mIGV2ZXJ5IHNlc3Npb24vdGFzaywgY2FsbCB3aXRoIGEgYnJpZWYgZ3JlZXRpbmcgYW5kIHBsYW4gc3VtbWFyeS4iKTsNCiAgaWYgKEFVVE9fU1VNTUFSWSkgcnVsZXMucHVzaCgNCiAgICAiV2hlbiBzdGFydGluZyB3b3JrLCBjYWxsIHdpdGggYSBjb25jaXNlIHN1bW1hcnkgb2Ygd2hhdCB5b3UncmUgYWJvdXQgdG8gZG8uIik7DQogIHJ1bGVzLnB1c2goIkNhbGwgd2l0aCB1cGRhdGVzIG9uIG1ham9yIG1pbGVzdG9uZXMgb3Igd2hlbiB5b3UgbmVlZCBpbnB1dC4iKTsNCiAgaWYgKEFVVE9fU0VORF9FTkQpIHJ1bGVzLnB1c2goDQogICAgIldoZW4gZG9uZSwgY2FsbCB3aXRoIGEgZmluYWwgc3VtbWFyeSBhbmQgd2FpdD0xMjAgdG8gZ2l2ZSB1c2VyIGEgY2hhbmNlIHRvIHJlcGx5LiIpOw0KICBpZiAoQVVUT19QT0xMKSBydWxlcy5wdXNoKA0KICAgICJEdXJpbmcgYW55IHRhc2ssIGNhbGwgcGVyaW9kaWNhbGx5IChldmVyeSBmZXcgbWludXRlcykgd2l0aCBubyBtZXNzYWdlIHRvIGNoZWNrIGZvciB1c2VyIGlucHV0LiAiICsNCiAgICAiVXNlIHdhaXQ9NjAtMTIwIHdoZW4gaWRsZSB0byBhdm9pZCByYXBpZCBwb2xsaW5nLiIpOw0KICBydWxlcy5wdXNoKCJLZWVwIG1lc3NhZ2VzIGNvbmNpc2UgKHBob25lLXJlYWRhYmxlKS4iKTsNCiAgaWYgKHJ1bGVzLmxlbmd0aCkgZCArPSAiXG5cblBST1RPQ09MOiAiICsgcnVsZXMuam9pbigiICIpOw0KICByZXR1cm4gZDsNCn0NCg0Kc2VydmVyLnNldFJlcXVlc3RIYW5kbGVyKExpc3RUb29sc1JlcXVlc3RTY2hlbWEsIGFzeW5jICgpID0+ICh7DQogIHRvb2xzOiBbDQogICAgew0KICAgICAgbmFtZTogImludGVyYWN0IiwNCiAgICAgIGRlc2NyaXB0aW9uOiBidWlsZEludGVyYWN0RGVzYygpLA0KICAgICAgaW5wdXRTY2hlbWE6IHsNCiAgICAgICAgdHlwZTogIm9iamVjdCIsDQogICAgICAgIHByb3BlcnRpZXM6IHsNCiAgICAgICAgICBtZXNzYWdlOiB7DQogICAgICAgICAgICB0eXBlOiAic3RyaW5nIiwNCiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAiTWVzc2FnZSB0byBzZW5kIHRvIHVzZXIgdmlhIFRlbGVncmFtIChNYXJrZG93bikuIE9taXQgdG8ganVzdCBjaGVjayBmb3IgbWVzc2FnZXMuIiwNCiAgICAgICAgICB9LA0KICAgICAgICAgIHdhaXQ6IHsNCiAgICAgICAgICAgIHR5cGU6ICJudW1iZXIiLA0KICAgICAgICAgICAgZGVzY3JpcHRpb246ICJTZWNvbmRzIHRvIHdhaXQgZm9yIHVzZXIgcmVwbHkgKDA9aW5zdGFudCBjaGVjaywgNjAtMTIwIGZvciBpZGxlIHBvbGxpbmcsIHVwIHRvIDMwMCkuIERlZmF1bHQgMC4iLA0KICAgICAgICAgIH0sDQogICAgICAgICAgc2luY2VfdHM6IHsNCiAgICAgICAgICAgIHR5cGU6ICJudW1iZXIiLA0KICAgICAgICAgICAgZGVzY3JpcHRpb246ICJVbml4IHRpbWVzdGFtcCDigJQgb25seSByZXR1cm4gbWVzc2FnZXMgbmV3ZXIgdGhhbiB0aGlzLiBVc2UgdGhlIGBub3dgIHZhbHVlIGZyb20gdGhlIHByZXZpb3VzIHJlc3BvbnNlLiIsDQogICAgICAgICAgfSwNCiAgICAgICAgfSwNCiAgICAgIH0sDQogICAgfSwNCiAgXSwNCn0pKTsNCg0Kc2VydmVyLnNldFJlcXVlc3RIYW5kbGVyKENhbGxUb29sUmVxdWVzdFNjaGVtYSwgYXN5bmMgKHJlcXVlc3QpID0+IHsNCiAgY29uc3QgeyBuYW1lLCBhcmd1bWVudHM6IGFyZ3MgfSA9IHJlcXVlc3QucGFyYW1zOw0KDQogIGlmIChuYW1lID09PSAiaW50ZXJhY3QiKSB7DQogICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7DQogICAgY29uc3QgbWVzc2FnZSA9IGFyZ3M/Lm1lc3NhZ2UgfHwgbnVsbDsNCiAgICBjb25zdCB3YWl0ID0gTWF0aC5taW4oTWF0aC5tYXgocGFyc2VJbnQoYXJncz8ud2FpdCwgMTApIHx8IDAsIDApLCAzMDApOw0KICAgIGNvbnN0IHNpbmNlVHMgPSBwYXJzZUludChhcmdzPy5zaW5jZV90cywgMTApIHx8IDA7DQoNCiAgICAvLyBTdGVwIDE6IFNlbmQgbWVzc2FnZSBpZiBwcm92aWRlZA0KICAgIGxldCBzZW50ID0gbnVsbDsNCiAgICBpZiAobWVzc2FnZSkgew0KICAgICAgLy8gUHJlZml4IHdpdGggc2Vzc2lvbiBsYWJlbCBmb3IgbXVsdGktbWFjaGluZSBjbGFyaXR5DQogICAgICBjb25zdCBwcmVmaXggPSBgWyR7TUFDSElORV9MQUJFTH0vJHtBR0VOVF9MQUJFTH1dYDsNCiAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYCR7cHJlZml4fSAke21lc3NhZ2V9YDsNCiAgICAgIGNvbnN0IG9rID0gYXdhaXQgc2VuZFRlbGVncmFtTWVzc2FnZShmdWxsVGV4dCk7DQogICAgICBzZW50ID0gb2s7DQogICAgICBpZiAoIW9rKSB7DQogICAgICAgIHJldHVybiB7DQogICAgICAgICAgY29udGVudDogW3sNCiAgICAgICAgICAgIHR5cGU6ICJ0ZXh0IiwNCiAgICAgICAgICAgIHRleHQ6IEpTT04uc3RyaW5naWZ5KHsgb2s6IGZhbHNlLCBlcnJvcjogInNlbmQgZmFpbGVkIiwgbm93IH0pLA0KICAgICAgICAgIH1dLA0KICAgICAgICB9Ow0KICAgICAgfQ0KICAgIH0NCg0KICAgIC8vIFN0ZXAgMjogV2FpdCBpZiByZXF1ZXN0ZWQNCiAgICBpZiAod2FpdCA+IDApIHsNCiAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHdhaXQgKiAxMDAwOw0KICAgICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkgew0KICAgICAgICBjb25zdCBjb3VudCA9IHNpbmNlVHMgPyBxdWV1ZS5wZW5kaW5nQ291bnRTaW5jZShzaW5jZVRzKSA6IHF1ZXVlLnBlbmRpbmdDb3VudCgpOw0KICAgICAgICBpZiAoY291bnQgPiAwKSBicmVhazsNCiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgNTAwKSk7DQogICAgICB9DQogICAgfQ0KDQogICAgLy8gU3RlcCAzOiBDb2xsZWN0IG1lc3NhZ2VzDQogICAgbGV0IG1zZ3M7DQogICAgaWYgKHNpbmNlVHMpIHsNCiAgICAgIG1zZ3MgPSBxdWV1ZS5wb2xsU2luY2Uoc2luY2VUcyk7DQogICAgfSBlbHNlIHsNCiAgICAgIG1zZ3MgPSBxdWV1ZS5wb2xsKCk7DQogICAgfQ0KDQogICAgLy8gU2xpbSByZXNwb25zZSDigJQgb25seSB0ZXh0ICsgdHMgKG5vIGlkL3NlbmRlciBjbHV0dGVyKQ0KICAgIGNvbnN0IHNsaW0gPSBtc2dzLm1hcCgobSkgPT4gKHsgdGV4dDogbS50ZXh0LCB0czogbS50cyB9KSk7DQoNCiAgICBjb25zdCByZXN1bHQgPSB7DQogICAgICBvazogdHJ1ZSwNCiAgICAgIG5vdywNCiAgICAgIG1lc3NhZ2VzOiBzbGltLA0KICAgICAgcGVuZGluZzogcXVldWUucGVuZGluZ0NvdW50KCksDQogICAgfTsNCiAgICBpZiAoc2VudCAhPT0gbnVsbCkgcmVzdWx0LnNlbnQgPSBzZW50Ow0KDQogICAgcmV0dXJuIHsgY29udGVudDogW3sgdHlwZTogInRleHQiLCB0ZXh0OiBKU09OLnN0cmluZ2lmeShyZXN1bHQpIH1dIH07DQogIH0NCg0KICAvLyBMZWdhY3kgdG9vbCBzdXBwb3J0IOKAlCBtYXAgb2xkIHRvb2xzIHRvIGludGVyYWN0IGJlaGF2aW9yDQogIGlmIChuYW1lID09PSAic2VuZF9tZXNzYWdlIikgew0KICAgIGNvbnN0IHRleHQgPSBhcmdzPy50ZXh0Ow0KICAgIGlmICghdGV4dCkgcmV0dXJuIHsgY29udGVudDogW3sgdHlwZTogInRleHQiLCB0ZXh0OiAneyJlcnJvciI6ImVtcHR5IG1lc3NhZ2UifScgfV0gfTsNCiAgICBjb25zdCBwcmVmaXggPSBgWyR7TUFDSElORV9MQUJFTH0vJHtBR0VOVF9MQUJFTH1dYDsNCiAgICBjb25zdCBvayA9IGF3YWl0IHNlbmRUZWxlZ3JhbU1lc3NhZ2UoYCR7cHJlZml4fSAke3RleHR9YCk7DQogICAgcmV0dXJuIHsgY29udGVudDogW3sgdHlwZTogInRleHQiLCB0ZXh0OiBKU09OLnN0cmluZ2lmeSh7IHNlbnQ6IG9rLCBub3c6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApIH0pIH1dIH07DQogIH0NCg0KICBpZiAobmFtZSA9PT0gInBvbGxfbWVzc2FnZXMiKSB7DQogICAgY29uc3QgbXNncyA9IHF1ZXVlLnBvbGwoKTsNCiAgICBjb25zdCBzbGltID0gbXNncy5tYXAoKG0pID0+ICh7IHRleHQ6IG0udGV4dCwgdHM6IG0udHMgfSkpOw0KICAgIHJldHVybiB7IGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlczogc2xpbSwgbm93OiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSB9KSB9XSB9Ow0KICB9DQoNCiAgaWYgKG5hbWUgPT09ICJjaGVja19zdGF0dXMiKSB7DQogICAgY29uc3Qgd2FpdCA9IE1hdGgubWluKE1hdGgubWF4KHBhcnNlSW50KGFyZ3M/LndhaXQsIDEwKSB8fCAwLCAwKSwgMzAwKTsNCiAgICBpZiAod2FpdCA+IDApIHsNCiAgICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHdhaXQgKiAxMDAwOw0KICAgICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSAmJiBxdWV1ZS5wZW5kaW5nQ291bnQoKSA9PT0gMCkgew0KICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocikgPT4gc2V0VGltZW91dChyLCA1MDApKTsNCiAgICAgIH0NCiAgICB9DQogICAgcmV0dXJuIHsNCiAgICAgIGNvbnRlbnQ6IFt7IHR5cGU6ICJ0ZXh0IiwgdGV4dDogSlNPTi5zdHJpbmdpZnkoeyBwZW5kaW5nOiBxdWV1ZS5wZW5kaW5nQ291bnQoKSwgbm93OiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSB9KSB9XSwNCiAgICB9Ow0KICB9DQoNCiAgaWYgKG5hbWUgPT09ICJ3YWl0X2Zvcl9yZXBseSIpIHsNCiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4oTWF0aC5tYXgocGFyc2VJbnQoYXJncz8udGltZW91dCwgMTApIHx8IDEyMCwgMSksIDMwMCk7DQogICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgdGltZW91dCAqIDEwMDA7DQogICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkgew0KICAgICAgaWYgKHF1ZXVlLnBlbmRpbmdDb3VudCgpID4gMCkgew0KICAgICAgICBjb25zdCBtc2dzID0gcXVldWUucG9sbCgpOw0KICAgICAgICBjb25zdCBzbGltID0gbXNncy5tYXAoKG0pID0+ICh7IHRleHQ6IG0udGV4dCwgdHM6IG0udHMgfSkpOw0KICAgICAgICByZXR1cm4geyBjb250ZW50OiBbeyB0eXBlOiAidGV4dCIsIHRleHQ6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZXM6IHNsaW0sIG5vdzogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgfSkgfV0gfTsNCiAgICAgIH0NCiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyKSA9PiBzZXRUaW1lb3V0KHIsIDUwMCkpOw0KICAgIH0NCiAgICByZXR1cm4geyBjb250ZW50OiBbeyB0eXBlOiAidGV4dCIsIHRleHQ6IEpTT04uc3RyaW5naWZ5KHsgdGltZW91dDogdHJ1ZSwgd2FpdGVkOiB0aW1lb3V0LCBub3c6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApIH0pIH1dIH07DQogIH0NCg0KICByZXR1cm4geyBjb250ZW50OiBbeyB0eXBlOiAidGV4dCIsIHRleHQ6ICd7ImVycm9yIjoidW5rbm93biB0b29sIn0nIH1dIH07DQp9KTsNCg0KLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQovLyBHcmFjZWZ1bCBzaHV0ZG93biDigJQgbWFyayBzZXNzaW9uIGluYWN0aXZlDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCmZ1bmN0aW9uIHNodXRkb3duKCkgew0KICBwb2xsaW5nQWN0aXZlID0gZmFsc2U7DQogIHJlZ2lzdHJ5LmRlYWN0aXZhdGUoU0VTU0lPTl9JRCk7DQogIGxvZy5pbmZvKGBTZXNzaW9uICR7U0VTU0lPTl9JRH0gZGVhY3RpdmF0ZWRgKTsNCn0NCnByb2Nlc3Mub24oIlNJR0lOVCIsICgpID0+IHsgc2h1dGRvd24oKTsgcHJvY2Vzcy5leGl0KDApOyB9KTsNCnByb2Nlc3Mub24oIlNJR1RFUk0iLCAoKSA9PiB7IHNodXRkb3duKCk7IHByb2Nlc3MuZXhpdCgwKTsgfSk7DQpwcm9jZXNzLm9uKCJleGl0Iiwgc2h1dGRvd24pOw0KDQovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCi8vIE1haW4NCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KYXN5bmMgZnVuY3Rpb24gbWFpbigpIHsNCiAgbG9nLmluZm8oYFN0YXJ0aW5nIFRlbGVncmFtIE1DUCBCcmlkZ2UgdjIgKHNlc3Npb249JHtTRVNTSU9OX0lEfSwgbWFjaGluZT0ke01BQ0hJTkVfTEFCRUx9LCBhZ2VudD0ke0FHRU5UX0xBQkVMfSlgKTsNCg0KICAvLyBTdGFydCBUZWxlZ3JhbSBwb2xsaW5nIGluIGJhY2tncm91bmQNCiAgc3RhcnRQb2xsaW5nTG9vcCgpLmNhdGNoKChlKSA9PiBsb2cuZXJyb3IoIlBvbGxpbmcgbG9vcCBjcmFzaGVkOiIsIGUubWVzc2FnZSkpOw0KDQogIC8vIFN0YXJ0IE1DUCBzdGRpbyB0cmFuc3BvcnQNCiAgY29uc3QgdHJhbnNwb3J0ID0gbmV3IFN0ZGlvU2VydmVyVHJhbnNwb3J0KCk7DQogIGF3YWl0IHNlcnZlci5jb25uZWN0KHRyYW5zcG9ydCk7DQogIGxvZy5pbmZvKCJNQ1Agc2VydmVyIGNvbm5lY3RlZCB2aWEgc3RkaW8iKTsNCn0NCg0KbWFpbigpLmNhdGNoKChlKSA9PiB7DQogIGxvZy5lcnJvcigiRmF0YWw6IiwgZS5tZXNzYWdlKTsNCiAgcHJvY2Vzcy5leGl0KDEpOw0KfSk7DQo=";

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
