/**
 * The player: key, section and settings, chord chips, beat dots (the mockup's
 * player header), plus the SONG/KEY scrubbers and transport of the action bar.
 * These are the play view's components; the bench uses them as-is.
 */

import type { ChipView, PlayerView, SectionSettings, Setting } from "../../core/view";
import { STYLE_LABELS } from "../../core/styles";
import type { PatchRef } from "../../model/schema";
import { chipBarIndex } from "./derive";

export function PlayerHeader(props: {
  view: PlayerView;
  /** Sounding chord (while playing). */
  activeChord: number | undefined;
  beat: number | undefined;
  cued: Set<number>;
  stage?: boolean;
  onChip: (chip: ChipView) => void;
}) {
  const { view, activeChord, beat, cued, stage = true, onChip } = props;
  return (
    <div className={`player ${stage ? "stage" : ""}`}>
      <div className="key-row">
        <span className="key-pill">{view.key}</span>
        <span className="key-label">major</span>
        {view.keys.length > 1 && (
          <span className="key-lap">
            {view.lap + 1}/{view.keys.length}
          </span>
        )}
      </div>
      <div className="player-sec">
        <b>{view.section.name}</b>
        <Settings settings={view.settings} />
      </div>
      <div className="chips">
        {view.chips.length === 0 && <span className="muted">No chords in this section</span>}
        {view.chips.map((chip) => {
          const active = chip.chordIndex === activeChord;
          const barIdx = chipBarIndex(chip, view.section.bar);
          return (
            <button
              key={chip.chordIndex}
              type="button"
              className={`chip ${active ? "active" : ""} ${cued.has(chip.chordIndex) ? "cued" : ""}`}
              onClick={() => onChip(chip)}
            >
              <span className="numeral">{chip.numeral}</span>
              <span className="name">{chip.name}</span>
              {chip.bars.length > 1 && (
                <span className="bar-progress">
                  {chip.bars.map((b, i) => (
                    <span key={b} className={`bar-dot ${i === barIdx ? "active" : ""}`} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="beats">
        {Array.from({ length: view.meter.beatsPerBar }, (_, i) => (
          <span key={i} className={`beat-dot ${i === beat ? "active" : ""}`} />
        ))}
      </div>
    </div>
  );
}

const patchName = (p: PatchRef) => p.id;

/** The section's resolved settings; section overrides are marked (•). */
function Settings({ settings }: { settings: SectionSettings }) {
  const items: [string, string, Setting<unknown>][] =
    settings.kind === "backingTrack"
      ? [
          ["⭐", STYLE_LABELS[settings.style.value.id], settings.style],
          ["🥁", settings.drums.value, settings.drums],
          ["🎸", settings.bass.value, settings.bass],
          ["♩", `${settings.tempo.value}`, settings.tempo],
          ["🎵", settings.voicing.value, settings.voicing],
        ]
      : [
          ["♩", `${settings.tempo.value}`, settings.tempo],
          [
            "",
            `${settings.meter.value.beatsPerBar}/${settings.meter.value.beatUnit}`,
            settings.meter,
          ],
          ["Swing", `${settings.swing.value}`, settings.swing],
          ["🎵", settings.voicing.value, settings.voicing],
          ...(["chords", "bass", "drums"] as const)
            .filter((r) => settings.instruments[r].from === "section")
            .map((r): [string, string, Setting<unknown>] => [
              "🎛",
              `${r} ${patchName(settings.instruments[r].value)}`,
              settings.instruments[r],
            ]),
        ];
  return (
    <>
      {items.map(([icon, value, s], i) => (
        <span
          key={i}
          className={`eff ${s.from === "section" ? "ovr" : ""}`}
          title={s.from === "section" ? "Section override" : "Song setting"}
        >
          {icon} {value}
        </span>
      ))}
    </>
  );
}

export function Scrubbers(props: {
  view: PlayerView;
  /** Highlight the current entry/lap only when there is a position to show. */
  showCurrent: boolean;
  queuedSection: number | undefined;
  queuedKey: number | undefined;
  onSection: (arrIdx: number) => void;
  onKey: (lap: number) => void;
}) {
  const { view, showCurrent, queuedSection, queuedKey, onSection, onKey } = props;
  return (
    <>
      {view.arrIdx !== undefined && view.arrangement.length > 1 && (
        <div className="scrub">
          <span className="scrub-lbl">Song</span>
          <div className="scrub-track">
            {view.arrangement.map((e) => (
              <button
                key={e.arrIdx}
                type="button"
                className={`seg-btn ${showCurrent && e.arrIdx === view.arrIdx ? "current" : ""} ${e.arrIdx === queuedSection ? "queued" : ""}`}
                onClick={() => onSection(e.arrIdx)}
              >
                {e.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {view.keys.length > 1 && (
        <div className="scrub">
          <span className="scrub-lbl">Key</span>
          <div className="scrub-track">
            {view.keys.map((k, lap) => (
              <button
                key={lap}
                type="button"
                className={`seg-btn ${showCurrent && lap === view.lap ? "current" : ""} ${lap === queuedKey ? "queued" : ""}`}
                onClick={() => onKey(lap)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function TransportButtons(props: {
  playing: boolean;
  canStop: boolean;
  position: string;
  onPlay: () => void;
  onStop: () => void;
  onMix: () => void;
}) {
  return (
    <div className="inner">
      <button type="button" className="btn" onClick={props.onMix}>
        🎚 Mix
      </button>
      <button
        type="button"
        className="btn"
        disabled={!props.canStop}
        onClick={props.onStop}
        title="Stop: back to the beginning"
      >
        ■
      </button>
      <button
        type="button"
        className={`play ${props.playing ? "on" : ""}`}
        onClick={props.onPlay}
        title={props.playing ? "Pause" : "Play"}
      >
        {props.playing ? "❚❚" : "▶"}
      </button>
      <div className="pos">{props.position}</div>
    </div>
  );
}
