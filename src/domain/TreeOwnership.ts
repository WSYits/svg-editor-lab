import type { Shape } from './Shape.js';
import { GroupShape } from './GroupShape.js';
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

  static addTo(document: SvgDocument, groupId: string, id: string): void {
    const target = this.findById(document, groupId);
    if (!target) throw new Error(`no such container: ${groupId}`);
    if (!this.#isGroup(target)) throw new Error(`not a container: ${groupId}`);
    const shape = this.#requireShape(document, id);
    if (this.nodes(shape).includes(target)) throw new Error('cannot create a parent-child cycle');
    const owner = this.#requireOwner(document, shape);
    const siblings = this.childrenOf(owner);
    if (owner === target) {
      if (siblings.at(-1) === shape) return;
      const next = Object.freeze([...siblings.filter(child => child !== shape), shape]);
      this.#members.set(owner, next);
      return;
    }
    const targetChildren = this.childrenOf(target);
    if (targetChildren.includes(shape)) throw new Error(`invalid owner: ${id}`);
    const oldNext = Object.freeze(siblings.filter(child => child !== shape));
    const newNext = Object.freeze([...targetChildren, shape]);
    // All allocations and domain checks precede this commit. These are native
    // WeakMap updates on genuine private maps, with validated object keys already
    // present in each map: no invalid-key/receiver errors, coercion or user code.
    // No observable async boundary occurs between writes. Process termination or
    // runtime resource exhaustion is outside the recoverable domain-error contract.
    this.#members.set(owner, oldNext);
    this.#members.set(target, newNext);
    this.#owners.set(shape, target);
  }

  static front(document: SvgDocument, id: string): void {
    this.#reorder(document, id, true);
  }

  static back(document: SvgDocument, id: string): void {
    this.#reorder(document, id, false);
  }

  static group(document: SvgDocument, newId: string, ids: readonly string[]): GroupShape {
    this.#assertDocument(document);
    const requested = [...ids];
    if (requested.length === 0) throw new Error('group requires at least one shape');
    const original = this.childrenOf(document).flatMap(root => this.nodes(root));
    const byId = new Map(original.map(shape => [shape.id, shape]));
    if (byId.has(newId)) throw new Error(`id already exists: ${newId}`);
    const selected = new Set<Shape>();
    for (const id of requested) {
      const shape = byId.get(id);
      if (!shape) throw new Error(`no such shape: ${id}`);
      if (selected.has(shape)) throw new Error(`duplicate selection: ${id}`);
      selected.add(shape);
    }
    const ordered = original.filter(shape => selected.has(shape));
    const paths = ordered.map(shape => this.#containerPath(document, shape));
    for (const path of paths) {
      for (const container of path) {
        if (this.#isGroup(container) && selected.has(container)) {
          throw new Error(`cannot group a container into its own descendant: ${container.id}`);
        }
      }
    }
    const common = paths[0]!.find(container => paths.every(path => path.includes(container)));
    if (!common) throw new Error('no common document container');
    const commonChildren = this.childrenOf(common);
    const anchor = commonChildren.find(branch => this.nodes(branch).some(node => selected.has(node)));
    if (!anchor) throw new Error('no grouping insertion anchor');
    const replacements = new Map<GroupShape | SvgDocument, readonly Shape[]>();
    for (const path of paths) {
      const owner = path[0]!;
      if (!replacements.has(owner)) {
        replacements.set(owner, Object.freeze(this.childrenOf(owner).filter(child => !selected.has(child))));
      }
    }

    // Construct only an empty, unexposed group: attached originals must not be
    // passed to the detached-subtree constructor. No live tree has changed yet.
    const group = new GroupShape(newId);
    const target: Shape[] = [];
    for (const child of commonChildren) {
      if (child === anchor) target.push(group);
      if (!selected.has(child)) target.push(child);
    }
    replacements.set(common, Object.freeze(target));
    const members = Object.freeze(ordered);

    // All validation, traversal, construction and candidate allocation is done.
    // Native writes to genuine private WeakMaps use validated object keys. The
    // new group's owner entry is new; resource exhaustion is not a recoverable
    // domain error. There are no callbacks or public operations in this commit.
    this.#members.set(group, members);
    for (const [container, children] of replacements) this.#members.set(container, children);
    for (const shape of members) this.#owners.set(shape, group);
    this.#owners.set(group, common);
    return group;
  }

  static #containerPath(document: SvgDocument, shape: Shape): (GroupShape | SvgDocument)[] {
    const path: (GroupShape | SvgDocument)[] = [];
    let owner = this.#requireOwner(document, shape);
    path.push(owner);
    while (owner !== document) {
      if (!this.#isGroup(owner)) throw new Error(`invalid owner: ${shape.id}`);
      owner = this.#requireOwner(document, owner);
      path.push(owner);
    }
    return path;
  }

  static #reorder(document: SvgDocument, id: string, front: boolean): void {
    const shape = this.#requireShape(document, id);
    const owner = this.#requireOwner(document, shape);
    const siblings = this.childrenOf(owner);
    if ((front ? siblings.at(-1) : siblings[0]) === shape) return;
    const remaining = siblings.filter(child => child !== shape);
    const next = Object.freeze(front ? [...remaining, shape] : [shape, ...remaining]);
    this.#members.set(owner, next);
  }

  static #requireOwner(document: SvgDocument, shape: Shape): GroupShape | SvgDocument {
    const owner = this.#owners.get(shape);
    if (owner === undefined ||
        (owner !== document && (!this.#isGroup(owner) || this.findById(document, owner.id) !== owner)) ||
        !this.childrenOf(owner).includes(shape)) {
      throw new Error(`invalid owner: ${shape.id}`);
    }
    return owner;
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
