// Synthesized UI sounds (no audio files needed).

class Sound {
  constructor() {
    this.enabled = true;
    this.volume = 0.6;
    this.ctx = null;
    this.lastMove = 0;
  }

  #ctx() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    this.master.gain.value = this.volume * 0.5;
    return this.ctx;
  }

  unlock() { if (this.enabled) this.#ctx(); }

  #tone({ freq = 440, to = null, type = "sine", dur = 0.08, gain = 0.3, delay = 0, attack = 0.005 }) {
    const ctx = this.#ctx();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.enabled || this.volume <= 0) return;
    switch (name) {
      case "move": {
        const now = performance.now();
        if (now - this.lastMove < 45) return; // avoid buzzing on fast repeats
        this.lastMove = now;
        this.#tone({ freq: 1800, type: "sine", dur: 0.035, gain: 0.12 });
        break;
      }
      case "select":
        this.#tone({ freq: 660, to: 990, type: "triangle", dur: 0.09, gain: 0.25 });
        this.#tone({ freq: 1320, type: "sine", dur: 0.08, gain: 0.08, delay: 0.04 });
        break;
      case "back":
        this.#tone({ freq: 700, to: 420, type: "triangle", dur: 0.1, gain: 0.22 });
        break;
      case "tab":
        this.#tone({ freq: 520, to: 780, type: "sine", dur: 0.07, gain: 0.18 });
        break;
      case "toggle":
        this.#tone({ freq: 880, type: "square", dur: 0.04, gain: 0.06 });
        this.#tone({ freq: 1320, type: "sine", dur: 0.06, gain: 0.12, delay: 0.035 });
        break;
      case "error":
        this.#tone({ freq: 220, type: "sawtooth", dur: 0.12, gain: 0.12 });
        this.#tone({ freq: 180, type: "sawtooth", dur: 0.16, gain: 0.12, delay: 0.1 });
        break;
      case "open":
        this.#tone({ freq: 440, to: 880, type: "sine", dur: 0.16, gain: 0.18 });
        break;
      case "launch":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.#tone({ freq: f, type: "triangle", dur: 0.5, gain: 0.16, delay: i * 0.07, attack: 0.02 }));
        this.#tone({ freq: 130, to: 65, type: "sine", dur: 0.6, gain: 0.35 });
        break;
      case "boot":
        [261.63, 392, 523.25, 783.99].forEach((f, i) =>
          this.#tone({ freq: f, type: "sine", dur: 0.9, gain: 0.12, delay: i * 0.12, attack: 0.05 }));
        break;
      case "notify":
        this.#tone({ freq: 988, type: "sine", dur: 0.1, gain: 0.15 });
        this.#tone({ freq: 1319, type: "sine", dur: 0.16, gain: 0.15, delay: 0.09 });
        break;
    }
  }
}

export const sound = new Sound();
