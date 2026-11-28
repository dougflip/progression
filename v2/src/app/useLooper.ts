/** React view of the looper: its state and the last recording error. */

import { useSyncExternalStore } from "react";
import type { Looper, LooperState, RecordError } from "../engine/looper";
import { assertNever } from "../model/types";

export interface LooperView {
  state: LooperState;
  /** The last failed recording; cleared when a new one starts. */
  error?: RecordError;
}

const stores = new WeakMap<
  Looper,
  { get: () => LooperView; subscribe: (cb: () => void) => () => void }
>();

function store(looper: Looper) {
  let s = stores.get(looper);
  if (s) return s;
  let view: LooperView = { state: looper.state() };
  const listeners = new Set<() => void>();
  looper.subscribe((e) => {
    switch (e.type) {
      case "state":
        view = e.state.kind === "arming" ? { state: e.state } : { ...view, state: e.state };
        break;
      case "error":
        view = { ...view, error: e.error };
        break;
      case "recorded":
        return; // the bench adds the take to its doc
      default:
        return assertNever(e);
    }
    listeners.forEach((l) => l());
  });
  s = {
    get: () => view,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  stores.set(looper, s);
  return s;
}

export function useLooper(looper: Looper): LooperView {
  const s = store(looper);
  return useSyncExternalStore(s.subscribe, s.get);
}
