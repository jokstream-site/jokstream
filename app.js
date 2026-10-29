/* JokStream app logic. Use only channels you are authorized to access or redistribute. */
const CHANNELS_PER_PAGE = 30;
// The owner Worker serves the directory and proxies sources authorized for use.
const CHANNEL_DIRECTORY_URL = "https://jokstreamproxy1.abdonarjah.workers.dev/?get_list=true";
const STREAM_PROXY_URL = "https://jokstreamproxy1.abdonarjah.workers.dev/";
const STREAM_HANDSHAKE_TIMEOUT_MS = 3000;
const SHARE_GATE_INTERVAL_MS = 45 * 60 * 1000;

// Supabase Realtime chat. The publishable key is designed for browser use; RLS protects table access.
const SUPABASE_URL = "https://qdzaihlvoidqghjpfxdk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_biqieT8ICxX0k433lhBU-A_mHdW_6GK";
const CHAT_CONFIG = { maxMessages: 50, maxMessageLength: 300, maxNicknameLength: 24, minSendIntervalMs: 900 };
let supabaseClient = null;
let supabaseChatChannel = null;
let chatRoomKey = null;
let currentChannel = null;
let lastChatSend = 0;
let pendingGateChannel = null;
let gateWindowOpened = false;
let gateReturnHandler = null;

let allChannels = [];
let filteredChannels = [];
let visibleCount = CHANNELS_PER_PAGE;
let hlsInstance = null;
let cancelPlaybackAttempt = null;
let p2pEngineClass = null;
let shareUnlockedThisSession = false;
let watchStartedAt = 0;
let breakGatePending = false;
let deferredInstallPrompt = null;
let overlayPlaceholders = null;
let presenceViewerId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let presenceRoomKey = null;
const POPUNDER_INTERVAL_MS = 30 * 60 * 1000;
const POPUNDER_STORAGE_KEY = "jokstream_popunder_last_shown_v1";

const $ = (id) => document.getElementById(id);

function toast(message, isError = false) {
  const region = $("socialToastRegion");
  if (!region) return;
  const node = document.createElement("div");
  node.className = `toast${isError ? " error" : ""}`;
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function safeText(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function slugify(value) {
  return safeText(value, 160).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown-channel";
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const commaIndex = line.lastIndexOf(",");
      const metadata = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
      const name = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "Unknown channel";
      const attr = (key) => {
        const match = metadata.match(new RegExp(`${key}="([^"]*)"`));
        return match ? match[1] : "";
      };
      current = {
        name: safeText(name, 140) || "Unknown channel",
        logo: attr("tvg-logo"),
        group: safeText(attr("group-title") || "Other", 80),
        country: safeText(attr("tvg-country"), 80),
        url: ""
      };
    } else if (!line.startsWith("#") && current) {
      current.url = line;
      // Preserve both HTTPS and HTTP stream URLs; no scheme-based channel filtering.
      if (/^https?:\/\//i.test(current.url)) {
        const metadata = `${current.name} ${current.group}`;
        current.shareGate = /\b(premium|exclusive|encrypted|vip|members[ -]?only)\b/i.test(metadata);
        current.chatRoom = slugify(`${current.name}-${current.group}-${current.country}`);
        channels.push(current);
      }
      current = null;
    }
  }

  const seen = new Set();
  return channels.filter((channel) => {
    const key = `${channel.name}|${channel.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeChannel(channel) {
  if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
    throw new Error("The channel directory contains an invalid channel.");
  }
  const name = safeText(channel.name, 140) || "Unknown channel";
  const group = safeText(channel.group || "Other", 80);
  const country = safeText(channel.country, 80);
  const url = typeof channel.url === "string" ? channel.url.trim() : "";
  let source;
  try {
    source = new URL(url);
  } catch (_) {
    throw new Error(`The channel directory contains an invalid URL for "${name}".`);
  }
  if (source.protocol !== "http:" && source.protocol !== "https:") {
    throw new Error(`The channel directory contains an unsupported URL for "${name}".`);
  }
  const hasShareGate = Object.prototype.hasOwnProperty.call(channel, "shareGate");
  return {
    name,
    group,
    logo: typeof channel.logo === "string" ? channel.logo : "",
    country,
    url: source.href,
    chatRoom: safeText(channel.chatRoom, 160) || slugify(`${name}-${group}-${country}`),
    shareGate: hasShareGate
      ? channel.shareGate === true || channel.shareGate === "true"
      : /\b(premium|exclusive|encrypted|vip|members[ -]?only)\b/i.test(`${name} ${group}`)
  };
}

function decodeChannelDirectory(text) {
  let payload = text.trim();
  let encoding = "direct";
  const isDirectory = (value) => /^(?:#EXTM3U(?:\s|$)|#EXTINF:|\[)/.test(value);
  if (!isDirectory(payload)) {
    const binary = atob(payload.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    encoding = "base64";
  }
  if (!isDirectory(payload)) throw new Error("Unsupported directory format.");
  const format = payload.startsWith("[") ? "json" : "m3u";
  const directory = format === "json" ? JSON.parse(payload) : parseM3U(payload);
  return {
    directory, encoding, format,
    extinfCount: format === "m3u" ? (payload.match(/^\s*#EXTINF:/gm) || []).length : 0
  };
}

async function loadChannels() {
  const list = $("channelList");
  allChannels = [];
  filteredChannels = [];
  visibleCount = CHANNELS_PER_PAGE;
  $("channelCount").textContent = "0";
  $("resultsCount").textContent = "Loading channels…";
  list.innerHTML = '<div class="empty-state">Loading the public channel directory…</div>';
  $("playerStatus").textContent = "Loading channel directory";
  const diagnostics = {
    stage: "request", status: null, responseBytes: 0, encoding: "unknown", format: "unknown",
    extinfCount: 0, parsedEntries: 0, rejectedEntries: 0, duplicateEntries: 0, acceptedChannels: 0
  };
  try {
    const response = await fetch(CHANNEL_DIRECTORY_URL, { cache: "no-store" });
    diagnostics.status = response.status;
    diagnostics.stage = "http";
    if (!response.ok) throw new Error(`Playlist request failed (${response.status})`);
    diagnostics.stage = "read";
    const text = await response.text();
    diagnostics.responseBytes = new TextEncoder().encode(text).byteLength;
    diagnostics.stage = "decode-and-parse";
    const { directory, encoding, format, extinfCount } = decodeChannelDirectory(text);
    Object.assign(diagnostics, { encoding, format, extinfCount, parsedEntries: directory.length });
    diagnostics.stage = "normalize";
    // A bad entry must not discard the rest of the cached directory.
    const seen = new Set();
    allChannels = directory.flatMap((entry) => {
      try {
        const channel = normalizeChannel(entry);
        const key = `${channel.name}|${channel.url}`;
        if (seen.has(key)) { diagnostics.duplicateEntries++; return []; }
        seen.add(key);
        return [channel];
      } catch (_) { diagnostics.rejectedEntries++; return []; }
    });
    diagnostics.acceptedChannels = allChannels.length;
    diagnostics.stage = "render";
    allChannels.sort((a, b) => a.name.localeCompare(b.name));
    $("channelCount").textContent = allChannels.length.toLocaleString();
    populateCategories();
    applyChannelFilters();
    if (allChannels.length) {
      $("playerStatus").textContent = "Channel directory ready";
    } else {
      $("resultsCount").textContent = "0 results";
      $("playerStatus").textContent = "Channel directory is empty";
      list.innerHTML = '<div class="empty-state">No channels are currently published by the Worker.</div>';
    }
    diagnostics.stage = "complete";
    // Only aggregate metadata: never log payloads, source URLs, names, or raw errors.
    console.info("Channel directory diagnostics", diagnostics);
  } catch (_) {
    console.error("Channel directory diagnostics", diagnostics);
    allChannels = [];
    filteredChannels = [];
    $("channelCount").textContent = "0";
    list.innerHTML = '<div class="empty-state">Could not load the channel directory. Check your connection and try refreshing the page.</div>';
    $("resultsCount").textContent = "Unavailable";
    $("playerStatus").textContent = "Directory could not be loaded";
  }
}


function renderQuickCategoryFilters() {
  const host = $("categoryQuickFilters");
  if (!host) return;
  const groups = [...new Set(allChannels.map((channel) => channel.group).filter(Boolean))];
  const preferred = [
    ["Sports", /sport|football|soccer|basket|nba|tennis|motorsport|cricket/i],
    ["News", /news|noticias|actualit|inform|world news/i],
    ["Entertainment", /entertain|movie|film|series|music|comedy|drama/i],
    ["Kids", /kids|children|cartoon|animation/i],
    ["Documentary", /documentary|document|history|science|nature/i]
  ];
  const buttons = [{ label: "All", value: "" }];
  for (const [label, pattern] of preferred) {
    if (groups.some((group) => pattern.test(group))) buttons.push({ label, value: `__smart:${label}` });
  }
  host.replaceChildren();
  for (const item of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-chip";
    button.textContent = item.label;
    button.dataset.category = item.value;
    button.setAttribute("aria-pressed", item.value === "" ? "true" : "false");
    button.addEventListener("click", () => {
      host.querySelectorAll(".category-chip").forEach((chip) => {
        chip.setAttribute("aria-pressed", String(chip === button));
      });
      $("categoryFilter").value = item.value.startsWith("__smart:") ? "" : item.value;
      $("categoryFilter").dataset.smartCategory = item.value.startsWith("__smart:") ? item.value.slice(8) : "";
      applyChannelFilters();
    });
    host.appendChild(button);
  }
}

function populateCategories() {
  const select = $("categoryFilter");
  const categories = [...new Set(allChannels.map((channel) => channel.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = '<option value="">All categories</option>';
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  }
  renderQuickCategoryFilters();
}

function applyChannelFilters() {
  const query = safeText($("channelSearch").value, 120).toLowerCase();
  const category = $("categoryFilter").value;
  const smartCategory = $("categoryFilter").dataset.smartCategory || "";
  const smartPatterns = {
    Sports: /sport|football|soccer|basket|nba|tennis|motorsport|cricket/i,
    News: /news|noticias|actualit|inform|world news/i,
    Entertainment: /entertain|movie|film|series|music|comedy|drama/i,
    Kids: /kids|children|cartoon|animation/i,
    Documentary: /documentary|document|history|science|nature/i
  };
  const pattern = smartPatterns[smartCategory];
  filteredChannels = allChannels.filter((channel) => {
    const matchesQuery = !query || `${channel.name} ${channel.country} ${channel.group}`.toLowerCase().includes(query);
    const matchesCategory = pattern ? pattern.test(`${channel.name} ${channel.group}`) : (!category || channel.group === category);
    return matchesQuery && matchesCategory;
  });
  visibleCount = CHANNELS_PER_PAGE;
  renderChannels();
}

function renderChannels() {
  const list = $("channelList");
  const channels = filteredChannels.slice(0, visibleCount);
  list.replaceChildren();
  if (!channels.length) {
    list.innerHTML = '<div class="empty-state">No channels match your search.</div>';
  } else {
    const fragment = document.createDocumentFragment();
    for (const channel of channels) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel-item";
      button.setAttribute("aria-label", `Play ${channel.name}`);
      const logo = document.createElement("span");
      logo.className = "channel-logo";
      if (channel.logo && /^https?:\/\//i.test(channel.logo)) {
        const img = document.createElement("img");
        img.src = channel.logo;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => { logo.textContent = channel.name.slice(0, 1).toUpperCase(); };
        logo.appendChild(img);
      } else logo.textContent = channel.name.slice(0, 1).toUpperCase();
      const info = document.createElement("span");
      info.className = "channel-info";
      const name = document.createElement("span");
      name.className = "channel-name";
      name.textContent = channel.name;
      const meta = document.createElement("span");
      meta.className = "channel-meta";
      meta.textContent = [channel.group, channel.country].filter(Boolean).join(" · ");
      info.append(name, meta);
      const play = document.createElement("span");
      play.className = "play-symbol";
      play.textContent = "▶";
      button.append(logo, info, play);
      button.addEventListener("click", () => requestPlayChannel(channel, button));
      fragment.appendChild(button);
    }
    list.appendChild(fragment);
  }
  $("resultsCount").textContent = `${filteredChannels.length.toLocaleString()} results`;
  $("loadMoreButton").hidden = visibleCount >= filteredChannels.length;
}

function stopCurrentHls() {
  if (cancelPlaybackAttempt) {
    cancelPlaybackAttempt();
    cancelPlaybackAttempt = null;
  }
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch (_) {}
    hlsInstance = null;
  }
}

function resolveStreamUrl(channel) {
  try {
    const source = new URL(channel.url);
    if (source.protocol !== "http:" && source.protocol !== "https:") return "";
    return `${STREAM_PROXY_URL}?proxy_url=${encodeURIComponent(channel.url)}`;
  } catch (_) {
    return "";
  }
}

function requestPlayChannel(channel, selectedButton) {
  if (!shareUnlockedThisSession || channel.shareGate) {
    pendingGateChannel = { channel, selectedButton };
    openShareGate();
    return;
  }
  playChannel(channel, selectedButton);
}

function openShareGate() {
  gateWindowOpened = false;
  const isBreakGate = breakGatePending;
  $("shareGateTitle").textContent = isBreakGate ? "Quick break — share JokStream" : "Share JokStream to continue";
  $("shareGateStatus").textContent = "Open WhatsApp, then return here. The site cannot verify whether a message was sent.";
  $("shareGateModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function unlockShareGate() {
  if (!pendingGateChannel) return;
  const pending = pendingGateChannel;
  pendingGateChannel = null;
  shareUnlockedThisSession = true;
  breakGatePending = false;
  $("shareGateModal").hidden = true;
  document.body.style.overflow = "";
  if (gateReturnHandler) {
    window.removeEventListener("focus", gateReturnHandler);
    document.removeEventListener("visibilitychange", gateReturnHandler);
    gateReturnHandler = null;
  }
  requestAnimationFrame(() => playChannel(pending.channel, pending.selectedButton));
}

function setupShareGate() {
  $("shareGateButton").addEventListener("click", () => {
    if (!pendingGateChannel) return;
    const button = $("shareGateButton");
    if (gateWindowOpened && button.dataset.returned === "true") {
      unlockShareGate();
      button.dataset.returned = "false";
      button.textContent = "Open WhatsApp to share";
      return;
    }
    gateWindowOpened = true;
    const message = `Discover JokStream — live TV and entertainment in one place: ${getSiteUrl()}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    $("shareGateStatus").textContent = "If WhatsApp opened, return to this tab. A website cannot confirm message delivery.";
    gateReturnHandler = () => {
      if (!gateWindowOpened || document.visibilityState === "hidden") return;
      window.setTimeout(() => {
        if (pendingGateChannel) {
          button.textContent = "I returned — continue";
          button.dataset.returned = "true";
        }
      }, 350);
    };
    window.addEventListener("focus", gateReturnHandler);
    document.addEventListener("visibilitychange", gateReturnHandler);
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => {
      if (pendingGateChannel) {
        button.textContent = "I returned — continue";
        button.dataset.returned = "true";
      }
    }, 1300);
  });
}

function setPlayerMessage(message, visible = true) {
  $("playerMessage").textContent = message;
  $("playerMessage").classList.toggle("hidden", !visible);
}

function configureAdaptiveHls(videoElement, finalStreamUrl, channel, isBackup = false) {
  stopCurrentHls();
  let active = true;
  let handshakeTimer = null;
  let mediaRecoveryAttempted = false;
  const listeners = [];
  const clearHandshake = () => {
    window.clearTimeout(handshakeTimer);
    handshakeTimer = null;
  };
  cancelPlaybackAttempt = () => {
    active = false;
    clearHandshake();
    listeners.forEach(([event, handler]) => videoElement.removeEventListener(event, handler));
  };
  const resetMedia = () => {
    videoElement.style.visibility = "hidden";
    videoElement.pause();
    videoElement.removeAttribute("src");
    videoElement.load();
  };
  const failover = () => {
    if (!active) return;
    // Destroying HLS aborts its loaders; clearing src releases native media requests.
    stopCurrentHls();
    resetMedia();
    if (!isBackup) {
      $("playerStatus").textContent = "Switching to stable backup server...";
      setPlayerMessage("Switching to stable backup server...", true);
      // The Worker chooses the mirror server-side. Retry once using its exact route.
      configureAdaptiveHls(videoElement, resolveStreamUrl(channel), channel, true);
    } else {
      $("playerStatus").textContent = "Stream unavailable";
      setPlayerMessage("The backup server did not respond. Select the channel to try again.", true);
    }
  };
  const ready = () => {
    if (!active) return;
    clearHandshake();
    $("playerStatus").textContent = "Live stream ready · adaptive quality";
    videoElement.style.visibility = "visible";
    videoElement.play().then(() => {
      if (active) setPlayerMessage("", false);
    }).catch(() => {
      if (active) setPlayerMessage("Press play to start the stream.", true);
    });
  };
  const listen = (event, handler) => {
    listeners.push([event, handler]);
    videoElement.addEventListener(event, handler);
  };
  const HlsCtor = window.Hls;
  const isHls = /\.m3u8$/i.test(new URL(channel.url).pathname);
  handshakeTimer = window.setTimeout(failover, STREAM_HANDSHAKE_TIMEOUT_MS);
  if (!isHls || !HlsCtor || !HlsCtor.isSupported()) {
    listen("loadedmetadata", ready);
    listen("error", failover);
    videoElement.src = finalStreamUrl;
    videoElement.load();
    return;
  }
  let HlsWithP2P = HlsCtor;
  const P2P = window.p2pml && window.p2pml.hlsjs && window.p2pml.hlsjs.HlsJsP2PEngine;
  if (P2P && typeof P2P.injectMixin === "function") {
    try { HlsWithP2P = P2P.injectMixin(HlsCtor); } catch (_) { /* Use standard HLS. */ }
  }
  const hlsConfig = {
    enableWorker: true,
    lowLatencyMode: true,
    startLevel: -1,
    capLevelToPlayerSize: true,
    maxBufferLength: 18,
    maxMaxBufferLength: 36,
    maxBufferSize: 45 * 1000 * 1000,
    abrEwmaDefaultEstimate: 350000,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.65,
    testBandwidth: true,
    backBufferLength: 30,
    manifestLoadingTimeOut: STREAM_HANDSHAKE_TIMEOUT_MS,
    manifestLoadingMaxRetry: 0
  };
  if (HlsWithP2P !== HlsCtor) {
    hlsConfig.p2p = { core: { swarmId: `jokstream-${slugify(channel.name)}-${slugify(channel.group || "live")}` } };
  }
  try {
    const instance = new HlsWithP2P(hlsConfig);
    hlsInstance = instance;
    // Subscribe before loading so even immediate failures are handled.
    instance.on(HlsCtor.Events.MANIFEST_PARSED, ready);
    instance.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => {
      if (!active) return;
      const level = instance.levels[data.level];
      if (level && level.height) $("playerStatus").textContent = `Playing · ${level.height}p adaptive quality`;
    });
    instance.on(HlsCtor.Events.ERROR, (_event, data) => {
      if (!active) return;
      if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
        failover();
      } else if (data.fatal) {
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && !mediaRecoveryAttempted) {
          mediaRecoveryAttempted = true;
          instance.recoverMediaError();
        } else failover();
      }
    });
    instance.attachMedia(videoElement);
    instance.loadSource(finalStreamUrl);
  } catch (_) { failover(); }
}

function updateDynamicSeo(channel) {
  if (!channel) return;
  const name = safeText(channel.name, 100);
  document.title = `${name} — Live channel and community chat | JokStream`;
  const description = `Watch ${name} on JokStream and join the live channel chat. Stream availability depends on the source provider.`;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "description"; document.head.appendChild(meta); }
  meta.content = description.slice(0, 160);
  let schema = document.getElementById("jokstreamDynamicSchema");
  if (!schema) { schema = document.createElement("script"); schema.id = "jokstreamDynamicSchema"; schema.type = "application/ld+json"; document.head.appendChild(schema); }
  schema.textContent = JSON.stringify({"@context":"https://schema.org","@type":"BroadcastService","name":name,"broadcastDisplayName":name,"url":getSiteUrl(),"broadcastTimezone":"UTC","description":description});
}

function openPlayerOverlay(channel) {
  const overlay = $("playerOverlay");
  if (!overlay || overlayPlaceholders) return;
  const playerCard = document.querySelector(".player-card");
  const chatPanel = document.querySelector(".chat-panel");
  const bannerSlot = $("belowPlayerAdSlot");
  overlayPlaceholders = {
    player: document.createComment("player-card-home"),
    chat: document.createComment("chat-panel-home"),
    banner: document.createComment("banner-slot-home"),
    playerParent: playerCard.parentNode,
    chatParent: chatPanel.parentNode,
    bannerParent: bannerSlot.parentNode
  };
  playerCard.parentNode.insertBefore(overlayPlaceholders.player, playerCard);
  chatPanel.parentNode.insertBefore(overlayPlaceholders.chat, chatPanel);
  bannerSlot.parentNode.insertBefore(overlayPlaceholders.banner, bannerSlot);
  $("overlayPlayerSlot").appendChild(playerCard);
  $("overlayChatSlot").append(chatPanel, bannerSlot);
  $("overlayChannelTitle").textContent = safeText(channel && channel.name || "Now watching", 100);
  overlay.hidden = false;
  document.body.classList.add("overlay-open");
  document.body.style.overflow = "hidden";
}

function closePlayerOverlay() {
  const overlay = $("playerOverlay");
  if (!overlayPlaceholders || !overlay) return;
  const playerCard = document.querySelector("#overlayPlayerSlot .player-card");
  const chatPanel = document.querySelector("#overlayChatSlot .chat-panel");
  const bannerSlot = $("overlayChatSlot #belowPlayerAdSlot");
  if (playerCard) overlayPlaceholders.playerParent.insertBefore(playerCard, overlayPlaceholders.player.nextSibling);
  if (chatPanel) overlayPlaceholders.chatParent.insertBefore(chatPanel, overlayPlaceholders.chat.nextSibling);
  if (bannerSlot) overlayPlaceholders.bannerParent.insertBefore(bannerSlot, overlayPlaceholders.banner.nextSibling);
  Object.values(overlayPlaceholders).filter((v) => v && v.nodeType === 8).forEach((node) => node.remove());
  overlayPlaceholders = null;
  overlay.hidden = true;
  document.body.classList.remove("overlay-open");
  document.body.style.overflow = "";
}

function playChannel(channel, selectedButton) {
  currentChannel = channel;
  updateDynamicSeo(channel);
  openPlayerOverlay(channel);
  setChatRoom(channel);
  const videoElement = $("jokstreamPlayer");
  $("nowPlayingTitle").textContent = channel.name;
  setPlayerMessage("Loading stream…", true);
  $("playerStatus").textContent = "Connecting to stream…";
  document.querySelectorAll(".channel-item.active").forEach((item) => item.classList.remove("active"));
  if (selectedButton) selectedButton.classList.add("active");
  stopCurrentHls();
  videoElement.style.visibility = "hidden";
  videoElement.pause();
  videoElement.removeAttribute("src");
  videoElement.load();
  const finalStreamUrl = resolveStreamUrl(channel);
  if (!finalStreamUrl) {
    $("playerStatus").textContent = "Unsupported stream URL";
    setPlayerMessage("This channel URL could not be parsed.", true);
    return;
  }
  $("playerStatus").textContent = "Opening authorized stream through your HTTPS Worker…";
  configureAdaptiveHls(videoElement, finalStreamUrl, channel);
  watchStartedAt = watchStartedAt || Date.now();
}

function setupCinemaMode() {
  const button = $("cinemaModeButton");
  button.addEventListener("click", () => {
    const enabled = document.body.classList.toggle("cinema-mode");
    button.setAttribute("aria-pressed", String(enabled));
    button.textContent = enabled ? "Exit cinema" : "Cinema mode";
    toast(enabled ? "Cinema mode enabled. Chat is floating." : "Cinema mode closed.");
  });
}

function setupSmartBreakGate() {
  const video = $("jokstreamPlayer");
  // A generic player cannot reliably detect halftime or broadcaster ad breaks. Never
  // interrupt active playback: only offer the share gate after 45 minutes when playback pauses.
  video.addEventListener("pause", () => {
    if (!currentChannel || !shareUnlockedThisSession || !watchStartedAt) return;
    if (Date.now() - watchStartedAt < SHARE_GATE_INTERVAL_MS || pendingGateChannel) return;
    breakGatePending = true;
    pendingGateChannel = { channel: currentChannel, selectedButton: document.querySelector(".channel-item.active") };
    openShareGate();
  });
  video.addEventListener("playing", () => {
    if (watchStartedAt && Date.now() - watchStartedAt >= SHARE_GATE_INTERVAL_MS) {
      $("playerStatus").textContent = "Watching live · share reminder will wait for a pause";
    }
  });
}

function getSiteUrl() { return window.location.href.split("#")[0]; }

async function copySiteUrl() {
  const url = getSiteUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast("Website link copied.");
  } catch {
    const field = document.createElement("textarea");
    field.value = url;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    toast(copied ? "Website link copied." : "Copy failed. Please copy the address bar URL.", !copied);
  }
}

function openShareModal() { $("shareModal").hidden = false; document.body.style.overflow = "hidden"; }
function closeShareModal() { $("shareModal").hidden = true; document.body.style.overflow = ""; }

function setupShare() {
  const message = `Discover JokStream — live TV and entertainment in one place: ${getSiteUrl()}`;
  $("whatsappShareButton").href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  $("openShareModalButton").addEventListener("click", openShareModal);
  $("closeShareModalButton").addEventListener("click", closeShareModal);
  $("continueWatchingButton").addEventListener("click", closeShareModal);
  $("modalCopyLinkButton").addEventListener("click", copySiteUrl);
  $("copySiteLinkButton").addEventListener("click", copySiteUrl);
  $("shareModal").querySelector("[data-close-modal]").addEventListener("click", closeShareModal);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("shareModal").hidden) closeShareModal(); });
}

function setChatStatus(text, connected = false) {
  const status = $("chatConnectionStatus");
  status.textContent = text;
  status.classList.toggle("connected", connected);
}

function clearChatMessages(message) {
  const container = $("chatMessages");
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "chat-empty";
  empty.textContent = message;
  container.appendChild(empty);
}

function renderChatMessage(message) {
  const messages = $("chatMessages");
  const empty = messages.querySelector(".chat-empty");
  if (empty) empty.remove();
  // Avoid rendering the same realtime message twice when the sender receives its own broadcast.
  const messageId = message.id ? String(message.id) : "";
  if (messageId && messages.querySelector(`[data-message-id="${messageId}"]`)) return;
  const row = document.createElement("div");
  row.className = "chat-message";
  if (messageId) row.dataset.messageId = messageId;
  const head = document.createElement("div");
  head.className = "chat-message-head";
  const name = document.createElement("span");
  name.className = "chat-message-name";
  name.textContent = safeText(message.display_name || message.name || "Viewer", CHAT_CONFIG.maxNicknameLength);
  const time = document.createElement("span");
  time.className = "chat-message-time";
  const createdAt = message.created_at || message.createdAt;
  time.textContent = createdAt ? new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const text = document.createElement("div");
  text.className = "chat-message-text";
  text.textContent = safeText(message.message || message.text, CHAT_CONFIG.maxMessageLength);
  head.append(name, time);
  row.append(head, text);
  messages.appendChild(row);
  while (messages.children.length > CHAT_CONFIG.maxMessages) messages.firstElementChild.remove();
  messages.scrollTop = messages.scrollHeight;
}

async function setChatRoom(channel) {
  if (!channel) return;
  const nextKey = channel.chatRoom || slugify(channel.name);
  if (nextKey === chatRoomKey) return;
  chatRoomKey = nextKey;
  presenceRoomKey = nextKey;
  const viewerCounter = $("viewerCount");
  if (viewerCounter) viewerCounter.textContent = "👁️ Connecting viewers…";
  if (supabaseChatChannel && supabaseClient) {
    try { await supabaseClient.removeChannel(supabaseChatChannel); } catch (_) {}
    supabaseChatChannel = null;
  }
  $("chatRoomLabel").textContent = `Room: ${safeText(channel.name, 90)}`;
  clearChatMessages("Connecting to this channel's shared chat…");
  $("chatMessageInput").disabled = true;
  $("chatSendButton").disabled = true;
  setChatStatus("Connecting…", false);
  if (!supabaseClient) {
    clearChatMessages("Chat service could not start. Please refresh and try again.");
    setChatStatus("Unavailable", false);
    $("chatFeedback").textContent = "The shared chat service did not initialize.";
    return;
  }
  const roomAtStart = nextKey;
  const { data, error } = await supabaseClient.from("chat_messages")
    .select("id, channel_id, display_name, message, created_at")
    .eq("channel_id", roomAtStart).order("created_at", { ascending: false }).limit(CHAT_CONFIG.maxMessages);
  if (chatRoomKey !== roomAtStart) return;
  if (error) {
    clearChatMessages("Could not load shared messages. The chat database may need its access policies checked.");
    setChatStatus("Connection error", false);
    $("chatFeedback").textContent = "Could not load chat history. Please try again later.";
    console.error("JokStream chat history error:", error.message);
    return;
  }
  clearChatMessages("No messages yet. Start the conversation!");
  (data || []).reverse().forEach(renderChatMessage);
  supabaseChatChannel = supabaseClient.channel(`jokstream-chat-${roomAtStart}`, { config: { presence: { key: presenceViewerId } } })
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "chat_messages", filter: `channel_id=eq.${roomAtStart}`
    }, (payload) => {
      if (chatRoomKey === roomAtStart) renderChatMessage(payload.new);
    })
    .on("presence", { event: "sync" }, () => {
      if (chatRoomKey !== roomAtStart || !supabaseChatChannel) return;
      const state = supabaseChatChannel.presenceState();
      const count = Object.keys(state || {}).length;
      const counter = $("viewerCount");
      if (counter) counter.textContent = `👁️ ${count.toLocaleString()} watching now`;
    })
    .subscribe(async (status) => {
      if (chatRoomKey !== roomAtStart) return;
      if (status === "SUBSCRIBED") {
        try { await supabaseChatChannel.track({ viewer_id: presenceViewerId, channel_id: roomAtStart, joined_at: new Date().toISOString() }); }
        catch (error) { console.warn("Presence tracking unavailable:", error); }
        setChatStatus("Live chat", true);
        $("chatMessageInput").disabled = false;
        $("chatSendButton").disabled = false;
        $("chatFeedback").textContent = "You are in the shared room for this channel. Messages are visible to other visitors in the same room.";
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setChatStatus("Reconnecting…", false);
        $("chatFeedback").textContent = "Live connection interrupted. The chat will attempt to reconnect.";
      }
    });
}

function initializeChat() {
  $("chatForm").addEventListener("submit", sendChatMessage);
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setChatStatus("Unavailable", false);
    $("chatFeedback").textContent = "Could not load the chat service library. Check your connection and refresh.";
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    realtime: { params: { eventsPerSecond: 5 } }
  });
  setChatStatus("Ready", false);
  if (currentChannel) setChatRoom(currentChannel);
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (!chatRoomKey || !supabaseClient) {
    $("chatFeedback").textContent = "Choose a channel and wait for the shared chat to connect.";
    return;
  }
  const nickname = safeText($("chatNickname").value || "Viewer", CHAT_CONFIG.maxNicknameLength) || "Viewer";
  const messageText = safeText($("chatMessageInput").value, CHAT_CONFIG.maxMessageLength);
  if (!messageText) return;
  const now = Date.now();
  if (now - lastChatSend < CHAT_CONFIG.minSendIntervalMs) {
    $("chatFeedback").textContent = "Please wait a moment before sending another message.";
    return;
  }
  lastChatSend = now;
  $("chatSendButton").disabled = true;
  const roomAtSend = chatRoomKey;
  const { error } = await supabaseClient.from("chat_messages").insert({
    channel_id: roomAtSend,
    display_name: nickname,
    message: messageText
  });
  if (error) {
    $("chatFeedback").textContent = "Message not sent. Check your connection and try again.";
    console.error("JokStream chat send error:", error.message);
  } else {
    $("chatMessageInput").value = "";
    $("chatFeedback").textContent = "Message sent to this channel's shared chat.";
  }
  if (chatRoomKey === roomAtSend && $("chatConnectionStatus").textContent.includes("Live")) $("chatSendButton").disabled = false;
}

function loadMonetagTag(zoneId, src, parent, key) {
  if (document.querySelector(`script[data-jokstream-ad="${key}"]`)) return;
  const script = document.createElement("script");
  script.dataset.jokstreamAd = key;
  script.dataset.zone = String(zoneId);
  script.src = src;
  script.async = true;
  (parent || document.body).appendChild(script);
}

function initializeMonetagAds() {
  // These are the exact owner-supplied zone IDs and script URLs. Monetag controls final delivery and eligibility.
  loadMonetagTag("12117072", "https://n6wxm.com/vignette.min.js", document.body, "vignette");
  loadMonetagTag("12117045", "https://nap5k.com/tag.min.js", $("monetagInlineBannerSlot") || document.body, "banner-inline");
  try {
    const last = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || 0);
    if (Date.now() - last >= POPUNDER_INTERVAL_MS) {
      localStorage.setItem(POPUNDER_STORAGE_KEY, String(Date.now()));
      loadMonetagTag("12117037", "https://al5sm.com/tag.min.js", document.body, "popunder-30m");
    }
  } catch (_) {
    // If storage is unavailable, load at most once in this document lifetime.
    loadMonetagTag("12117037", "https://al5sm.com/tag.min.js", document.body, "popunder-session");
  }
}

function setupInstallButton() {
  const installButton = $("installButton");
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installButton.hidden = true; toast("JokStream has been installed."); });
}

function registerServiceWorker() {
  // Monetag requires its downloaded /sw.js file at the site root.
  // Do not register pwa-sw.js at the same root scope: a second worker would replace Monetag's worker.
  // pwa-sw.js is retained in the package as an optional offline-cache implementation for a future
  // deployment where the ad provider's worker and app worker can be safely coordinated.
  console.info("Monetag worker is served from /sw.js; app shell worker registration is intentionally disabled to avoid a scope conflict.");
}

document.addEventListener("DOMContentLoaded", () => {
  $("year").textContent = new Date().getFullYear();
  $("channelSearch").addEventListener("input", applyChannelFilters);
  $("categoryFilter").addEventListener("change", () => {
    $("categoryFilter").dataset.smartCategory = "";
    const host = $("categoryQuickFilters");
    if (host) host.querySelectorAll(".category-chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.category === $("categoryFilter").value));
    });
    applyChannelFilters();
  });
  $("loadMoreButton").addEventListener("click", () => { visibleCount += CHANNELS_PER_PAGE; renderChannels(); });
  setupShare();
  setupShareGate();
  initializeMonetagAds();
  $("closePlayerOverlay").addEventListener("click", closePlayerOverlay);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("playerOverlay").hidden) closePlayerOverlay(); });
  setupCinemaMode();
  setupSmartBreakGate();
  setupInstallButton();
  registerServiceWorker();
  loadChannels();
  initializeChat();
});
