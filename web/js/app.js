import { api } from "./api.js";
import { input } from "./input.js";
import { nav } from "./nav.js";
import { sound } from "./sound.js";
import { OnScreenKeyboard } from "./osk.js";
import { BootScene } from "./boot.js";

// ======================================================================== state
const state = {
  games: [],
  settings: {},
  user: "player",
  hostname: "",
  demo: false,
  version: "",
  view: "home",
  running: new Map(),       // id -> { title, started }
  railGames: [],
  railIndex: 0,
  libs: {
    library: { filter: "all", sort: "az", query: "" },
    apps: { filter: "all", sort: "az", query: "" },
  },
  booted: false,
  launching: false,
};

// The Games and Apps tabs share one list view; each keeps its own filters.
Object.defineProperty(state, "lib", { get: () => state.libs[state.view === "apps" ? "apps" : "library"] });
const isListView = () => state.view === "library" || state.view === "apps";
const listKind = () => (state.view === "apps" ? "app" : "game");
const viewEl = (name) => document.getElementById(name === "apps" ? "view-library" : `view-${name}`);
const isApp = (g) => g?.kind === "app";
const playLabel = (g) => (isApp(g) ? "Open" : "Play");

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const appEl = $("#app");
const SOURCES = { steam: "Steam", epic: "Epic Games", heroic: "Heroic", lutris: "Lutris", mod: "Mods", desktop: "Desktop", custom: "Custom", launcher: "Launchers", app: "App" };
const APP_CATEGORY_ORDER = ["Games", "Internet", "Media", "Graphics", "Office", "Development", "Utilities", "System", "Other"];
const SORTS = [
  { id: "az", label: "A–Z" },
  { id: "recent", label: "Recently played" },
  { id: "playtime", label: "Most played" },
];
const ACCENTS = ["#00d4ff", "#7c5cff", "#ff3ea5", "#ff4d4d", "#ff9f1c", "#ffd23f", "#3ee08f", "#14e0c4", "#e8ecf4"];

// ======================================================================== helpers
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function initials(title) {
  const words = title.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}

function formatPlaytime(seconds) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${Math.max(m, 1)}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatAgo(ts) {
  if (!ts) return "Never";
  const then = new Date(ts * 1000);
  const days = Math.floor((startOfDay(new Date()) - startOfDay(then)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: then.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function formatSize(bytes) {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [null, "00d4ff"];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shiftHue(hex, deg) {
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `hsl(${(h + deg + 360) % 360} ${Math.round(Math.max(s, 0.5) * 100)}% ${Math.round(Math.min(l, 0.62) * 100)}%)`;
}

// Try image URLs in order; resolves to the first that loads (cached).
const imageCache = new Map();
function firstImage(urls) {
  const list = (urls || []).filter(Boolean);
  const key = list.join("|");
  if (!list.length) return Promise.resolve(null);
  if (!imageCache.has(key)) {
    imageCache.set(key, new Promise((resolve) => {
      const tryAt = (i) => {
        if (i >= list.length) return resolve(null);
        const img = new Image();
        img.onload = () => resolve(list[i]);
        img.onerror = () => tryAt(i + 1);
        img.src = list[i];
      };
      tryAt(0);
    }));
  }
  return imageCache.get(key);
}

// Builds cover art with a generated fallback, cover image, then icon.
function artHtml(game) {
  const h = hash(game.title);
  return `<div class="tile-art" style="--h1:${h % 360};--h2:${(h + 50) % 360}">
    <div class="fallback"><span class="fb-initials">${escapeHtml(initials(game.title))}</span>${escapeHtml(game.title)}</div>
  </div>`;
}

function appArtHtml(app) {
  const h = hash(app.title);
  return `<div class="tile-art app-art" style="--h1:${h % 360};--h2:${(h + 50) % 360}">
    <div class="fallback app-fallback"><span class="fb-initials">${escapeHtml(initials(app.title))}</span></div>
  </div>`;
}

function hydrateArt(container, game) {
  const art = container.querySelector(".tile-art");
  if (!art || art.dataset.hydrated) return;
  art.dataset.hydrated = "1";
  const place = (url, cls) => {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    if (cls) img.className = cls;
    img.onload = () => img.classList.add("loaded");
    img.src = url;
    art.appendChild(img);
  };
  firstImage(game.art.cover).then((url) => {
    if (url) return place(url);
    return firstImage(game.art.icon).then((iconUrl) => iconUrl && place(iconUrl, "icon-art"));
  });
}

// Lazily hydrate art as cards scroll into view.
const artObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const game = gameById(e.target.dataset.id);
    if (game) hydrateArt(e.target, game);
    artObserver.unobserve(e.target);
  }
}, { rootMargin: "400px" });

const gameById = (id) => state.games.find((g) => g.id === id);
const visibleAll = () => state.games.filter((g) => state.settings.showHidden || !g.hidden);
const visibleGames = () => visibleAll().filter((g) => !isApp(g));
const visibleApps = () => visibleAll().filter(isApp);

// ======================================================================== glyphs & hints
const GLYPHS = {
  keyboard: { accept: "Enter", back: "Esc", x: "X", y: "F", lb: "Q", rb: "E", lt: "PgUp", rt: "PgDn", start: "M", select: "/", guide: "Home" },
  xbox: { accept: ["A", "xa"], back: ["B", "xb"], x: ["X", "xx"], y: ["Y", "xy"], lb: "LB", rb: "RB", lt: "LT", rt: "RT", start: "☰", select: "⧉", guide: "⊗" },
  playstation: { accept: ["✕", "ps ps-cross"], back: ["○", "ps ps-circle"], x: ["□", "ps ps-square"], y: ["△", "ps ps-triangle"], lb: "L1", rb: "R1", lt: "L2", rt: "R2", start: "OPT", select: "⧉", guide: "PS" },
  nintendo: { accept: ["B", ""], back: ["A", ""], x: ["Y", ""], y: ["X", ""], lb: "L", rb: "R", lt: "ZL", rt: "ZR", start: "+", select: "−", guide: "⌂" },
};

function glyph(action) {
  const set = input.device === "keyboard" ? GLYPHS.keyboard : GLYPHS[input.family] || GLYPHS.xbox;
  const g = set[action];
  if (input.device === "keyboard") return `<span class="glyph key">${escapeHtml(g)}</span>`;
  if (Array.isArray(g)) return `<span class="glyph ${g[1]}">${escapeHtml(g[0])}</span>`;
  return `<span class="glyph pill">${escapeHtml(g)}</span>`;
}

function refreshGlyphs() {
  $$("[data-glyph]").forEach((el) => (el.innerHTML = glyph(el.dataset.glyph)));
  updateHints();
  if (osk.isOpen) osk.render();
}

function currentHints() {
  const top = layers.at(-1);
  const el = nav.current;
  if (top?.name === "details") return [["accept", "Select"], ["y", "Favorite"], ["lb", "Prev"], ["rb", "Next"], ["back", "Back"]];
  if (top) return [["accept", "Select"], ["back", top.name === "power" ? "Close" : "Cancel"]];
  const hints = [];
  const game = el?.dataset?.id && gameById(el.dataset.id);
  if (game) {
    hints.push(["accept", state.running.has(game.id) ? "Running" : playLabel(game)], ["x", "Details"], ["y", game.favorite ? "Unfavorite" : "Favorite"]);
  } else if (el?.querySelector?.("input")) {
    hints.push(["accept", "Type"]);
  } else if (el?.hasAttribute?.("data-adjust")) {
    hints.push(["accept", "Change"]);
  } else {
    hints.push(["accept", "Select"]);
  }
  if (state.view !== "home") hints.push(["back", "Home"]);
  if (isListView()) hints.push(["select", "Search"], ["lt", "Page"]);
  hints.push(["start", "Menu"]);
  return hints;
}

function updateHints() {
  $("#hints").innerHTML = currentHints()
    .map(([action, label]) => `<span class="hint" data-action="${action}">${glyph(action)}<span>${escapeHtml(label)}</span></span>`)
    .join("");
}
$("#hints").addEventListener("click", (e) => {
  const hint = e.target.closest("[data-action]");
  if (hint) handleAction(hint.dataset.action, { device: "mouse" });
});

// ======================================================================== toasts
function toast(title, sub = "", { kind = "info", iconName = "info", time = 3600 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="ti">${icon(iconName)}</span><div><div class="tt">${escapeHtml(title)}</div>${sub ? `<div class="ts">${escapeHtml(sub)}</div>` : ""}</div>`;
  $("#toasts").appendChild(el);
  sound.play(kind === "error" ? "error" : "notify");
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, time);
}

// ======================================================================== background
let bgFront = $("#bg-a"), bgBack = $("#bg-b"), bgUrl = null, bgTimer = 0;
// Artwork for a full-screen background: the game's hero/cover art, or for
// programs (and games without art) a glow built from their icon.
async function backdrop(game) {
  if (!game) return { url: null, icon: false };
  const art = await firstImage(game.art.hero.length ? game.art.hero : game.art.cover);
  if (art) return { url: art, icon: false };
  const iconUrl = await firstImage(game.art.icon);
  return { url: iconUrl, icon: !!iconUrl };
}

function paintBackdrop(el, { url, icon }) {
  el.classList.toggle("icon-bg", icon);
  el.style.setProperty("--icon", icon ? `url("${url}")` : "none");
  el.style.backgroundImage = url && !icon ? `url("${url}")` : "";
}

function setBackground(game, delay = 160) {
  clearTimeout(bgTimer);
  bgTimer = setTimeout(async () => {
    const bd = await backdrop(game);
    const url = bd.url;
    if (url === bgUrl) return;
    bgUrl = url;
    if (!url) {
      bgFront.classList.remove("show");
      return;
    }
    paintBackdrop(bgBack, bd);
    bgBack.classList.add("show");
    bgFront.classList.remove("show");
    [bgFront, bgBack] = [bgBack, bgFront];
  }, delay);
}

// ======================================================================== theming
function applySettings() {
  const s = state.settings;
  const root = document.documentElement.style;
  root.setProperty("--accent", s.accent);
  root.setProperty("--accent-rgb", hexToRgb(s.accent).join(", "));
  root.setProperty("--accent-2", shiftHue(s.accent, s.accent.toLowerCase() === "#e8ecf4" ? 220 : 55));
  document.body.dataset.bg = s.background;
  sound.enabled = !!s.sounds;
  sound.volume = Number(s.volume);
  updateClock();
  bootScene.colors();
}

let settingsSaveTimer = 0;
const pendingSettings = {};
function saveSetting(key, value, { render = true } = {}) {
  state.settings[key] = value;
  pendingSettings[key] = value;
  applySettings();
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    const patch = { ...pendingSettings };
    Object.keys(pendingSettings).forEach((k) => delete pendingSettings[k]);
    try {
      const res = await api.settings(patch);
      if (patch.sources) await reloadState();
      state.settings = res.settings;
    } catch (err) {
      toast("Could not save settings", err.message, { kind: "error" });
    }
  }, 350);
  if (render) {
    if (["showHidden"].includes(key)) { renderHome(); renderLibrary(); }
    if (state.view === "settings") renderSettings();
  }
}

// ======================================================================== clock & status
function updateClock() {
  const now = new Date();
  $("#clock-time").textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: !state.settings.clock24 });
  $("#clock-date").textContent = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
setInterval(updateClock, 5000);

async function pollStatus() {
  try {
    const st = await api.status();
    const before = new Map(state.running);
    state.running = new Map(st.running.map((r) => [r.id, r]));

    const np = $("#now-playing");
    if (st.running.length) {
      np.hidden = false;
      np.querySelector(".np-text").textContent = st.running.map((r) => r.title).join(", ");
    } else {
      np.hidden = true;
    }

    const net = $("#net-status");
    net.innerHTML = icon(st.network.type === "wired" ? "ethernet" : st.network.online ? "wifi" : "offline");
    net.title = st.network.online ? `Online (${st.network.type})` : "Offline";
    net.style.color = st.network.online ? "" : "var(--danger)";

    const bat = $("#battery");
    if (st.battery) {
      bat.hidden = false;
      bat.querySelector(".battery-fill").style.width = `${st.battery.level}%`;
      bat.querySelector(".battery-text").textContent = `${st.battery.level}%`;
      bat.classList.toggle("low", st.battery.level <= 15 && !st.battery.charging);
      bat.classList.toggle("charging", st.battery.charging);
    } else {
      bat.hidden = true;
    }

    const changed = before.size !== state.running.size || [...before.keys()].some((id) => !state.running.has(id));
    if (changed) {
      for (const [id, info] of before) {
        if (!state.running.has(id)) {
          const seconds = Date.now() / 1000 - info.started;
          if (seconds < 10) continue; // handed off to an already-open window
          toast("Session ended", `${info.title} · ${Math.max(1, Math.round(seconds / 60))} min`, { iconName: "clock" });
        }
      }
      await reloadState({ keepFocus: true });
    }
  } catch {
    /* server busy or restarting; try again next tick */
  }
}

// ======================================================================== layers (overlays)
const layers = [];
function openLayer(el, name, { onClose } = {}) {
  layers.push({ el, name, onClose, scope: nav.scope, focus: nav.current });
  el.classList.add("open");
  document.body.classList.add("overlay-open");
  nav.setScope(el, { restore: false });
  updateHints();
}

function closeLayer({ silent = false } = {}) {
  const layer = layers.pop();
  if (!layer) return;
  layer.el.classList.remove("open");
  if (!layers.length) document.body.classList.remove("overlay-open");
  nav.scope = layer.scope;
  let focus = layer.focus;
  if (focus && !focus.isConnected && focus.dataset.id) {
    // The element was re-rendered while the overlay was open; find its replacement.
    focus = layer.scope.querySelector(`[data-nav][data-id="${CSS.escape(focus.dataset.id)}"]`);
  }
  if (focus && layer.scope.contains(focus)) nav.focus(focus, { silent: true });
  else nav.ensure();
  if (!silent) sound.play("back");
  layer.onClose?.();
  updateHints();
}
const topLayer = () => layers.at(-1);

// ======================================================================== confirm dialog
function confirmDialog(title, text, yesLabel = "Confirm") {
  return new Promise((resolve) => {
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-yes").textContent = yesLabel;
    let result = false;
    const yes = () => { result = true; closeLayer({ silent: true }); };
    const no = () => closeLayer();
    $("#confirm-yes").onclick = yes;
    $("#confirm-no").onclick = no;
    openLayer($("#confirm"), "confirm", { onClose: () => resolve(result) });
    sound.play("open");
  });
}

// ======================================================================== on-screen keyboard
const osk = new OnScreenKeyboard({ nav, sound, glyph });

function editField(el) {
  const field = el.matches("input") ? el : el.querySelector("input");
  if (!field) return false;
  if (input.device === "gamepad") {
    osk.open(field, { onClose: () => field.dispatchEvent(new Event("change", { bubbles: true })) });
  } else {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
  return true;
}

// ======================================================================== views
function showView(name, { focus = true } = {}) {
  if (state.view !== name && nav.current && viewEl(state.view).contains(nav.current)) {
    viewFocus[state.view] = nav.current;
  }
  const changed = state.view !== name;
  state.view = name;
  $$(".view").forEach((v) => (v.hidden = v !== viewEl(name)));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.body.classList.remove("view-home", "view-library", "view-apps", "view-settings");
  document.body.classList.add(`view-${name}`);
  if (isListView()) {
    $("#search").value = state.lib.query;
    $("#search").placeholder = name === "apps" ? "Search apps" : "Search games";
    $("#search").setAttribute("aria-label", $("#search").placeholder);
    if (changed) $("#grid").innerHTML = "";
    renderLibrary();
  }
  if (name === "settings") renderSettings();
  if (name === "home") updateRail(false);
  if (focus) {
    const remembered = viewFocus[name];
    if (remembered && remembered.isConnected) nav.focus(remembered, { silent: true });
    else if (name === "home") focusRail(state.railIndex);
    else if (isListView()) nav.focus($("#grid [data-nav]") || $("#search-box"), { silent: true });
    else nav.focus(nav.candidates(viewEl(name))[0] || null, { silent: true });
  }
  if (changed) sound.play("tab");
  updateHints();
}
const viewFocus = {};
const VIEW_ORDER = ["home", "library", "apps", "settings"];

$$(".tab").forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.tab)));

// ---------------------------------------------------------------- home
function homeOrder() {
  return [...visibleGames()].sort((a, b) =>
    (state.running.has(b.id) - state.running.has(a.id)) ||
    ((a.source === "launcher") - (b.source === "launcher")) || // launchers after the games
    (b.lastPlayed - a.lastPlayed) ||
    (b.favorite - a.favorite) ||
    a.title.localeCompare(b.title));
}

function renderHome({ keepId } = {}) {
  const rail = $("#rail");
  const focusedId = keepId ?? (rail.contains(nav.current) ? nav.current.dataset.id : state.railGames[state.railIndex]?.id);
  const games = homeOrder().slice(0, 18);
  state.railGames = games;

  const tiles = games.map((g) => `
    <div class="tile" data-nav data-id="${escapeHtml(g.id)}">
      ${artHtml(g)}
      ${g.favorite ? `<span class="fav-badge">${icon("star")}</span>` : ""}
      ${state.running.has(g.id) ? `<span class="run-badge">RUNNING</span>` : ""}
      <div class="tile-label">${escapeHtml(g.title)}</div>
    </div>`);
  if (games.length) {
    tiles.push(`<div class="tile special" data-nav data-special="library">
      <div class="tile-art">${icon("grid")}<span class="special-text">All games · ${visibleGames().length}</span></div>
      <div class="tile-label">Game Library</div></div>`);
  }
  tiles.push(`<div class="tile special" data-nav data-special="add">
    <div class="tile-art">${icon("plus")}<span class="special-text">Add game</span></div>
    <div class="tile-label">Add a game</div></div>`);
  if (!games.length) {
    tiles.push(`<div class="tile special" data-nav data-special="rescan">
      <div class="tile-art">${icon("refresh")}<span class="special-text">Rescan</span></div>
      <div class="tile-label">Rescan library</div></div>`);
  }
  rail.innerHTML = tiles.join("");
  $$(".tile[data-id]", rail).forEach((el) => hydrateArt(el, gameById(el.dataset.id)));

  let index = games.findIndex((g) => g.id === focusedId);
  if (index < 0) index = Math.min(state.railIndex, rail.children.length - 1);
  state.railIndex = Math.max(0, index);
  const wasInRail = nav.current && !nav.current.isConnected && state.view === "home" && !layers.length;
  updateRail(false);
  if (wasInRail || (state.view === "home" && !layers.length && !nav.current)) focusRail(state.railIndex);
}

function focusRail(index) {
  const tiles = $("#rail").children;
  const tile = tiles[Math.max(0, Math.min(index, tiles.length - 1))];
  if (tile) nav.focus(tile, { silent: true });
}

function updateRail(animate = true) {
  const rail = $("#rail");
  const tiles = [...rail.children];
  const i = state.railIndex;
  tiles.forEach((t, j) => {
    const d = j - i;
    t.classList.toggle("current", d === 0);
    t.style.setProperty("--s", d === 0 ? 1.28 : 1);
    t.style.setProperty("--arc-y", d > 0 ? `${Math.min(d * d * 0.22 + d * 0.4, 3.6)}rem` : d < 0 ? "1rem" : "0rem");
    t.style.setProperty("--arc-r", d > 0 ? `${Math.min(d * 1.6, 9)}deg` : "0deg");
    t.style.setProperty("--o", d < -1 ? 0 : d === -1 ? 0.35 : d > 7 ? 0 : 1);
  });
  const current = tiles[i];
  if (current) {
    const keep = (tiles[0].offsetWidth + 16) * (i > 0 ? 1 : 0);
    rail.style.transition = animate ? "" : "none";
    rail.style.transform = `translateX(${-(current.offsetLeft - keep)}px)`;
    if (!animate) requestAnimationFrame(() => (rail.style.transition = ""));
  }
  updateSpotlight();
}

function updateSpotlight() {
  const tile = $("#rail").children[state.railIndex];
  const game = tile?.dataset.id ? gameById(tile.dataset.id) : null;
  const logo = $("#spot-logo"), meta = $("#spot-meta"), cards = $("#spot-cards");
  const play = $("#spot-play"), fav = $("#spot-fav"), info = $("#spot-info");

  if (!game) {
    const special = tile?.dataset.special;
    const empty = !state.games.length;
    logo.innerHTML = `<div class="spot-title">${empty ? "Welcome to GameHub" : special === "library" ? "Game Library" : special === "rescan" ? "Rescan library" : "Add a game"}</div>`;
    meta.innerHTML = empty
      ? `<p class="empty-hero">No games were found yet. GameHub looks for Steam, Heroic (Epic &amp; GOG), Lutris and desktop games automatically — or add any game by its launch command.</p>`
      : special === "library"
        ? `<span class="meta-item">${visibleGames().length} games · ${visibleGames().filter((g) => g.favorite).length} favorites</span>`
        : `<span class="meta-item">Add emulators, itch.io games, scripts or anything with a launch command.</span>`;
    play.hidden = fav.hidden = info.hidden = true;
    cards.innerHTML = "";
    setBackground(null);
    return;
  }

  play.hidden = fav.hidden = info.hidden = false;
  const running = state.running.has(game.id);
  play.classList.toggle("running", running);
  play.querySelector("span").textContent = running ? "Running" : playLabel(game);
  fav.classList.toggle("on", game.favorite);
  fav.innerHTML = icon(game.favorite ? "star" : "star-o");

  logo.innerHTML = `<div class="spot-title">${escapeHtml(game.title)}</div>`;
  const token = (logo.dataset.token = game.id);
  firstImage(game.art.logo).then((url) => {
    if (url && logo.dataset.token === token) logo.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(game.title)}">`;
  });
  meta.innerHTML = `
    <span class="source-chip src-${game.source}">${isApp(game) ? escapeHtml(game.category || "App") : SOURCES[game.source] || game.source}</span>
    ${isApp(game) && game.description ? `<span class="meta-item">${escapeHtml(game.description)}</span>` : ""}
    ${game.favorite ? `<span class="meta-item">${icon("star")} Favorite</span>` : ""}
    ${running ? `<span class="meta-item" style="color:var(--good)">● Running now</span>` : ""}`;
  cards.innerHTML = `
    <div class="info-card"><div class="k">${isApp(game) ? "Last opened" : "Last played"}</div><div class="v">${formatAgo(game.lastPlayed)}</div></div>
    <div class="info-card"><div class="k">${isApp(game) ? "Time used" : "Play time"}</div><div class="v">${formatPlaytime(game.playtime)}</div></div>
    <div class="info-card"><div class="k">Launches</div><div class="v">${game.launches || 0}</div></div>`;
  setBackground(game);
}

$("#rail").addEventListener("navfocus", (e) => {
  const tiles = [...$("#rail").children];
  const i = tiles.indexOf(e.target);
  if (i >= 0 && i !== state.railIndex) {
    state.railIndex = i;
    updateRail();
  }
});
$("#rail").addEventListener("click", (e) => {
  const tile = e.target.closest(".tile");
  if (!tile) return;
  if (nav.current !== tile) { nav.focus(tile); sound.play("move"); return; }
  activateTile(tile);
});
$(".rail-wrap").addEventListener("wheel", (e) => {
  e.preventDefault();
  if (Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
  const now = performance.now();
  if (now - (state.lastWheel || 0) < 90) return;
  state.lastWheel = now;
  focusRail(state.railIndex + ((e.deltaY || e.deltaX) > 0 ? 1 : -1));
  sound.play("move");
}, { passive: false });

function activateTile(tile) {
  const special = tile.dataset.special;
  if (special === "library") return showView("library");
  if (special === "add") return openAddGame();
  if (special === "rescan") return rescan();
  const game = gameById(tile.dataset.id);
  if (game) launchGame(game);
}

function currentRailGame() {
  const id = $("#rail").children[state.railIndex]?.dataset.id;
  return id ? gameById(id) : null;
}
$("#spot-play").addEventListener("click", () => { const g = currentRailGame(); if (g) launchGame(g); });
$("#spot-fav").addEventListener("click", () => { const g = currentRailGame(); if (g) toggleFavorite(g); });
$("#spot-info").addEventListener("click", () => { const g = currentRailGame(); if (g) openDetails(g, state.railGames); });

// ---------------------------------------------------------------- library
function libraryList() {
  const { filter, sort, query } = state.lib;
  const kind = listKind();
  let list = state.games.filter((g) => {
    if ((g.kind || "game") !== kind) return false;
    if (filter === "hidden") return g.hidden;
    if (!state.settings.showHidden && g.hidden) return false;
    if (filter === "favorites") return g.favorite;
    if (filter === "recent") return g.lastPlayed > 0;
    if (filter.startsWith("cat:")) return g.category === filter.slice(4);
    if (filter in SOURCES) return g.source === filter;
    return true;
  });
  if (query) {
    const q = query.toLowerCase().normalize("NFKD");
    list = list.filter((g) => g.title.toLowerCase().normalize("NFKD").includes(q));
  }
  const by = {
    az: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
    recent: (a, b) => b.lastPlayed - a.lastPlayed || a.title.localeCompare(b.title),
    playtime: (a, b) => b.playtime - a.playtime || b.launches - a.launches || a.title.localeCompare(b.title),
  }[filter === "recent" && sort === "az" ? "recent" : sort];
  return list.sort(by);
}

function renderChips() {
  const apps = listKind() === "app";
  const all = apps ? visibleApps() : visibleGames();
  const chips = [
    ["all", "All", all.length],
    ["favorites", "Favorites", all.filter((g) => g.favorite).length],
    ["recent", apps ? "Recently used" : "Recently played", all.filter((g) => g.lastPlayed).length],
    ...(apps
      ? APP_CATEGORY_ORDER.map((c) => [`cat:${c}`, c, all.filter((g) => g.category === c).length])
      : Object.entries(SOURCES).filter(([id]) => id !== "app").map(([id, label]) => [id, label, all.filter((g) => g.source === id).length])
    ).filter(([, , n]) => n > 0),
  ];
  const hidden = state.games.filter((g) => g.hidden && (g.kind || "game") === listKind()).length;
  if (hidden) chips.push(["hidden", "Hidden", hidden]);
  if (!chips.some(([id]) => id === state.lib.filter)) state.lib.filter = "all";
  const focusedFilter = nav.current?.dataset?.filter;
  $("#chips").innerHTML = chips.map(([id, label, n]) =>
    `<button class="chip ${state.lib.filter === id ? "active" : ""}" data-nav data-filter="${id}">${label}<span class="n">${n}</span></button>`).join("");
  if (focusedFilter) nav.focus($(`#chips [data-filter="${focusedFilter}"]`), { silent: true, scroll: false });
}

function renderLibrary() {
  renderChips();
  const list = libraryList();
  const grid = $("#grid");
  const focusedId = grid.contains(nav.current) ? nav.current.dataset.id : null;
  const apps = listKind() === "app";
  const noun = apps ? "app" : "game";
  $("#lib-heading").textContent = apps ? "Apps" : "Games";
  $("#lib-count").textContent = `${list.length} ${noun}${list.length === 1 ? "" : "s"}`;
  $("#lib-add").hidden = apps;
  $("#sort-label").textContent = SORTS.find((s) => s.id === state.lib.sort).label;

  if (!list.length) {
    const searching = !!state.lib.query;
    const any = (apps ? visibleApps() : visibleGames()).length;
    grid.innerHTML = `<div class="empty">${icon(searching ? "search" : apps ? "apps" : "gamepad")}
      <h2>${searching ? "No matches" : any ? "Nothing here yet" : apps ? "No apps found" : "Your library is empty"}</h2>
      <div>${searching ? `Nothing matches “${escapeHtml(state.lib.query)}”.` : any ? "Try another filter." : apps ? "Turn on “Scan apps” in Settings, then rescan." : "Install games in Steam, Heroic or Lutris, or add one manually."}</div>
      <div class="row">
        ${searching ? `<button class="btn btn-ghost" data-nav data-do="clear-search">Clear search</button>` : ""}
        <button class="btn btn-ghost" data-nav data-do="add">${icon("plus")}<span>Add game</span></button>
        <button class="btn btn-ghost" data-nav data-do="rescan">${icon("refresh")}<span>Rescan</span></button>
      </div></div>`;
  } else {
    grid.classList.toggle("apps", apps);
    grid.innerHTML = list.map((g) => `
      <div class="card ${apps ? "app-card" : ""} ${g.hidden ? "is-hidden" : ""}" data-nav data-id="${escapeHtml(g.id)}">
        ${apps ? appArtHtml(g) : artHtml(g)}
        ${g.favorite ? `<span class="fav-badge">${icon("star")}</span>` : ""}
        ${state.running.has(g.id) ? `<span class="run-badge">RUNNING</span>` : ""}
        <div class="card-title" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</div>
        <div class="card-sub">${apps ? escapeHtml(g.category || "App") : SOURCES[g.source]}${g.playtime ? ` · ${formatPlaytime(g.playtime)}` : ""}</div>
      </div>`).join("");
    $$(".card", grid).forEach((c) => artObserver.observe(c));
  }
  state.libList = list;
  if (focusedId) {
    const again = grid.querySelector(`[data-id="${CSS.escape(focusedId)}"]`);
    if (again) nav.focus(again, { silent: true, scroll: false });
  }
  if (nav.current && !nav.current.isConnected && isListView() && !layers.length) {
    nav.focus($("#grid [data-nav]") || $("#search-box"), { silent: true });
  }
}

$("#chips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-filter]");
  if (!chip) return;
  state.lib.filter = chip.dataset.filter;
  sound.play("toggle");
  renderLibrary();
  updateHints();
});
$("#grid").addEventListener("click", (e) => {
  const action = e.target.closest("[data-do]")?.dataset.do;
  if (action === "add") return openAddGame();
  if (action === "rescan") return rescan();
  if (action === "clear-search") {
    $("#search").value = "";
    state.lib.query = "";
    renderLibrary();
    return nav.focus($("#search-box"));
  }
  const card = e.target.closest(".card");
  if (card) launchGame(gameById(card.dataset.id));
});
$("#grid").addEventListener("navfocus", (e) => {
  const game = gameById(e.target.dataset.id);
  if (game) setBackground(game, 250);
});
$("#search").addEventListener("input", (e) => {
  state.lib.query = e.target.value.trim();
  renderLibrary();
});
$("#search-box").addEventListener("click", (e) => {
  if (e.target.id !== "search") editField($("#search-box"));
});
$("#sort-btn").addEventListener("click", () => {
  const i = SORTS.findIndex((s) => s.id === state.lib.sort);
  state.lib.sort = SORTS[(i + 1) % SORTS.length].id;
  sound.play("toggle");
  renderLibrary();
});
$("#lib-add").addEventListener("click", () => openAddGame());

function libraryColumns() {
  const cards = $$("#grid .card");
  if (!cards.length) return 1;
  const top = cards[0].offsetTop;
  const n = cards.findIndex((c) => c.offsetTop !== top);
  return n < 0 ? cards.length : n;
}

function pageLibrary(direction) {
  const cards = $$("#grid .card");
  const i = cards.indexOf(nav.current);
  if (i < 0) { if (cards[0]) nav.focus(cards[0]); return; }
  const step = libraryColumns() * 3 * direction;
  const target = cards[Math.max(0, Math.min(cards.length - 1, i + step))];
  if (target && target !== nav.current) { nav.focus(target); sound.play("move"); }
}

// ---------------------------------------------------------------- settings
const SETTINGS_HELP = {};

function settingRow({ id, label, desc, value, type, help }) {
  SETTINGS_HELP[id] = help || desc || "";
  const adjust = type === "cycle" || type === "slider" ? "data-adjust" : "";
  return `<button class="setting" data-nav ${adjust} data-setting="${id}">
    <div><div class="label">${label}</div>${desc ? `<div class="desc">${desc}</div>` : ""}</div>
    <div class="value">${value}</div></button>`;
}
const toggleHtml = (on) => `<span class="toggle ${on ? "on" : ""}"></span>`;
const cycleHtml = (text) => `<span class="cycle-arrows"><span class="arr l">${icon("chevron")}</span>${escapeHtml(text)}<span class="arr">${icon("chevron")}</span></span>`;
const sliderHtml = (v) => `<span class="slider"><span class="slider-fill" style="width:${v * 100}%"></span><span class="slider-knob" style="left:${v * 100}%"></span></span>`;

const BACKGROUNDS = [["hero", "Game artwork"], ["aurora", "Aurora"], ["solid", "Solid"]];

function renderSettings() {
  const s = state.settings;
  const focused = nav.current?.dataset?.setting || nav.current?.dataset?.accent;
  const groups = [
    ["Appearance", [
      `<div class="swatches" data-row>${ACCENTS.map((c) =>
        `<button class="swatch ${c === s.accent ? "active" : ""}" data-nav data-accent="${c}" style="--c:${c}" aria-label="Accent ${c}"></button>`).join("")}</div>`,
      settingRow({ id: "background", label: "Background", desc: "What fills the screen behind your games", type: "cycle", value: cycleHtml(BACKGROUNDS.find(([k]) => k === s.background)?.[1] || s.background) }),
      settingRow({ id: "clock24", label: "24-hour clock", type: "toggle", value: toggleHtml(s.clock24) }),
    ]],
    ["Sound & feedback", [
      settingRow({ id: "sounds", label: "Interface sounds", type: "toggle", value: toggleHtml(s.sounds) }),
      settingRow({ id: "volume", label: "Volume", type: "slider", value: sliderHtml(s.volume), help: "Use left and right to change the volume." }),
      settingRow({ id: "rumble", label: "Controller vibration", desc: "Rumble when launching games", type: "toggle", value: toggleHtml(s.rumble) }),
    ]],
    ["Library", [
      ...Object.entries({ steam: "Steam", epic: "Epic Games (Legendary / Wine)", heroic: "Heroic (Epic, GOG)", lutris: "Lutris", mods: "Minecraft mod launchers (Prism, PolyMC, MultiMC)", launchers: "Game launchers (Steam, Epic, Prism…)", desktop: "Desktop games (.desktop)" }).map(([k, label]) =>
        settingRow({ id: `src-${k}`, label: `Scan ${label}`, type: "toggle", value: toggleHtml(s.sources[k]), help: `Include games installed through ${label}.` })),
      settingRow({ id: "src-apps", label: "Show apps", desc: "All programs from your app menu, in the Apps tab", type: "toggle", value: toggleHtml(s.sources.apps), help: "List every program on your PC (browsers, chat, media, the game stores) in the Apps tab." }),
      settingRow({ id: "showHidden", label: "Show hidden games", desc: "Hidden games are always listed under the Hidden filter", type: "toggle", value: toggleHtml(s.showHidden) }),
      settingRow({ id: "rescan", label: "Rescan library", desc: "Look for newly installed or removed games", value: icon("refresh") }),
      settingRow({ id: "add", label: "Add a game", desc: "Anything with a launch command", value: icon("plus") }),
    ]],
    ["System", [
      settingRow({ id: "hideOnLaunch", label: "Step aside while playing", desc: "Hide GameHub when a game or app starts, and come back when it closes", type: "toggle", value: toggleHtml(s.hideOnLaunch), help: "GameHub hides itself when you start something and returns when it closes. Press Super+O to show or hide GameHub at any time." }),
      settingRow({ id: "fullscreen", label: "Full screen", desc: "Also F11", type: "toggle", value: toggleHtml(isFullscreen()) }),
      settingRow({ id: "quit", label: "Quit GameHub", value: icon("exit") }),
    ]],
  ];
  SETTINGS_HELP.accent = "Pick the accent color used for highlights, glows and the boot screen.";
  $("#settings-list").innerHTML = groups.map(([title, rows]) => `<div class="settings-group">${title}</div>${rows.join("")}`).join("");
  $("#settings-about").innerHTML = `GameHub ArcStyle ${escapeHtml(state.version)}<br>${visibleGames().length} games · ${visibleApps().length} apps · ${escapeHtml(state.hostname)}${state.demo ? "<br>Demo mode" : ""}`;
  if (focused) {
    const el = $(`#settings-list [data-setting="${focused}"]`) || $(`#settings-list [data-accent="${focused}"]`);
    if (el) nav.focus(el, { silent: true, scroll: false });
  }
}

$("#settings-list").addEventListener("navfocus", (e) => {
  const key = e.target.dataset.setting || (e.target.dataset.accent ? "accent" : "");
  $("#settings-help").textContent = SETTINGS_HELP[key] || "Customize how GameHub looks, sounds and finds your games.";
});

$("#settings-list").addEventListener("click", (e) => {
  const swatch = e.target.closest("[data-accent]");
  if (swatch) { sound.play("toggle"); return saveSetting("accent", swatch.dataset.accent); }
  const row = e.target.closest("[data-setting]");
  if (!row) return;
  const id = row.dataset.setting;
  const s = state.settings;
  sound.play("toggle");
  switch (id) {
    case "clock24": case "sounds": case "rumble": case "showHidden": case "hideOnLaunch":
      return saveSetting(id, !s[id]);
    case "background": return adjustSetting(row, 1);
    case "volume": return adjustSetting(row, s.volume >= 1 ? -1 : 1);
    case "rescan": return rescan();
    case "add": return openAddGame();
    case "fullscreen": return toggleFullscreen();
    case "quit": return quitApp();
    default:
      if (id.startsWith("src-")) {
        const key = id.slice(4);
        return saveSetting("sources", { ...s.sources, [key]: !s.sources[key] });
      }
  }
});

function adjustSetting(row, dir) {
  const id = row.dataset.setting;
  if (id === "background") {
    const i = BACKGROUNDS.findIndex(([k]) => k === state.settings.background);
    saveSetting("background", BACKGROUNDS[(i + dir + BACKGROUNDS.length) % BACKGROUNDS.length][0]);
    sound.play("toggle");
  } else if (id === "volume") {
    const v = Math.round(Math.max(0, Math.min(1, state.settings.volume + dir * 0.1)) * 10) / 10;
    saveSetting("volume", v);
    sound.play("move");
  }
}
$("#settings-list").addEventListener("adjust", (e) => adjustSetting(e.target, e.detail));

// ======================================================================== details overlay
let detailsGame = null, detailsList = [];
function openDetails(game, list = state.games) {
  detailsList = list;
  renderDetails(game);
  if (topLayer()?.name !== "details") {
    openLayer($("#details"), "details");
    sound.play("open");
  }
  nav.focus($("#details-actions [data-nav]"), { silent: true });
}

function renderDetails(game) {
  detailsGame = game;
  const running = state.running.has(game.id);
  backdrop(game).then((bd) => {
    if (detailsGame !== game) return;
    const el = $("#details-bg");
    paintBackdrop(el, bd);
    if (!bd.url) {
      const h = hash(game.title) % 360;
      el.style.backgroundImage = `radial-gradient(60% 70% at 75% 45%, hsl(${h} 70% 40% / 0.45), transparent 70%), radial-gradient(50% 60% at 20% 80%, rgba(var(--accent-rgb), 0.18), transparent 70%)`;
    }
  });
  const logo = $("#details-logo");
  logo.innerHTML = `<div class="spot-title">${escapeHtml(game.title)}</div>`;
  firstImage(game.art.logo).then((url) => {
    if (url && detailsGame === game) logo.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(game.title)}">`;
  });
  $("#details-chips").innerHTML = `
    <span class="source-chip src-${game.source}">${isApp(game) ? escapeHtml(game.category || "App") : SOURCES[game.source]}</span>
    ${game.favorite ? `<span class="source-chip" style="--src:#ffd23f">Favorite</span>` : ""}
    ${game.hidden ? `<span class="source-chip" style="--src:#888">Hidden</span>` : ""}
    ${running ? `<span class="source-chip" style="--src:var(--good)">Running</span>` : ""}`;
  $("#details-actions").innerHTML = `
    <button class="btn btn-primary ${running ? "running" : ""}" data-nav data-do="play">${icon("play")}<span>${running ? "Running" : playLabel(game)}</span></button>
    <button class="btn ${game.favorite ? "btn-icon on" : ""}" data-nav data-do="fav">${icon(game.favorite ? "star" : "star-o")}<span>${game.favorite ? "Favorited" : "Favorite"}</span></button>
    <button class="btn" data-nav data-do="hide">${icon(game.hidden ? "eye" : "eye-off")}<span>${game.hidden ? "Unhide" : "Hide"}</span></button>
    ${game.source === "custom" ? `<button class="btn btn-danger" data-nav data-do="remove">${icon("trash")}<span>Remove</span></button>` : ""}`;
  $("#details-actions .btn-icon.on")?.classList.remove("btn-icon");
  $("#details-stats").innerHTML = `
    <div class="info-card"><div class="k">${isApp(game) ? "Time used" : "Play time"}</div><div class="v">${formatPlaytime(game.playtime)}</div></div>
    <div class="info-card"><div class="k">${isApp(game) ? "Last opened" : "Last played"}</div><div class="v">${formatAgo(game.lastPlayed)}</div></div>
    <div class="info-card"><div class="k">Launches</div><div class="v">${game.launches || 0}</div></div>
    ${game.size ? `<div class="info-card"><div class="k">Size on disk</div><div class="v">${formatSize(game.size)}</div></div>` : ""}
    ${game.command ? `<div class="info-card" style="grid-column:1/-1"><div class="k">Command</div><div class="details-cmd">${escapeHtml(game.command)}</div></div>` : ""}`;
  $("#details-desc").textContent = (isApp(game) && game.description) || "";
  $("#details-desc").hidden = !(isApp(game) && game.description);
  const cover = $("#details-cover");
  cover.classList.toggle("app", isApp(game));
  cover.innerHTML = isApp(game) ? appArtHtml(game) : artHtml(game);
  hydrateArt(cover, game);
}

$("#details-actions").addEventListener("click", async (e) => {
  const action = e.target.closest("[data-do]")?.dataset.do;
  const game = detailsGame;
  if (!action || !game) return;
  const keep = action;
  if (action === "play") return launchGame(game);
  if (action === "fav") await toggleFavorite(game);
  if (action === "hide") await setHidden(game, !game.hidden);
  if (action === "remove") {
    if (!(await confirmDialog("Remove game?", `“${game.title}” will be removed from GameHub. The game files are not touched.`, "Remove"))) return;
    try {
      const res = await api.removeCustom(game.id);
      setGames(res.games);
      closeLayer({ silent: true });
      toast("Game removed", game.title, { iconName: "trash" });
    } catch (err) { toast("Could not remove game", err.message, { kind: "error" }); }
    return;
  }
  const fresh = gameById(game.id);
  if (fresh && topLayer()?.name === "details") {
    renderDetails(fresh);
    nav.focus($(`#details-actions [data-do="${keep}"]`) || $("#details-actions [data-nav]"), { silent: true });
  }
});

function cycleDetails(dir) {
  if (!detailsList.length || !detailsGame) return;
  const i = detailsList.findIndex((g) => g.id === detailsGame.id);
  const next = detailsList[(i + dir + detailsList.length) % detailsList.length];
  const focusedAction = nav.current?.dataset?.do;
  renderDetails(gameById(next.id) || next);
  nav.focus($(`#details-actions [data-do="${focusedAction}"]`) || $("#details-actions [data-nav]"), { silent: true });
  sound.play("tab");
}

// ======================================================================== power menu
const POWER_ITEMS = [
  { id: "resume", label: "Resume", icon: "play" },
  { id: "fullscreen", label: "Toggle full screen", icon: "expand" },
  { id: "rescan", label: "Rescan library", icon: "refresh" },
  { id: "settings", label: "Settings", icon: "gear" },
  { sep: true },
  { id: "quit", label: "Quit GameHub", icon: "exit" },
  { id: "suspend", label: "Sleep", icon: "moon" },
  { id: "reboot", label: "Restart", icon: "restart", danger: true },
  { id: "shutdown", label: "Shut down", icon: "power", danger: true },
];

function openPower() {
  if (topLayer()?.name === "power") return closeLayer();
  $("#power-list").innerHTML = POWER_ITEMS.map((item) => item.sep ? `<div class="power-sep"></div>` :
    `<button class="power-item ${item.danger ? "danger" : ""}" data-nav data-power="${item.id}">${icon(item.icon)}<span>${item.label}</span></button>`).join("");
  openLayer($("#power"), "power");
  sound.play("open");
}

$("#power").addEventListener("click", async (e) => {
  if (e.target.id === "power") return closeLayer();
  const id = e.target.closest("[data-power]")?.dataset.power;
  if (!id) return;
  sound.play("select");
  switch (id) {
    case "resume": return closeLayer({ silent: true });
    case "fullscreen": closeLayer({ silent: true }); return toggleFullscreen();
    case "rescan": closeLayer({ silent: true }); return rescan();
    case "settings": closeLayer({ silent: true }); return showView("settings");
    case "quit": return quitApp();
    default: {
      const labels = { suspend: ["Sleep now?", "The computer will go to sleep.", "Sleep"], reboot: ["Restart computer?", "Unsaved progress in running games may be lost.", "Restart"], shutdown: ["Shut down computer?", "Unsaved progress in running games may be lost.", "Shut down"] };
      const [t, d, y] = labels[id];
      if (id !== "suspend" && !(await confirmDialog(t, d, y))) return;
      try {
        await api.power(id);
        closeLayer({ silent: true });
      } catch (err) { toast("Power action failed", err.message, { kind: "error" }); }
    }
  }
});
$("#power-btn").addEventListener("click", openPower);

async function quitApp() {
  if (!(await confirmDialog("Quit GameHub?", "Your games keep running. Start GameHub again from your app menu.", "Quit"))) return;
  if (input.postNative({ type: "quit" })) return;
  try { await api.power("quit"); } catch { /* server is going away */ }
  document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;color:#889;font-family:sans-serif">GameHub has closed. You can close this window.</div>`;
  setTimeout(() => window.close(), 300);
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.view === "settings" && !layers.length && renderSettings(), 200);
});

const isFullscreen = () => !!document.fullscreenElement || (window.innerWidth >= screen.width && window.innerHeight >= screen.height);

function toggleFullscreen() {
  if (input.postNative({ type: "fullscreen" })) return;
  const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  Promise.resolve(p).catch(() => toast("Full screen unavailable", "Press F11 to toggle full screen", { kind: "error" }))
    .finally(() => setTimeout(() => state.view === "settings" && renderSettings(), 300));
}

// ======================================================================== add game
function openAddGame() {
  ["#ag-title", "#ag-command", "#ag-cover", "#ag-hero"].forEach((s) => {
    $(s).value = "";
    $(s).closest(".field").classList.remove("invalid");
  });
  openLayer($("#addgame"), "addgame");
  nav.focus($("#ag-title").closest(".field"), { silent: true });
  sound.play("open");
}

$("#addgame").addEventListener("click", (e) => {
  const field = e.target.closest(".field");
  if (field && e.target.tagName !== "INPUT") editField(field);
});
$("#ag-cancel").addEventListener("click", () => closeLayer());
$("#ag-save").addEventListener("click", async () => {
  const game = { title: $("#ag-title").value.trim(), command: $("#ag-command").value.trim(), cover: $("#ag-cover").value.trim(), hero: $("#ag-hero").value.trim() };
  let bad = false;
  for (const [key, sel] of [["title", "#ag-title"], ["command", "#ag-command"]]) {
    const invalid = !game[key];
    $(sel).closest(".field").classList.toggle("invalid", invalid);
    if (invalid && !bad) { bad = true; nav.focus($(sel).closest(".field")); }
  }
  if (bad) return sound.play("error");
  try {
    const res = await api.addCustom(game);
    setGames(res.games);
    closeLayer({ silent: true });
    const added = $(`#view-${state.view} [data-id="${CSS.escape(res.id)}"]`);
    if (added) nav.focus(added, { silent: true });
    sound.play("select");
    toast("Game added", game.title, { iconName: "plus" });
  } catch (err) {
    toast("Could not add game", err.message, { kind: "error" });
  }
});

// ======================================================================== game actions
async function launchGame(game) {
  if (!game || state.launching) return;
  if (state.running.has(game.id)) {
    return toast("Already running", `${game.title} is running. Switch to it with Alt+Tab.`, { iconName: "play" });
  }
  state.launching = true;
  const overlay = $("#launching");
  $("#launch-title").textContent = game.title;
  const app = isApp(game);
  $("#launch-sub").textContent = app ? "Opening…" : "Starting game…";
  overlay.classList.toggle("app", app);
  const cover = $("#launch-cover");
  cover.innerHTML = app ? appArtHtml(game) : artHtml(game);
  hydrateArt(cover, game);
  backdrop(game).then((bd) => {
    $("#launch-bg").style.backgroundImage = bd.url ? `url("${bd.url}")` : "none";
    $("#launch-bg").classList.toggle("icon-bg", bd.icon);
  });
  overlay.classList.add("show");
  sound.play(app ? "open" : "launch");
  if (state.settings.rumble && !app) input.rumble(0.8, 0.5, 260);
  try {
    await api.launch(game.id);
    game.lastPlayed = Math.floor(Date.now() / 1000);
    game.launches = (game.launches || 0) + 1;
    state.running.set(game.id, { title: game.title, started: game.lastPlayed });
    if (state.demo) toast("Demo mode", "Games are not actually started in demo mode.", { iconName: "info" });
  } catch (err) {
    overlay.classList.remove("show");
    state.launching = false;
    return toast(app ? "Could not open app" : "Could not start game", err.message, { kind: "error" });
  }
  setTimeout(() => {
    overlay.classList.remove("show");
    state.launching = false;
    // Step aside so the game/app is in front; Super+O (or closing it) brings GameHub back.
    if (state.settings.hideOnLaunch && !state.demo) input.postNative({ type: "hide", reason: "launch" });
    renderHome({ keepId: game.id });
    if (isListView()) renderLibrary();
    if (topLayer()?.name === "details") renderDetails(gameById(game.id));
    updateHints();
  }, app ? 1300 : 2600);
}

async function toggleFavorite(game) {
  try {
    const res = await api.meta(game.id, { favorite: !game.favorite });
    game.favorite = res.meta.favorite;
    sound.play("toggle");
    toast(game.favorite ? "Added to favorites" : "Removed from favorites", game.title, { iconName: "star", time: 2200 });
    refreshAfterMeta(game);
  } catch (err) { toast("Could not update game", err.message, { kind: "error" }); }
}

async function setHidden(game, hidden) {
  try {
    const res = await api.meta(game.id, { hidden });
    game.hidden = res.meta.hidden;
    sound.play("toggle");
    toast(hidden ? "Game hidden" : "Game visible again", hidden ? "Find it under the Hidden filter in your library." : game.title, { iconName: hidden ? "eye-off" : "eye", time: 2600 });
    refreshAfterMeta(game);
  } catch (err) { toast("Could not update game", err.message, { kind: "error" }); }
}

function refreshAfterMeta(game) {
  const focusedId = nav.current?.dataset?.id;
  renderHome({ keepId: state.view === "home" && focusedId ? focusedId : undefined });
  if (isListView()) renderLibrary();
  if (state.view === "home" && !layers.length && focusedId) {
    const tile = $(`#rail [data-id="${CSS.escape(focusedId)}"]`);
    if (tile) nav.focus(tile, { silent: true });
  }
  updateHints();
}

async function rescan() {
  toast("Scanning library…", "Looking for installed games", { iconName: "refresh", time: 1600 });
  try {
    const res = await api.rescan();
    const before = state.games.length;
    setGames(res.games);
    const diff = state.games.length - before;
    toast("Library updated", `${visibleGames().length} games · ${visibleApps().length} apps${diff ? ` (${diff > 0 ? "+" : ""}${diff})` : ""}`, { iconName: "grid" });
  } catch (err) {
    toast("Rescan failed", err.message, { kind: "error" });
  }
}

function setGames(games) {
  state.games = games;
  renderHome();
  if (isListView()) renderLibrary();
  if (state.view === "settings") renderSettings();
  nav.ensure();
  updateHints();
}

async function reloadState() {
  const data = await api.state();
  state.settings = data.settings;
  state.demo = data.demo;
  state.version = data.version;
  state.user = data.user;
  state.hostname = data.hostname;
  applySettings();
  setGames(data.games);
}

// ======================================================================== input routing
function handleAction(action, info = {}) {
  if (!state.booted) {
    dismissBoot();
    return true;
  }
  if (osk.isOpen) return osk.handle(action);
  if (state.launching) return true;

  // Leave native text fields with up/down/enter/escape.
  if (info.typing) {
    document.activeElement.blur();
    if (action === "accept" || action === "back") return true;
  }

  const layer = topLayer();
  const current = nav.current;

  if (action === "start" || action === "guide") {
    if (layer?.name === "confirm") return true;
    if (layer && layer.name !== "power") closeLayer({ silent: true });
    openPower();
    return true;
  }

  switch (action) {
    case "up": case "down": case "left": case "right":
      if (nav.move(action)) {
        if (!(current?.hasAttribute("data-adjust") && (action === "left" || action === "right"))) sound.play("move");
        updateHints();
      }
      return true;

    case "accept":
      if (!current) return true;
      if (current.matches(".search, .field")) {
        sound.play("select");
        return editField(current);
      }
      if (!current.closest(".rail") && !current.closest("#grid") && !current.matches("[data-setting], [data-accent], .chip, #sort-btn")) {
        sound.play("select");
      }
      if (current.closest("#rail")) return activateTile(current);
      current.click();
      return true;

    case "back":
      if (layer) { closeLayer(); return true; }
      if (state.view !== "home") { showView("home"); sound.play("back"); return true; }
      if (!$("#rail").contains(current)) { focusRail(state.railIndex); sound.play("back"); }
      return true;

    case "x": {
      const game = current?.dataset?.id && gameById(current.dataset.id);
      if (game && !layer) openDetails(game, isListView() ? state.libList : state.railGames);
      return true;
    }

    case "y": {
      const game = layer?.name === "details" ? detailsGame : current?.dataset?.id && gameById(current.dataset.id);
      if (game && (!layer || layer.name === "details")) {
        toggleFavorite(game).then(() => {
          if (topLayer()?.name === "details") {
            const focused = nav.current?.dataset?.do;
            renderDetails(gameById(game.id));
            nav.focus($(`#details-actions [data-do="${focused}"]`) || $("#details-actions [data-nav]"), { silent: true });
          }
        });
      }
      return true;
    }

    case "lb": case "rb": {
      const dir = action === "lb" ? -1 : 1;
      if (layer?.name === "details") { cycleDetails(dir); return true; }
      if (layer) return true;
      const i = VIEW_ORDER.indexOf(state.view);
      showView(VIEW_ORDER[(i + dir + VIEW_ORDER.length) % VIEW_ORDER.length]);
      return true;
    }

    case "lt": case "rt": {
      if (layer) return true;
      const dir = action === "lt" ? -1 : 1;
      if (isListView()) pageLibrary(dir);
      if (state.view === "home") { focusRail(state.railIndex + dir * 5); sound.play("move"); }
      return true;
    }

    case "select":
      if (layer) return true;
      if (!isListView()) showView("library", { focus: false });
      nav.focus($("#search-box"));
      editField($("#search-box"));
      return true;
  }
  return false;
}

input.on((action, info) => {
  sound.unlock();
  handleAction(action, info);
});

input.onDevice = () => refreshGlyphs();
input.onConnection = (connected, pad) => {
  const name = pad.id.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim() || "Controller";
  $("#pad-status").classList.toggle("on", input.controllerCount > 0);
  if (state.booted && pad.id) {
    toast(connected ? "Controller connected" : "Controller disconnected", name, { iconName: "gamepad", kind: connected ? "info" : "error" });
  }
};

nav.onFocus = () => updateHints();

// Mouse: hovering focuses (except rail tiles, which move under the pointer).
let lastPointer = { x: -1, y: -1 };
document.addEventListener("pointermove", (e) => {
  if (Math.abs(e.clientX - lastPointer.x) + Math.abs(e.clientY - lastPointer.y) < 3) return;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (input.device !== "keyboard") {
    input.device = "keyboard";
    document.documentElement.dataset.input = "keyboard";
    refreshGlyphs();
  }
  const el = e.target.closest?.("[data-nav]");
  if (!el || el === nav.current || el.closest("#rail") || !nav.scope.contains(el)) return;
  nav.focus(el, { scroll: false });
});
document.addEventListener("focusin", (e) => {
  // Clicking into a text field focuses its navigable wrapper too.
  const wrap = e.target.closest?.("[data-nav]");
  if (wrap && wrap !== nav.current && nav.scope.contains(wrap)) nav.focus(wrap, { scroll: false });
});
document.addEventListener("pointerdown", () => { sound.unlock(); if (!state.booted) dismissBoot(); });

// ======================================================================== boot
const bootScene = new BootScene($("#boot-canvas"));
bootScene.start();

function dismissBoot() {
  if (state.booted) return;
  state.booted = true;
  sound.unlock();
  sound.play("boot");
  $("#boot").classList.add("warping");
  bootScene.warpOut(850).then(() => {
    $("#boot").classList.add("done");
    document.body.classList.add("ready");
    setTimeout(() => bootScene.stop(), 700);
  });
  showView("home", { focus: true });
  if (state.demo) setTimeout(() => toast("Demo library", "Started with --demo. Launching is simulated.", { iconName: "gamepad" }), 900);
}

async function init() {
  document.body.classList.add("view-home");
  refreshGlyphs();
  try {
    await reloadState();
  } catch (err) {
    $(".boot-press-text").textContent = `Could not reach GameHub: ${err.message}`;
    return;
  }
  nav.setScope(appEl, { restore: false });
  showView("home", { focus: true });
  pollStatus();
  setInterval(pollStatus, 4000);
  // Pressing any controller button or key dismisses the splash; auto-continue after a moment.
}

init();
