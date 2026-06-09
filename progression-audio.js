/**
 * progression-audio.js
 * Tone.js-coupled audio engine. Accepts a state snapshot and plays it.
 * Knows nothing about DOM or app state — fires callbacks with resolved
 * display data for the host to consume.
 */

import {
  resolvedChordName, resolvedKeyName,
  clampShift, makeChord, getShiftsForCycle,
} from './progression-core.js';

/**
 * @param {{ Tone: any }} deps
 */
export function makeProgressionAudio({ Tone }) {
  // ── Audio nodes ────────────────────────────────────────────────────────────
  let _channels = null; // created once, survives rebuild
  let _synth = null, _reverb = null, _part = null;
  let _kick = null, _snare = null, _hat = null;
  let _kickSeq = null, _snareSeq = null, _hatSeq = null;
  let _bass = null, _bassSeq = null, _beatSeq = null;

  // ── Playback state ─────────────────────────────────────────────────────────
  let _pendingJump = null;
  let _currentPosIndex = 0;
  let _manualLap = 0;
  let _advance = 'auto';
  let _muteState = { chordsOn: true, bassOn: true, drumsOn: true };
  // Track last-set volume per channel so setMute can reapply it on unmute,
  // guarding against Tone.js silently ignoring -Infinity assignments.
  let _volState  = { chords: 50, bass: 100, drums: 100, master: 100 };

  // ── Active start params (needed inside Draw callbacks) ─────────────────────
  let _key = 'C';
  let _cycle = 'none';
  let _customCycleKeys = [];

  // ── Callbacks ──────────────────────────────────────────────────────────────
  let _onChordTick = null;
  let _onBeatTick  = null;
  let _onBarTick   = null;

  // ── Private helpers ────────────────────────────────────────────────────────

  /** @param {number} v - 0–100 */
  function _toDb(v) {
    if (!Number.isFinite(v) || v <= 0) return -Infinity;
    return Tone.gainToDb(Math.min(100, v) / 100);
  }

  function _safe(fn) {
    try { fn(); } catch (e) { console.warn('Tone suppressed:', e); }
  }
  function _safeCall(obj, method) {
    if (!obj) return;
    try { obj[method](); } catch (e) { console.warn(`Tone.${method} suppressed:`, e); }
  }

  function _initChannels({ chordVol, bassVol, drumVol, masterVol, chordsOn, bassOn }) {
    if (_channels) return;
    _volState = { chords: chordVol, bass: bassVol, drums: drumVol, master: masterVol };
    const master = new Tone.Channel().toDestination();
    const chord  = new Tone.Channel().connect(master);
    const bass   = new Tone.Channel().connect(master);
    const drum   = new Tone.Channel().connect(master);
    chord.volume.value  = _toDb(chordVol);
    bass.volume.value   = _toDb(bassVol);
    drum.volume.value   = _toDb(drumVol);
    master.volume.value = _toDb(masterVol);
    chord.mute = !chordsOn;
    bass.mute  = !bassOn;
    _channels = { chord, bass, drum, master };
  }

  function _teardown() {
    _safeCall(_part, 'stop');
    _safeCall(_part, 'dispose');
    _part = null;
    for (const s of [_kickSeq, _snareSeq, _hatSeq, _bassSeq, _beatSeq]) {
      _safeCall(s, 'stop');
      _safeCall(s, 'dispose');
    }
    _kickSeq = _snareSeq = _hatSeq = _bassSeq = _beatSeq = null;
    for (const v of [_synth, _kick, _snare, _hat, _bass, _reverb]) _safeCall(v, 'dispose');
    _synth = _kick = _snare = _hat = _bass = _reverb = null;
    _safe(() => Tone.Draw.cancel(0));
    _safe(() => Tone.Transport.cancel());
  }

  function _buildSynth() {
    _reverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(_channels.chord);
    _synth  = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1.5 },
    }).connect(_reverb);
    _synth.volume.value = -13;
  }

  /**
   * @param {import('./progression-core.js').SongChord[]} chords
   * @param {string} cycle
   * @param {string[]} customCycleKeys
   * @param {string} voicing
   * @returns {{ songBars: number, posOffsets: Record<number,number> }}
   */
  function _buildPart(chords, cycle, customCycleKeys, voicing) {
    const shifts       = getShiftsForCycle(cycle, customCycleKeys);
    const smooth       = voicing === 'voice-lead' || voicing === 'voice-lead-loop';
    const resetEachLap = voicing === 'voice-lead-loop';

    const songBars = chords.reduce((s, c) => s + c.bars, 0);

    // Bar offset for each posIndex (needed for position scrubbing)
    const posOffsets = {};
    let offsetAcc = 0;
    for (const c of chords) {
      if (!(c.posIndex in posOffsets)) posOffsets[c.posIndex] = offsetAcc;
      offsetAcc += c.bars;
    }

    // Per posIndex: numerals (for name resolution) and raw tokens (for chip structure)
    const posSectionNumerals = {};
    const posSectionTokens   = {};
    for (const c of chords) {
      if (!posSectionNumerals[c.posIndex]) posSectionNumerals[c.posIndex] = [];
      if (!posSectionTokens[c.posIndex])   posSectionTokens[c.posIndex]   = [];
      posSectionNumerals[c.posIndex].push(c.numeral);
      posSectionTokens[c.posIndex].push(c.token);
    }

    let cumBars = 0;
    const events = [];
    let prevUpper = null;

    for (let i = 0; i < shifts.length; i++) {
      if (resetEachLap) prevUpper = null;
      const rawShift   = shifts[i];
      const audioShift = clampShift(rawShift);

      for (const c of chords) {
        const voiced = (audioShift || smooth)
          ? makeChord(c.root + audioShift, c.quality, smooth ? prevUpper : null)
          : c;
        if (smooth) prevUpper = voiced.upperVoicing;

        events.push({
          time:             `${cumBars}m`,
          bars:             c.bars,
          notes:            voiced.notes,
          chipIndex:        c.chipIndex,
          sectionIndex:     c.sectionIndex,
          posIndex:         c.posIndex,
          shift:            rawShift,
          sectionNumerals:  posSectionNumerals[c.posIndex],
          sectionTokens:    posSectionTokens[c.posIndex],
        });
        cumBars += c.bars;
      }
    }

    let lastPos = -1;

    _part = new Tone.Part((time, ev) => {
      // ── Manual mode: intercept section boundaries ──
      if (_advance === 'manual' && ev.posIndex !== _currentPosIndex) {
        if (_pendingJump !== null) {
          const target = _pendingJump;
          _pendingJump = null;
          _currentPosIndex = target;
          _manualLap = 0;
          Tone.Transport.position = `${Math.round(posOffsets[_currentPosIndex] ?? 0)}:0:0`;
        } else {
          _manualLap++;
          Tone.Transport.position =
            `${Math.round(_manualLap * songBars + (posOffsets[_currentPosIndex] ?? 0))}:0:0`;
        }
        return;
      }

      // ── Auto mode: jump on demand ──
      if (_pendingJump !== null && _advance !== 'manual') {
        const target      = _pendingJump;
        _pendingJump      = null;
        const ticksPerBar = Tone.Transport.PPQ * 4;
        const currentBar  = Tone.Transport.ticks / ticksPerBar;
        const lapStart    = Math.floor(currentBar / songBars) * songBars;
        Tone.Transport.position = `${Math.round(lapStart + (posOffsets[target] ?? 0))}:0:0`;
        return;
      }

      // ── Play chord ──
      if (_synth) _safe(() => _synth.triggerAttackRelease(ev.notes, `${ev.bars}m`, time));

      // ── Visual callbacks (animation frame, not audio thread) ──
      Tone.Draw.schedule(() => {
        const sectionChanged = ev.posIndex !== lastPos;
        if (sectionChanged) lastPos = ev.posIndex;

        if (_onChordTick) {
          const resolvedChipNames = (ev.sectionNumerals || []).map(n =>
            resolvedChordName(n, ev.shift, _key, _cycle));
          _onChordTick({
            chipIndex:        ev.chipIndex,
            posIndex:         ev.posIndex,
            sectionIndex:     ev.sectionIndex,
            sectionChanged,
            resolvedChipNames,
            resolvedKey:      resolvedKeyName(_key, ev.shift, _cycle),
            bars:             ev.bars,
            sectionTokens:    sectionChanged ? ev.sectionTokens : null,
          });
        }
      }, time);

      const measureSec = Tone.Time('1m').toSeconds();
      for (let b = 1; b < ev.bars; b++) {
        Tone.Draw.schedule(() => { if (_onBarTick) _onBarTick(b); }, time + measureSec * b);
      }
    }, events);

    _part.loop    = true;
    _part.loopEnd = `${cumBars}m`;
    _part.start(0);

    _beatSeq = new Tone.Sequence((time, beat) => {
      Tone.Draw.schedule(() => { if (_onBeatTick) _onBeatTick(beat); }, time);
    }, [0, 1, 2, 3], '4n').start(0);

    return { songBars, posOffsets };
  }

  /** @param {object} style @param {boolean} drumsOn */
  function _buildDrums(style, drumsOn) {
    _kick = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 6,
      envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 1.4 },
    }).connect(_channels.drum);
    _kick.volume.value = -4;

    _snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
    }).connect(_channels.drum);
    _snare.volume.value = -10;

    _hat = new Tone.MetalSynth({
      frequency: 250, envelope: { attack: 0.002, decay: 0.05, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
    }).connect(_channels.drum);
    _hat.volume.value = -28;

    _kickSeq = new Tone.Sequence((time, hit) => {
      if (hit && _kick) _safe(() => _kick.triggerAttackRelease('C1', '8n', time));
    }, style.kick, '16n').start(0);

    _snareSeq = new Tone.Sequence((time, hit) => {
      if (hit && _snare) _safe(() => _snare.triggerAttackRelease('16n', time));
    }, style.snare, '16n').start(0);

    _hatSeq = new Tone.Sequence((time, hit) => {
      if (hit && _hat) _safe(() => _hat.triggerAttackRelease('32n', time));
    }, style.hat, '16n').start(0);

    const muted = !drumsOn;
    for (const s of [_kickSeq, _snareSeq, _hatSeq]) s.mute = muted;
  }

  /**
   * @param {import('./progression-core.js').SongChord[]} chords
   * @param {string} cycle
   * @param {object} style
   * @param {string} bassVariant
   * @param {boolean} bassOn
   */
  function _buildBass(chords, cycle, customCycleKeys, style, bassVariant, bassOn) {
    _bass = new Tone.MonoSynth({
      oscillator:     { type: 'sawtooth' },
      filter:         { Q: 2, type: 'lowpass' },
      envelope:       { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
      filterEnvelope: { attack: 0.01, decay: 0.2,  sustain: 0.4, release: 0.3, baseFrequency: 80, octaves: 2.5 },
    }).connect(_channels.bass);
    _bass.volume.value = -6;

    const patterns = style.bass[bassVariant] || style.bass.simple;
    const shifts    = getShiftsForCycle(cycle, customCycleKeys);
    const steps     = [];

    for (let i = 0; i < shifts.length; i++) {
      const shift = clampShift(shifts[i]);
      for (const c of chords) {
        const voiced  = shift ? makeChord(c.root + shift, c.quality) : c;
        const pattern = voiced.isMinor ? patterns.minor : patterns.major;
        const total   = c.bars * 16;
        for (let s = 0; s < total; s++) {
          const step = pattern[s % 16];
          if      (step === 'R') steps.push(voiced.bassRoot);
          else if (step === '3') steps.push(voiced.bassThird);
          else if (step === '5') steps.push(voiced.bassFifth);
          else                   steps.push(null);
        }
      }
    }

    _bassSeq = new Tone.Sequence((time, note) => {
      if (note && _bass) _safe(() => _bass.triggerAttackRelease(note, '8n', time));
    }, steps, '16n').start(0);

    _bassSeq.mute = !bassOn;
  }

  // ── Public interface ───────────────────────────────────────────────────────

  return {
    isPlaying: () => Tone.Transport.state === 'started',

    /**
     * @param {{
     *   chordSequence: import('./progression-core.js').SongChord[],
     *   tempo: number,
     *   style: object,
     *   bassVariant: string,
     *   voicing: string,
     *   advance: string,
     *   startPosIndex: number,
     *   key: string,
     *   cycle: string,
     *   mix: { chordVol: number, bassVol: number, drumVol: number, masterVol: number, chordsOn: boolean, bassOn: boolean, drumsOn: boolean },
     *   onChordTick: function,
     *   onBeatTick: function,
     *   onBarTick: function,
     * }} opts
     */
    async start({ chordSequence, tempo, style, bassVariant, voicing, advance,
                  startPosIndex = 0, key, cycle, customCycleKeys = [], mix,
                  onChordTick, onBeatTick, onBarTick }) {
      await Tone.start();
      if ('audioSession' in navigator) navigator.audioSession.type = 'playback';

      _key             = key;
      _cycle           = cycle;
      _customCycleKeys = customCycleKeys;
      _advance         = advance;
      _onChordTick  = onChordTick;
      _onBeatTick   = onBeatTick;
      _onBarTick    = onBarTick;
      _pendingJump  = null;
      _manualLap    = 0;
      _currentPosIndex = startPosIndex;
      _muteState    = { chordsOn: mix.chordsOn, bassOn: mix.bassOn, drumsOn: mix.drumsOn };

      _initChannels(mix);
      _teardown();
      _buildSynth();

      const { posOffsets } = _buildPart(chordSequence, cycle, customCycleKeys, voicing);
      _buildDrums(style, mix.drumsOn);
      _buildBass(chordSequence, cycle, customCycleKeys, style, bassVariant, mix.bassOn);

      Tone.Transport.bpm.value = tempo;
      if (advance === 'manual') _currentPosIndex = startPosIndex;
      Tone.Transport.position  = `${posOffsets[startPosIndex] ?? 0}:0:0`;
      Tone.Transport.start();
    },

    stop() {
      Tone.Transport.stop();
      _teardown();
      _pendingJump     = null;
      _manualLap       = 0;
      _currentPosIndex = 0;
    },

    /** Hot-swap chord sequence mid-playback (called inside scheduleOnce). */
    rebuild({ chordSequence, style, bassVariant, voicing, key, cycle, customCycleKeys = [] }) {
      if (Tone.Transport.state !== 'started') return;
      Tone.Transport.scheduleOnce(() => {
        if (Tone.Transport.state !== 'started') return;
        _key             = key;
        _cycle           = cycle;
        _customCycleKeys = customCycleKeys;
        try {
          _teardown();
          _buildSynth();
          _buildPart(chordSequence, cycle, customCycleKeys, voicing);
          _buildDrums(style, _muteState.drumsOn);
          _buildBass(chordSequence, cycle, customCycleKeys, style, bassVariant, _muteState.bassOn);
          if (_channels) _channels.chord.mute = !_muteState.chordsOn;
        } catch (e) {
          console.warn('Audio rebuild failed:', e);
        }
      }, '+0');
    },

    /** @param {number} bpm */
    setTempo(bpm) { Tone.Transport.bpm.value = bpm; },

    /**
     * @param {'chords'|'bass'|'drums'|'master'} channel
     * @param {number} value - 0–100
     */
    setVolume(channel, value) {
      if (!_channels) return;
      _volState[channel] = value;
      const db = _toDb(value);
      if      (channel === 'chords') _channels.chord.volume.value  = db;
      else if (channel === 'bass')   _channels.bass.volume.value   = db;
      else if (channel === 'drums')  _channels.drum.volume.value   = db;
      else if (channel === 'master') _channels.master.volume.value = db;
    },

    /**
     * @param {'chords'|'bass'|'drums'} channel
     * @param {boolean} muted
     */
    setMute(channel, muted) {
      _muteState[channel === 'chords' ? 'chordsOn' : channel === 'bass' ? 'bassOn' : 'drumsOn'] = !muted;
      if (channel === 'chords' && _channels) {
        _channels.chord.mute = muted;
        // Reapply volume in case Tone.js silently rejected a -Infinity assignment earlier
        if (!muted) _channels.chord.volume.value = _toDb(_volState.chords);
      } else if (channel === 'bass' && _channels) {
        _channels.bass.mute = muted;
        if (!muted) _channels.bass.volume.value = _toDb(_volState.bass);
      } else if (channel === 'drums') {
        for (const s of [_kickSeq, _snareSeq, _hatSeq]) if (s) s.mute = muted;
      }
    },

    /** @param {'auto'|'manual'} mode */
    setAdvance(mode) { _advance = mode; },

    /** @param {number} posIndex */
    queueJump(posIndex) { _pendingJump = posIndex; },

    cancelJump() { _pendingJump = null; },
  };
}
