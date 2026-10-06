// Controller friendly on-screen keyboard.
//   A: type key   X: backspace   Y: space   LB/RB: move cursor   LT: shift   Start: done   B: close

const LAYOUT = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "'"],
  ["z", "x", "c", "v", "b", "n", "m", "-", ".", "/"],
];
const SYMBOLS = [
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
  ["~", "`", "=", "+", "[", "]", "{", "}", "\\", "|"],
  [":", ";", "\"", "<", ">", "?", "_", ",", "€", "£"],
  ["é", "è", "ü", "ö", "ä", "å", "æ", "ø", "ñ", "ß"],
];

export class OnScreenKeyboard {
  constructor({ nav, sound, glyph }) {
    this.nav = nav;
    this.sound = sound;
    this.glyph = glyph;
    this.shift = false;
    this.symbols = false;
    this.target = null;
    this.el = document.createElement("div");
    this.el.className = "osk";
    this.el.innerHTML = `
      <div class="osk-panel">
        <div class="osk-preview"><span class="osk-label"></span><div class="osk-text"></div></div>
        <div class="osk-keys"></div>
        <div class="osk-hints"></div>
      </div>`;
    document.body.appendChild(this.el);
    this.keysEl = this.el.querySelector(".osk-keys");
    this.textEl = this.el.querySelector(".osk-text");
    this.el.addEventListener("click", (e) => {
      const key = e.target.closest("[data-key]");
      if (key) this.press(key.dataset.key);
    });
  }

  get isOpen() { return this.el.classList.contains("open"); }

  open(target, { onDone, onClose } = {}) {
    this.target = target;
    this.onDone = onDone;
    this.onClose = onClose;
    this.el.querySelector(".osk-label").textContent = target.getAttribute("aria-label") || target.placeholder || "Enter text";
    this.caret = target.value.length;
    this.render();
    this.el.classList.add("open");
    this.prevScope = this.nav.scope;
    this.prevFocus = this.nav.current;
    this.nav.setScope(this.el, { restore: true });
    this.sound.play("open");
  }

  close(done = false) {
    if (!this.isOpen) return;
    this.el.classList.remove("open");
    this.nav.setScope(this.prevScope);
    if (this.prevFocus) this.nav.focus(this.prevFocus, { silent: true });
    const target = this.target;
    this.target = null;
    if (done) this.onDone?.(target);
    this.onClose?.(target);
  }

  render() {
    const layout = this.symbols ? SYMBOLS : LAYOUT;
    const keyHtml = (label, key, cls = "") =>
      `<button class="osk-key ${cls}" data-nav data-key="${key}">${label}</button>`;
    const rows = layout.map((row) =>
      `<div class="osk-row" data-row>${row.map((k) => {
        const label = this.shift ? k.toUpperCase() : k;
        return keyHtml(escapeHtml(label), escapeHtml(label));
      }).join("")}</div>`);
    rows.push(`<div class="osk-row" data-row>
      ${keyHtml("⇧ Shift", "{shift}", `wide ${this.shift ? "on" : ""}`)}
      ${keyHtml(this.symbols ? "abc" : "#+=", "{symbols}", "wide")}
      ${keyHtml("Space", "{space}", "space")}
      ${keyHtml("⌫", "{back}", "wide")}
      ${keyHtml("Done", "{done}", "wide accent")}
    </div>`);
    const focusedKey = this.nav.current?.dataset?.key;
    const focusedIndex = focusedKey ? [...this.keysEl.querySelectorAll("[data-key]")].indexOf(this.nav.current) : -1;
    this.keysEl.innerHTML = rows.join("");
    if (this.isOpen && focusedIndex >= 0) {
      const keys = this.keysEl.querySelectorAll("[data-key]");
      this.nav.focus(keys[focusedIndex], { silent: true, scroll: false });
    }
    this.el.querySelector(".osk-hints").innerHTML = `
      <span>${this.glyph("x")} Backspace</span><span>${this.glyph("y")} Space</span>
      <span>${this.glyph("lb")}${this.glyph("rb")} Cursor</span><span>${this.glyph("lt")} Shift</span>
      <span>${this.glyph("start")} Done</span><span>${this.glyph("back")} Close</span>`;
    this.updateText();
  }

  updateText() {
    if (!this.target) return;
    const v = this.target.value;
    const masked = this.target.type === "password" ? "•".repeat(v.length) : v;
    this.textEl.innerHTML = `${escapeHtml(masked.slice(0, this.caret))}<i class="osk-caret"></i>${escapeHtml(masked.slice(this.caret))}`;
  }

  #edit(fn) {
    const t = this.target;
    const before = t.value;
    const [value, caret] = fn(before, this.caret);
    t.value = value.slice(0, t.maxLength > 0 ? t.maxLength : undefined);
    this.caret = Math.min(caret, t.value.length);
    if (t.value !== before) t.dispatchEvent(new Event("input", { bubbles: true }));
    this.updateText();
  }

  press(key) {
    if (!this.target) return;
    switch (key) {
      case "{shift}": this.shift = !this.shift; this.render(); this.sound.play("toggle"); return;
      case "{symbols}": this.symbols = !this.symbols; this.render(); this.sound.play("toggle"); return;
      case "{space}": this.#insert(" "); break;
      case "{back}": this.#backspace(); break;
      case "{done}": this.sound.play("select"); this.close(true); return;
      default:
        this.#insert(key);
        if (this.shift) { this.shift = false; this.render(); }
    }
    this.sound.play("move");
  }

  #insert(text) { this.#edit((v, c) => [v.slice(0, c) + text + v.slice(c), c + text.length]); }
  #backspace() { this.#edit((v, c) => (c > 0 ? [v.slice(0, c - 1) + v.slice(c), c - 1] : [v, c])); }

  // Returns true when the action was consumed.
  handle(action) {
    if (!this.isOpen) return false;
    switch (action) {
      case "up": case "down": case "left": case "right":
        if (this.nav.move(action)) this.sound.play("move");
        return true;
      case "accept": this.nav.current?.click(); return true;
      case "back": this.sound.play("back"); this.close(false); return true;
      case "x": this.#backspace(); this.sound.play("move"); return true;
      case "y": this.#insert(" "); this.sound.play("move"); return true;
      case "lb": this.caret = Math.max(0, this.caret - 1); this.updateText(); return true;
      case "rb": this.caret = Math.min(this.target.value.length, this.caret + 1); this.updateText(); return true;
      case "lt": this.press("{shift}"); return true;
      case "start": this.press("{done}"); return true;
      default: return true;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
