/**
 * The play view's practice row (cycle, custom keys, advance) and the Mix sheet
 * (levels and mutes). Mutes are practice data (shareable intent); levels are
 * device settings. Both apply instantly.
 */

import { useState } from "react";
import { parseKeyList, withCycle, type CycleKind } from "../../core/practice";
import type { Channel, KeyName, Mix, Practice } from "../../model/schema";
import type { DeepReadonly, NonEmpty } from "../../model/types";

const CYCLES: [CycleKind, string][] = [
  ["none", "Off"],
  ["fourths", "4ths"],
  ["fifths", "5ths"],
  ["custom", "Custom"],
];

export function PracticeRow(props: {
  practice: DeepReadonly<Practice>;
  onChange: (practice: Practice) => void;
}) {
  const { practice, onChange } = props;
  const cycle = practice.cycle;
  // The saved practice drops custom keys when another cycle is picked; remember them here.
  const [keysText, setKeysText] = useState(
    cycle.kind === "custom" ? cycle.keys.join(" ") : "A E D G",
  );
  const parsed = parseKeyList(keysText);

  const pickCycle = (kind: CycleKind) => {
    if (kind === "custom" && !parsed.ok) return;
    onChange(withCycle(practice, kind, parsed.ok ? (parsed.keys as NonEmpty<KeyName>) : undefined));
  };

  return (
    <div className="practice">
      <span className="practice-lbl">Practice</span>
      <label className="pill">
        🔁 Cycle{" "}
        <select value={cycle.kind} onChange={(e) => pickCycle(e.target.value as CycleKind)}>
          {CYCLES.map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {cycle.kind === "custom" && (
        <input
          className={`text ${parsed.ok ? "" : "invalid"}`}
          value={keysText}
          aria-label="Keys to cycle through"
          title={parsed.ok ? "Keys to cycle through" : parsed.error}
          placeholder="A E D G"
          onChange={(e) => {
            setKeysText(e.target.value);
            const next = parseKeyList(e.target.value);
            if (next.ok) onChange(withCycle(practice, "custom", next.keys as NonEmpty<KeyName>));
          }}
        />
      )}
      <button
        type="button"
        className="pill"
        title={
          practice.advance === "manual"
            ? "Repeat each section until you jump"
            : "Follow the arrangement"
        }
        onClick={() =>
          onChange({
            ...(structuredClone(practice) as Practice),
            advance: practice.advance === "manual" ? "auto" : "manual",
          })
        }
      >
        ⏭️ {practice.advance === "manual" ? "Manual" : "Auto"}
      </button>
    </div>
  );
}

const ROWS: { channel: Channel | "master"; label: string; mutable: boolean }[] = [
  { channel: "chords", label: "Chords", mutable: true },
  { channel: "bass", label: "Bass", mutable: true },
  { channel: "drums", label: "Drums", mutable: true },
  { channel: "loops", label: "Loops", mutable: false },
  { channel: "master", label: "Master", mutable: false },
];

export function MixSheet(props: {
  levels: Mix["levels"];
  mutes: DeepReadonly<Practice["mutes"]>;
  /** Loops exist only in songs (composer). */
  showLoops: boolean;
  onLevels: (levels: Mix["levels"]) => void;
  onMutes: (mutes: Practice["mutes"]) => void;
  onClose: () => void;
}) {
  const { levels, mutes, showLoops, onLevels, onMutes, onClose } = props;
  return (
    <Sheet title="Mix" onClose={onClose}>
      <p className="muted">
        Mutes are saved with practice settings (they can be shared). Levels stay on this device.
        Changes are instant.
      </p>
      {ROWS.filter((r) => showLoops || r.channel !== "loops").map(({ channel, label, mutable }) => (
        <div className="mix-row" key={channel}>
          <label>
            {mutable && channel !== "master" && (
              <input
                type="checkbox"
                checked={!mutes[channel]}
                onChange={(e) => onMutes({ ...mutes, [channel]: !e.target.checked })}
              />
            )}
            {label}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={levels[channel]}
            aria-label={`${label} level`}
            onChange={(e) => onLevels({ ...levels, [channel]: Number(e.target.value) })}
          />
          <span className="val">{levels[channel]}</span>
        </div>
      ))}
    </Sheet>
  );
}

export function Sheet(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="backdrop" onClick={props.onClose} />
      <div className="sheet" role="dialog" aria-label={props.title}>
        <div className="inner">
          <div className="sheet-head">
            <h3>{props.title}</h3>
            <button type="button" className="btn small" onClick={props.onClose}>
              Close
            </button>
          </div>
          {props.children}
        </div>
      </div>
    </>
  );
}
