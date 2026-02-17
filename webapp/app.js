// =============================================================================
//  Telegram MCP Bridge — Web App
//  Runs as a Telegram Mini App (TWA) or standalone in browser.
//  Communicates with the Telegram Bot API to manage agent sessions.
// =============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Telegram WebApp SDK
  // ---------------------------------------------------------------------------
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation();
  }

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = "tg_mcp_bridge";

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch { return {}; }
  }

  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  let settings = loadSettings();

  function getBotToken() {
    return settings.botToken || "";
  }

  function getChatId() {
    return settings.chatId || "";
  }

  // ---------------------------------------------------------------------------
  // Telegram Bot API helper
  // ---------------------------------------------------------------------------
  async function tgApi(method, body) {
    const token = getBotToken();
    if (!token) throw new Error("Bot token not configured");
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {};
    const res = await fetch(url, opts);
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Telegram API error");
    return json.result;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let sessions = {};
  let chatMessages = []; // { text, sender, ts, session? }
  let refreshTimer = null;
  let lastUpdateId = 0;
  let pollTimer = null;

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const statusDot = $("#status-dot");
  const statusText = $("#status-text");
  const sessionsList = $("#sessions-list");
  const chatMessagesEl = $("#chat-messages");
  const chatInput = $("#chat-input");
  const chatTarget = $("#chat-target");
  const btnSend = $("#btn-send");
  const btnRefresh = $("#btn-refresh");

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`#panel-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------
  function setStatus(state, text) {
    statusDot.className = "status-dot " + state;
    statusText.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  function showToast(msg) {
    let toast = $(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  // ---------------------------------------------------------------------------
  // Time formatting
  // ---------------------------------------------------------------------------
  function timeAgo(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 10) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function formatTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ---------------------------------------------------------------------------
  // Sessions rendering
  // ---------------------------------------------------------------------------
  function renderSessions() {
    const entries = Object.entries(sessions);
    if (!entries.length) {
      sessionsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📡</div>
          <p>No sessions found</p>
          <p class="hint">Start an agent with the MCP bridge to see sessions here</p>
        </div>`;
      return;
    }

    // Sort: active first, then by lastSeen desc
    entries.sort((a, b) => {
      if (a[1].active !== b[1].active) return b[1].active ? 1 : -1;
      return (b[1].lastSeen || 0) - (a[1].lastSeen || 0);
    });

    sessionsList.innerHTML = entries.map(([id, s]) => {
      const now = Math.floor(Date.now() / 1000);
      const isActive = s.active && (now - (s.lastSeen || 0)) < 600;
      const badgeClass = isActive ? "" : "inactive";
      const badgeText = isActive ? "● Active" : "● Offline";
      return `
        <div class="session-card" data-session="${id}">
          <div class="session-card-header">
            <div class="session-card-title">
              🖥️ ${escHtml(s.machine || "Unknown")}
              <span class="session-id">${escHtml(id)}</span>
            </div>
            <span class="session-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="session-meta">
            <span class="session-meta-item">🤖 ${escHtml(s.agent || "agent")}</span>
            <span class="session-meta-item">🕐 ${timeAgo(s.lastSeen || s.startedAt || 0)}</span>
            ${s.startedAt ? `<span class="session-meta-item">📅 Started ${formatTime(s.startedAt)}</span>` : ""}
          </div>
        </div>`;
    }).join("");

    // Click to switch chat target
    sessionsList.querySelectorAll(".session-card").forEach((card) => {
      card.addEventListener("click", () => {
        const sid = card.dataset.session;
        chatTarget.value = sid;
        // Switch to chat tab
        $$(".tab").forEach((t) => t.classList.remove("active"));
        $$(".panel").forEach((p) => p.classList.remove("active"));
        $$(".tab")[1].classList.add("active");
        $("#panel-chat").classList.add("active");
      });
    });
  }

  function updateChatTargetOptions() {
    const current = chatTarget.value;
    const opts = ['<option value="__broadcast__">📢 All Sessions</option>'];
    for (const [id, s] of Object.entries(sessions)) {
      const label = `🖥️ ${s.machine || id} (${s.agent || "agent"})`;
      opts.push(`<option value="${escHtml(id)}">${escHtml(label)}</option>`);
    }
    chatTarget.innerHTML = opts.join("");
    // Restore selection if still valid
    if ([...chatTarget.options].some((o) => o.value === current)) {
      chatTarget.value = current;
    }
  }

  // ---------------------------------------------------------------------------
  // Chat rendering
  // ---------------------------------------------------------------------------
  function renderChat() {
    if (!chatMessages.length) {
      chatMessagesEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <p>No messages yet</p>
          <p class="hint">Messages between you and your agents appear here</p>
        </div>`;
      return;
    }

    chatMessagesEl.innerHTML = chatMessages.map((m) => {
      const isUser = m.sender === "user";
      const cls = isUser ? "msg-user" : "msg-agent";
      const label = isUser ? "" : `<div class="msg-label">${escHtml(m.session || "agent")}</div>`;
      return `
        <div class="msg ${cls}">
          ${label}
          <div>${escHtml(m.text)}</div>
          <div class="msg-meta">
            <span>${formatTime(m.ts)}</span>
          </div>
        </div>`;
    }).join("");

    // Scroll to bottom
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    const chatId = getChatId();
    if (!chatId) {
      showToast("Configure Chat ID in Settings first");
      return;
    }

    chatInput.value = "";
    chatInput.style.height = "auto";
    btnSend.disabled = true;

    // Add to local chat
    chatMessages.push({
      text,
      sender: "user",
      ts: Math.floor(Date.now() / 1000),
    });
    renderChat();

    try {
      await tgApi("sendMessage", {
        chat_id: parseInt(chatId, 10),
        text,
      });
    } catch (e) {
      showToast("Send failed: " + e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch sessions from data dir (via bot API — we read the _sessions.json
  // by having the MCP server expose it, or we parse /sessions command output)
  // ---------------------------------------------------------------------------
  async function fetchSessions() {
    if (!getBotToken() || !getChatId()) {
      setStatus("error", "Configure bot token & chat ID in Settings");
      return;
    }

    setStatus("loading", "Refreshing...");

    try {
      // Send /sessions command to the bot, then read the response
      // This triggers the MCP server to reply with session info
      await tgApi("sendMessage", {
        chat_id: parseInt(getChatId(), 10),
        text: "/sessions",
      });

      // Wait a moment for the bot to process and reply
      await new Promise((r) => setTimeout(r, 1500));

      // Fetch recent messages to find the sessions response
      const updates = await tgApi("getUpdates", {
        offset: lastUpdateId || -10,
        limit: 20,
        timeout: 0,
      });

      let foundSessions = false;
      for (const update of updates) {
        if (update.update_id >= lastUpdateId) {
          lastUpdateId = update.update_id + 1;
        }
        const msg = update.message;
        if (!msg || !msg.text) continue;

        // Parse sessions response from bot
        if (msg.from?.is_bot && msg.text.includes("Sessions:")) {
          sessions = parseSessionsMessage(msg.text);
          foundSessions = true;
        }

        // Collect chat messages from user and bot
        if (String(msg.chat?.id) === getChatId()) {
          const isBot = msg.from?.is_bot;
          const existing = chatMessages.find((m) =>
            m.ts === msg.date && m.text === msg.text
          );
          if (!existing && !msg.text.startsWith("/")) {
            // Extract session label from bot messages like [machine/agent] text
            let session = null;
            let text = msg.text;
            if (isBot) {
              const match = msg.text.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
              if (match) {
                session = match[1];
                text = match[2];
              }
            }
            chatMessages.push({
              text,
              sender: isBot ? "agent" : "user",
              ts: msg.date,
              session,
            });
          }
        }
      }

      // Deduplicate and sort messages
      const seen = new Set();
      chatMessages = chatMessages.filter((m) => {
        const key = `${m.ts}:${m.sender}:${m.text.slice(0, 50)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      chatMessages.sort((a, b) => a.ts - b.ts);

      // Keep last 200 messages
      if (chatMessages.length > 200) {
        chatMessages = chatMessages.slice(-200);
      }

      renderSessions();
      updateChatTargetOptions();
      renderChat();

      const activeCount = Object.values(sessions).filter((s) => s.active).length;
      setStatus("connected", `${activeCount} active session${activeCount !== 1 ? "s" : ""}`);
    } catch (e) {
      setStatus("error", e.message);
      console.error("Fetch sessions error:", e);
    }
  }

  function parseSessionsMessage(text) {
    const result = {};
    // Parse lines like: 🟢 `s-abc123` *MyPC* (agent) — 5s ago
    // or: 🔴 `s-abc123` *MyPC* (agent) — 120s ago
    const lines = text.split("\n");
    for (const line of lines) {
      const match = line.match(/([🟢🔴])\s*`([^`]+)`\s*\*([^*]+)\*\s*\(([^)]+)\)\s*—\s*(\d+)s ago/);
      if (match) {
        const [, status, id, machine, agent, agoStr] = match;
        const ago = parseInt(agoStr, 10);
        const now = Math.floor(Date.now() / 1000);
        result[id] = {
          machine,
          agent,
          active: status === "🟢",
          lastSeen: now - ago,
          startedAt: now - ago - 60, // approximate
        };
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Polling for new messages (lightweight)
  // ---------------------------------------------------------------------------
  async function pollMessages() {
    if (!getBotToken()) return;

    try {
      const updates = await tgApi("getUpdates", {
        offset: lastUpdateId,
        limit: 50,
        timeout: 0,
      });

      let hasNew = false;
      for (const update of updates) {
        if (update.update_id >= lastUpdateId) {
          lastUpdateId = update.update_id + 1;
        }
        const msg = update.message;
        if (!msg || !msg.text) continue;
        if (String(msg.chat?.id) !== getChatId()) continue;

        // Skip commands and sessions responses
        if (msg.text.startsWith("/")) continue;
        if (msg.text.includes("Sessions:") && msg.from?.is_bot) {
          // Update sessions from this response
          sessions = parseSessionsMessage(msg.text);
          renderSessions();
          updateChatTargetOptions();
          continue;
        }

        const isBot = msg.from?.is_bot;
        const existing = chatMessages.find((m) =>
          m.ts === msg.date && m.text === msg.text
        );
        if (!existing) {
          let session = null;
          let text = msg.text;
          if (isBot) {
            const match = msg.text.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
            if (match) {
              session = match[1];
              text = match[2];
            }
          }
          chatMessages.push({
            text,
            sender: isBot ? "agent" : "user",
            ts: msg.date,
            session,
          });
          hasNew = true;
        }
      }

      if (hasNew) {
        chatMessages.sort((a, b) => a.ts - b.ts);
        if (chatMessages.length > 200) {
          chatMessages = chatMessages.slice(-200);
        }
        renderChat();
      }
    } catch (e) {
      // Silent fail for polling
      console.warn("Poll error:", e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-refresh
  // ---------------------------------------------------------------------------
  function startAutoRefresh() {
    stopAutoRefresh();
    const interval = (settings.refreshInterval || 10) * 1000;

    // Poll for messages more frequently
    pollTimer = setInterval(pollMessages, Math.min(interval, 5000));

    // Full session refresh less frequently
    refreshTimer = setInterval(fetchSessions, Math.max(interval, 15000));
  }

  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function loadSettingsUI() {
    $("#setting-bot-token").value = settings.botToken || "";
    $("#setting-chat-id").value = settings.chatId || "";
    $("#setting-auto-refresh").checked = settings.autoRefresh !== false;
    $("#setting-refresh-interval").value = settings.refreshInterval || 10;
  }

  function saveSettingsFromUI() {
    settings.botToken = $("#setting-bot-token").value.trim();
    settings.chatId = $("#setting-chat-id").value.trim();
    settings.autoRefresh = $("#setting-auto-refresh").checked;
    settings.refreshInterval = parseInt($("#setting-refresh-interval").value, 10) || 10;
    saveSettings(settings);
    showToast("Settings saved");

    // Restart auto-refresh with new settings
    if (settings.autoRefresh) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }

    // Trigger a refresh
    fetchSessions();
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------
  btnRefresh.addEventListener("click", () => {
    btnRefresh.querySelector("svg").style.animation = "spin 0.6s linear";
    setTimeout(() => btnRefresh.querySelector("svg").style.animation = "", 600);
    fetchSessions();
  });

  btnSend.addEventListener("click", sendMessage);

  chatInput.addEventListener("input", () => {
    btnSend.disabled = !chatInput.value.trim();
    // Auto-resize
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.value.trim()) sendMessage();
    }
  });

  $("#btn-save-settings").addEventListener("click", saveSettingsFromUI);

  $("#btn-clear-settings").addEventListener("click", () => {
    if (confirm("Clear all settings and message history?")) {
      localStorage.removeItem(STORAGE_KEY);
      settings = {};
      chatMessages = [];
      sessions = {};
      loadSettingsUI();
      renderSessions();
      renderChat();
      stopAutoRefresh();
      setStatus("", "Disconnected");
      showToast("All data cleared");
    }
  });

  // ---------------------------------------------------------------------------
  // HTML escaping
  // ---------------------------------------------------------------------------
  function escHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    loadSettingsUI();
    renderSessions();
    renderChat();

    if (getBotToken() && getChatId()) {
      fetchSessions();
      if (settings.autoRefresh !== false) {
        startAutoRefresh();
      }
    } else {
      setStatus("error", "Configure bot token & chat ID in Settings");
      // Switch to settings tab
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".panel").forEach((p) => p.classList.remove("active"));
      $$(".tab")[2].classList.add("active");
      $("#panel-settings").classList.add("active");
    }
  }

  init();
})();
