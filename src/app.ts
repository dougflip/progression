import {
  makeProgressionPlayer,
  serializeUrl,
  STYLE_OPTIONS,
  type StyleOption,
  STYLE_LABELS,
  BASS_OPTIONS,
  type BassOption,
  BASS_LABELS,
  DRUM_OPTIONS,
  type DrumOption,
  DRUM_LABELS,
  VOICING_OPTIONS,
  type VoicingOption,
  VOICING_PILL_LABELS,
  CYCLE_OPTIONS,
  CYCLE_LABELS,
  BARS_OPTIONS,
  PRESETS,
  tokenize,
  parseToken,
  resolvePlayOrder,
  VALID_KEYS,
  getShiftsForCycle,
  resolvedKeyName,
  getResolvedChipNames,
  isAbsoluteChord,
  type AppState,
  type MixSettings,
  type UserPreset,
  type ChordTickEvent,
} from "./progression-core.js";
import { makeProgressionAudio } from "./progression-audio.js";

// ── App instance ────────────────────────────────────────────────────────

const audio = makeProgressionAudio();

const app = makeProgressionPlayer({
  audio,
  persist: (key, value) => localStorage.setItem(key, value),
  load: (key) => localStorage.getItem(key),
  onStateChange: render,
  onPlaybackChange: onPlaybackChange,
  onChordTick: onChordTick,
  onBeatTick: onBeatTick,
  onBarTick: onBarTick,
  onError: (msg) => {
    statusEl.textContent = msg;
  },
});

// ── DOM refs ────────────────────────────────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const keyNoteBtnEl = $("key-note-btn") as HTMLButtonElement;
const keyPickerEl = $("key-picker") as HTMLDivElement;
const stripEl = $("chord-strip") as HTMLDivElement;
const statusEl = $("status") as HTMLElement;
const playBtn = $("play") as HTMLButtonElement;
const stopBtn = $("stop-btn") as HTMLButtonElement;
const keySelectEl = $("key-select") as HTMLSelectElement;
const tempoSliderEl = $("tempo-slider") as HTMLInputElement;
const tempoDisplayEl = $("tempo-display") as HTMLElement;
const arrangementEl = $("arrangement") as HTMLInputElement;
const sectionRowsEl = $("section-rows") as HTMLDivElement;
const sectionCountEl = $("section-count-label") as HTMLElement;
const addSectionEl = $("add-section") as HTMLButtonElement;
const userPresetsEl = $("user-presets") as HTMLDivElement;
const scrubberBar = $("scrubber-bar") as HTMLDivElement;
const scrubberTrack = $("scrubber-track") as HTMLDivElement;
const readoutTempoEl = $("readout-tempo") as HTMLElement;
const readoutStyleEl = $("readout-style") as HTMLButtonElement;
const readoutBassEl = $("readout-bass") as HTMLButtonElement;
const readoutDrumsEl = $("readout-drums") as HTMLButtonElement;
const readoutVoicingEl = $("readout-voicing") as HTMLButtonElement;
const readoutBarsEl = $("readout-bars") as HTMLButtonElement;
const readoutCycleEl = $("readout-cycle") as HTMLButtonElement;
const readoutAdvanceEl = $("readout-advance") as HTMLButtonElement;
const keyScrubberBar = $("key-scrubber-bar") as HTMLDivElement;
const keyScrubberTrack = $("key-scrubber-track") as HTMLDivElement;
const customKeysEditorEl = $("custom-keys-editor") as HTMLDivElement;
const customKeyPickerEl = $("custom-key-picker") as HTMLDivElement;
const customKeyRowsEl = $("custom-key-rows") as HTMLDivElement;
const chordVolEl = $("chord-vol") as HTMLInputElement;
const bassVolEl = $("bass-vol") as HTMLInputElement;
const drumVolEl = $("drum-vol") as HTMLInputElement;
const masterVolEl = $("master-vol") as HTMLInputElement;
const chordsOnEl = $("chords-on") as HTMLInputElement;
const bassOnEl = $("bass-on") as HTMLInputElement;
const drumsOnEl = $("drums-on") as HTMLInputElement;
const keepAwakeEl = $("keep-awake") as HTMLInputElement;

// ── Render ──────────────────────────────────────────────────────────────

function render(state: AppState): void {
  renderChips(state);
  renderReadout(state);
  renderSectionRows(state);
  renderScrubber(state);
  renderKeyScrubber(state);
  renderMix(state);
  syncUrl(state);
}

function renderChips(state: AppState): void {
  const progStr = state.sections[state.activeSection - 1]?.progression ?? "";
  const tokens = tokenize(progStr);
  buildChipStructure(tokens);
  updateChipNames(getResolvedChipNames(state, _currentLapIndex));
  keyNoteBtnEl.textContent = _currentScrubKey ?? state.playback.key;
  keySelectEl.value = state.playback.key;
  keyPickerEl
    .querySelectorAll<HTMLElement>(".key-chip")
    .forEach((b) =>
      b.classList.toggle(
        "active",
        (b as HTMLElement & { dataset: DOMStringMap }).dataset["key"] === state.playback.key,
      ),
    );
}

function buildChipStructure(tokens: string[]): void {
  const activeIdx = [...stripEl.querySelectorAll(".chip")].findIndex((c) =>
    c.classList.contains("active"),
  );
  stripEl.innerHTML = "";
  tokens.forEach((token) => {
    const { numeral, bars } = parseToken(token, 0);
    const displayToken = token.includes(":") ? `${numeral}:${bars}` : numeral;
    const isAbsolute = isAbsoluteChord(numeral);
    const chip = document.createElement("div");
    chip.className = "chip";
    if (!isAbsolute) {
      chip.appendChild(
        Object.assign(document.createElement("div"), {
          className: "numeral",
          textContent: displayToken,
        }),
      );
    }
    chip.appendChild(Object.assign(document.createElement("div"), { className: "name" }));
    chip.appendChild(Object.assign(document.createElement("div"), { className: "bar-progress" }));
    stripEl.appendChild(chip);
  });
  if (activeIdx >= 0) setActiveChip(activeIdx);
}

function updateChipNames(names: string[]): void {
  stripEl.querySelectorAll<HTMLElement>(".chip .name").forEach((el, i) => {
    if (names[i] !== undefined) el.textContent = names[i]!;
  });
}

function setActiveChip(index: number): void {
  stripEl.querySelectorAll(".chip").forEach((c, i) => c.classList.toggle("active", i === index));
}

function clearActiveChip(): void {
  setActiveChip(-1);
}

// ── Beat / bar progress helpers ─────────────────────────────────────────

const beatDots = document.querySelectorAll<HTMLElement>(".beat-dot");

function onBeatTick(beat: number): void {
  if (!audio.isPlaying()) return;
  beatDots.forEach((d, i) => d.classList.toggle("active", i === beat));
}

function clearBeats(): void {
  beatDots.forEach((d) => d.classList.remove("active"));
}

function activeBarProgress(): Element | null {
  const active = stripEl.querySelector(".chip.active");
  return active?.querySelector(".bar-progress") ?? null;
}

function renderBarDots(count: number, activeBar: number): void {
  clearBars();
  if (count <= 1) return;
  const bp = activeBarProgress();
  if (!bp) return;
  for (let i = 0; i < count; i++) {
    bp.appendChild(
      Object.assign(document.createElement("span"), {
        className: "bar-dot" + (i === activeBar ? " active" : ""),
      }),
    );
  }
}

function onBarTick(bar: number): void {
  if (!audio.isPlaying()) return;
  const bp = activeBarProgress();
  if (!bp) return;
  Array.from(bp.children).forEach((d, i) => d.classList.toggle("active", i === bar));
}

function clearBars(): void {
  stripEl.querySelectorAll(".bar-progress").forEach((bp) => {
    bp.innerHTML = "";
  });
}

// ── Scrubber current position ───────────────────────────────────────────

function centerActiveSegment(
  track: Element,
  seg: Element | null,
  behavior: ScrollBehavior = "smooth",
): void {
  if (!seg) return;
  const trackRect = track.getBoundingClientRect();
  const segRect = seg.getBoundingClientRect();
  (track as HTMLElement).scrollTo({
    left:
      (track as HTMLElement).scrollLeft +
      segRect.left -
      trackRect.left -
      trackRect.width / 2 +
      segRect.width / 2,
    behavior,
  });
}

function setScrubberCurrent(posIndex: number): void {
  const pendingJump = app.getPendingJump();
  let activeSeg: Element | null = null;
  scrubberTrack.querySelectorAll<HTMLElement>(".scrubber-seg").forEach((seg) => {
    const sp = parseInt(seg.dataset["posIndex"] ?? "", 10);
    const isCurrent = sp === posIndex;
    seg.classList.toggle("current", isCurrent);
    seg.classList.toggle("queued", sp === pendingJump && sp !== posIndex);
    if (isCurrent) activeSeg = seg;
  });
  centerActiveSegment(scrubberTrack, activeSeg);
}

// ── Audio timing callbacks (fast path — no onStateChange) ───────────────

function onChordTick({
  chipIndex,
  posIndex,
  sectionChanged,
  resolvedChipNames,
  resolvedKey,
  bars,
  sectionTokens,
  lapIndex,
}: ChordTickEvent): void {
  _currentScrubPosIndex = posIndex;
  _currentScrubKey = resolvedKey;
  _currentLapIndex = lapIndex;
  if (sectionChanged && sectionTokens) {
    buildChipStructure(sectionTokens);
  }
  setActiveChip(chipIndex);
  updateChipNames(resolvedChipNames);
  keyNoteBtnEl.textContent = resolvedKey;
  const pendingKeyJump = app.getPendingKeyJump();
  let activeKeySeg: Element | null = null;
  keyScrubberTrack.querySelectorAll<HTMLElement>(".scrubber-seg").forEach((seg) => {
    const ki = parseInt(seg.dataset["keyIndex"] ?? "", 10);
    const isCurrent = seg.textContent === resolvedKey;
    seg.classList.toggle("current", isCurrent);
    seg.classList.toggle("queued", ki === pendingKeyJump && !isCurrent);
    if (isCurrent) activeKeySeg = seg;
  });
  centerActiveSegment(keyScrubberTrack, activeKeySeg);
  setScrubberCurrent(posIndex);
  renderBarDots(bars, 0);
}

function renderReadout(state: AppState): void {
  readoutTempoEl.textContent = String(state.playback.tempo);
  tempoDisplayEl.textContent = `${state.playback.tempo} BPM`;
  readoutStyleEl.textContent =
    STYLE_LABELS[state.playback.style as StyleOption] ?? state.playback.style;
  readoutStyleEl.setAttribute("aria-label", `Style: ${state.playback.style}`);
  readoutBassEl.textContent = BASS_LABELS[state.playback.bass as BassOption] ?? state.playback.bass;
  readoutBassEl.setAttribute("aria-label", `Bass: ${state.playback.bass}`);
  readoutDrumsEl.textContent =
    DRUM_LABELS[state.playback.drums as DrumOption] ?? state.playback.drums;
  readoutDrumsEl.setAttribute("aria-label", `Drums: ${state.playback.drums}`);
  readoutVoicingEl.textContent =
    VOICING_PILL_LABELS[state.playback.voicing as VoicingOption] ?? state.playback.voicing;
  readoutVoicingEl.setAttribute("aria-label", `Voicing: ${state.playback.voicing}`);
  readoutBarsEl.textContent = `‖ ${state.playback.bars} ${state.playback.bars === 1 ? "bar" : "bars"}`;
  readoutBarsEl.setAttribute("aria-label", `Bars: ${state.playback.bars}`);
  readoutCycleEl.textContent = CYCLE_LABELS[state.playback.cycle] ?? state.playback.cycle;
  readoutCycleEl.setAttribute("aria-label", `Loop: ${state.playback.cycle}`);
  readoutAdvanceEl.textContent = state.playback.advance === "manual" ? "⏭️ Manual" : "⏭️ Auto";
  readoutAdvanceEl.setAttribute("aria-label", `Advance: ${state.playback.advance}`);

  const isCustom = state.playback.cycle === "custom";
  customKeysEditorEl.hidden = !isCustom;
  if (isCustom) renderCustomCycleEditor(state);

  if (document.activeElement !== tempoSliderEl) tempoSliderEl.value = String(state.playback.tempo);

  document
    .querySelectorAll<HTMLElement>("[data-bars]")
    .forEach((btn) =>
      btn.classList.toggle(
        "active",
        parseInt(btn.dataset["bars"] ?? "", 10) === state.playback.bars,
      ),
    );
  document
    .querySelectorAll<HTMLElement>("[data-cycle]")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset["cycle"] === state.playback.cycle),
    );
  document
    .querySelectorAll<HTMLElement>("[data-style]")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset["style"] === state.playback.style),
    );
  document
    .querySelectorAll<HTMLElement>("[data-bass]")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset["bass"] === state.playback.bass));
  document
    .querySelectorAll<HTMLElement>("[data-drums]")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset["drums"] === state.playback.drums),
    );
  document
    .querySelectorAll<HTMLElement>("[data-voicing]")
    .forEach((btn) =>
      btn.classList.toggle("active", btn.dataset["voicing"] === state.playback.voicing),
    );
}

function renderSectionRows(state: AppState): void {
  const { sections, activeSection } = state;
  const playing = audio.isPlaying();
  const existing = sectionRowsEl.querySelectorAll<HTMLElement>(".section-row");

  if (existing.length !== sections.length) {
    sectionRowsEl.innerHTML = "";
    sections.forEach((_, i) => sectionRowsEl.appendChild(makeSectionRow(i, state)));
  } else {
    existing.forEach((row, i) => {
      const numEl = row.querySelector<HTMLElement>(".section-num")!;
      numEl.className = "section-num" + (activeSection === i + 1 ? " active-section" : "");
      numEl.textContent = String(i + 1);
      const inp = row.querySelector<HTMLInputElement>(".section-prog-input")!;
      if (document.activeElement !== inp) inp.value = sections[i]?.progression ?? "";
      inp.disabled = playing;
      const buttons = row.querySelectorAll<HTMLButtonElement>(".icon-btn");
      const upBtn = buttons[0]!;
      const downBtn = buttons[1]!;
      const delBtn = buttons[2]!;
      upBtn.disabled = playing || i === 0;
      downBtn.disabled = playing || i === sections.length - 1;
      delBtn.disabled = playing || sections.length <= 1;
    });
  }

  addSectionEl.disabled = playing || sections.length >= 6;
  if (document.activeElement !== arrangementEl) arrangementEl.value = state.arrangement;
  arrangementEl.disabled = playing;
  sectionCountEl.textContent = `(${sections.length} of 6)`;
}

// Last known scrubber position — used to restore .current after DOM rebuild
let _currentScrubPosIndex: number | null = null;
let _currentScrubKey: string | null = null;
let _currentLapIndex = 0;

function renderScrubber(state: AppState): void {
  const order = resolvePlayOrder(state.sections, state.arrangement);
  if (order.length < 2) {
    scrubberBar.hidden = true;
    readoutAdvanceEl.hidden = true;
    syncBodyPadding();
    return;
  }
  scrubberBar.hidden = false;
  readoutAdvanceEl.hidden = false;
  scrubberTrack.innerHTML = "";
  order.forEach((sectionRef, posIndex) => {
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "scrubber-seg";
    if (posIndex === _currentScrubPosIndex) seg.classList.add("current");
    seg.textContent = String(sectionRef);
    seg.dataset["posIndex"] = String(posIndex);
    seg.addEventListener("click", () => handleScrubberTap(posIndex));
    scrubberTrack.appendChild(seg);
  });
  syncBodyPadding();
}

function renderKeyScrubber(state: AppState): void {
  if (state.playback.cycle === "none") {
    keyScrubberBar.hidden = true;
    syncBodyPadding();
    return;
  }
  const shifts = getShiftsForCycle(state.playback.cycle, state.playback.customCycleKeys);
  const keys = shifts.map((s) => resolvedKeyName(state.playback.key, s, state.playback.cycle));
  if (keys.length < 2) {
    keyScrubberBar.hidden = true;
    syncBodyPadding();
    return;
  }
  keyScrubberBar.hidden = false;
  keyScrubberTrack.innerHTML = "";
  keys.forEach((keyName, i) => {
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "scrubber-seg";
    if (keyName === _currentScrubKey) seg.classList.add("current");
    seg.textContent = keyName;
    seg.dataset["keyIndex"] = String(i);
    seg.addEventListener("click", () => handleKeySegmentTap(i));
    keyScrubberTrack.appendChild(seg);
  });
  syncBodyPadding();
}

function handleKeySegmentTap(lapIndex: number): void {
  if (!audio.isPlaying()) {
    const state = app.getState();
    const shifts = getShiftsForCycle(state.playback.cycle, state.playback.customCycleKeys);
    _currentLapIndex = lapIndex;
    _currentScrubKey = resolvedKeyName(
      state.playback.key,
      shifts[lapIndex] ?? 0,
      state.playback.cycle,
    );
    app.seekToLap(lapIndex);
    return;
  }
  if (app.getPendingKeyJump() === lapIndex) {
    app.cancelKeyJump();
    keyScrubberTrack.querySelectorAll(".scrubber-seg").forEach((s) => s.classList.remove("queued"));
    return;
  }
  app.queueKeyJump(lapIndex);
  keyScrubberTrack.querySelectorAll<HTMLElement>(".scrubber-seg").forEach((seg) => {
    const ki = parseInt(seg.dataset["keyIndex"] ?? "", 10);
    seg.classList.toggle("queued", ki === lapIndex && !seg.classList.contains("current"));
  });
}

function handleScrubberTap(posIndex: number): void {
  if (!audio.isPlaying()) {
    _currentScrubPosIndex = posIndex;
    app.seekToPos(posIndex);
    return;
  }
  // Cancel if tapping the queued segment again
  if (app.getPendingJump() === posIndex) {
    app.cancelJump();
    scrubberTrack.querySelectorAll(".scrubber-seg").forEach((s) => s.classList.remove("queued"));
    return;
  }
  app.queueJump(posIndex);
  scrubberTrack.querySelectorAll<HTMLElement>(".scrubber-seg").forEach((seg) => {
    const sp = parseInt(seg.dataset["posIndex"] ?? "", 10);
    seg.classList.toggle("queued", sp === posIndex && !seg.classList.contains("current"));
  });
}

function renderMix(state: AppState): void {
  const ae = document.activeElement;
  if (ae !== chordVolEl) chordVolEl.value = String(state.mix.chordVol);
  if (ae !== bassVolEl) bassVolEl.value = String(state.mix.bassVol);
  if (ae !== drumVolEl) drumVolEl.value = String(state.mix.drumVol);
  if (ae !== masterVolEl) masterVolEl.value = String(state.mix.masterVol);
  ($("chord-vol-val") as HTMLElement).textContent = String(state.mix.chordVol);
  ($("bass-vol-val") as HTMLElement).textContent = String(state.mix.bassVol);
  ($("drum-vol-val") as HTMLElement).textContent = String(state.mix.drumVol);
  ($("master-vol-val") as HTMLElement).textContent = String(state.mix.masterVol);
  chordsOnEl.checked = state.mix.chordsOn;
  bassOnEl.checked = state.mix.bassOn;
  drumsOnEl.checked = state.mix.drumsOn;
}

function makeSectionRow(index: number, state: AppState): HTMLDivElement {
  const { sections, activeSection } = state;
  const playing = audio.isPlaying();
  const row = document.createElement("div");
  row.className = "section-row";

  const num = document.createElement("div");
  num.className = "section-num" + (activeSection === index + 1 ? " active-section" : "");
  num.textContent = String(index + 1);

  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "section-prog-input";
  inp.value = sections[index]?.progression ?? "";
  inp.setAttribute("autocomplete", "off");
  inp.setAttribute("autocapitalize", "off");
  inp.setAttribute("autocorrect", "off");
  inp.spellcheck = false;
  inp.disabled = playing;
  inp.addEventListener("focus", () => {
    sectionRowsEl
      .querySelectorAll<HTMLElement>(".section-num")
      .forEach((n, j) => n.classList.toggle("active-section", j === index));
  });
  inp.addEventListener("input", () => app.updateSection(index, inp.value));

  const upBtn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "icon-btn",
    textContent: "↑",
    disabled: playing || index === 0,
  });
  upBtn.addEventListener("click", () => app.moveSection(index, "up"));

  const downBtn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "icon-btn",
    textContent: "↓",
    disabled: playing || index === sections.length - 1,
  });
  downBtn.addEventListener("click", () => app.moveSection(index, "down"));

  const delBtn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "icon-btn",
    textContent: "×",
    disabled: playing || sections.length <= 1,
  });
  delBtn.addEventListener("click", () => app.removeSection(index));

  row.append(num, inp, upBtn, downBtn, delBtn);
  return row;
}

function renderUserPresets(focusId: string | null = null): void {
  userPresetsEl.innerHTML = "";
  const list = app.getUserPresets();
  if (!list.length) {
    userPresetsEl.appendChild(
      Object.assign(document.createElement("div"), {
        className: "empty-presets",
        textContent: "No saved presets yet.",
      }),
    );
    return;
  }
  list.forEach((p) => {
    const row = document.createElement("div");
    row.className = "user-preset-row";

    const nameBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "preset-btn user-preset-name",
      textContent: p.name,
    });
    nameBtn.addEventListener("click", () => app.loadPreset(p.state));

    const editBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "icon-btn",
      textContent: "✎",
    });
    editBtn.setAttribute("aria-label", `Rename ${p.name}`);
    editBtn.addEventListener("click", () => enterRename(row, p));

    const delBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "icon-btn",
      textContent: "×",
    });
    delBtn.setAttribute("aria-label", `Delete ${p.name}`);
    delBtn.addEventListener("click", () => {
      app.deleteUserPreset(p.id);
      renderUserPresets();
    });

    row.append(nameBtn, editBtn, delBtn);
    userPresetsEl.appendChild(row);
    if (focusId === p.id) enterRename(row, p);
  });
}

function enterRename(row: HTMLDivElement, preset: UserPreset): void {
  row.innerHTML = "";
  const inp = Object.assign(document.createElement("input"), {
    type: "text",
    className: "rename-input",
    value: preset.name,
    autocomplete: "off",
    spellcheck: false,
  });
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    app.renameUserPreset(preset.id, inp.value.trim() || preset.name);
    renderUserPresets();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    renderUserPresets();
  };
  inp.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  inp.addEventListener("blur", commit);
  row.appendChild(inp);
  inp.focus();
  inp.select();
}

// ── Theme ────────────────────────────────────────────────────────────────

function applyTheme(t: string): void {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
  document
    .querySelectorAll<HTMLElement>("[data-theme-opt]")
    .forEach((b) => b.classList.toggle("active", b.dataset["themeOpt"] === t));
}

// ── Playback change ──────────────────────────────────────────────────────

const PAUSE_ICON =
  '<svg width="17" height="20" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="6" height="20" rx="1.5"/><rect x="11" y="0" width="6" height="20" rx="1.5"/></svg>';

function onPlaybackChange(playing: boolean): void {
  stopBtn.hidden = !app.isPaused();
  playBtn.innerHTML = playing ? PAUSE_ICON : "▶";
  playBtn.classList.toggle("playing", playing);
  playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  if (playing) {
    statusEl.textContent = "";
    if (keepAwakeEl.checked) void acquireWakeLock();
  } else if (app.isPaused()) {
    void releaseWakeLock();
    clearBeats();
    clearBars();
    scrubberTrack.querySelectorAll(".scrubber-seg").forEach((s) => s.classList.remove("queued"));
    keyScrubberTrack.querySelectorAll(".scrubber-seg").forEach((s) => s.classList.remove("queued"));
  } else {
    void releaseWakeLock();
    clearActiveChip();
    clearBeats();
    clearBars();
    _currentScrubPosIndex = null;
    _currentScrubKey = null;
    _currentLapIndex = 0;
    statusEl.textContent = "";
    scrubberTrack
      .querySelectorAll(".scrubber-seg")
      .forEach((s) => s.classList.remove("current", "queued"));
    keyScrubberTrack
      .querySelectorAll(".scrubber-seg")
      .forEach((s) => s.classList.remove("current", "queued"));
    renderChips(app.getState());
  }
}

// ── Wake lock ────────────────────────────────────────────────────────────

let _wakeLock: WakeLockSentinel | null = null;
async function acquireWakeLock(): Promise<void> {
  if (_wakeLock || !("wakeLock" in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request("screen");
    _wakeLock.addEventListener("release", () => {
      _wakeLock = null;
    });
  } catch (e) {
    console.warn("Wake lock failed:", (e as Error).message);
  }
}
async function releaseWakeLock(): Promise<void> {
  if (!_wakeLock) return;
  try {
    await _wakeLock.release();
  } catch {
    /* ignore */
  }
  _wakeLock = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && keepAwakeEl.checked && audio.isPlaying()) {
    void acquireWakeLock();
  }
});

// ── UI helpers ───────────────────────────────────────────────────────────

function syncBodyPadding(): void {
  const bar = $("action-bar");
  if (bar) document.body.style.paddingBottom = bar.offsetHeight + "px";
}

let _urlTimer: ReturnType<typeof setTimeout> | null = null;
function syncUrl(state: AppState): void {
  clearTimeout(_urlTimer ?? undefined);
  _urlTimer = setTimeout(() => {
    history.replaceState(null, "", "?" + serializeUrl(state));
  }, 200);
}

// ── Key picker ───────────────────────────────────────────────────────────

(["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const).forEach((k) => {
  const btn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "key-chip",
    textContent: k,
  });
  btn.dataset["key"] = k;
  btn.addEventListener("click", () => {
    app.setPlayback({ key: k });
    keyPickerEl.hidden = true;
  });
  keyPickerEl.appendChild(btn);
});

keyNoteBtnEl.addEventListener("click", () => {
  keyPickerEl.hidden = !keyPickerEl.hidden;
});
document.addEventListener("click", (e: MouseEvent) => {
  if (keyPickerEl.hidden) return;
  if (keyNoteBtnEl.contains(e.target as Node) || keyPickerEl.contains(e.target as Node)) return;
  keyPickerEl.hidden = true;
});

// ── Tempo picker ─────────────────────────────────────────────────────────

const tempoPickerEl = $("tempo-picker") as HTMLDivElement;
const tempoQuickEl = $("tempo-quick") as HTMLInputElement;

($("tempo-toggle") as HTMLButtonElement).addEventListener("click", () => {
  if (tempoPickerEl.hidden) {
    tempoQuickEl.value = String(app.getState().playback.tempo);
    tempoPickerEl.hidden = false;
  } else tempoPickerEl.hidden = true;
});
tempoQuickEl.addEventListener("input", () =>
  app.setPlayback({ tempo: Math.max(40, Math.min(220, parseInt(tempoQuickEl.value, 10))) }),
);
($("tempo-down") as HTMLButtonElement).addEventListener("click", () =>
  app.setPlayback({ tempo: Math.max(40, app.getState().playback.tempo - 1) }),
);
($("tempo-up") as HTMLButtonElement).addEventListener("click", () =>
  app.setPlayback({ tempo: Math.min(220, app.getState().playback.tempo + 1) }),
);
document.addEventListener("click", (e: MouseEvent) => {
  if (tempoPickerEl.hidden) return;
  if (
    ($("tempo-toggle") as HTMLElement).contains(e.target as Node) ||
    tempoPickerEl.contains(e.target as Node)
  )
    return;
  tempoPickerEl.hidden = true;
});

tempoSliderEl.addEventListener("input", () =>
  app.setPlayback({ tempo: parseInt(tempoSliderEl.value, 10) }),
);

// ── Tap tempo ─────────────────────────────────────────────────────────────

let _taps: number[] = [];
let _tapTimer: ReturnType<typeof setTimeout> | null = null;

function handleTap(btn: HTMLElement): void {
  const now = Date.now();
  if (_taps.length > 0 && now - (_taps[_taps.length - 1] ?? 0) > 2000) _taps = [];
  _taps.push(now);
  if (_taps.length > 8) _taps = _taps.slice(-8);

  if (_taps.length >= 2) {
    let total = 0;
    for (let i = 1; i < _taps.length; i++) total += (_taps[i] ?? 0) - (_taps[i - 1] ?? 0);
    const bpm = Math.round(60000 / (total / (_taps.length - 1)));
    app.setPlayback({ tempo: Math.max(40, Math.min(220, bpm)) });
  }

  btn.classList.remove("tapped");
  void btn.offsetWidth;
  btn.classList.add("tapped");

  clearTimeout(_tapTimer ?? undefined);
  _tapTimer = setTimeout(() => {
    _taps = [];
  }, 2000);
}

($("tap-tempo-pop") as HTMLButtonElement).addEventListener("click", (e: MouseEvent) => {
  e.stopPropagation();
  handleTap(e.currentTarget as HTMLElement);
});
($("tap-tempo-setup") as HTMLButtonElement).addEventListener("click", (e: MouseEvent) =>
  handleTap(e.currentTarget as HTMLElement),
);

// ── Setup sheet option groups ─────────────────────────────────────────────

keySelectEl.addEventListener("change", () => app.setPlayback({ key: keySelectEl.value }));

document
  .querySelectorAll<HTMLElement>("[data-bars]")
  .forEach((btn) =>
    btn.addEventListener("click", () =>
      app.setPlayback({ bars: parseInt(btn.dataset["bars"] ?? "", 10) }),
    ),
  );
document
  .querySelectorAll<HTMLElement>("[data-cycle]")
  .forEach((btn) => btn.addEventListener("click", () => app.setCycle(btn.dataset["cycle"] ?? "")));
document
  .querySelectorAll<HTMLElement>("[data-style]")
  .forEach((btn) =>
    btn.addEventListener("click", () => app.setPlayback({ style: btn.dataset["style"] ?? "" })),
  );
document
  .querySelectorAll<HTMLElement>("[data-bass]")
  .forEach((btn) =>
    btn.addEventListener("click", () => app.setPlayback({ bass: btn.dataset["bass"] ?? "" })),
  );
document
  .querySelectorAll<HTMLElement>("[data-drums]")
  .forEach((btn) =>
    btn.addEventListener("click", () => app.setPlayback({ drums: btn.dataset["drums"] ?? "" })),
  );
document
  .querySelectorAll<HTMLElement>("[data-voicing]")
  .forEach((btn) =>
    btn.addEventListener("click", () => app.setPlayback({ voicing: btn.dataset["voicing"] ?? "" })),
  );
document
  .querySelectorAll<HTMLElement>("[data-theme-opt]")
  .forEach((btn) => btn.addEventListener("click", () => applyTheme(btn.dataset["themeOpt"] ?? "")));

// ── Readout pill cycling ──────────────────────────────────────────────────

const cycleOpt = <T>(opts: readonly T[], cur: T): T => opts[(opts.indexOf(cur) + 1) % opts.length]!;
readoutStyleEl.addEventListener("click", () =>
  app.setPlayback({ style: cycleOpt(STYLE_OPTIONS, app.getState().playback.style) }),
);
readoutBassEl.addEventListener("click", () =>
  app.setPlayback({ bass: cycleOpt(BASS_OPTIONS, app.getState().playback.bass) }),
);
readoutDrumsEl.addEventListener("click", () =>
  app.setPlayback({ drums: cycleOpt(DRUM_OPTIONS, app.getState().playback.drums) }),
);
readoutVoicingEl.addEventListener("click", () =>
  app.setPlayback({ voicing: cycleOpt(VOICING_OPTIONS, app.getState().playback.voicing) }),
);
readoutBarsEl.addEventListener("click", () =>
  app.setPlayback({ bars: cycleOpt(BARS_OPTIONS, app.getState().playback.bars) }),
);
readoutCycleEl.addEventListener("click", () =>
  app.setCycle(
    cycleOpt(CYCLE_OPTIONS, app.getState().playback.cycle as (typeof CYCLE_OPTIONS)[number]),
  ),
);
readoutAdvanceEl.addEventListener("click", () =>
  app.setPlayback({ advance: app.getState().playback.advance === "auto" ? "manual" : "auto" }),
);

function renderCustomCycleEditor(state: AppState): void {
  const keys = state.playback.customCycleKeys;
  customKeyRowsEl.innerHTML = "";
  if (!keys.length) {
    customKeyRowsEl.appendChild(
      Object.assign(document.createElement("div"), {
        className: "empty-presets",
        textContent: "Tap a key above to add it to the sequence.",
      }),
    );
    return;
  }
  keys.forEach((key, i) => {
    const row = document.createElement("div");
    row.className = "section-row";
    const num = Object.assign(document.createElement("div"), {
      className: "section-num",
      textContent: String(i + 1),
    });
    const nameEl = Object.assign(document.createElement("div"), {
      className: "custom-key-name",
      textContent: key,
    });
    const upBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "icon-btn",
      textContent: "↑",
      disabled: i === 0,
    });
    upBtn.addEventListener("click", () => {
      const k = [...keys];
      [k[i], k[i - 1]] = [k[i - 1]!, k[i]!];
      app.setPlayback({ customCycleKeys: k });
    });
    const downBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "icon-btn",
      textContent: "↓",
      disabled: i === keys.length - 1,
    });
    downBtn.addEventListener("click", () => {
      const k = [...keys];
      [k[i], k[i + 1]] = [k[i + 1]!, k[i]!];
      app.setPlayback({ customCycleKeys: k });
    });
    const delBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "icon-btn",
      textContent: "×",
    });
    delBtn.addEventListener("click", () =>
      app.setPlayback({ customCycleKeys: keys.filter((_, j) => j !== i) }),
    );
    row.append(num, nameEl, upBtn, downBtn, delBtn);
    customKeyRowsEl.appendChild(row);
  });
  const atLimit = keys.length >= 12;
  customKeyPickerEl.querySelectorAll<HTMLButtonElement>(".key-chip").forEach((btn) => {
    btn.disabled = atLimit;
  });
}

(VALID_KEYS as readonly string[]).forEach((k) => {
  const btn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "key-chip",
    textContent: k,
  });
  btn.addEventListener("click", () => {
    const keys = app.getState().playback.customCycleKeys;
    if (keys.length >= 12) return;
    app.setPlayback({ customCycleKeys: [...keys, k] });
  });
  customKeyPickerEl.appendChild(btn);
});

// ── Sections ──────────────────────────────────────────────────────────────

addSectionEl.addEventListener("click", () => {
  app.addSection();
  const rows = sectionRowsEl.querySelectorAll<HTMLInputElement>(".section-prog-input");
  if (rows.length) rows[rows.length - 1]!.focus();
});

arrangementEl.addEventListener("input", () => app.setArrangement(arrangementEl.value));

// ── Presets ───────────────────────────────────────────────────────────────

PRESETS.forEach((p) => {
  const btn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "preset-btn",
    textContent: p.label,
  });
  btn.addEventListener("click", () => {
    const current = app.getState();
    app.loadPreset({
      ...p.state,
      playback: { ...current.playback, ...p.state.playback },
    });
  });
  $("presets").appendChild(btn);
});

($("save-preset") as HTMLButtonElement).addEventListener("click", () => {
  const n = app.getUserPresets().length + 1;
  const id = app.saveUserPreset(`Preset ${n}`);
  renderUserPresets(id);
});

// ── Mix ───────────────────────────────────────────────────────────────────

type VolKey = keyof Pick<MixSettings, "chordVol" | "bassVol" | "drumVol" | "masterVol">;
const wireVol = (el: HTMLInputElement, valId: string, key: VolKey): void => {
  el.addEventListener("input", () => {
    ($(`${valId}`) as HTMLElement).textContent = el.value;
    app.setMix({ [key]: parseInt(el.value, 10) });
  });
};
wireVol(chordVolEl, "chord-vol-val", "chordVol");
wireVol(bassVolEl, "bass-vol-val", "bassVol");
wireVol(drumVolEl, "drum-vol-val", "drumVol");
wireVol(masterVolEl, "master-vol-val", "masterVol");

chordsOnEl.addEventListener("change", () => app.setMix({ chordsOn: chordsOnEl.checked }));
bassOnEl.addEventListener("change", () => app.setMix({ bassOn: bassOnEl.checked }));
drumsOnEl.addEventListener("change", () => app.setMix({ drumsOn: drumsOnEl.checked }));

// ── Playback ──────────────────────────────────────────────────────────────

playBtn.addEventListener("click", () => {
  app.togglePlay().catch((e: Error) => {
    statusEl.textContent = "Error: " + e.message;
  });
});
stopBtn.addEventListener("click", () => app.stop());
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code !== "Space") return;
  const t = document.activeElement?.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
  e.preventDefault();
  app.togglePlay().catch((e: Error) => {
    statusEl.textContent = "Error: " + e.message;
  });
});

// ── Keep awake ────────────────────────────────────────────────────────────

keepAwakeEl.checked = localStorage.getItem("keep-awake") === "1";
keepAwakeEl.addEventListener("change", () =>
  localStorage.setItem("keep-awake", keepAwakeEl.checked ? "1" : "0"),
);

// ── Sheets ────────────────────────────────────────────────────────────────

($("open-setup") as HTMLButtonElement).addEventListener("click", () =>
  ($("setup-sheet") as HTMLDialogElement).showModal(),
);
($("open-mix") as HTMLButtonElement).addEventListener("click", () =>
  ($("mix-sheet") as HTMLDialogElement).showModal(),
);
document
  .querySelectorAll<HTMLElement>("[data-close]")
  .forEach((btn) =>
    btn.addEventListener("click", () => ($(btn.dataset["close"]!) as HTMLDialogElement).close()),
  );
document.querySelectorAll<HTMLDialogElement>("dialog").forEach((d) =>
  d.addEventListener("click", (e: MouseEvent) => {
    if (e.target === d) d.close();
  }),
);

// ── Share link ────────────────────────────────────────────────────────────

($("copy-share") as HTMLButtonElement).addEventListener("click", async () => {
  clearTimeout(_urlTimer ?? undefined);
  history.replaceState(null, "", "?" + app.serializeUrl());
  const btn = $("copy-share") as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(window.location.href);
    btn.textContent = "Copied!";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => {
    btn.textContent = "Copy share link";
  }, 1500);
});

window.addEventListener("resize", syncBodyPadding);

// ── Welcome overlay ───────────────────────────────────────────────────────
const WELCOMED = "cppWelcomed";
if (!localStorage.getItem(WELCOMED)) ($("welcome-modal") as HTMLDialogElement).showModal();
($("welcome-docs-link") as HTMLAnchorElement).addEventListener("click", () =>
  localStorage.setItem(WELCOMED, "1"),
);
($("welcome-dismiss") as HTMLButtonElement).addEventListener("click", () =>
  ($("welcome-modal") as HTMLDialogElement).close(),
);
($("welcome-modal") as HTMLDialogElement).addEventListener("close", () =>
  localStorage.setItem(WELCOMED, "1"),
);

// ── Init ──────────────────────────────────────────────────────────────────

app.applyUrl(location.search);
renderUserPresets();
applyTheme(localStorage.getItem("theme") ?? "dark");
