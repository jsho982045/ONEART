import type { ToolId } from "./tools";

/**
 * The sound of each medium, synthesized live (no audio files), built the way the real sound is made:
 *
 *   friction   the continuous rub of the tool on canvas (filtered noise), brighter and louder the harder
 *              and faster you go
 *   grain      the tooth of the canvas: tiny clicks as graphite or charcoal skips over each thread, more of
 *              them the faster you move
 *   body       the low knock of the stretched canvas drumming against its frame under a loaded brush
 *   wet        for watercolor, the soft slosh of water moving in the hair
 *   room       a small, dry studio around all of it
 *
 * The tool touching down and lifting off have their own short sounds, and everything sits left or right
 * with where you are painting on the screen.
 */

type Voice = {
  frictionHz: number;
  frictionQ: number;
  friction: number;
  grain: number;
  grainHz: number;
  body: number;
  wet: number;
  touch: number;
};

const VOICES: Record<Exclude<ToolId, "text">, Voice> = {
  pencil: { frictionHz: 3800, frictionQ: 0.8, friction: 0.13, grain: 0.22, grainHz: 5200, body: 0.02, wet: 0, touch: 0.25 },
  charcoal: { frictionHz: 1700, frictionQ: 0.5, friction: 0.2, grain: 0.3, grainHz: 2600, body: 0.05, wet: 0, touch: 0.35 },
  ink: { frictionHz: 6400, frictionQ: 2.2, friction: 0.06, grain: 0.05, grainHz: 7500, body: 0.01, wet: 0.02, touch: 0.2 },
  oil: { frictionHz: 900, frictionQ: 0.45, friction: 0.24, grain: 0.04, grainHz: 1400, body: 0.18, wet: 0.05, touch: 0.45 },
  watercolor: { frictionHz: 600, frictionQ: 0.4, friction: 0.12, grain: 0, grainHz: 1000, body: 0.08, wet: 0.2, touch: 0.3 },
};

type Graph = {
  out: GainNode;
  pan: StereoPannerNode | null;
  friction: { src: AudioBufferSourceNode; band: BiquadFilterNode; gain: GainNode };
  grain: { src: AudioBufferSourceNode; gain: GainNode };
  body: { src: AudioBufferSourceNode; gain: GainNode };
  wet: { src: AudioBufferSourceNode; band: BiquadFilterNode; gain: GainNode };
};

export class PaintSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackle: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private g: Graph | null = null;
  private voice: Voice | null = null;
  private smoothSpeed = 0;
  enabled = true;

  /**
   * Builds the sound engine ahead of time. Call from any user gesture (browsers block audio until then).
   * The audio context is created inside the gesture; the noise itself is generated a moment later so the
   * tap that triggered this never waits for it.
   */
  prepare() {
    if (!this.ensure()) return;
    if (!this.noise) setTimeout(() => this.buildBuffers(), 0);
  }

  private buildBuffers() {
    const ctx = this.ctx;
    if (!ctx || this.noise) return;
    const sr = ctx.sampleRate;

    // White noise: friction.
    this.noise = ctx.createBuffer(1, sr * 2, sr);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

    // Sparse clicks of random size: the canvas tooth. Played faster when you move faster.
    this.crackle = ctx.createBuffer(1, sr * 2, sr);
    const c = this.crackle.getChannelData(0);
    for (let i = 0; i < c.length; i++) {
      if (Math.random() < 260 / sr) {
        const amp = 0.3 + Math.random() * 0.7;
        const len = 8 + Math.floor(Math.random() * 30);
        for (let k = 0; k < len && i + k < c.length; k++) c[i + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / (len * 0.3));
      }
    }

    // Brown noise: the low body of the canvas and the wash of water.
    this.brown = ctx.createBuffer(1, sr * 2, sr);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;
      const sr = ctx.sampleRate;
      // A small, dry room: a short decaying impulse.
      const room = ctx.createConvolver();
      const ir = ctx.createBuffer(2, Math.floor(sr * 0.32), sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) * 0.5;
      }
      room.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      master.connect(room).connect(wet).connect(ctx.destination);
      this.master = master;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    return s;
  }

  /** x is where on screen you're painting, 0 (left) to 1 (right). */
  start(tool: ToolId, pressure = 0.5, x = 0.5) {
    if (tool === "text") return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.buildBuffers();
    if (!this.noise || !this.crackle || !this.brown) return;
    this.stop(true);
    const v = VOICES[tool];
    this.voice = v;
    this.smoothSpeed = 0;

    const out = ctx.createGain();
    out.gain.value = 1;
    let pan: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === "function") {
      pan = ctx.createStereoPanner();
      pan.pan.value = (x - 0.5) * 0.9;
      out.connect(pan).connect(this.master);
    } else {
      out.connect(this.master);
    }

    const t = ctx.currentTime;
    const offset = () => Math.random() * 1.6;

    const fSrc = this.loop(this.noise);
    const fBand = ctx.createBiquadFilter();
    fBand.type = "bandpass";
    fBand.frequency.value = v.frictionHz;
    fBand.Q.value = v.frictionQ;
    const fGain = ctx.createGain();
    fGain.gain.value = 0;
    fSrc.connect(fBand).connect(fGain).connect(out);

    const gSrc = this.loop(this.crackle);
    const gHigh = ctx.createBiquadFilter();
    gHigh.type = "highpass";
    gHigh.frequency.value = v.grainHz;
    const gGain = ctx.createGain();
    gGain.gain.value = 0;
    gSrc.connect(gHigh).connect(gGain).connect(out);

    const bSrc = this.loop(this.brown);
    const bLow = ctx.createBiquadFilter();
    bLow.type = "lowpass";
    bLow.frequency.value = 220;
    const bGain = ctx.createGain();
    bGain.gain.value = 0;
    bSrc.connect(bLow).connect(bGain).connect(out);

    const wSrc = this.loop(this.brown);
    wSrc.playbackRate.value = 3.2;
    const wBand = ctx.createBiquadFilter();
    wBand.type = "bandpass";
    wBand.frequency.value = 1100;
    wBand.Q.value = 3;
    const wGain = ctx.createGain();
    wGain.gain.value = 0;
    wSrc.connect(wBand).connect(wGain).connect(out);

    for (const s of [fSrc, gSrc, bSrc, wSrc]) s.start(t, offset());
    this.g = {
      out,
      pan,
      friction: { src: fSrc, band: fBand, gain: fGain },
      grain: { src: gSrc, gain: gGain },
      body: { src: bSrc, gain: bGain },
      wet: { src: wSrc, band: wBand, gain: wGain },
    };
    this.tap(v.touch * (0.5 + pressure * 0.7), tool === "oil" || tool === "watercolor" ? 700 : 2400);
  }

  /** speed in CSS px per ms, pressure 0..1, x 0..1 across the screen */
  update(speed: number, pressure: number, x = 0.5) {
    const ctx = this.ctx;
    const g = this.g;
    const v = this.voice;
    if (!ctx || !g || !v) return;
    this.smoothSpeed += (speed - this.smoothSpeed) * 0.35;
    const sp = Math.min(1.6, this.smoothSpeed);
    const move = Math.pow(Math.min(1, sp / 1.2), 0.7);
    const press = 0.45 + 0.55 * pressure;
    const t = ctx.currentTime;
    g.friction.gain.gain.setTargetAtTime(v.friction * move * press, t, 0.03);
    g.friction.band.frequency.setTargetAtTime(v.frictionHz * (0.85 + 0.3 * pressure + 0.2 * sp), t, 0.05);
    g.grain.gain.gain.setTargetAtTime(v.grain * move * (0.6 + 0.4 * pressure), t, 0.02);
    g.grain.src.playbackRate.setTargetAtTime(0.35 + sp * 1.1, t, 0.05);
    g.body.gain.gain.setTargetAtTime(v.body * press * (0.3 + 0.7 * move), t, 0.06);
    g.wet.gain.gain.setTargetAtTime(v.wet * (0.4 + 0.6 * move), t, 0.08);
    g.wet.band.frequency.setTargetAtTime(800 + Math.random() * 900, t, 0.12);
    g.pan?.pan.setTargetAtTime((x - 0.5) * 0.9, t, 0.1);
  }

  stop(immediate = false) {
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g) return;
    const t = ctx.currentTime;
    const fade = immediate ? 0.005 : 0.07;
    g.out.gain.cancelScheduledValues(t);
    g.out.gain.setTargetAtTime(0, t, fade);
    for (const s of [g.friction.src, g.grain.src, g.body.src, g.wet.src]) {
      try {
        s.stop(t + (immediate ? 0.04 : 0.45));
      } catch {
        /* already stopped */
      }
    }
    if (!immediate && this.voice) this.tap(this.voice.touch * 0.35, 3000);
    this.g = null;
  }

  /** A short tap: the tool landing on (or leaving) the canvas. */
  private tap(level: number, hz: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || level <= 0) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = hz;
    f.Q.value = 1.2;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(level * 0.5, t + 0.004);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(f).connect(a).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.09);
  }
}
