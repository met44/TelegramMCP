// =============================================================================
//  Telegram MCP Bridge — Web App
//  Runs as a Telegram Mini App (TWA) or standalone in browser.
//  Send-only dashboard: sends messages to the forum group.
//  Per-session chat happens natively in Telegram Topics.
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
  let refreshTimer = null;

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
        <div class="session-card" data-session="${escHtml(id)}">
          <div class="session-card-header">
            <div class="session-card-title">
              🖥️ ${escHtml(s.label || s.machine || "Unknown")}
              <span class="session-id">${escHtml(id)}</span>
            </div>
            <span class="session-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="session-meta">
            <span class="session-meta-item">🤖 ${escHtml(s.agent || "agent")}</span>
            <span class="session-meta-item">🕐 ${timeAgo(s.lastSeen || s.startedAt || 0)}</span>
            ${s.topicId ? `<span class="session-meta-item">� Topic #${s.topicId}</span>` : ""}
          </div>
        </div>`;
    }).join("");

    // Click to open Telegram group (topics are native)
    sessionsList.querySelectorAll(".session-card").forEach((card) => {
      card.addEventListener("click", () => {
        showToast("Open the group in Telegram to chat in this session's topic");
      });
    });
  }

  function updateChatTargetOptions() {
    const current = chatTarget.value;
    const opts = ['<option value="__general__">📢 General (all agents)</option>'];
    for (const [id, s] of Object.entries(sessions)) {
      if (!s.topicId) continue;
      const label = `🖥️ ${s.label || s.machine || id}`;
      opts.push(`<option value="${s.topicId}">${escHtml(label)}</option>`);
    }
    chatTarget.innerHTML = opts.join("");
    if ([...chatTarget.options].some((o) => o.value === current)) {
      chatTarget.value = current;
    }
  }

  // ---------------------------------------------------------------------------
  // Chat panel — send-only (actual chat is in Telegram Topics)
  // ---------------------------------------------------------------------------
  function renderChat() {
    chatMessagesEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p>Per-session chat lives in Telegram Topics</p>
        <p class="hint">Each agent has its own topic in your forum group.<br>
        Use this panel to send quick messages, or open Telegram to see full conversations.</p>
      </div>`;
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

    try {
      const body = {
        chat_id: parseInt(chatId, 10),
        text,
      };
      // Send to specific topic if selected
      const target = chatTarget.value;
      if (target && target !== "__general__") {
        body.message_thread_id = parseInt(target, 10);
      }
      await tgApi("sendMessage", body);
      showToast("Message sent ✓");
    } catch (e) {
      showToast("Send failed: " + e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch sessions via getChat + getForumTopicIconStickers
  // We read the _sessions.json indirectly by sending /sessions and parsing
  // the bot's response. But since we can't use getUpdates (conflicts with
  // MCP server polling), we use getChat to verify the group is alive,
  // and rely on the session data being visible in the forum topics.
  //
  // For a richer experience, the user should configure session data URL
  // or we parse the topic list from the group.
  // ---------------------------------------------------------------------------
  async function fetchSessions() {
    if (!getBotToken() || !getChatId()) {
      setStatus("error", "Configure bot token & chat ID in Settings");
      return;
    }

    setStatus("loading", "Refreshing...");

    try {
      // Verify the group is accessible
      const chatInfo = await tgApi("getChat", { chat_id: parseInt(getChatId(), 10) });

      if (!chatInfo.is_forum) {
        setStatus("error", "Group does not have Topics enabled");
        return;
      }

      // We can't list topics via Bot API directly, but we can verify the group
      // and show basic info. Session data comes from the _sessions.json on disk
      // which is managed by the MCP servers.
      setStatus("connected", `Connected to: ${chatInfo.title || "Forum Group"}`);

      // If we have cached sessions, show them
      renderSessions();
      updateChatTargetOptions();
    } catch (e) {
      setStatus("error", e.message);
      console.error("Fetch error:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-refresh
  // ---------------------------------------------------------------------------
  function startAutoRefresh() {
    stopAutoRefresh();
    const interval = (settings.refreshInterval || 30) * 1000;
    refreshTimer = setInterval(fetchSessions, interval);
  }

  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function loadSettingsUI() {
    $("#setting-bot-token").value = settings.botToken || "";
    $("#setting-chat-id").value = settings.chatId || "";
    $("#setting-auto-refresh").checked = settings.autoRefresh !== false;
    $("#setting-refresh-interval").value = settings.refreshInterval || 30;
  }

  function saveSettingsFromUI() {
    settings.botToken = $("#setting-bot-token").value.trim();
    settings.chatId = $("#setting-chat-id").value.trim();
    settings.autoRefresh = $("#setting-auto-refresh").checked;
    settings.refreshInterval = parseInt($("#setting-refresh-interval").value, 10) || 30;
    saveSettings(settings);
    showToast("Settings saved");

    if (settings.autoRefresh) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }

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
    if (confirm("Clear all settings?")) {
      localStorage.removeItem(STORAGE_KEY);
      settings = {};
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
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".panel").forEach((p) => p.classList.remove("active"));
      $$(".tab")[2].classList.add("active");
      $("#panel-settings").classList.add("active");
    }
  }

  init();
})();
