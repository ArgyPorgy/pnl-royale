"use client";
// Game sounds, synthesized with Web Audio: nothing to download, nothing to license. On by default,
// muted with the speaker button, and the choice is remembered on this device.
import { useEffect, useState } from "react";

export type Sfx = "tick" | "tickHigh" | "cut" | "survive" | "out" | "win" | "start" | "trade" | "join" | "storm";

const KEY = "royale:sound";
let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let muted = false;
let loaded = false;
const subs = new Set<(m: boolean) => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    muted = localStorage.getItem(KEY) === "off";
  } catch {
    /* storage blocked: sound stays on */
  }
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "off" : "on");
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  subs.forEach((f) => f(m));
  if (!m) audio()?.resume().catch(() => undefined);
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(false);
  useEffect(() => {
    load();
    setM(muted);
    subs.add(setM);
    return () => {
      subs.delete(setM);
    };
  }, []);
  return [m, setMuted];
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bus = ctx.createGain();
    bus.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    bus.connect(comp);
    comp.connect(ctx.destination);
  }
  return ctx;
}

// Browsers start audio only after a tap or a key press; the first one anywhere unlocks it.
if (typeof window !== "undefined") {
  const unlock = () => audio()?.resume().catch(() => undefined);
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
}

type Tone = { f: number; to?: number; at?: number; dur: number; gain: number; type?: OscillatorType; lowpass?: number };
function tone(c: AudioContext, { f, to, at = 0, dur, gain, type = "sine", lowpass }: Tone) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = o;
  if (lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpass;
    o.connect(lp);
    node = lp;
  }
  node.connect(g);
  g.connect(bus!);
  o.start(t);
  o.stop(t + dur + 0.03);
}

type Noise = { at?: number; dur: number; gain: number; f: number; to?: number; filter?: BiquadFilterType; q?: number };
function noise(c: AudioContext, { at = 0, dur, gain, f, to, filter = "lowpass", q = 0.8 }: Noise) {
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bq = c.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f, t);
  if (to) bq.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bq);
  bq.connect(g);
  g.connect(bus!);
  src.start(t);
  src.stop(t + dur);
}

const C_MAJOR = [523.25, 659.25, 783.99, 1046.5];

const SOUNDS: Record<Sfx, (c: AudioContext) => void> = {
  tick: (c) => tone(c, { f: 1000, dur: 0.05, gain: 0.05, type: "square", lowpass: 3200 }),
  tickHigh: (c) => {
    tone(c, { f: 1480, dur: 0.08, gain: 0.08, type: "square", lowpass: 4200 });
    tone(c, { f: 740, dur: 0.08, gain: 0.05 });
  },
  cut: (c) => {
    tone(c, { f: 120, to: 36, dur: 0.6, gain: 0.7 });
    noise(c, { dur: 0.55, gain: 0.5, f: 900, to: 70 });
    tone(c, { f: 2600, to: 700, dur: 0.22, gain: 0.05, type: "triangle" });
  },
  survive: (c) => {
    tone(c, { f: 659.25, dur: 0.16, gain: 0.16, type: "triangle" });
    tone(c, { f: 987.77, at: 0.1, dur: 0.3, gain: 0.16, type: "triangle" });
    tone(c, { f: 1318.5, at: 0.2, dur: 0.35, gain: 0.05 });
  },
  out: (c) => {
    tone(c, { f: 392, to: 92, dur: 0.95, gain: 0.14, type: "sawtooth", lowpass: 1400 });
    tone(c, { f: 82, to: 38, dur: 0.7, gain: 0.55 });
    noise(c, { dur: 0.5, gain: 0.25, f: 420 });
  },
  win: (c) => {
    C_MAJOR.forEach((f, i) => {
      tone(c, { f, at: i * 0.11, dur: 0.26, gain: 0.15, type: "triangle" });
      tone(c, { f: f / 2, at: i * 0.11, dur: 0.2, gain: 0.04, type: "square", lowpass: 2000 });
    });
    C_MAJOR.forEach((f) => tone(c, { f, at: 0.48, dur: 1.3, gain: 0.06, type: "triangle" }));
    noise(c, { at: 0.46, dur: 0.9, gain: 0.05, f: 6000, filter: "highpass" });
  },
  start: (c) => {
    tone(c, { f: 180, to: 760, dur: 0.45, gain: 0.08, type: "sawtooth", lowpass: 2200 });
    noise(c, { dur: 0.45, gain: 0.08, f: 400, to: 5000, filter: "bandpass" });
    [440, 554.37, 659.25].forEach((f) => tone(c, { f, at: 0.45, dur: 0.6, gain: 0.09, type: "triangle" }));
  },
  trade: (c) => tone(c, { f: 1400, to: 700, dur: 0.06, gain: 0.08 }),
  join: (c) => {
    tone(c, { f: 987.77, dur: 0.09, gain: 0.06, type: "square", lowpass: 3500 });
    tone(c, { f: 1318.5, at: 0.08, dur: 0.24, gain: 0.06, type: "square", lowpass: 3500 });
  },
  storm: (c) => {
    noise(c, { dur: 1.3, gain: 0.3, f: 260, to: 1400, filter: "bandpass", q: 0.7 });
    tone(c, { f: 55, dur: 1.3, gain: 0.3 });
  },
};

const VIBRATE: Partial<Record<Sfx, number[]>> = { cut: [60], out: [120, 60, 180], win: [40, 40, 40, 40, 120], start: [30] };

export function sfx(name: Sfx) {
  load();
  if (muted) return;
  const c = audio();
  if (c && c.state !== "closed") {
    if (c.state === "suspended") c.resume().catch(() => undefined);
    try {
      SOUNDS[name](c);
    } catch {
      /* audio unavailable: the game goes on silently */
    }
  }
  const v = VIBRATE[name];
  if (v && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(v);
}
