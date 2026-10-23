import type { Shape } from './Shape.js';
import type { GroupShape } from './GroupShape.js';
import type { SvgDocument } from './SvgDocument.js';

/** Owns topology and ownership together; every exported write is a complete operation. */
export class TreeOwnership {
  static readonly #owners = new WeakMap<Shape, GroupShape | SvgDocument>();
  static readonly #members = new WeakMap<object, readonly Shape[]>();
  static readonly #groups = new WeakSet<object>();
  static readonly #documents = new WeakSet<SvgDocument>();

  private constructor() {}

  static initializeGroup(group: GroupShape, children: readonly Shape[]): void {
    this.#assertUninitialized(group);
    const next = Object.freeze([...children]);
    this.#validateIncoming(next, new Set([group.id]), group);
    // No callbacks or fallible domain checks remain in this synchronous commit.
    this.#members.set(group, next);
    this.#groups.add(group);
    for (const child of next) this.#owners.set(child, group);
  }

  static initializeDocument(document: SvgDocument): void {
    this.#assertUninitialized(document);
    this.#members.set(document, Object.freeze([]));
    this.#documents.add(document);
  }

  static childrenOf(container: GroupShape | SvgDocument): readonly Shape[] {
    const children = this.#members.get(container);
    if (!children) throw new Error('uninitialized tree container');
    return children;
  }

  static ownerOf(shape: Shape): GroupShape | SvgDocument | undefined {
    return this.#owners.get(shape);
  }

  static nodes(root: Shape): Shape[] {
    return [root, ...(this.#members.get(root) ?? []).flatMap(child => this.nodes(child))];
  }

  static findById(document: SvgDocument, id: string): Shape | undefined {
    this.#assertDocument(document);
    return this.childrenOf(document).flatMap(root => this.nodes(root)).find(shape => shape.id === id);
  }

  static parentOf(document: SvgDocument, id: string): GroupShape | undefined {
    const owner = this.#owners.get(this.#requireShape(document, id));
    return owner !== undefined && this.#isGroup(owner) ? owner : undefined;
  }

  static insert(document: SvgDocument, shape: Shape, parentId?: string): void {
    this.#assertDocument(document);
    let parent: GroupShape | undefined;
    if (parentId !== undefined) {
      const target = this.findById(document, parentId);
      if (!target) throw new Error(`no such container: ${parentId}`);
      if (!this.#isGroup(target)) throw new Error(`not a container: ${parentId}`);
      parent = target;
    }
    const existingIds = new Set(this.childrenOf(document).flatMap(root => this.nodes(root)).map(node => node.id));
    this.#validateIncoming([shape], existingIds, parent);
    const container = parent ?? document;
    const next = Object.freeze([...this.childrenOf(container), shape]);
    this.#members.set(container, next);
    this.#owners.set(shape, container);
  }

  static remove(document: SvgDocument, id: string): Shape {
    const shape = this.#requireShape(document, id);
    const owner = this.#owners.get(shape);
    if (owner === undefined) throw new Error(`invalid owner: ${id}`);
    const children = this.childrenOf(owner);
    const index = children.indexOf(shape);
    if (index < 0) throw new Error(`invalid owner: ${id}`);
    const next = Object.freeze(children.filter((_, position) => position !== index));
    this.#members.set(owner, next);
    this.#owners.delete(shape);
    return shape;
  }

  static #validateIncoming(roots: readonly Shape[], ids: Set<string>, forbidden?: Shape): void {
    const objects = new Set<Shape>();
    for (const root of roots) {
      const nodes = this.nodes(root);
      if (forbidden && nodes.includes(forbidden)) throw new Error('cannot create a parent-child cycle');
      if (this.#owners.has(root)) throw new Error(`shape already belongs to a tree: ${root.id}`);
      for (const node of nodes) {
        if (objects.has(node)) throw new Error(`duplicate shape object: ${node.id}`);
        if (ids.has(node.id)) throw new Error(`id already exists: ${node.id}`);
        objects.add(node);
        ids.add(node.id);
      }
    }
  }

  static #isGroup(container: object): container is GroupShape {
    return this.#groups.has(container);
  }

  static #assertUninitialized(container: object): void {
    if (this.#members.has(container)) throw new Error('tree container already initialized');
  }

  static #assertDocument(document: SvgDocument): void {
    if (!this.#documents.has(document)) throw new Error('not an initialized document');
  }

  static #requireShape(document: SvgDocument, id: string): Shape {
    const shape = this.findById(document, id);
    if (!shape) throw new Error(`no such shape: ${id}`);
    return shape;
  }
}
