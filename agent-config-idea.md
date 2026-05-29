# Agent-Driven Configuration

## The Idea

The app's state is a well-defined, typed object (`AppState`). That makes it
machine-readable in a way that opens up a new input pathway: instead of
configuring the app through a UI, a user describes what they want in plain
English and an agent produces a valid `AppState` to realize it.

**User:** "I want to practice minor ii-V-Is through all 12 keys, slow tempo,
voice leading on, busy bass."

**Agent:** produces a valid `AppState` JSON → app loads it instantly.

This is novel because the schema IS the interface. The richer and better-typed
the state object, the more powerful the agent becomes — not in spite of
complexity but because of it. A deeply configurable app that would be tedious
to navigate in a UI becomes trivial to configure by description.

---

## Why This Works Here

**The schema is already close.** `AppState` is fully typed with JSDoc/TS syntax.
`DEFAULTS` documents every field. `VALID_KEYS`, `STYLE_OPTIONS`, etc. constrain
valid values to known enums. An agent prompt is essentially: "here's the schema,
here are valid values for each field, here's what each setting means musically —
produce a valid AppState for this request."

**The domain is well-understood.** An agent already knows music theory. `I vi ii V`,
12-bar blues, voice leading, cycle of 4ths — no domain explanation needed. The
prompt only needs to map musical concepts to schema fields.

**Structured output makes it reliable.** This is a constrained JSON generation
task, not a free-form response. The model produces a valid object or it doesn't.
Validation against the schema is cheap and a failed attempt is easy to retry.

**Per-section overrides amplify this.** As the app gains more configuration
depth — per-section style/tempo/voicing overrides, custom bass patterns, synth
parameter tweaks — the UI path gets more tedious and the agent path gets more
valuable. Describing "a 3-section practice module with a slow intro, two busier
verses, and a bridge in a different key" in plain English is far faster than
building it in a UI, especially on a phone.

---

## How It Would Work

1. **User inputs a plain-text description** — as casual or as precise as they want.
2. **Agent receives:** user description + a system prompt explaining the app and
   its musical intent + the `AppState` JSON schema with valid values for each field.
3. **Agent produces:** a valid `AppState` JSON object.
4. **App loads it** via `app.loadPreset(parsedState)` — same code path as any
   other state load. Nothing else changes.

The agent could live anywhere: a separate page in the app, a Claude.ai project,
a simple API call from a companion tool. The app itself doesn't need to change
at all — it just needs a way to accept the produced JSON.

---

## What the System Prompt Needs

Beyond the schema, the prompt needs musical context so the agent makes good
choices when the user is vague:

- What each style *sounds like* (funk = syncopated, tighter pocket; ballad = sparse, half-time)
- What voicing modes mean in practice (root = clearest for ear training; voice-lead/loop = most musical)
- What cycle modes are for (practicing a progression through all 12 keys)
- How sections + arrangement work together
- Sensible tempo ranges per style/use-case

This musical annotation lives in the prompt, not the schema — keeping the schema
clean and technical while the prompt handles musical intent.

---

## Future State Object Depth

The current `AppState` covers global settings. The full vision includes:

- **Per-section overrides** — each section can override style, tempo, voicing, bass variant, volumes
- **Custom bass patterns** — user-defined 16-step patterns instead of built-in variants
- **Custom drum patterns** — same
- **Synth parameter tweaks** — attack, decay, reverb, oscillator type
- **Custom key cycles** — `cycle: { type: 'custom', keys: ['A', 'E', 'D', 'G'] }`

Each addition makes UI configuration harder and agent configuration easier. The
schema becomes the superpower.

---

## The Core Insight

Most configurable apps are hard to use because configuration lives in a UI.
This flips it: configuration lives in a schema, the UI covers the common cases,
and an agent handles everything the UI can't. The user describes intent in
natural language and the agent translates it to the exact configuration needed.

The schema is the interface. Type it well and you get a UI, a share link,
an agent input, and a file format — all for free.
