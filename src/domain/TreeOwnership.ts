import { Shape } from './Shape.js';

/** Internal capability: structural writes belong to domain containers/documents. */
export const treeMutation = Symbol('tree mutation');

/** Object ownership is independent of ids, including across separate documents. */
export class TreeOwnership {
  static readonly #owners = new WeakMap<Shape, object>();

  static ownerOf(shape: Shape): object | undefined {
    return this.#owners.get(shape);
  }

  static assertDetached(shape: Shape): void {
    if (this.#owners.has(shape)) throw new Error(`shape already belongs to a tree: ${shape.id}`);
  }

  static claim(shape: Shape, owner: object, access: symbol): void {
    this.requireAccess(access);
    this.assertDetached(shape);
    this.#owners.set(shape, owner);
  }

  static release(shape: Shape, owner: object, access: symbol): void {
    this.requireAccess(access);
    if (this.#owners.get(shape) !== owner) throw new Error(`invalid owner: ${shape.id}`);
    this.#owners.delete(shape);
  }

  static requireAccess(access: symbol): void {
    if (access !== treeMutation) throw new Error('structural changes require document access');
  }

  static nodes(root: Shape): Shape[] {
    return [root, ...root.children.flatMap(child => this.nodes(child))];
  }
}
