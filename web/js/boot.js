// Animated title scene for the "Press any button" screen, drawn on a canvas:
// starry sky with nebulae, a glowing arc portal over the horizon, neon
// mountain ridges and a synthwave grid floor rushing towards the viewer.

const TAU = Math.PI * 2;

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [0, 212, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

// Small deterministic random generator so the landscape is the same every start.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1D value noise with smooth interpolation for mountain ridges.
function ridge(rand, points) {
  const values = Array.from({ length: points + 1 }, () => rand());
  return (x) => {
    const f = x * points;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return values[i % values.length] * (1 - s) + values[(i + 1) % values.length] * s;
  };
}

export class BootScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.running = false;
    this.warp = 0;              // 0..1 while flying into the portal
    this.colors();
    const rand = mulberry32(7);
    this.stars = Array.from({ length: 260 }, () => ({
      x: rand(), y: rand() * 0.62, r: rand() * 1.3 + 0.2, tw: rand() * TAU, sp: 0.6 + rand() * 1.8,
    }));
    this.nebulae = Array.from({ length: 5 }, (_, i) => ({
      x: 0.12 + rand() * 0.76, y: 0.08 + rand() * 0.35, r: 0.22 + rand() * 0.25, c: i % 2, drift: rand() * TAU,
    }));
    this.sparks = Array.from({ length: 70 }, () => this.#spark(rand, true));
    this.rand = rand;
    this.far = ridge(mulberry32(11), 9);
    this.near = ridge(mulberry32(23), 6);
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
  }

  // Read the theme colours (any CSS colour syntax) via the canvas normaliser.
  colors() {
    const css = getComputedStyle(document.documentElement);
    const toRgb = (value, fallback) => {
      this.ctx.fillStyle = "#010203";
      this.ctx.fillStyle = value.trim();
      const hex = this.ctx.fillStyle;
      return hex === "#010203" ? fallback : rgb(hex);
    };
    this.a = toRgb(css.getPropertyValue("--accent"), [0, 212, 255]);
    this.b = toRgb(css.getPropertyValue("--accent-2"), [122, 92, 255]);
  }

  #spark(rand, anywhere) {
    return {
      x: rand(), y: anywhere ? 0.55 + rand() * 0.45 : 1.02, vy: 0.02 + rand() * 0.05,
      r: 0.6 + rand() * 1.8, life: rand(), wob: rand() * TAU,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    window.addEventListener("resize", this.resize);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    window.removeEventListener("resize", this.resize);
  }

  // Fly into the portal; resolves when the animation is done.
  warpOut(duration = 900) {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        this.warp = Math.min(1, (now - start) / duration);
        if (this.warp < 1 && this.running) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  frame(now) {
    if (!this.running) return;
    const t = (now - this.t0) / 1000;
    this.draw(t);
    requestAnimationFrame(this.frame);
  }

  draw(t) {
    const { ctx, w, h, a, b } = this;
    const warp = this.warp * this.warp;
    const horizon = h * 0.62;
    const cx = w / 2;

    ctx.save();
    // Camera push-in while warping.
    const zoom = 1 + warp * 2.4;
    ctx.translate(cx, horizon - h * 0.12);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -(horizon - h * 0.12));

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#03040b");
    sky.addColorStop(0.55, "#0a0b24");
    sky.addColorStop(1, rgba(b, 0.55));
    ctx.fillStyle = sky;
    ctx.fillRect(-w, -h, w * 3, horizon + h);

    // Nebulae
    ctx.globalCompositeOperation = "lighter";
    for (const n of this.nebulae) {
      const x = (n.x + Math.sin(t * 0.03 + n.drift) * 0.02) * w;
      const y = n.y * h;
      const r = n.r * Math.max(w, h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = n.c ? a : b;
      g.addColorStop(0, rgba(c, 0.16));
      g.addColorStop(0.5, rgba(c, 0.05));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Stars
    for (const s of this.stars) {
      const alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw));
      ctx.fillStyle = `rgba(230, 240, 255, ${alpha * (1 - warp)})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, TAU);
      ctx.fill();
    }

    // Arc portal: glow, rays, rings
    const portalR = Math.min(w, h) * 0.34;
    const py = horizon;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);
    const glow = ctx.createRadialGradient(cx, py, portalR * 0.2, cx, py, portalR * 1.9);
    glow.addColorStop(0, rgba(a, 0.38 + warp * 0.5));
    glow.addColorStop(0.45, rgba(b, 0.16 + warp * 0.3));
    glow.addColorStop(1, rgba(b, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - portalR * 2, py - portalR * 2, portalR * 4, portalR * 2);

    // Light rays fanning out from the portal
    ctx.save();
    ctx.translate(cx, py);
    for (let i = 0; i < 18; i++) {
      const ang = Math.PI + (i + 0.5) * (Math.PI / 18) + Math.sin(t * 0.2 + i) * 0.02;
      const len = portalR * (2.2 + 0.4 * Math.sin(t * 0.7 + i * 1.7));
      const grad = ctx.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
      grad.addColorStop(0, rgba(i % 2 ? a : b, 0.12 + 0.06 * pulse));
      grad.addColorStop(1, rgba(i % 2 ? a : b, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, len, ang - 0.035, ang + 0.035);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Inner sun disc with scanline cut-outs (synthwave sun)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, py, portalR * 0.72, Math.PI, TAU);
    ctx.closePath();
    ctx.clip();
    const sun = ctx.createLinearGradient(0, py - portalR * 0.72, 0, py);
    sun.addColorStop(0, rgba(a, 0.95));
    sun.addColorStop(1, rgba(b, 0.9));
    ctx.fillStyle = sun;
    ctx.fillRect(cx - portalR, py - portalR, portalR * 2, portalR);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 9; i++) {
      const k = i / 9;
      const yy = py - portalR * 0.72 * (1 - k) * 0.62 - ((t * 10) % (portalR * 0.08)) * k;
      ctx.fillRect(cx - portalR, yy, portalR * 2, 1 + k * portalR * 0.045);
    }
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";

    // Concentric rings of the arc
    for (let i = 0; i < 3; i++) {
      const r = portalR * (0.86 + i * 0.13) + Math.sin(t * 1.2 + i) * 2;
      ctx.strokeStyle = rgba(i === 1 ? b : a, 0.75 - i * 0.2);
      ctx.lineWidth = i === 0 ? 3 : 1.5;
      ctx.shadowColor = rgba(a, 0.9);
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(cx, py, r, Math.PI, TAU);
      ctx.stroke();
    }
    // A bright comet travelling along the arc
    const ca = Math.PI + ((t * 0.35) % 1) * Math.PI;
    const cr = portalR * 0.86;
    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ca) * cr, py + Math.sin(ca) * cr, 3.2, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";

    // Mountain ridges (far, then near), lit from the portal
    this.#mountains(this.far, horizon, h * 0.16, "#0b0d24", rgba(b, 0.7), t * 0.004);
    this.#mountains(this.near, horizon, h * 0.09, "#05060f", rgba(a, 0.85), t * 0.008);

    // Floor
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, "#07081a");
    floor.addColorStop(1, "#020208");
    ctx.fillStyle = floor;
    ctx.fillRect(-w, horizon, w * 3, h);

    // Perspective grid rushing towards the viewer
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w, horizon, w * 3, h);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.2;
    const speed = 0.35 + warp * 6;
    const rows = 22;
    for (let i = 0; i < rows; i++) {
      const z = ((i + (t * speed) % 1) / rows);
      const y = horizon + Math.pow(z, 2.6) * (h - horizon) * 1.05;
      ctx.strokeStyle = rgba(a, 0.08 + z * 0.55);
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w * 2, y);
      ctx.stroke();
    }
    for (let i = -24; i <= 24; i++) {
      const x0 = cx + i * w * 0.012;
      const x1 = cx + i * w * 0.16;
      const g = ctx.createLinearGradient(0, horizon, 0, h);
      g.addColorStop(0, rgba(b, 0));
      g.addColorStop(1, rgba(b, 0.55));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, horizon);
      ctx.lineTo(x1, h);
      ctx.stroke();
    }
    // Horizon line + reflection of the portal on the floor
    const ref = ctx.createRadialGradient(cx, horizon, 0, cx, horizon, portalR * 1.6);
    ref.addColorStop(0, rgba(a, 0.35));
    ref.addColorStop(1, rgba(a, 0));
    ctx.fillStyle = ref;
    ctx.fillRect(cx - portalR * 2, horizon, portalR * 4, portalR * 1.6);
    ctx.strokeStyle = rgba(a, 0.9);
    ctx.lineWidth = 2;
    ctx.shadowColor = rgba(a, 1);
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(-w, horizon);
    ctx.lineTo(w * 2, horizon);
    ctx.stroke();
    ctx.restore();

    // Rising sparks
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.sparks) {
      s.y -= s.vy / 60;
      s.life += 0.004;
      if (s.y < 0.25) Object.assign(s, this.#spark(this.rand, false));
      const x = (s.x + Math.sin(t * 0.8 + s.wob) * 0.01) * w;
      const fade = Math.min(1, (s.y - 0.25) * 4) * 0.8;
      ctx.fillStyle = rgba(s.r > 1.6 ? b : a, fade);
      ctx.beginPath();
      ctx.arc(x, s.y * h, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    // Vignette + white flash at the end of the warp
    const vig = ctx.createRadialGradient(cx, h * 0.55, Math.min(w, h) * 0.3, cx, h * 0.55, Math.max(w, h) * 0.85);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
    if (warp > 0.6) {
      ctx.fillStyle = `rgba(255,255,255,${(warp - 0.6) / 0.4 * 0.9})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  #mountains(noise, horizon, height, fill, rim, drift) {
    const { ctx, w } = this;
    ctx.beginPath();
    ctx.moveTo(-w, horizon);
    const steps = 140;
    let lastY = horizon;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = -w * 0.1 + u * w * 1.2;
      // Leave a valley in the middle so the portal stays visible.
      const valley = Math.min(1, Math.abs(u - 0.5) * 3.2);
      const y = horizon - noise((u + drift) % 1) * height * (0.35 + 0.65 * valley);
      pts.push([x, y]);
      ctx.lineTo(x, y);
      lastY = y;
    }
    ctx.lineTo(w * 2, lastY);
    ctx.lineTo(w * 2, horizon + 2);
    ctx.lineTo(-w, horizon + 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // Rim light along the ridge
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = rim;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }
}
