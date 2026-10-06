// Unified input: turns gamepad buttons/sticks and keyboard keys into UI actions.
//
// Actions: up down left right accept back x y lb rb lt rt start select guide
// Listeners receive (action, { device, repeat }).

const STANDARD_BUTTONS = {
  0: "accept", 1: "back", 2: "x", 3: "y",
  4: "lb", 5: "rb", 6: "lt", 7: "rt",
  8: "select", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right", 16: "guide",
};

const KEYS = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Enter: "accept", " ": "accept", Escape: "back", Backspace: "back",
  x: "x", X: "x", f: "y", F: "y", q: "lb", Q: "lb", e: "rb", E: "rb",
  PageUp: "lt", PageDown: "rt", m: "start", M: "start", "/": "select", Home: "guide",
};

const REPEATABLE = new Set(["up", "down", "left", "right", "lt", "rt"]);
const REPEAT_DELAY = 380;
const REPEAT_RATE = 95;
const DEADZONE = 0.55;

export function controllerFamily(id = "") {
  const s = id.toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return "xbox";
  if (/054c|dualsense|dualshock|playstation|wireless controller|ps[345]/.test(s)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return "nintendo";
  return "xbox";
}

class Input {
  constructor() {
    this.listeners = new Set();
    this.device = "keyboard";       // keyboard | gamepad
    this.family = "xbox";           // xbox | playstation | nintendo
    this.held = new Map();          // action -> { next: timestamp }
    this.pads = new Map();          // index -> gamepad id
    this.enabled = true;
    this.onDevice = null;
    this.onConnection = null;

    window.addEventListener("keydown", (e) => this.#key(e));
    window.addEventListener("gamepadconnected", (e) => {
      this.pads.set(e.gamepad.index, e.gamepad.id);
      this.onConnection?.(true, e.gamepad);
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      this.pads.delete(e.gamepad.index);
      this.onConnection?.(false, e.gamepad);
    });
    // Ignore buttons that are already held when focus comes back (e.g. after quitting a game).
    window.addEventListener("focus", () => { this.suppressUntilRelease = true; });

    // In the desktop app, controllers are read natively and forwarded here.
    this.native = window.__GAMEHUB_NATIVE__ || null;
    window.gamehubNative = {
      action: (action, family, repeat) => {
        this.#setDevice("gamepad", family);
        this.#emit(action, { device: "gamepad", repeat });
      },
      connection: (connected, name, count) => {
        this.nativeCount = count;
        this.onConnection?.(connected, { id: name || "Controller" });
      },
    };
    if (!this.native?.gamepad) requestAnimationFrame(() => this.#poll());
    this.postNative({ type: "ready" });
  }

  get controllerCount() {
    return this.native?.gamepad ? this.nativeCount || 0 : this.pads.size;
  }

  postNative(message) {
    const handler = window.webkit?.messageHandlers?.gamehub;
    if (!handler) return false;
    handler.postMessage(JSON.stringify(message));
    return true;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  #emit(action, info) {
    if (!this.enabled) return;
    for (const fn of this.listeners) {
      if (fn(action, info) === true) break;
    }
  }

  #setDevice(device, family) {
    if (this.device !== device || (family && this.family !== family)) {
      this.device = device;
      if (family) this.family = family;
      document.documentElement.dataset.input = device;
      document.documentElement.dataset.family = this.family;
      this.onDevice?.(device, this.family);
    }
  }

  #key(e) {
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (typing) {
      // While typing natively, only a few keys drive the UI.
      if (!["ArrowUp", "ArrowDown", "Escape", "Enter", "Tab"].includes(e.key)) return;
      if (e.key === "Tab") return;
    }
    if (e.key === "F11") return; // let the browser toggle full screen
    const action = KEYS[e.key];
    if (!action || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    this.#setDevice("keyboard");
    this.#emit(action, { device: "keyboard", repeat: e.repeat, typing });
  }

  #readPad(pad) {
    const pressed = new Set();
    const buttons = pad.buttons;
    const standard = pad.mapping === "standard";
    for (const [i, action] of Object.entries(STANDARD_BUTTONS)) {
      const b = buttons[i];
      if (b && (b.pressed || b.value > 0.5)) pressed.add(action);
    }
    const [lx = 0, ly = 0] = pad.axes;
    if (lx < -DEADZONE) pressed.add("left");
    if (lx > DEADZONE) pressed.add("right");
    if (ly < -DEADZONE) pressed.add("up");
    if (ly > DEADZONE) pressed.add("down");
    // Non-standard mappings often expose the d-pad as a hat on axes 6/7.
    if (!standard && pad.axes.length >= 8) {
      const hx = pad.axes[6], hy = pad.axes[7];
      if (hx < -0.5) pressed.add("left");
      if (hx > 0.5) pressed.add("right");
      if (hy < -0.5) pressed.add("up");
      if (hy > 0.5) pressed.add("down");
    }
    return pressed;
  }

  #poll() {
    requestAnimationFrame(() => this.#poll());
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pressed = new Set();
    let activePad = null;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const p = this.#readPad(pad);
      if (p.size) activePad = pad;
      p.forEach((a) => pressed.add(a));
    }

    // Never act while a game (or another window) has focus.
    if (!document.hasFocus()) {
      this.held.clear();
      this.suppressUntilRelease = true;
      return;
    }
    if (this.suppressUntilRelease) {
      if (pressed.size === 0) this.suppressUntilRelease = false;
      for (const a of pressed) this.held.set(a, { next: Infinity });
      return;
    }

    const now = performance.now();
    for (const action of [...this.held.keys()]) {
      if (!pressed.has(action)) this.held.delete(action);
    }
    for (const action of pressed) {
      const state = this.held.get(action);
      if (!state) {
        this.held.set(action, { next: now + REPEAT_DELAY });
        this.#setDevice("gamepad", controllerFamily(activePad?.id));
        this.lastPad = activePad;
        this.#emit(action, { device: "gamepad", repeat: false });
      } else if (REPEATABLE.has(action) && now >= state.next) {
        state.next = now + REPEAT_RATE;
        this.#emit(action, { device: "gamepad", repeat: true });
      }
    }
  }

  rumble(strong = 0.6, weak = 0.4, duration = 140) {
    if (this.native?.gamepad) return this.postNative({ type: "rumble", strong, weak, ms: duration });
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      const actuator = pad?.vibrationActuator;
      if (actuator?.playEffect) {
        actuator.playEffect("dual-rumble", { duration, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
      }
    }
  }
}

export const input = new Input();
