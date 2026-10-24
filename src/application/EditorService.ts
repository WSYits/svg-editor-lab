import type { SvgDocument } from '../domain/SvgDocument.js';
import type { Command } from './commands/Command.js';
import { CommandResult } from './CommandResult.js';
import { EditorSession } from './EditorSession.js';
import { HistoryManager } from './HistoryManager.js';

interface EditorState {
  readonly session: EditorSession;
  readonly history: HistoryManager;
}

export interface HistoryStatus {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly disabled: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export class EditorService {
  #state: EditorState;
  #busy = false;

  constructor(session = new EditorSession(), history = new HistoryManager()) {
    if (!session.hasDocument && (history.undoCount > 0 || history.redoCount > 0)) {
      throw new Error('nonempty history requires a document');
    }
    this.#state = Object.freeze({ session, history });
  }

  get hasDocument(): boolean { return this.#state.session.hasDocument; }
  get defaultSavePath(): string | undefined { return this.#state.session.defaultSavePath; }

  getDocumentSnapshot(): SvgDocument | undefined {
    return this.#state.session.getDocumentSnapshot();
  }

  getHistoryStatus(): HistoryStatus {
    const history = this.#state.history;
    return Object.freeze({ undoCount: history.undoCount, redoCount: history.redoCount,
      disabled: history.disabled, canUndo: history.canUndo, canRedo: history.canRedo });
  }

  execute(command: Command): CommandResult {
    return this.#run(() => {
      const { session: current, history: previous } = this.#state;
      const candidate = this.#snapshot(current);
      // Copy the result value as well: a custom Command may retain its result.
      const result = new CommandResult(command.execute(candidate).summary);
      const history = previous.recordEdit(this.#snapshot(current));
      const session = new EditorSession(candidate, current.defaultSavePath);
      // All execution, cloning, result creation and history preparation succeeded.
      // Publishing one private reference performs no domain work or user callback.
      this.#state = Object.freeze({ session, history });
      return result;
    });
  }

  undo(): CommandResult { return this.#restore(true); }
  redo(): CommandResult { return this.#restore(false); }

  #restore(undo: boolean): CommandResult {
    return this.#run(() => {
      const current = this.#state;
      this.#assertDocument(current.session);
      if (undo) current.history.assertUndoAllowed();
      else current.history.assertRedoAllowed();
      const snapshot = this.#snapshot(current.session);
      const transition = undo ? current.history.prepareUndo(snapshot) : current.history.prepareRedo(snapshot);
      const session = new EditorSession(transition.document, current.session.defaultSavePath);
      const result = new CommandResult(undo ? 'undo completed' : 'redo completed');
      this.#state = Object.freeze({ session, history: transition.history });
      return result;
    });
  }

  #assertDocument(session: EditorSession): void {
    if (!session.hasDocument) throw new Error("no document. use 'init' or 'read' first");
  }

  #snapshot(session: EditorSession): SvgDocument {
    this.#assertDocument(session);
    return session.getDocumentSnapshot()!;
  }

  #run(action: () => CommandResult): CommandResult {
    if (this.#busy) throw new Error('editor operation already in progress');
    this.#busy = true;
    try {
      return action();
    } finally {
      this.#busy = false;
    }
  }
}
