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

interface PartEvent {
  time: string;
  bars: number;
  notes: string[];
  chipIndex: number;
  sectionIndex: number;
  posIndex: number;
  shift: number;
  sectionNumerals: string[];
  sectionTokens: string[];
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
    openHat: new Tone.Player("samples/hihat-open.ogg"),
    crash: new Tone.Player("samples/crash-l.ogg"),
    ride: new Tone.Player("samples/ride.ogg"),
    tom: new Tone.Player("samples/tom1.ogg"),
    tom2: new Tone.Player("samples/tom2.ogg"),
  };

  let _synth: Tone.PolySynth | null = null;
  let _reverb: Tone.Reverb | null = null;
  let _part: Tone.Part<PartEvent> | null = null;
  let _kick: Tone.MembraneSynth | null = null;
  let _snare: Tone.NoiseSynth | null = null;
  let _hat: Tone.MetalSynth | null = null;
  let _openHat: Tone.NoiseSynth | null = null;
  let _openHatFilter: Tone.Filter | null = null;
  let _crash: Tone.NoiseSynth | null = null;
  let _crashFilter: Tone.Filter | null = null;
  let _ride: Tone.NoiseSynth | null = null;
  let _rideFilter: Tone.Filter | null = null;
  let _clap: Tone.NoiseSynth | null = null;
  let _clapFilter: Tone.Filter | null = null;
  let _tom: Tone.MembraneSynth | null = null;
  let _tom2: Tone.MembraneSynth | null = null;
  let _kickSeq: Tone.Sequence<number> | null = null;
  let _snareSeq: Tone.Sequence<number> | null = null;
  let _hatSeq: Tone.Sequence<number> | null = null;
  let _openHatSeq: Tone.Sequence<number> | null = null;
  let _crashSeq: Tone.Sequence<number> | null = null;
  let _rideSeq: Tone.Sequence<number> | null = null;
  let _clapSeq: Tone.Sequence<number> | null = null;
  let _tomSeq: Tone.Sequence<number> | null = null;
  let _tom2Seq: Tone.Sequence<number> | null = null;
  let _bass: Tone.MonoSynth | null = null;
  let _bassSeq: Tone.Sequence<string | null> | null = null;
  let _beatSeq: Tone.Sequence<number> | null = null;

  // ── Playback state ─────────────────────────────────────────────────────────
  let _pendingJump: number | null = null;
  let _pendingKeyJump: number | null = null;
  let _currentPosIndex = 0;
  let _currentLap = 0;
  let _songBars = 0;
  let _manualLap = 0;
  let _advance = "auto";
  let _muteState = { chordsOn: true, bassOn: true, drumsOn: true };
  // Track last-set volume per channel so setMute can reapply it on unmute,
  // guarding against Tone.js silently ignoring -Infinity assignments.
  let _volState = { chords: 50, bass: 100, drums: 100, master: 100 };

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
    if (!Number.isFinite(v) || v <= 0) return -Infinity;
    return Tone.gainToDb(Math.min(100, v) / 100);
  }

  function _safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.warn("Tone suppressed:", e);
    }
  }

  function _initChannels({
    chordVol,
    bassVol,
    drumVol,
    masterVol,
    chordsOn,
    bassOn,
  }: {
    chordVol: number;
    bassVol: number;
    drumVol: number;
    masterVol: number;
    chordsOn: boolean;
    bassOn: boolean;
  }): void {
    if (_channels) return;
    _volState = { chords: chordVol, bass: bassVol, drums: drumVol, master: masterVol };
    const master = new Tone.Channel().toDestination();
    const chord = new Tone.Channel().connect(master);
    const bass = new Tone.Channel().connect(master);
    const drum = new Tone.Channel().connect(master);
    chord.volume.value = _toDb(chordVol);
    bass.volume.value = _toDb(bassVol);
    drum.volume.value = _toDb(drumVol);
    master.volume.value = _toDb(masterVol);
    chord.mute = !chordsOn;
    bass.mute = !bassOn;
    for (const player of Object.values(_sp)) player.connect(drum);
    _channels = { chord, bass, drum, master };
  }

  function _teardown(): void {
    safeCall(_part, "stop");
    safeCall(_part, "dispose");
    _part = null;
    for (const s of [
      _kickSeq,
      _snareSeq,
      _hatSeq,
      _openHatSeq,
      _crashSeq,
      _rideSeq,
      _clapSeq,
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
      _openHatSeq =
      _crashSeq =
      _rideSeq =
      _clapSeq =
      _tomSeq =
      _tom2Seq =
      _bassSeq =
      _beatSeq =
        null;
    for (const v of [
      _synth,
      _kick,
      _snare,
      _hat,
      _openHat,
      _openHatFilter,
      _crash,
      _crashFilter,
      _ride,
      _rideFilter,
      _clap,
      _clapFilter,
      _tom,
      _tom2,
      _bass,
      _reverb,
    ])
      safeCall(v, "dispose");
    _synth =
      _kick =
      _snare =
      _hat =
      _openHat =
      _openHatFilter =
      _crash =
      _crashFilter =
      _ride =
      _rideFilter =
      _clap =
      _clapFilter =
      _tom =
      _tom2 =
      _bass =
      _reverb =
        null;
    _safe(() => Tone.Draw.cancel(0));
    _safe(() => Tone.Transport.cancel());
  }

  function _buildSynth(): void {
    _reverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(_channels!.chord);
    _synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1.5 },
    }).connect(_reverb);
    _synth.volume.value = -13;
  }

  function _buildPart(
    chords: SongChord[],
    cycle: string,
    customCycleKeys: string[],
    voicing: string,
  ): PartOffsets {
    const shifts = getShiftsForCycle(cycle, customCycleKeys);
    const smooth = voicing === "voice-lead" || voicing === "voice-lead-loop";
    const resetEachLap = voicing === "voice-lead-loop";

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

    let cumBars = 0;
    const events: PartEvent[] = [];
    let prevUpper: number[] | null = null;

    for (let i = 0; i < shifts.length; i++) {
      if (resetEachLap) prevUpper = null;
      const rawShift = shifts[i]!;
      const audioShift = clampShift(rawShift);

      for (const c of chords) {
        const voiced: ReturnType<typeof makeChord> =
          audioShift || smooth
            ? makeChord(c.root + audioShift, c.quality, smooth ? prevUpper : null)
            : c;
        if (smooth) prevUpper = voiced.upperVoicing;

        events.push({
          time: `${cumBars}m`,
          bars: c.bars,
          notes: voiced.notes,
          chipIndex: c.chipIndex,
          sectionIndex: c.sectionIndex,
          posIndex: c.posIndex,
          shift: rawShift,
          sectionNumerals: posSectionNumerals[c.posIndex] ?? [],
          sectionTokens: posSectionTokens[c.posIndex] ?? [],
        });
        cumBars += c.bars;
      }
    }

    let lastPos = -1;

    _part = new Tone.Part<PartEvent>((time, ev) => {
      // ── Key jump: fire at the next lap boundary (end of full song) ──
      const lapIndex = Math.floor(Tone.Transport.ticks / (Tone.Transport.PPQ * 4) / songBars);
      if (lapIndex > _currentLap) {
        _currentLap = lapIndex;
        if (_pendingKeyJump !== null) {
          const lap = _pendingKeyJump;
          _pendingKeyJump = null;
          _currentPosIndex = 0;
          _manualLap = 0;
          _currentLap = lap - 1;
          Tone.Transport.position = `${Math.round(lap * songBars)}:0:0`;
          return;
        }
      }

      // ── Manual mode: intercept section boundaries ──
      if (_advance === "manual" && ev.posIndex !== _currentPosIndex) {
        if (_pendingJump !== null) {
          const target = _pendingJump;
          _pendingJump = null;
          _currentPosIndex = target;
          _manualLap = 0;
          Tone.Transport.position = `${Math.round(posOffsets[_currentPosIndex] ?? 0)}:0:0`;
        } else {
          _manualLap++;
          Tone.Transport.position = `${Math.round(_manualLap * songBars + (posOffsets[_currentPosIndex] ?? 0))}:0:0`;
        }
        return;
      }

      // ── Auto mode: jump on demand ──
      if (_pendingJump !== null && _advance !== "manual") {
        const target = _pendingJump;
        _pendingJump = null;
        const ticksPerBar = Tone.Transport.PPQ * 4;
        const currentBar = Tone.Transport.ticks / ticksPerBar;
        const lapStart = Math.floor(currentBar / songBars) * songBars;
        Tone.Transport.position = `${Math.round(lapStart + (posOffsets[target] ?? 0))}:0:0`;
        return;
      }

      // ── Play chord ──
      if (_synth) _safe(() => _synth!.triggerAttackRelease(ev.notes, `${ev.bars}m`, time));

      // ── Visual callbacks (animation frame, not audio thread) ──
      Tone.Draw.schedule(() => {
        const sectionChanged = ev.posIndex !== lastPos;
        if (sectionChanged) lastPos = ev.posIndex;

        if (_onChordTick) {
          const resolvedChipNames = ev.sectionNumerals.map((n) =>
            resolvedChordName(n, ev.shift, _key, _cycle),
          );
          _onChordTick({
            chipIndex: ev.chipIndex,
            posIndex: ev.posIndex,
            sectionIndex: ev.sectionIndex,
            sectionChanged,
            resolvedChipNames,
            resolvedKey: resolvedKeyName(_key, ev.shift, _cycle),
            bars: ev.bars,
            sectionTokens: sectionChanged ? ev.sectionTokens : null,
            lapIndex,
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

    _openHatFilter = new Tone.Filter({
      type: "highpass",
      frequency: 7000,
      Q: 0.5,
    }).connect(_channels!.drum);
    _openHat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.5 },
    }).connect(_openHatFilter);
    _openHat.volume.value = -18;

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

    _clapFilter = new Tone.Filter({
      type: "highpass",
      frequency: 1200,
      Q: 0.8,
    }).connect(_channels!.drum);
    _clap = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.1 },
    }).connect(_clapFilter);
    _clap.volume.value = -12;

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
        if (hit) _triggerDrum(time, _sp.hat, () => _hat!.triggerAttackRelease("32n", time));
      },
      v.hat,
      "16n",
    ).start(0);

    if (v.openHat) {
      _openHatSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit)
            _triggerDrum(time, _sp.openHat, () => _openHat!.triggerAttackRelease("8n", time));
        },
        v.openHat,
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

    if (v.clap) {
      _clapSeq = new Tone.Sequence<number>(
        (time, hit) => {
          if (hit && _clap) _safe(() => _clap!.triggerAttackRelease("16n", time));
        },
        v.clap,
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
      _openHatSeq,
      _crashSeq,
      _rideSeq,
      _clapSeq,
      _tomSeq,
      _tom2Seq,
    ])
      if (s) s.mute = muted;
  }

  function _buildBass(
    chords: SongChord[],
    cycle: string,
    customCycleKeys: string[],
    style: StyleDef,
    bassVariant: string,
    bassOn: boolean,
  ): void {
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
    const shifts = getShiftsForCycle(cycle, customCycleKeys);
    const steps: (string | null)[] = [];

    for (let i = 0; i < shifts.length; i++) {
      const shift = clampShift(shifts[i]!);
      for (const c of chords) {
        const voiced = shift ? makeChord(c.root + shift, c.quality) : c;
        const pattern = voiced.isMinor ? patterns.minor : patterns.major;
        const total = c.bars * 16;
        for (let s = 0; s < total; s++) {
          const step = pattern[s % 16];
          if (step === "R") steps.push(voiced.bassRoot);
          else if (step === "3") steps.push(voiced.bassThird);
          else if (step === "5") steps.push(voiced.bassFifth);
          else steps.push(null);
        }
      }
    }

    _bassSeq = new Tone.Sequence<string | null>(
      (time, note) => {
        if (note && _bass) _safe(() => _bass!.triggerAttackRelease(note, "8n", time));
      },
      steps,
      "16n",
    ).start(0);

    _bassSeq.mute = !bassOn;
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
      _manualLap = 0;
      _currentLap = startLapIndex;
      _currentPosIndex = startPosIndex;
      _muteState = { chordsOn: mix.chordsOn, bassOn: mix.bassOn, drumsOn: mix.drumsOn };

      _initChannels(mix);
      _teardown();
      _buildSynth();

      const { posOffsets, chipOffsets } = _buildPart(
        chordSequence,
        cycle,
        customCycleKeys,
        voicing,
      );
      _buildDrums(style, drumVariant, mix.drumsOn);
      _buildBass(chordSequence, cycle, customCycleKeys, style, bassVariant, mix.bassOn);

      Tone.Transport.bpm.value = tempo;
      if (advance === "manual") _currentPosIndex = startPosIndex;
      const startBarOffset =
        chipOffsets[startPosIndex]?.[startChipIndex] ?? posOffsets[startPosIndex] ?? 0;
      Tone.Transport.position = `${startLapIndex * _songBars + startBarOffset}:0:0`;
      Tone.Transport.start();
    },

    stop(): void {
      Tone.Transport.stop();
      _teardown();
      _pendingJump = null;
      _pendingKeyJump = null;
      _manualLap = 0;
      _currentLap = 0;
      _currentPosIndex = 0;
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
      Tone.Transport.scheduleOnce(() => {
        if (Tone.Transport.state !== "started") return;
        _key = key;
        _cycle = cycle;
        _customCycleKeys = customCycleKeys;
        try {
          _teardown();
          _buildSynth();
          _buildPart(chordSequence, cycle, customCycleKeys, voicing);
          _buildDrums(style, drumVariant, _muteState.drumsOn);
          _buildBass(chordSequence, cycle, customCycleKeys, style, bassVariant, _muteState.bassOn);
          if (_channels) _channels.chord.mute = !_muteState.chordsOn;
        } catch (e) {
          console.warn("Audio rebuild failed:", e);
        }
      }, "+0");
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
        // Reapply volume in case Tone.js silently rejected a -Infinity assignment earlier
        if (!muted) _channels.chord.volume.value = _toDb(_volState.chords);
      } else if (channel === "bass" && _channels) {
        _channels.bass.mute = muted;
        if (!muted) _channels.bass.volume.value = _toDb(_volState.bass);
      } else if (channel === "drums") {
        for (const s of [
          _kickSeq,
          _snareSeq,
          _hatSeq,
          _openHatSeq,
          _crashSeq,
          _rideSeq,
          _clapSeq,
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
