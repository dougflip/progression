/**
 * progression-audio.ts
 * Tone.js-coupled audio engine. Accepts a state snapshot and plays it.
 * Knows nothing about DOM or app state — fires callbacks with resolved
 * display data for the host to consume.
 */

import * as Tone from "tone";
import {
  resolvedChordName,
  resolvedKeyName,
  clampShift,
  makeChord,
  getShiftsForCycle,
  type ChordQuality,
  type SongChord,
  type StyleDef,
  type DrumOption,
  type ChordTickEvent,
  type AudioStartOpts,
  type AudioRebuildOpts,
  type AudioEngine,
} from "./progression-core.js";

interface Channels {
  chord: Tone.Channel;
  bass: Tone.Channel;
  drum: Tone.Channel;
  master: Tone.Channel;
}

// Single-lap event — shift is resolved at callback time via _currentShift
interface PartEvent {
  time: string;
  bars: number;
  root: number;
  quality: ChordQuality;
  chipIndex: number;
  sectionIndex: number;
  posIndex: number;
  sectionNumerals: string[];
  sectionTokens: string[];
}

// Symbolic bass step — actual note resolved dynamically from _currentShift at callback time
interface BassStepItem {
  chordIdx: number;
  noteType: "R" | "3" | "5" | null;
}

interface PartOffsets {
  songBars: number;
  posOffsets: Record<number, number>;
  chipOffsets: Record<number, Record<number, number>>;
}

function safeCall(obj: unknown, method: "stop" | "dispose"): void {
  if (!obj) return;
  try {
    (obj as Record<string, () => void>)[method]?.();
  } catch (e) {
    console.warn(`Tone.${method} suppressed:`, e);
  }
}

export function makeProgressionAudio(): AudioEngine {
  // ── Audio nodes ────────────────────────────────────────────────────────────
  let _channels: Channels | null = null; // created once, survives rebuild

  // Sample players — created immediately so loading begins before first play.
  // Connected to drum channel in _initChannels. Never torn down.
  const _sp = {
    kick: new Tone.Player("samples/kick.ogg"),
    snare: new Tone.Player("samples/snare1.ogg"),
    hat: new Tone.Player("samples/hihat-closed.ogg"),
    hatOpen: new Tone.Player("samples/hihat-open.ogg"),
    crash: new Tone.Player("samples/crash-l.ogg"),
    ride: new Tone.Player("samples/ride.ogg").set({ volume: -8 }),
    rideBell: new Tone.Player("samples/ride-bell.ogg").set({ volume: -8 }),
    tom: new Tone.Player("samples/tom1.ogg"),
    tom2: new Tone.Player("samples/tom2.ogg"),
  };

  let _synth: Tone.PolySynth | null = null;
  let _reverb: Tone.Reverb | null = null;
  let _part: Tone.Part<PartEvent> | null = null;
  let _kick: Tone.MembraneSynth | null = null;
  let _snare: Tone.NoiseSynth | null = null;
  let _hat: Tone.MetalSynth | null = null;
  let _hatOpen: Tone.NoiseSynth | null = null;
  let _hatOpenFilter: Tone.Filter | null = null;
  let _crash: Tone.NoiseSynth | null = null;
  let _crashFilter: Tone.Filter | null = null;
  let _ride: Tone.NoiseSynth | null = null;
  let _rideFilter: Tone.Filter | null = null;
  let _tom: Tone.MembraneSynth | null = null;
  let _tom2: Tone.MembraneSynth | null = null;
  let _kickSeq: Tone.Sequence<number> | null = null;
  let _snareSeq: Tone.Sequence<number> | null = null;
  let _hatSeq: Tone.Sequence<number> | null = null;
  let _hatOpenSeq: Tone.Sequence<number> | null = null;
  let _crashSeq: Tone.Sequence<number> | null = null;
  let _rideSeq: Tone.Sequence<number> | null = null;
  let _rideBellSeq: Tone.Sequence<number> | null = null;
  let _tomSeq: Tone.Sequence<number> | null = null;
  let _tom2Seq: Tone.Sequence<number> | null = null;
  let _bass: Tone.MonoSynth | null = null;
  let _bassSeq: Tone.Sequence<BassStepItem> | null = null;
  let _beatSeq: Tone.Sequence<number> | null = null;

  // ── Playback state ─────────────────────────────────────────────────────────
  let _pendingJump: number | null = null;
  let _pendingKeyJump: number | null = null;
  let _currentPosIndex = 0;
  let _currentLap = 0; // transport-derived; used only for lap boundary detection
  let _songBars = 0;
  let _advance = "auto";
  let _muteState = { chordsOn: true, bassOn: true, drumsOn: true };
  let _volState = { chords: 50, bass: 100, drums: 100, master: 100 };

  // ── Cycle / key state ──────────────────────────────────────────────────────
  let _shifts: number[] = [0];
  let _currentShiftIndex = 0; // which key in the cycle we're on (reported as lapIndex)
  let _currentShift = 0; // _shifts[_currentShiftIndex]
  let _storedChords: SongChord[] = []; // referenced by bass callback for dynamic note lookup

  // ── Voice leading state (engine-level so it persists across Part loop iterations) ──
  let _prevUpper: number[] | null = null;
  let _voicingSmooth = false;
  let _voicingResetEachLap = false;

  // ── Active start params (needed inside Draw callbacks) ─────────────────────
  let _key = "C";
  let _cycle = "none";
  let _customCycleKeys: string[] = [];

  // ── Callbacks ──────────────────────────────────────────────────────────────
  let _onChordTick: ((ev: ChordTickEvent) => void) | null = null;
  let _onBeatTick: ((beat: number) => void) | null = null;
  let _onBarTick: ((bar: number) => void) | null = null;

  // ── Private helpers ────────────────────────────────────────────────────────

  function _toDb(v: number): number {
    if (!Number.isFinite(v) || v <= 0) return -100; // Tone.js may silently ignore -Infinity
    return Tone.gainToDb(Math.min(100, v) / 100);
  }

  function _safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.warn("Tone suppressed:", e);
    }
  }

  function _initChannels(): void {
    if (_channels) return;
    const master = new Tone.Channel().toDestination();
    const chord = new Tone.Channel().connect(master);
    const bass = new Tone.Channel().connect(master);
    const drum = new Tone.Channel().connect(master);
    for (const player of Object.values(_sp)) player.connect(drum);
    _channels = { chord, bass, drum, master };
  }

  function _syncMixToChannels(mix: {
    chordVol: number;
    bassVol: number;
    drumVol: number;
    masterVol: number;
    chordsOn: boolean;
    bassOn: boolean;
  }): void {
    _volState = {
      chords: mix.chordVol,
      bass: mix.bassVol,
      drums: mix.drumVol,
      master: mix.masterVol,
    };
    _channels!.chord.volume.value = _toDb(mix.chordVol);
    _channels!.bass.volume.value = _toDb(mix.bassVol);
    _channels!.drum.volume.value = _toDb(mix.drumVol);
    _channels!.master.volume.value = _toDb(mix.masterVol);
    _channels!.chord.mute = !mix.chordsOn;
    _channels!.bass.mute = !mix.bassOn;
  }

  function _teardown(cancelTransport = true, keepSynth = false): void {
    safeCall(_part, "stop");
    safeCall(_part, "dispose");
    _part = null;
    for (const s of [
      _kickSeq,
      _snareSeq,
      _hatSeq,
      _hatOpenSeq,
      _crashSeq,
      _rideSeq,
      _rideBellSeq,
      _tomSeq,
      _tom2Seq,
      _bassSeq,
      _beatSeq,
    ]) {
      safeCall(s, "stop");
      safeCall(s, "dispose");
    }
    _kickSeq =
      _snareSeq =
      _hatSeq =
      _hatOpenSeq =
      _crashSeq =
      _rideSeq =
      _rideBellSeq =
      _tomSeq =
      _tom2Seq =
      _bassSeq =
      _beatSeq =
        null;
    if (!keepSynth) {
      if (_synth) _safe(() => _synth!.releaseAll());
    }
    for (const v of keepSynth
      ? [
          _kick,
          _snare,
          _hat,
          _hatOpen,
          _hatOpenFilter,
          _crash,
          _crashFilter,
          _ride,
          _rideFilter,
          _tom,
          _tom2,
          _bass,
        ]
      : [
          _synth,
          _kick,
          _snare,
          _hat,
          _hatOpen,
          _hatOpenFilter,
          _crash,
          _crashFilter,
          _ride,
          _rideFilter,
          _tom,
          _tom2,
          _bass,
          _reverb,
        ])
      safeCall(v, "dispose");
    if (!keepSynth) {
      _synth = null;
      _reverb = null;
    }
    _kick =
      _snare =
      _hat =
      _hatOpen =
      _hatOpenFilter =
      _crash =
      _crashFilter =
      _ride =
      _rideFilter =
      _tom =
      _tom2 =
      _bass =
        null;
    _safe(() => Tone.Draw.cancel(0));
    if (cancelTransport) _safe(() => Tone.Transport.cancel());
  }

  function _buildSynth(): void {
    _reverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(_channels!.chord);
    _synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1.5 },
    }).connect(_reverb);
    _synth.volume.value = -13;
  }

  function _buildPart(chords: SongChord[], voicing: string): PartOffsets {
    _voicingSmooth = voicing === "voice-lead" || voicing === "voice-lead-loop";
    _voicingResetEachLap = voicing === "voice-lead-loop";
    _prevUpper = null; // reset voice leading on each build/rebuild

    const songBars = chords.reduce((s, c) => s + c.bars, 0);
    _songBars = songBars;

    const posOffsets: Record<number, number> = {};
    const chipOffsets: Record<number, Record<number, number>> = {};
    let offsetAcc = 0;
    for (const c of chords) {
      if (!(c.posIndex in posOffsets)) posOffsets[c.posIndex] = offsetAcc;
      if (!chipOffsets[c.posIndex]) chipOffsets[c.posIndex] = {};
      chipOffsets[c.posIndex]![c.chipIndex] = offsetAcc;
      offsetAcc += c.bars;
    }

    const posSectionNumerals: Record<number, string[]> = {};
    const posSectionTokens: Record<number, string[]> = {};
    for (const c of chords) {
      if (!posSectionNumerals[c.posIndex]) posSectionNumerals[c.posIndex] = [];
      if (!posSectionTokens[c.posIndex]) posSectionTokens[c.posIndex] = [];
      posSectionNumerals[c.posIndex]!.push(c.numeral);
      posSectionTokens[c.posIndex]!.push(c.token);
    }

    // Build events for a single lap — notes resolved dynamically at callback time
    let cumBars = 0;
    const events: PartEvent[] = [];
    for (const c of chords) {
      events.push({
        time: `${cumBars}m`,
        bars: c.bars,
        root: c.root,
        quality: c.quality,
        chipIndex: c.chipIndex,
        sectionIndex: c.sectionIndex,
        posIndex: c.posIndex,
        sectionNumerals: posSectionNumerals[c.posIndex] ?? [],
        sectionTokens: posSectionTokens[c.posIndex] ?? [],
      });
      cumBars += c.bars;
    }

    let lastPos = -1;

    _part = new Tone.Part<PartEvent>((time, ev) => {
      // ── Lap boundary: advance key or fire queued key jump (auto mode) ───────
      // transportLapIndex counts how many times the single-lap Part has looped.
      const transportLapIndex = Math.floor(
        Tone.Transport.ticks / (Tone.Transport.PPQ * 4) / songBars,
      );
      if (transportLapIndex > _currentLap) {
        _currentLap = transportLapIndex;
        if (_pendingKeyJump !== null) {
          // Explicit key jump: fire at lap boundary in both auto and manual mode.
          // In multi-section manual mode the transport never reaches a lap boundary
          // (section intercept keeps seeking back), so this only fires for
          // single-section arrangements where there is no section boundary to use.
          _currentShiftIndex = _pendingKeyJump;
          _pendingKeyJump = null;
          _currentShift = _shifts[_currentShiftIndex] ?? 0;
          if (_voicingResetEachLap) _prevUpper = null;
        } else if (_advance !== "manual") {
          // Auto mode only: advance to the next key naturally.
          // Manual mode: key never changes without an explicit user tap.
          _currentShiftIndex = (_currentShiftIndex + 1) % _shifts.length;
          _currentShift = _shifts[_currentShiftIndex] ?? 0;
          if (_voicingResetEachLap) _prevUpper = null;
        }
        // No transport seek, no return — chord plays immediately with updated shift
      }

      // ── Manual mode: intercept section boundaries ────────────────────────────
      if (_advance === "manual" && ev.posIndex !== _currentPosIndex) {
        if (_pendingJump !== null) {
          const target = _pendingJump;
          _pendingJump = null;
          _currentPosIndex = target;
        }
        // Key changes in manual mode fire at section boundaries (fully user-controlled)
        if (_pendingKeyJump !== null) {
          _currentShiftIndex = _pendingKeyJump;
          _pendingKeyJump = null;
          _currentShift = _shifts[_currentShiftIndex] ?? 0;
          if (_voicingResetEachLap) _prevUpper = null;
          // _currentPosIndex is intentionally NOT reset — user keeps their held section
        }
        Tone.Transport.position = `${Math.round(posOffsets[_currentPosIndex] ?? 0)}:0:0`;
        return;
      }

      // ── Auto mode: section jump on demand ───────────────────────────────────
      if (_pendingJump !== null && _advance !== "manual") {
        const target = _pendingJump;
        _pendingJump = null;
        Tone.Transport.position = `${Math.round(posOffsets[target] ?? 0)}:0:0`;
        return;
      }

      // ── Compute voiced notes from current shift ──────────────────────────────
      const audioShift = clampShift(_currentShift);
      const voiced = makeChord(
        ev.root + audioShift,
        ev.quality,
        _voicingSmooth ? _prevUpper : null,
      );
      if (_voicingSmooth) _prevUpper = voiced.upperVoicing;

      // ── Play chord ──────────────────────────────────────────────────────────
      if (_synth) _safe(() => _synth!.triggerAttackRelease(voiced.notes, `${ev.bars}m`, time));

      // ── Visual callbacks (animation frame, not audio thread) ─────────────────
      // Capture shift state now so Draw callbacks reflect the shift at play time,
      // not whatever _currentShift happens to be when the animation frame fires.
      const shiftSnapshot = _currentShift;
      const shiftIndexSnapshot = _currentShiftIndex;
      Tone.Draw.schedule(() => {
        const sectionChanged = ev.posIndex !== lastPos;
        if (sectionChanged) lastPos = ev.posIndex;

        if (_onChordTick) {
          const resolvedChipNames = ev.sectionNumerals.map((n) =>
            resolvedChordName(n, shiftSnapshot, _key, _cycle),
          );
          _onChordTick({
            chipIndex: ev.chipIndex,
            posIndex: ev.posIndex,
            sectionIndex: ev.sectionIndex,
            sectionChanged,
            resolvedChipNames,
            resolvedKey: resolvedKeyName(_key, shiftSnapshot, _cycle),
            bars: ev.bars,
            sectionTokens: sectionChanged ? ev.sectionTokens : null,
            lapIndex: shiftIndexSnapshot,
          });
        }
      }, time);

      const measureSec = Tone.Time("1m").toSeconds() as number;
      for (let b = 1; b < ev.bars; b++) {
        Tone.Draw.schedule(
          () => {
            if (_onBarTick) _onBarTick(b);
          },
          time + measureSec * b,
        );
      }
    }, events);

    _part.loop = true;
    _part.loopEnd = `${cumBars}m`;
    _part.start(0);

    _beatSeq = new Tone.Sequence<number>(
      (time, beat) => {
        Tone.Draw.schedule(() => {
          if (_onBeatTick) _onBeatTick(beat);
        }, time);
      },
      [0, 1, 2, 3],
      "4n",
    ).start(0);

    return { songBars, posOffsets, chipOffsets };
  }

  function _triggerDrum(time: number, player: Tone.Player, fallback: () => void): void {
    if (player.loaded) {
      _safe(() => {
        player.stop(time);
        player.start(time);
      });
    } else {
      _safe(fallback);
    }
  }

  function _buildDrums(style: StyleDef, drumVariant: string, drumsOn: boolean): void {
    _kick = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 1.4 },
    }).connect(_channels!.drum);
    _kick.volume.value = -4;

    _snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
    }).connect(_channels!.drum);
    _snare.volume.value = -10;

    _hat = new Tone.MetalSynth({
      envelope: { attack: 0.002, decay: 0.05, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).connect(_channels!.drum);
    _hat.frequency.value = 250;
    _hat.volume.value = -28;

    _hatOpenFilter = new Tone.Filter({
      type: "highpass",
      frequency: 7000,
      Q: 0.5,
    }).connect(_channels!.drum);
    _hatOpen = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.5 },
    }).connect(_hatOpenFilter);
    _hatOpen.volume.value = -18;

    _crashFilter = new Tone.Filter({
      type: "highpass",
      frequency: 5000,
      Q: 0.5,
    }).connect(_channels!.drum);
    _crash = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 1.2 },
    }).connect(_crashFilter);
    _crash.volume.value = -14;

    _rideFilter = new Tone.Filter({
      type: "highpass",
      frequency: 6000,
      Q: 0.5,
    }).connect(_channels!.drum);
    _ride = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 },
    }).connect(_rideFilter);
    _ride.volume.value = -22;

    _tom = new Tone.MembraneSynth({
      pitchDecay: 0.025,
      octaves: 3,
      envelope: { attack: 0.0006, decay: 0.3, sustain: 0, release: 0.8 },
    }).connect(_channels!.drum);
    _tom.volume.value = -4;

    _tom2 = new Tone.MembraneSynth({
      pitchDecay: 0.025,
      octaves: 3,
      envelope: { attack: 0.0006, decay: 0.3, sustain: 0, release: 0.8 },
    }).connect(_channels!.drum);
    _tom2.volume.value = -4;

    const v = style[drumVariant as DrumOption] ?? style.simple;

    _kickSeq = new Tone.Sequence<number>(
      (time, hit) => {
        if (hit) _triggerDrum(time, _sp.kick, () => _kick!.triggerAttackRelease("C1", "8n", time));
      },
      v.kick,
      "16n",
    ).start(0);

    _snareSeq = new Tone.Sequence<number>(
      (time, hit) => {
        if (hit) _triggerDrum(time, _sp.snare, () => _snare!.triggerAttackRelease("16n", time));
      },
      v.snare,
      "16n",
    ).start(0);

    _hatSeq = new Tone.Sequence<number>(
      (time, hit) => {
        if (hit) {
          _safe(() => _sp.hatOpen.stop(time));
          _triggerDrum(time, _sp.hat, () => _hat!.triggerAttackRelease("32n", time));
        }
      },
      v.hat,
      "16n",
    ).start(0);

    if (v.hatOpen) {
      _hatOpenSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit)
            _triggerDrum(time, _sp.hatOpen, () => _hatOpen!.triggerAttackRelease("8n", time));
        },
        v.hatOpen,
        "16n",
      ).start(0);
    }

    if (v.crash) {
      _crashSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit) _triggerDrum(time, _sp.crash, () => _crash!.triggerAttackRelease("4n", time));
        },
        v.crash,
        "16n",
      ).start(0);
    }

    if (v.ride) {
      _rideSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit) _triggerDrum(time, _sp.ride, () => _ride!.triggerAttackRelease("32n", time));
        },
        v.ride,
        "16n",
      ).start(0);
    }

    if (v.rideBell) {
      _rideBellSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit) _triggerDrum(time, _sp.rideBell, () => _ride!.triggerAttackRelease("32n", time));
        },
        v.rideBell,
        "16n",
      ).start(0);
    }

    if (v.tom) {
      _tomSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit) _triggerDrum(time, _sp.tom, () => _tom!.triggerAttackRelease("A1", "8n", time));
        },
        v.tom,
        "16n",
      ).start(0);
    }

    if (v.tom2) {
      _tom2Seq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit)
            _triggerDrum(time, _sp.tom2, () => _tom2!.triggerAttackRelease("D2", "8n", time));
        },
        v.tom2,
        "16n",
      ).start(0);
    }

    const muted = !drumsOn;
    for (const s of [
      _kickSeq,
      _snareSeq,
      _hatSeq,
      _hatOpenSeq,
      _crashSeq,
      _rideSeq,
      _rideBellSeq,
      _tomSeq,
      _tom2Seq,
    ])
      if (s) s.mute = muted;
  }

  function _buildBass(chords: SongChord[], style: StyleDef, bassVariant: string): void {
    _bass = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { Q: 2, type: "lowpass" },
      envelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.4,
        release: 0.3,
        baseFrequency: 80,
        octaves: 2.5,
      },
    }).connect(_channels!.bass);
    _bass.volume.value = -6;

    const patterns = (style[bassVariant as DrumOption] ?? style.simple).bass;

    // Build symbolic steps for one lap — pattern selection uses base chord quality
    // (shift-independent), actual note resolved dynamically at callback time.
    const steps: BassStepItem[] = [];
    for (let ci = 0; ci < chords.length; ci++) {
      const c = chords[ci]!;
      const pattern = c.isMinor ? patterns.minor : patterns.major;
      const total = c.bars * 16;
      for (let s = 0; s < total; s++) {
        const step = pattern[s % 16];
        steps.push({
          chordIdx: ci,
          noteType: step === "R" ? "R" : step === "3" ? "3" : step === "5" ? "5" : null,
        });
      }
    }

    _bassSeq = new Tone.Sequence<BassStepItem>(
      (time, item) => {
        if (item.noteType === null || !_bass) return;
        const c = _storedChords[item.chordIdx];
        if (!c) return;
        const shift = clampShift(_currentShift);
        // When shift=0 reuse pre-computed chord data; otherwise compute shifted chord
        const voiced = shift ? makeChord(c.root + shift, c.quality) : c;
        const note =
          item.noteType === "R"
            ? voiced.bassRoot
            : item.noteType === "3"
              ? voiced.bassThird
              : voiced.bassFifth;
        _safe(() => _bass!.triggerAttackRelease(note, "8n", time));
      },
      steps,
      "16n",
    ).start(0);
  }

  // ── Public interface ───────────────────────────────────────────────────────

  return {
    isPlaying: () => Tone.Transport.state === "started",

    async start({
      chordSequence,
      tempo,
      style,
      bassVariant,
      drumVariant,
      voicing,
      advance,
      startPosIndex = 0,
      startChipIndex = 0,
      startLapIndex = 0,
      key,
      cycle,
      customCycleKeys = [],
      mix,
      onChordTick,
      onBeatTick,
      onBarTick,
    }: AudioStartOpts): Promise<void> {
      await Tone.start();
      if ("audioSession" in navigator)
        (navigator as unknown as { audioSession: { type: string } }).audioSession.type = "playback";

      _key = key;
      _cycle = cycle;
      _customCycleKeys = customCycleKeys;
      _advance = advance;
      _onChordTick = onChordTick;
      _onBeatTick = onBeatTick;
      _onBarTick = onBarTick;
      _pendingJump = null;
      _pendingKeyJump = null;
      _currentLap = 0;
      _currentPosIndex = startPosIndex;
      _muteState = { chordsOn: mix.chordsOn, bassOn: mix.bassOn, drumsOn: mix.drumsOn };

      // Cycle / key state
      _shifts = getShiftsForCycle(cycle, customCycleKeys);
      _currentShiftIndex = startLapIndex;
      _currentShift = _shifts[startLapIndex] ?? 0;
      _storedChords = chordSequence;

      _initChannels();
      _syncMixToChannels(mix);
      _teardown();
      _buildSynth();

      const { posOffsets, chipOffsets } = _buildPart(chordSequence, voicing);
      _buildDrums(style, drumVariant, mix.drumsOn);
      _buildBass(chordSequence, style, bassVariant);

      Tone.Transport.bpm.value = tempo;
      if (advance === "manual") _currentPosIndex = startPosIndex;
      // Transport start position: bar offset within one lap (no lap multiplier —
      // the lap index is captured in _currentShiftIndex instead).
      const startBarOffset =
        chipOffsets[startPosIndex]?.[startChipIndex] ?? posOffsets[startPosIndex] ?? 0;
      Tone.Transport.position = `${startBarOffset}:0:0`;
      Tone.Transport.start();
    },

    stop(): void {
      Tone.Transport.stop();
      _teardown();
      _pendingJump = null;
      _pendingKeyJump = null;
      _currentLap = 0;
      _currentPosIndex = 0;
      _currentShiftIndex = 0;
      _currentShift = 0;
      _prevUpper = null;
    },

    rebuild({
      chordSequence,
      style,
      bassVariant,
      drumVariant,
      voicing,
      key,
      cycle,
      customCycleKeys = [],
    }: AudioRebuildOpts): void {
      if (Tone.Transport.state !== "started") return;
      _key = key;
      _cycle = cycle;
      _customCycleKeys = customCycleKeys;

      // Update shift array and clamp index in case cycle length changed
      _shifts = getShiftsForCycle(cycle, customCycleKeys);
      _currentShiftIndex = Math.min(_currentShiftIndex, _shifts.length - 1);
      _currentShift = _shifts[_currentShiftIndex] ?? 0;
      _storedChords = chordSequence;

      try {
        _teardown(false, true);
        _buildPart(chordSequence, voicing); // sets _songBars
        _buildDrums(style, drumVariant, _muteState.drumsOn);
        _buildBass(chordSequence, style, bassVariant);
        // Sync _currentLap to current transport position so the first callback
        // after rebuild doesn't trigger a false lap boundary.
        _currentLap = Math.floor(Tone.Transport.ticks / (Tone.Transport.PPQ * 4) / _songBars);
        if (_channels) {
          _channels.chord.mute = !_muteState.chordsOn;
          _channels.bass.mute = !_muteState.bassOn;
        }
      } catch (e) {
        console.warn("Audio rebuild failed:", e);
      }
    },

    setTempo(bpm: number): void {
      Tone.Transport.bpm.value = bpm;
    },

    setVolume(channel: "chords" | "bass" | "drums" | "master", value: number): void {
      if (!_channels) return;
      _volState[
        channel === "chords"
          ? "chords"
          : channel === "bass"
            ? "bass"
            : channel === "drums"
              ? "drums"
              : "master"
      ] = value;
      // Skip channel assignment while muted — Tone.js volume.value can override the mute state.
      // The new value is stored in _volState and applied when the channel is unmuted.
      if (channel === "chords" && !_muteState.chordsOn) return;
      if (channel === "bass" && !_muteState.bassOn) return;
      const db = _toDb(value);
      if (channel === "chords") _channels.chord.volume.value = db;
      else if (channel === "bass") _channels.bass.volume.value = db;
      else if (channel === "drums") _channels.drum.volume.value = db;
      else if (channel === "master") _channels.master.volume.value = db;
    },

    setMute(channel: "chords" | "bass" | "drums", muted: boolean): void {
      _muteState[channel === "chords" ? "chordsOn" : channel === "bass" ? "bassOn" : "drumsOn"] =
        !muted;
      if (channel === "chords" && _channels) {
        _channels.chord.mute = muted;
        if (!muted) _channels.chord.volume.value = _toDb(_volState.chords);
      } else if (channel === "bass" && _channels) {
        _channels.bass.mute = muted;
        if (_bassSeq) _bassSeq.mute = muted;
        if (!muted) _channels.bass.volume.value = _toDb(_volState.bass);
      } else if (channel === "drums") {
        for (const s of [
          _kickSeq,
          _snareSeq,
          _hatSeq,
          _hatOpenSeq,
          _crashSeq,
          _rideSeq,
          _rideBellSeq,
          _tomSeq,
          _tom2Seq,
        ])
          if (s) s.mute = muted;
      }
    },

    setAdvance(mode: string): void {
      _advance = mode;
    },

    queueJump(posIndex: number): void {
      _pendingJump = posIndex;
    },

    cancelJump(): void {
      _pendingJump = null;
    },

    queueKeyJump(lapIndex: number): void {
      _pendingKeyJump = lapIndex;
    },

    cancelKeyJump(): void {
      _pendingKeyJump = null;
    },

    getPendingJump: (): number | null => _pendingJump,
    getPendingKeyJump: (): number | null => _pendingKeyJump,
  };
}
