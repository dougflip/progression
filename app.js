import {
  makeProgressionPlayer, serializeUrl,
  STYLE_OPTIONS, STYLE_LABELS, BASS_OPTIONS, BASS_LABELS,
  VOICING_OPTIONS, VOICING_PILL_LABELS, CYCLE_OPTIONS, CYCLE_LABELS,
  BARS_OPTIONS, PRESETS, tokenize, parseToken, resolvePlayOrder,
  VALID_KEYS, getShiftsForCycle, resolvedKeyName,
  getResolvedChipNames, isAbsoluteChord,
} from './progression-core.js';
import { makeProgressionAudio } from './progression-audio.js';

// ── App instance ────────────────────────────────────────────────────────

const audio = makeProgressionAudio({ Tone });

const app = makeProgressionPlayer({
  audio,
  persist: (key, value) => localStorage.setItem(key, value),
  load:    (key) => localStorage.getItem(key),
  onStateChange:    render,
  onPlaybackChange: onPlaybackChange,
  onChordTick:      onChordTick,
  onBeatTick:       onBeatTick,
  onBarTick:        onBarTick,
  onError: (msg) => { statusEl.textContent = msg; },
});

// ── DOM refs ────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const keyNoteBtnEl    = $('key-note-btn');
const keyPickerEl     = $('key-picker');
const stripEl         = $('chord-strip');
const statusEl        = $('status');
const playBtn         = $('play');
const stopBtn         = $('stop-btn');
const keySelectEl     = $('key-select');
const tempoSliderEl   = $('tempo-slider');
const tempoDisplayEl  = $('tempo-display');
const arrangementEl   = $('arrangement');
const sectionRowsEl   = $('section-rows');
const sectionCountEl  = $('section-count-label');
const addSectionEl    = $('add-section');
const userPresetsEl   = $('user-presets');
const scrubberBar     = $('scrubber-bar');
const scrubberTrack   = $('scrubber-track');
const readoutTempoEl  = $('readout-tempo');
const readoutStyleEl  = $('readout-style');
const readoutBassEl   = $('readout-bass');
const readoutVoicingEl = $('readout-voicing');
const readoutBarsEl   = $('readout-bars');
const readoutCycleEl  = $('readout-cycle');
const readoutAdvanceEl  = $('readout-advance');
const keyScrubberBar     = $('key-scrubber-bar');
const keyScrubberTrack   = $('key-scrubber-track');
const customKeysEditorEl = $('custom-keys-editor');
const customKeyPickerEl  = $('custom-key-picker');
const customKeyRowsEl    = $('custom-key-rows');
const chordVolEl      = $('chord-vol');
const bassVolEl       = $('bass-vol');
const drumVolEl       = $('drum-vol');
const masterVolEl     = $('master-vol');
const chordsOnEl      = $('chords-on');
const bassOnEl        = $('bass-on');
const drumsOnEl       = $('drums-on');

// ── Render ──────────────────────────────────────────────────────────────

/** @param {import('./progression-core.js').AppState} state */
function render(state) {
  renderChips(state);
  renderReadout(state);
  renderSectionRows(state);
  renderScrubber(state);
  renderKeyScrubber(state);
  renderMix(state);
  syncUrl(state);
}

/** @param {import('./progression-core.js').AppState} state */
function renderChips(state) {
  const progStr = state.sections[state.activeSection - 1]?.progression ?? '';
  const tokens  = tokenize(progStr);
  buildChipStructure(tokens);
  updateChipNames(getResolvedChipNames(state, _currentLapIndex));
  keyNoteBtnEl.textContent = _currentScrubKey ?? state.key;
  keySelectEl.value = state.key;
  keyPickerEl.querySelectorAll('.key-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.key === state.key));
}

/**
 * Builds chip DOM structure from token strings — no name resolution.
 * @param {string[]} tokens
 */
function buildChipStructure(tokens) {
  const activeIdx = [...stripEl.querySelectorAll('.chip')].findIndex(c => c.classList.contains('active'));
  stripEl.innerHTML = '';
  tokens.forEach(token => {
    const { numeral, bars } = parseToken(token, 0);
    const displayToken = token.includes(':') ? `${numeral}:${bars}` : numeral;
    const isAbsolute   = isAbsoluteChord(numeral);
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (!isAbsolute) {
      chip.appendChild(Object.assign(document.createElement('div'),
        { className: 'numeral', textContent: displayToken }));
    }
    chip.appendChild(Object.assign(document.createElement('div'), { className: 'name' }));
    chip.appendChild(Object.assign(document.createElement('div'), { className: 'bar-progress' }));
    stripEl.appendChild(chip);
  });
  if (activeIdx >= 0) setActiveChip(activeIdx);
}

/** Updates displayed chord name text without rebuilding chip DOM. */
function updateChipNames(names) {
  stripEl.querySelectorAll('.chip .name').forEach((el, i) => {
    if (names[i] !== undefined) el.textContent = names[i];
  });
}

/** @param {number} index — pass -1 to clear all */
function setActiveChip(index) {
  stripEl.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', i === index));
}

function clearActiveChip() { setActiveChip(-1); }

// ── Beat / bar progress helpers ─────────────────────────────────────────

const beatDots = document.querySelectorAll('.beat-dot');

function onBeatTick(beat) {
  if (!audio.isPlaying()) return;
  beatDots.forEach((d, i) => d.classList.toggle('active', i === beat));
}

function clearBeats() { beatDots.forEach(d => d.classList.remove('active')); }

function activeBarProgress() {
  const active = stripEl.querySelector('.chip.active');
  return active?.querySelector('.bar-progress') ?? null;
}

function renderBarDots(count, activeBar) {
  clearBars();
  if (count <= 1) return;
  const bp = activeBarProgress();
  if (!bp) return;
  for (let i = 0; i < count; i++) {
    bp.appendChild(Object.assign(document.createElement('span'),
      { className: 'bar-dot' + (i === activeBar ? ' active' : '') }));
  }
}

function onBarTick(bar) {
  if (!audio.isPlaying()) return;
  const bp = activeBarProgress();
  if (!bp) return;
  Array.from(bp.children).forEach((d, i) => d.classList.toggle('active', i === bar));
}

function clearBars() {
  stripEl.querySelectorAll('.bar-progress').forEach(bp => { bp.innerHTML = ''; });
}

// ── Scrubber current position ───────────────────────────────────────────

function centerActiveSegment(track, seg, behavior = 'smooth') {
  if (!seg) return;
  const trackRect = track.getBoundingClientRect();
  const segRect   = seg.getBoundingClientRect();
  track.scrollTo({
    left: track.scrollLeft + segRect.left - trackRect.left - trackRect.width / 2 + segRect.width / 2,
    behavior,
  });
}

function setScrubberCurrent(posIndex) {
  const pendingJump = app.getPendingJump();
  let activeSeg = null;
  scrubberTrack.querySelectorAll('.scrubber-seg').forEach(seg => {
    const sp = parseInt(seg.dataset.posIndex, 10);
    const isCurrent = sp === posIndex;
    seg.classList.toggle('current', isCurrent);
    seg.classList.toggle('queued', sp === pendingJump && sp !== posIndex);
    if (isCurrent) activeSeg = seg;
  });
  centerActiveSegment(scrubberTrack, activeSeg);
}

// ── Audio timing callbacks (fast path — no onStateChange) ───────────────

/** @param {import('./progression-audio.js').ChordTickEvent} ev */
function onChordTick({ chipIndex, posIndex, sectionIndex, sectionChanged,
                       resolvedChipNames, resolvedKey, bars, sectionTokens, lapIndex }) {
  _currentScrubPosIndex = posIndex;
  _currentScrubKey      = resolvedKey;
  _currentLapIndex      = lapIndex;
  if (sectionChanged && sectionTokens) {
    buildChipStructure(sectionTokens);
  }
  setActiveChip(chipIndex);
  updateChipNames(resolvedChipNames);
  keyNoteBtnEl.textContent = resolvedKey;
  const pendingKeyJump = app.getPendingKeyJump();
  let activeKeySeg = null;
  keyScrubberTrack.querySelectorAll('.scrubber-seg').forEach(seg => {
    const ki = parseInt(seg.dataset.keyIndex, 10);
    const isCurrent = seg.textContent === resolvedKey;
    seg.classList.toggle('current', isCurrent);
    seg.classList.toggle('queued', ki === pendingKeyJump && !isCurrent);
    if (isCurrent) activeKeySeg = seg;
  });
  centerActiveSegment(keyScrubberTrack, activeKeySeg);
  setScrubberCurrent(posIndex);
  renderBarDots(bars, 0);
}

/** @param {import('./progression-core.js').AppState} state */
function renderReadout(state) {
  readoutTempoEl.textContent  = state.tempo;
  tempoDisplayEl.textContent  = `${state.tempo} BPM`;
  readoutStyleEl.textContent  = STYLE_LABELS[state.style]   ?? state.style;
  readoutBassEl.textContent   = BASS_LABELS[state.bass]      ?? state.bass;
  readoutVoicingEl.textContent = VOICING_PILL_LABELS[state.voicing] ?? state.voicing;
  readoutBarsEl.textContent   = `${state.bars} ${state.bars === 1 ? 'bar' : 'bars'}`;
  readoutCycleEl.textContent  = CYCLE_LABELS[state.cycle]   ?? state.cycle;
  readoutAdvanceEl.textContent = state.advance === 'manual' ? 'Manual' : 'Auto';

  const isCustom = state.cycle === 'custom';
  customKeysEditorEl.hidden = !isCustom;
  if (isCustom) renderCustomCycleEditor(state);

  if (document.activeElement !== tempoSliderEl) tempoSliderEl.value = String(state.tempo);

  document.querySelectorAll('[data-bars]').forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.bars, 10) === state.bars));
  document.querySelectorAll('[data-cycle]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.cycle === state.cycle));
  document.querySelectorAll('[data-style]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.style === state.style));
  document.querySelectorAll('[data-bass]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.bass === state.bass));
  document.querySelectorAll('[data-voicing]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.voicing === state.voicing));
}

/** @param {import('./progression-core.js').AppState} state */
function renderSectionRows(state) {
  const { sections, activeSection } = state;
  const playing = audio.isPlaying();
  const existing = sectionRowsEl.querySelectorAll('.section-row');

  if (existing.length !== sections.length) {
    sectionRowsEl.innerHTML = '';
    sections.forEach((_, i) => sectionRowsEl.appendChild(makeSectionRow(i, state)));
  } else {
    existing.forEach((row, i) => {
      const numEl = row.querySelector('.section-num');
      numEl.className = 'section-num' + (activeSection === i + 1 ? ' active-section' : '');
      numEl.textContent = i + 1;
      const inp = row.querySelector('.section-prog-input');
      if (document.activeElement !== inp) inp.value = sections[i].progression;
      inp.disabled = playing;
      const [upBtn, downBtn, delBtn] = row.querySelectorAll('.icon-btn');
      upBtn.disabled  = playing || i === 0;
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
let _currentScrubPosIndex = null;
let _currentScrubKey      = null;
let _currentLapIndex      = 0;

/** @param {import('./progression-core.js').AppState} state */
function renderScrubber(state) {
  const order = resolvePlayOrder(state.sections, state.arrangement);
  if (order.length < 2) {
    scrubberBar.hidden = true;
    readoutAdvanceEl.hidden = true;
    syncBodyPadding();
    return;
  }
  scrubberBar.hidden = false;
  readoutAdvanceEl.hidden = false;
  scrubberTrack.innerHTML = '';
  order.forEach((sectionRef, posIndex) => {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'scrubber-seg';
    if (posIndex === _currentScrubPosIndex) seg.classList.add('current');
    seg.textContent = sectionRef;
    seg.dataset.posIndex = posIndex;
    seg.addEventListener('click', () => handleScrubberTap(posIndex));
    scrubberTrack.appendChild(seg);
  });
  syncBodyPadding();
}

/** @param {import('./progression-core.js').AppState} state */
function renderKeyScrubber(state) {
  if (state.cycle === 'none') {
    keyScrubberBar.hidden = true;
    syncBodyPadding();
    return;
  }
  const shifts = getShiftsForCycle(state.cycle, state.customCycleKeys);
  const keys   = shifts.map(s => resolvedKeyName(state.key, s, state.cycle));
  if (keys.length < 2) {
    keyScrubberBar.hidden = true;
    syncBodyPadding();
    return;
  }
  keyScrubberBar.hidden = false;
  keyScrubberTrack.innerHTML = '';
  keys.forEach((keyName, i) => {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'scrubber-seg';
    if (keyName === _currentScrubKey) seg.classList.add('current');
    seg.textContent = keyName;
    seg.dataset.keyIndex = i;
    seg.addEventListener('click', () => handleKeySegmentTap(i));
    keyScrubberTrack.appendChild(seg);
  });
  syncBodyPadding();
}

function handleKeySegmentTap(lapIndex) {
  if (!audio.isPlaying()) {
    const state = app.getState();
    const shifts = getShiftsForCycle(state.cycle, state.customCycleKeys);
    _currentLapIndex = lapIndex;
    _currentScrubKey = resolvedKeyName(state.key, shifts[lapIndex] ?? 0, state.cycle);
    app.seekToLap(lapIndex);
    return;
  }
  if (app.getPendingKeyJump() === lapIndex) {
    app.cancelKeyJump();
    keyScrubberTrack.querySelectorAll('.scrubber-seg').forEach(s => s.classList.remove('queued'));
    return;
  }
  app.queueKeyJump(lapIndex);
  keyScrubberTrack.querySelectorAll('.scrubber-seg').forEach(seg => {
    const ki = parseInt(seg.dataset.keyIndex, 10);
    seg.classList.toggle('queued', ki === lapIndex && !seg.classList.contains('current'));
  });
}

function handleScrubberTap(posIndex) {
  if (!audio.isPlaying()) {
    _currentScrubPosIndex = posIndex;
    app.seekToPos(posIndex);
    return;
  }
  // Cancel if tapping the queued segment again
  if (app.getPendingJump() === posIndex) {
    app.cancelJump();
    scrubberTrack.querySelectorAll('.scrubber-seg').forEach(s => s.classList.remove('queued'));
    return;
  }
  app.queueJump(posIndex);
  scrubberTrack.querySelectorAll('.scrubber-seg').forEach(seg => {
    const sp = parseInt(seg.dataset.posIndex, 10);
    seg.classList.toggle('queued', sp === posIndex && !seg.classList.contains('current'));
  });
}

/** @param {import('./progression-core.js').AppState} state */
function renderMix(state) {
  const ae = document.activeElement;
  if (ae !== chordVolEl)  chordVolEl.value  = String(state.chordVol);
  if (ae !== bassVolEl)   bassVolEl.value    = String(state.bassVol);
  if (ae !== drumVolEl)   drumVolEl.value    = String(state.drumVol);
  if (ae !== masterVolEl) masterVolEl.value  = String(state.masterVol);
  $('chord-vol-val').textContent  = state.chordVol;
  $('bass-vol-val').textContent   = state.bassVol;
  $('drum-vol-val').textContent   = state.drumVol;
  $('master-vol-val').textContent = state.masterVol;
  chordsOnEl.checked = state.chordsOn;
  bassOnEl.checked   = state.bassOn;
  drumsOnEl.checked  = state.drumsOn;
}

/** @param {number} index @param {import('./progression-core.js').AppState} state */
function makeSectionRow(index, state) {
  const { sections, activeSection } = state;
  const playing = audio.isPlaying();
  const row = document.createElement('div');
  row.className = 'section-row';

  const num = document.createElement('div');
  num.className = 'section-num' + (activeSection === index + 1 ? ' active-section' : '');
  num.textContent = index + 1;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'section-prog-input';
  inp.value = sections[index].progression;
  inp.autocomplete = 'off';
  inp.autocapitalize = 'off';
  inp.setAttribute('autocorrect', 'off');
  inp.spellcheck = false;
  inp.disabled = playing;
  inp.addEventListener('focus', () => {
    sectionRowsEl.querySelectorAll('.section-num').forEach((n, j) =>
      n.classList.toggle('active-section', j === index));
  });
  inp.addEventListener('input', () => app.updateSection(index, inp.value));

  const upBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', textContent: '↑', disabled: playing || index === 0 });
  upBtn.addEventListener('click', () => app.moveSection(index, 'up'));

  const downBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', textContent: '↓', disabled: playing || index === sections.length - 1 });
  downBtn.addEventListener('click', () => app.moveSection(index, 'down'));

  const delBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', textContent: '×', disabled: playing || sections.length <= 1 });
  delBtn.addEventListener('click', () => app.removeSection(index));

  row.append(num, inp, upBtn, downBtn, delBtn);
  return row;
}

function renderUserPresets(focusId = null) {
  userPresetsEl.innerHTML = '';
  const list = app.getUserPresets();
  if (!list.length) {
    userPresetsEl.appendChild(Object.assign(document.createElement('div'), { className: 'empty-presets', textContent: 'No saved presets yet.' }));
    return;
  }
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'user-preset-row';

    const nameBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'preset-btn user-preset-name', textContent: p.name });
    nameBtn.addEventListener('click', () => app.loadPreset(p.state));

    const editBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', textContent: '✎' });
    editBtn.setAttribute('aria-label', `Rename ${p.name}`);
    editBtn.addEventListener('click', () => enterRename(row, p));

    const delBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', textContent: '×' });
    delBtn.setAttribute('aria-label', `Delete ${p.name}`);
    delBtn.addEventListener('click', () => { app.deleteUserPreset(p.id); renderUserPresets(); });

    row.append(nameBtn, editBtn, delBtn);
    userPresetsEl.appendChild(row);
    if (focusId === p.id) enterRename(row, p);
  });
}

function enterRename(row, preset) {
  row.innerHTML = '';
  const inp = Object.assign(document.createElement('input'), { type: 'text', className: 'rename-input', value: preset.name, autocomplete: 'off', spellcheck: false });
  let done = false;
  const commit = () => { if (done) return; done = true; app.renameUserPreset(preset.id, inp.value.trim() || preset.name); renderUserPresets(); };
  const cancel = () => { if (done) return; done = true; renderUserPresets(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
  inp.addEventListener('blur', commit);
  row.appendChild(inp);
  inp.focus();
  inp.select();
}

// ── Theme ────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  document.querySelectorAll('[data-theme-opt]').forEach(b =>
    b.classList.toggle('active', b.dataset.themeOpt === t));
}

// ── Playback change ──────────────────────────────────────────────────────

const PAUSE_ICON = '<svg width="17" height="20" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="6" height="20" rx="1.5"/><rect x="11" y="0" width="6" height="20" rx="1.5"/></svg>';

/** @param {boolean} playing @param {string} [reason] */
function onPlaybackChange(playing) {
  stopBtn.hidden = !app.isPaused();
  playBtn.innerHTML = playing ? PAUSE_ICON : '▶';
  playBtn.classList.toggle('playing', playing);
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (playing) {
    statusEl.textContent = '';
    if (keepAwakeEl.checked) acquireWakeLock();
  } else if (app.isPaused()) {
    releaseWakeLock();
    clearBeats();
    clearBars();
    scrubberTrack.querySelectorAll('.scrubber-seg').forEach(s => s.classList.remove('queued'));
    keyScrubberTrack.querySelectorAll('.scrubber-seg').forEach(s => s.classList.remove('queued'));
  } else {
    releaseWakeLock();
    clearActiveChip();
    clearBeats();
    clearBars();
    _currentScrubPosIndex = null;
    _currentScrubKey      = null;
    _currentLapIndex      = 0;
    statusEl.textContent = '';
    scrubberTrack.querySelectorAll('.scrubber-seg')
      .forEach(s => s.classList.remove('current', 'queued'));
    keyScrubberTrack.querySelectorAll('.scrubber-seg')
      .forEach(s => s.classList.remove('current', 'queued'));
    renderChips(app.getState());
  }
}

// ── Wake lock ────────────────────────────────────────────────────────────

let _wakeLock = null;
async function acquireWakeLock() {
  if (_wakeLock || !('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (e) {
    console.warn('Wake lock failed:', e.message);
  }
}
async function releaseWakeLock() {
  if (!_wakeLock) return;
  try { await _wakeLock.release(); } catch {}
  _wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && keepAwakeEl.checked && audio.isPlaying()) {
    acquireWakeLock();
  }
});

// ── UI helpers ───────────────────────────────────────────────────────────

function syncBodyPadding() {
  const bar = $('action-bar');
  if (bar) document.body.style.paddingBottom = bar.offsetHeight + 'px';
}

let _urlTimer = null;
function syncUrl(state) {
  clearTimeout(_urlTimer);
  _urlTimer = setTimeout(() => {
    history.replaceState(null, '', '?' + serializeUrl(state));
  }, 200);
}

// ── Key picker ───────────────────────────────────────────────────────────

['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'].forEach(k => {
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'key-chip', textContent: k });
  btn.dataset.key = k;
  btn.addEventListener('click', () => { app.setState({ key: k }); keyPickerEl.hidden = true; });
  keyPickerEl.appendChild(btn);
});

keyNoteBtnEl.addEventListener('click', () => { keyPickerEl.hidden = !keyPickerEl.hidden; });
document.addEventListener('click', e => {
  if (keyPickerEl.hidden) return;
  if (keyNoteBtnEl.contains(e.target) || keyPickerEl.contains(e.target)) return;
  keyPickerEl.hidden = true;
});

// ── Tempo picker ─────────────────────────────────────────────────────────

const tempoPickerEl = $('tempo-picker');
const tempoQuickEl  = $('tempo-quick');

$('tempo-toggle').addEventListener('click', () => {
  if (tempoPickerEl.hidden) { tempoQuickEl.value = String(app.getState().tempo); tempoPickerEl.hidden = false; }
  else tempoPickerEl.hidden = true;
});
tempoQuickEl.addEventListener('input', () => app.setState({ tempo: Math.max(40, Math.min(220, parseInt(tempoQuickEl.value, 10))) }));
$('tempo-down').addEventListener('click', () => app.setState({ tempo: Math.max(40, app.getState().tempo - 1) }));
$('tempo-up').addEventListener('click',   () => app.setState({ tempo: Math.min(220, app.getState().tempo + 1) }));
document.addEventListener('click', e => {
  if (tempoPickerEl.hidden) return;
  if ($('tempo-toggle').contains(e.target) || tempoPickerEl.contains(e.target)) return;
  tempoPickerEl.hidden = true;
});

tempoSliderEl.addEventListener('input', () =>
  app.setState({ tempo: parseInt(tempoSliderEl.value, 10) }));

// ── Tap tempo ─────────────────────────────────────────────────────────────

let _taps = [];
let _tapTimer = null;

function handleTap(btn) {
  const now = Date.now();
  if (_taps.length > 0 && now - _taps[_taps.length - 1] > 2000) _taps = [];
  _taps.push(now);
  if (_taps.length > 8) _taps = _taps.slice(-8);

  if (_taps.length >= 2) {
    let total = 0;
    for (let i = 1; i < _taps.length; i++) total += _taps[i] - _taps[i - 1];
    const bpm = Math.round(60000 / (total / (_taps.length - 1)));
    app.setState({ tempo: Math.max(40, Math.min(220, bpm)) });
  }

  btn.classList.remove('tapped');
  void btn.offsetWidth;
  btn.classList.add('tapped');

  clearTimeout(_tapTimer);
  _tapTimer = setTimeout(() => { _taps = []; }, 2000);
}

$('tap-tempo-pop').addEventListener('click', e => { e.stopPropagation(); handleTap(e.currentTarget); });
$('tap-tempo-setup').addEventListener('click', e => handleTap(e.currentTarget));

// ── Setup sheet option groups ─────────────────────────────────────────────

keySelectEl.addEventListener('change', () => app.setState({ key: keySelectEl.value }));

document.querySelectorAll('[data-bars]').forEach(btn =>
  btn.addEventListener('click', () => app.setState({ bars: parseInt(btn.dataset.bars, 10) })));
document.querySelectorAll('[data-cycle]').forEach(btn =>
  btn.addEventListener('click', () => app.setCycle(btn.dataset.cycle)));
document.querySelectorAll('[data-style]').forEach(btn =>
  btn.addEventListener('click', () => app.setState({ style: btn.dataset.style })));
document.querySelectorAll('[data-bass]').forEach(btn =>
  btn.addEventListener('click', () => app.setState({ bass: btn.dataset.bass })));
document.querySelectorAll('[data-voicing]').forEach(btn =>
  btn.addEventListener('click', () => app.setState({ voicing: btn.dataset.voicing })));
document.querySelectorAll('[data-theme-opt]').forEach(btn =>
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeOpt)));

// ── Readout pill cycling ──────────────────────────────────────────────────

const cycleOpt = (opts, cur) => opts[(opts.indexOf(cur) + 1) % opts.length];
readoutStyleEl.addEventListener('click',   () => app.setState({ style:   cycleOpt(STYLE_OPTIONS,   app.getState().style) }));
readoutBassEl.addEventListener('click',    () => app.setState({ bass:    cycleOpt(BASS_OPTIONS,    app.getState().bass) }));
readoutVoicingEl.addEventListener('click', () => app.setState({ voicing: cycleOpt(VOICING_OPTIONS, app.getState().voicing) }));
readoutBarsEl.addEventListener('click',    () => app.setState({ bars:    cycleOpt(BARS_OPTIONS,    app.getState().bars) }));
readoutCycleEl.addEventListener('click', () =>
  app.setCycle(cycleOpt(CYCLE_OPTIONS, app.getState().cycle)));
readoutAdvanceEl.addEventListener('click', () => app.setState({ advance: app.getState().advance === 'auto' ? 'manual' : 'auto' }));

function renderCustomCycleEditor(state) {
  const keys = state.customCycleKeys;
  customKeyRowsEl.innerHTML = '';
  if (!keys.length) {
    customKeyRowsEl.appendChild(Object.assign(document.createElement('div'),
      { className: 'empty-presets', textContent: 'Tap a key above to add it to the sequence.' }));
    return;
  }
  keys.forEach((key, i) => {
    const row = document.createElement('div');
    row.className = 'section-row';
    const num = Object.assign(document.createElement('div'),
      { className: 'section-num', textContent: i + 1 });
    const nameEl = Object.assign(document.createElement('div'),
      { className: 'custom-key-name', textContent: key });
    const upBtn = Object.assign(document.createElement('button'),
      { type: 'button', className: 'icon-btn', textContent: '↑', disabled: i === 0 });
    upBtn.addEventListener('click', () => {
      const k = [...keys]; [k[i], k[i - 1]] = [k[i - 1], k[i]];
      app.setState({ customCycleKeys: k });
    });
    const downBtn = Object.assign(document.createElement('button'),
      { type: 'button', className: 'icon-btn', textContent: '↓', disabled: i === keys.length - 1 });
    downBtn.addEventListener('click', () => {
      const k = [...keys]; [k[i], k[i + 1]] = [k[i + 1], k[i]];
      app.setState({ customCycleKeys: k });
    });
    const delBtn = Object.assign(document.createElement('button'),
      { type: 'button', className: 'icon-btn', textContent: '×' });
    delBtn.addEventListener('click', () =>
      app.setState({ customCycleKeys: keys.filter((_, j) => j !== i) }));
    row.append(num, nameEl, upBtn, downBtn, delBtn);
    customKeyRowsEl.appendChild(row);
  });
  const atLimit = keys.length >= 12;
  customKeyPickerEl.querySelectorAll('.key-chip').forEach(btn => { btn.disabled = atLimit; });
}

VALID_KEYS.forEach(k => {
  const btn = Object.assign(document.createElement('button'),
    { type: 'button', className: 'key-chip', textContent: k });
  btn.addEventListener('click', () => {
    const keys = app.getState().customCycleKeys;
    if (keys.length >= 12) return;
    app.setState({ customCycleKeys: [...keys, k] });
  });
  customKeyPickerEl.appendChild(btn);
});

// ── Sections ──────────────────────────────────────────────────────────────

addSectionEl.addEventListener('click', () => {
  app.addSection();
  const rows = sectionRowsEl.querySelectorAll('.section-prog-input');
  if (rows.length) rows[rows.length - 1].focus();
});

arrangementEl.addEventListener('input', () => app.setState({ arrangement: arrangementEl.value }));

// ── Presets ───────────────────────────────────────────────────────────────

PRESETS.forEach(p => {
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'preset-btn', textContent: p.label });
  btn.addEventListener('click', () => app.loadPreset({ ...app.getState(), ...p.state }));
  $('presets').appendChild(btn);
});

$('save-preset').addEventListener('click', () => {
  const n = app.getUserPresets().length + 1;
  const id = app.saveUserPreset(`Preset ${n}`);
  renderUserPresets(id);
});

// ── Mix ───────────────────────────────────────────────────────────────────

const wireVol = (el, valId, key) => {
  el.addEventListener('input', () => {
    $(valId).textContent = el.value;
    app.setState({ [key]: parseInt(el.value, 10) });
  });
};
wireVol(chordVolEl,  'chord-vol-val',  'chordVol');
wireVol(bassVolEl,   'bass-vol-val',   'bassVol');
wireVol(drumVolEl,   'drum-vol-val',   'drumVol');
wireVol(masterVolEl, 'master-vol-val', 'masterVol');

chordsOnEl.addEventListener('change', () => app.setState({ chordsOn: chordsOnEl.checked }));
bassOnEl.addEventListener('change',   () => app.setState({ bassOn:   bassOnEl.checked }));
drumsOnEl.addEventListener('change',  () => app.setState({ drumsOn:  drumsOnEl.checked }));

// ── Playback ──────────────────────────────────────────────────────────────

playBtn.addEventListener('click', () => {
  app.togglePlay().catch(e => { statusEl.textContent = 'Error: ' + e.message; });
});
stopBtn.addEventListener('click', () => app.stop());
document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  const t = document.activeElement?.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  e.preventDefault();
  app.togglePlay().catch(e => { statusEl.textContent = 'Error: ' + e.message; });
});

// ── Keep awake ────────────────────────────────────────────────────────────

const keepAwakeEl = $('keep-awake');
keepAwakeEl.checked = localStorage.getItem('keep-awake') === '1';
keepAwakeEl.addEventListener('change', () =>
  localStorage.setItem('keep-awake', keepAwakeEl.checked ? '1' : '0'));

// ── Sheets ────────────────────────────────────────────────────────────────

$('open-setup').addEventListener('click', () => $('setup-sheet').showModal());
$('open-mix').addEventListener('click',   () => $('mix-sheet').showModal());
document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => $(btn.dataset.close).close()));
document.querySelectorAll('dialog').forEach(d =>
  d.addEventListener('click', e => { if (e.target === d) d.close(); }));

// ── Share link ────────────────────────────────────────────────────────────

$('copy-share').addEventListener('click', async () => {
  clearTimeout(_urlTimer);
  history.replaceState(null, '', '?' + app.serializeUrl());
  const btn = $('copy-share');
  try {
    await navigator.clipboard.writeText(window.location.href);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = 'Copy share link'; }, 1500);
});

window.addEventListener('resize', syncBodyPadding);

// ── Welcome overlay ───────────────────────────────────────────────────────
const WELCOMED = 'cppWelcomed';
if (!localStorage.getItem(WELCOMED)) $('welcome-modal').showModal();
$('welcome-docs-link').addEventListener('click', () => localStorage.setItem(WELCOMED, '1'));
$('welcome-dismiss').addEventListener('click', () => $('welcome-modal').close());
$('welcome-modal').addEventListener('close', () => localStorage.setItem(WELCOMED, '1'));

// ── Init ──────────────────────────────────────────────────────────────────

app.applyUrl(location.search);
renderUserPresets();
applyTheme(localStorage.getItem('theme') || 'dark');
