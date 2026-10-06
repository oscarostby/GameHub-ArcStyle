// Focus engine: spatial navigation between [data-nav] elements inside a scope.
//
//  data-nav             element can receive focus
//  data-row             parent container whose [data-nav] children move linearly with left/right
//  data-adjust          left/right are sent to the element as "adjust" events instead of moving
//  data-nav-default     preferred element when entering a scope

const isVisible = (el) => {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
};

class Nav {
  constructor() {
    this.scope = document.body;
    this.current = null;
    this.memory = new WeakMap(); // scope -> last focused element
    this.onFocus = null;
  }

  candidates(scope = this.scope) {
    return [...scope.querySelectorAll("[data-nav]")].filter(
      (el) => !el.disabled && !el.closest("[data-nav-disabled]") && isVisible(el)
    );
  }

  setScope(scope, { restore = true } = {}) {
    if (this.current && this.scope) this.memory.set(this.scope, this.current);
    this.scope = scope;
    const remembered = restore ? this.memory.get(scope) : null;
    if (remembered && scope.contains(remembered) && isVisible(remembered)) {
      this.focus(remembered, { silent: true });
    } else {
      this.focusFirst();
    }
  }

  focusFirst() {
    const list = this.candidates();
    const el = list.find((e) => e.hasAttribute("data-nav-default")) || list[0];
    if (el) this.focus(el, { silent: true });
    else this.blur();
  }

  blur() {
    this.current?.classList.remove("focused");
    this.current = null;
  }

  focus(el, { silent = false, scroll = true } = {}) {
    if (!el) return;
    if (this.current && this.current !== el) {
      this.current.classList.remove("focused");
      this.current.dispatchEvent(new CustomEvent("navblur", { bubbles: true }));
    }
    this.current = el;
    el.classList.add("focused");
    if (scroll && !el.closest("[data-no-scroll]")) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    el.dispatchEvent(new CustomEvent("navfocus", { bubbles: true }));
    this.onFocus?.(el, silent);
  }

  ensure() {
    if (!this.current || !this.scope.contains(this.current) || !isVisible(this.current)) {
      this.memory.delete(this.scope);
      this.focusFirst();
    }
  }

  // Returns true when focus moved.
  move(dir) {
    this.ensure();
    const from = this.current;
    if (!from) return false;

    if ((dir === "left" || dir === "right") && from.hasAttribute("data-adjust")) {
      from.dispatchEvent(new CustomEvent("adjust", { bubbles: true, detail: dir === "left" ? -1 : 1 }));
      return true;
    }

    const row = from.closest("[data-row]");
    if (row && (dir === "left" || dir === "right") && this.scope.contains(row)) {
      const items = this.candidates(row);
      const i = items.indexOf(from);
      const next = items[i + (dir === "left" ? -1 : 1)];
      if (next) { this.focus(next); return true; }
      if (row.hasAttribute("data-row-wrap") && items.length > 1) {
        this.focus(items[dir === "left" ? items.length - 1 : 0]);
        return true;
      }
      if (row.hasAttribute("data-row-trap")) return false;
    }

    const target = this.#nearest(from, dir);
    if (target) {
      // Entering a row from outside lands on its remembered item.
      const targetRow = target.closest("[data-row]");
      let entry = null;
      if (targetRow && targetRow !== row) {
        const remembered = this.memory.get(targetRow);
        entry = remembered && targetRow.contains(remembered) && isVisible(remembered)
          ? remembered
          : this.candidates(targetRow).find((e) => e.hasAttribute("data-nav-default"));
      }
      this.focus(entry || target);
      return true;
    }
    return false;
  }

  remember(el) {
    const row = el.closest("[data-row]");
    if (row) this.memory.set(row, el);
  }

  #nearest(from, dir) {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of this.candidates()) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let primary, secondary;
      switch (dir) {
        case "up":
          primary = a.top - b.bottom; secondary = Math.abs(ax - bx);
          if (by >= ay - 1) continue;
          break;
        case "down":
          primary = b.top - a.bottom; secondary = Math.abs(ax - bx);
          if (by <= ay + 1) continue;
          break;
        case "left":
          primary = a.left - b.right; secondary = Math.abs(ay - by);
          if (bx >= ax - 1) continue;
          break;
        case "right":
          primary = b.left - a.right; secondary = Math.abs(ay - by);
          if (bx <= ax + 1) continue;
          break;
      }
      const score = Math.max(primary, 0) + secondary * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
}

export const nav = new Nav();

// Track the last item per row so re-entering a row restores position.
document.addEventListener("navfocus", (e) => nav.remember(e.target), true);
