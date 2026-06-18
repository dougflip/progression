import * as Tone from "tone";

// ── Instrument definitions ────────────────────────────────────────────────

interface Param {
  label: string;
  key: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals: number;
}

interface Instrument {
  label: string;
  params: Param[];
  build(params: Record<string, number>): { trigger(): void; dispose(): void };
}

const master = new Tone.Channel().toDestination();
master.volume.value = Tone.gainToDb(0.9);

function param(
  label: string,
  key: string,
  min: number,
  max: number,
  step: number,
  value: number,
  decimals = 3,
): Param {
  return { label, key, min, max, step, value, decimals };
}

const INSTRUMENTS: Instrument[] = [
  {
    label: "Kick",
    params: [
      param("Pitch decay", "pitchDecay", 0.001, 0.2, 0.001, 0.05),
      param("Octaves", "octaves", 1, 10, 0.5, 6),
      param("Decay", "decay", 0.1, 1.5, 0.01, 0.4, 2),
      param("Volume (dB)", "volume", -20, 0, 0.5, -4, 1),
    ],
    build(p) {
      const s = new Tone.MembraneSynth({
        pitchDecay: p["pitchDecay"]!,
        octaves: p["octaves"]!,
        envelope: { attack: 0.005, decay: p["decay"]!, sustain: 0, release: 1.4 },
      }).connect(master);
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("C1", "8n"),
        dispose: () => s.dispose(),
      };
    },
  },
  {
    label: "Snare",
    params: [
      param("Decay", "decay", 0.05, 0.5, 0.005, 0.15),
      param("Volume (dB)", "volume", -20, 0, 0.5, -10, 1),
    ],
    build(p) {
      const s = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.005, decay: p["decay"]!, sustain: 0 },
      }).connect(master);
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("16n"),
        dispose: () => s.dispose(),
      };
    },
  },
  {
    label: "Hat (closed)",
    params: [
      param("Decay", "decay", 0.01, 0.2, 0.005, 0.05),
      param("Frequency", "frequency", 100, 800, 10, 250, 0),
      param("Volume (dB)", "volume", -40, -10, 0.5, -28, 1),
    ],
    build(p) {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.002, decay: p["decay"]!, release: 0.01 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
      }).connect(master);
      s.frequency.value = p["frequency"]!;
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("32n", "32n"),
        dispose: () => s.dispose(),
      };
    },
  },
  {
    label: "Open Hat",
    params: [
      param("HP freq", "hpFreq", 1000, 12000, 100, 7000, 0),
      param("Decay", "decay", 0.1, 1.0, 0.01, 0.4, 2),
      param("Release", "release", 0.1, 1.5, 0.05, 0.5, 2),
      param("Volume (dB)", "volume", -30, 0, 0.5, -18, 1),
    ],
    build(p) {
      const f = new Tone.Filter({ type: "highpass", frequency: p["hpFreq"]!, Q: 0.5 }).connect(
        master,
      );
      const s = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: p["decay"]!, sustain: 0, release: p["release"]! },
      }).connect(f);
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("8n"),
        dispose: () => {
          s.dispose();
          f.dispose();
        },
      };
    },
  },
  {
    label: "Crash",
    params: [
      param("HP freq", "hpFreq", 1000, 10000, 100, 5000, 0),
      param("Decay", "decay", 0.3, 2.5, 0.05, 0.8, 2),
      param("Release", "release", 0.3, 3.0, 0.05, 1.2, 2),
      param("Volume (dB)", "volume", -30, 0, 0.5, -14, 1),
    ],
    build(p) {
      const f = new Tone.Filter({ type: "highpass", frequency: p["hpFreq"]!, Q: 0.5 }).connect(
        master,
      );
      const s = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: p["decay"]!, sustain: 0, release: p["release"]! },
      }).connect(f);
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("4n"),
        dispose: () => {
          s.dispose();
          f.dispose();
        },
      };
    },
  },
  {
    label: "Ride",
    params: [
      param("HP freq", "hpFreq", 1000, 10000, 100, 6000, 0),
      param("Decay", "decay", 0.05, 0.8, 0.01, 0.15, 2),
      param("Release", "release", 0.05, 0.8, 0.01, 0.2, 2),
      param("Volume (dB)", "volume", -30, 0, 0.5, -22, 1),
    ],
    build(p) {
      const f = new Tone.Filter({ type: "highpass", frequency: p["hpFreq"]!, Q: 0.5 }).connect(
        master,
      );
      const s = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: p["decay"]!, sustain: 0, release: p["release"]! },
      }).connect(f);
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("32n"),
        dispose: () => {
          s.dispose();
          f.dispose();
        },
      };
    },
  },
  {
    label: "Clap",
    params: [
      param("HP freq", "hpFreq", 500, 5000, 100, 1200, 0),
      param("Decay", "decay", 0.02, 0.3, 0.005, 0.06),
      param("Volume (dB)", "volume", -20, 0, 0.5, -12, 1),
    ],
    build(p) {
      const f = new Tone.Filter({ type: "highpass", frequency: p["hpFreq"]!, Q: 0.8 }).connect(
        master,
      );
      const s = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: p["decay"]!, sustain: 0, release: 0.1 },
      }).connect(f);
      s.volume.value = p["volume"]!;
      return {
        trigger: () => s.triggerAttackRelease("16n"),
        dispose: () => {
          s.dispose();
          f.dispose();
        },
      };
    },
  },
  {
    label: "Tom 1",
    params: [
      param("Pitch", "pitch", 40, 200, 1, 55, 0),
      param("Pitch decay", "pitchDecay", 0.001, 0.15, 0.001, 0.025),
      param("Octaves", "octaves", 1, 6, 0.5, 3, 1),
      param("Decay", "decay", 0.1, 1.0, 0.01, 0.3, 2),
      param("Volume (dB)", "volume", -20, 0, 0.5, -4, 1),
    ],
    build(p) {
      const s = new Tone.MembraneSynth({
        pitchDecay: p["pitchDecay"]!,
        octaves: p["octaves"]!,
        envelope: { attack: 0.0006, decay: p["decay"]!, sustain: 0, release: 0.8 },
      }).connect(master);
      s.volume.value = p["volume"]!;
      const note = Tone.Frequency(p["pitch"]!, "midi").toNote();
      return {
        trigger: () => s.triggerAttackRelease(note, "8n"),
        dispose: () => s.dispose(),
      };
    },
  },
  {
    label: "Tom 2",
    params: [
      param("Pitch", "pitch", 40, 200, 1, 62, 0),
      param("Pitch decay", "pitchDecay", 0.001, 0.15, 0.001, 0.025),
      param("Octaves", "octaves", 1, 6, 0.5, 3, 1),
      param("Decay", "decay", 0.1, 1.0, 0.01, 0.3, 2),
      param("Volume (dB)", "volume", -20, 0, 0.5, -4, 1),
    ],
    build(p) {
      const s = new Tone.MembraneSynth({
        pitchDecay: p["pitchDecay"]!,
        octaves: p["octaves"]!,
        envelope: { attack: 0.0006, decay: p["decay"]!, sustain: 0, release: 0.8 },
      }).connect(master);
      s.volume.value = p["volume"]!;
      const note = Tone.Frequency(p["pitch"]!, "midi").toNote();
      return {
        trigger: () => s.triggerAttackRelease(note, "8n"),
        dispose: () => s.dispose(),
      };
    },
  },
];

// ── State ─────────────────────────────────────────────────────────────────

let selectedIndex = -1;
let currentValues: Record<string, number> = {};
let currentSynth: { trigger(): void; dispose(): void } | null = null;

function rebuildSynth(instrument: Instrument) {
  currentSynth?.dispose();
  currentSynth = instrument.build(currentValues);
}

// ── DOM ───────────────────────────────────────────────────────────────────

const grid = document.getElementById("pad-grid")!;
const paramsEl = document.getElementById("params")!;

const pads: HTMLButtonElement[] = INSTRUMENTS.map((inst, i) => {
  const btn = document.createElement("button");
  btn.className = "pad";
  btn.textContent = inst.label;

  btn.addEventListener("click", async () => {
    await Tone.start();
    // flash
    btn.classList.add("flash");
    setTimeout(() => btn.classList.remove("flash"), 120);

    if (selectedIndex === i) {
      currentSynth?.trigger();
      return;
    }

    // select
    pads.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    selectedIndex = i;

    // init param values from defaults
    currentValues = Object.fromEntries(inst.params.map((p) => [p.key, p.value]));
    rebuildSynth(inst);
    currentSynth!.trigger();
    renderParams(inst);
  });

  grid.appendChild(btn);
  return btn;
});

function renderParams(instrument: Instrument) {
  paramsEl.innerHTML = `<h2>${instrument.label} — Parameters</h2>`;

  for (const p of instrument.params) {
    const row = document.createElement("div");
    row.className = "param-row";

    const label = document.createElement("label");
    label.textContent = p.label;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(p.min);
    slider.max = String(p.max);
    slider.step = String(p.step);
    slider.value = String(currentValues[p.key] ?? p.value);

    const valEl = document.createElement("span");
    valEl.className = "val";
    valEl.textContent = Number(slider.value).toFixed(p.decimals);

    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      currentValues[p.key] = v;
      valEl.textContent = v.toFixed(p.decimals);
      rebuildSynth(instrument);
    });

    row.append(label, slider, valEl);
    paramsEl.appendChild(row);
  }
}
