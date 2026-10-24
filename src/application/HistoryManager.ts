import type { SvgDocument } from '../domain/SvgDocument.js';

/** Prepared values only: no current session is published by this result. */
export interface HistoryTransition {
  readonly document: SvgDocument;
  readonly history: HistoryManager;
}

/** Persistent history values; stored documents never escape or change. */
export class HistoryManager {
  #past: readonly SvgDocument[] = Object.freeze([]);
  #future: readonly SvgDocument[] = Object.freeze([]);
  #disabled = false;

  get undoCount(): number { return this.#past.length; }
  get redoCount(): number { return this.#future.length; }
  get disabled(): boolean { return this.#disabled; }
  get canUndo(): boolean { return !this.#disabled && this.#past.length > 0; }
  get canRedo(): boolean { return !this.#disabled && this.#future.length > 0; }

  /** Call only after an edit has succeeded; saves the pre-edit document. */
  recordEdit(before: SvgDocument): HistoryManager {
    const snapshot = before.clone();
    return HistoryManager.#fromSnapshots([...this.#past, snapshot], [], false);
  }

  /** Prepares a cleared, disabled history, without performing any document/IO operation. */
  resetBoundary(): HistoryManager {
    return HistoryManager.#fromSnapshots([], [], true);
  }

  prepareUndo(current: SvgDocument): HistoryTransition {
    return this.#prepare(current, true);
  }

  prepareRedo(current: SvgDocument): HistoryTransition {
    return this.#prepare(current, false);
  }

  #prepare(current: SvgDocument, undo: boolean): HistoryTransition {
    if (this.#disabled) throw new Error('undo not allowed after io command');
    const source = undo ? this.#past : this.#future;
    const target = source.at(-1);
    if (target === undefined) throw new Error(undo ? 'nothing to undo' : 'nothing to redo');
    // Both clones and all array allocation must succeed before a result exists.
    // In particular, never pop a live stack before cloning the restore target.
    const document = target.clone();
    const snapshot = current.clone();
    const past = undo ? this.#past.slice(0, -1) : [...this.#past, snapshot];
    const future = undo ? [...this.#future, snapshot] : this.#future.slice(0, -1);
    const history = HistoryManager.#fromSnapshots(past, future, false);
    return Object.freeze({ document, history });
  }

  static #fromSnapshots(past: readonly SvgDocument[], future: readonly SvgDocument[], disabled: boolean): HistoryManager {
    const next = new HistoryManager();
    // Only already-owned snapshots reach this private factory. Reusing them
    // across immutable history versions avoids cloning the entire history.
    next.#past = Object.freeze(past);
    next.#future = Object.freeze(future);
    next.#disabled = disabled;
    return next;
  }
}
