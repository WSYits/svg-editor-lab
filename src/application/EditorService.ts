import type { Shape } from '../domain/Shape.js';
import { ShapeFactory, type AttributeKind, type CreationDescription } from '../domain/ShapeFactory.js';
import type { ShapeView, TreeView } from './QueryView.js';
import { SvgDocument } from '../domain/SvgDocument.js';
import type { Command } from './commands/Command.js';
import { CommandResult } from './CommandResult.js';
import { EditorSession, type CanvasSize } from './EditorSession.js';
import { HistoryManager } from './HistoryManager.js';
import { SvgCodec } from '../svg/SvgCodec.js';
import type { FileStore } from '../io/FileStore.js';
import { DocumentIoResult } from './DocumentIoResult.js';

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
  readonly #files: FileStore | undefined;
  readonly #codec: SvgCodec;

  constructor(session = new EditorSession(), history = new HistoryManager(), fileStore?: FileStore, codec = new SvgCodec()) {
    this.#files = fileStore;
    this.#codec = codec;
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

  init(width?: number, height?: number): CommandResult {
    return this.#run(() => {
      if ((width === undefined) !== (height === undefined)) {
        throw new Error('init requires zero or two dimensions');
      }
      const document = width === undefined ? new SvgDocument() : new SvgDocument(width, height!);
      return this.#boundary(document, undefined, `canvas ${document.width}x${document.height} created`);
    });
  }

  read(path: string): DocumentIoResult {
    return this.#run(() => {
      const decoded = this.#fileStore().read(path);
      const { document, warnings } = this.#codec.decode(decoded);
      const next = this.#prepareBoundary(document, path);
      const result = this.#ioResult(document, `read ${path}`, warnings);
      this.#publish(next);
      return result;
    });
  }

  save(path?: string): DocumentIoResult {
    return this.#run(() => {
      const current = this.#state.session;
      const document = this.#snapshot(current);
      const target = path ?? current.defaultSavePath;
      if (target === undefined) throw new Error('no save path. provide a file path');
      const files = this.#fileStore();
      const source = this.#codec.encode(document);
      const next = this.#prepareBoundary(document, target);
      const result = this.#ioResult(document, `saved to ${target}`);
      // Complete all allocations, cloning, history and result preparation first.
      // FileStore.write returns only after replacement, with no post-success work.
      files.write(target, source);
      this.#publish(next);
      return result;
    });
  }

  #fileStore(): FileStore {
    if (!this.#files) throw new Error('file store is not configured');
    return this.#files;
  }

  #ioResult(document: SvgDocument, summary: string, warnings: readonly string[] = []): DocumentIoResult {
    const count = (nodes: readonly Shape[]): number => nodes.reduce((sum, node) => sum + 1 + count(node.children), 0);
    return new DocumentIoResult(`${summary} (${count(document.roots)} elements)`, warnings);
  }

  getCanvasSize(): CanvasSize {
    const session = this.#state.session;
    this.#assertDocument(session);
    return session.getCanvasSize()!;
  }

  resizeCanvas(width: number, height: number): CommandResult {
    return this.#run(() => {
      const current = this.#state.session;
      const candidate = this.#snapshot(current);
      candidate.resize(width, height);
      return this.#boundary(candidate, current.defaultSavePath, `canvas resized to ${candidate.width}x${candidate.height}`);
    });
  }

  getCreationTypes(): readonly string[] { return new ShapeFactory().getTypes(); }

  getCreationDescription(type: string): CreationDescription {
    return new ShapeFactory().describe(type);
  }

  getAttributeKind(id: string, attribute: string): AttributeKind {
    const document = this.#snapshot(this.#state.session);
    const shape = document.findById(id);
    if (!shape) throw new Error(`no such shape: ${id}`);
    return new ShapeFactory().attributeKind(shape.type, attribute);
  }

  getTreeView(id?: string): TreeView {
    const document = this.#snapshot(this.#state.session);
    const roots = id === undefined ? document.roots : [this.#requireShape(document, id)];
    return Object.freeze({ width: document.width, height: document.height, subtree: id !== undefined,
      roots: Object.freeze(roots.map(shape => this.#project(document, shape))) });
  }

  getShapeView(id: string): ShapeView {
    const document = this.#snapshot(this.#state.session);
    return this.#project(document, this.#requireShape(document, id));
  }

  #requireShape(document: SvgDocument, id: string): Shape {
    const shape = document.findById(id);
    if (!shape) throw new Error(`no such shape: ${id}`);
    return shape;
  }

  #project(document: SvgDocument, shape: Shape): ShapeView {
    return Object.freeze({ id: shape.id, type: shape.type, parentId: document.parentOf(shape.id)?.id,
      attributes: Object.freeze({ ...shape.getAttributes() }),
      children: Object.freeze(shape.children.map(child => this.#project(document, child))) });
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
      this.#publish(Object.freeze({ session, history }));
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
      this.#publish(Object.freeze({ session, history: transition.history }));
      return result;
    });
  }

  #prepareBoundary(document: SvgDocument, defaultSavePath: string | undefined): EditorState {
    const session = new EditorSession(document, defaultSavePath);
    const history = this.#state.history.resetBoundary();
    return Object.freeze({ session, history });
  }

  #boundary(document: SvgDocument, defaultSavePath: string | undefined, summary: string): CommandResult {
    const next = this.#prepareBoundary(document, defaultSavePath);
    const result = new CommandResult(summary);
    this.#publish(next);
    return result;
  }

  #publish(next: EditorState): void {
    // The complete state object already exists. Only a private reference is set;
    // no allocation, cloning, callback, output or filesystem work occurs here.
    this.#state = next;
  }

  #assertDocument(session: EditorSession): void {
    if (!session.hasDocument) throw new Error("no document. use 'init' or 'read' first");
  }

  #snapshot(session: EditorSession): SvgDocument {
    this.#assertDocument(session);
    return session.getDocumentSnapshot()!;
  }

  #run<T>(action: () => T): T {
    if (this.#busy) throw new Error('editor operation already in progress');
    this.#busy = true;
    try {
      return action();
    } finally {
      this.#busy = false;
    }
  }
}
