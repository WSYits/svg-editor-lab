import { Shape } from './Shape.js';
import { GroupShape } from './GroupShape.js';
import { TreeOwnership, treeMutation } from './TreeOwnership.js';

export class SvgDocument {
  #width: number;
  #height: number;
  readonly #roots: Shape[] = [];

  constructor(width = 800, height = 600) {
    this.validateSize(width, height);
    this.#width = width;
    this.#height = height;
  }

  get width(): number { return this.#width; }
  get height(): number { return this.#height; }
  get roots(): readonly Shape[] { return Object.freeze([...this.#roots]); }

  resize(width: number, height: number): void {
    this.validateSize(width, height);
    this.#width = width;
    this.#height = height;
  }

  findById(id: string): Shape | undefined {
    return this.#roots.flatMap(root => TreeOwnership.nodes(root)).find(shape => shape.id === id);
  }

  parentOf(id: string): GroupShape | undefined {
    const shape = this.requireShape(id);
    const owner = TreeOwnership.ownerOf(shape);
    return owner instanceof GroupShape ? owner : undefined;
  }

  insert(shape: Shape, parentId?: string): void {
    let parent: GroupShape | undefined;
    if (parentId !== undefined) {
      const target = this.findById(parentId);
      if (!target) throw new Error(`no such container: ${parentId}`);
      if (!(target instanceof GroupShape)) throw new Error(`not a container: ${parentId}`);
      parent = target;
    }
    const nodes = TreeOwnership.nodes(shape);
    if (parent && nodes.includes(parent)) throw new Error('cannot create a parent-child cycle');
    TreeOwnership.assertDetached(shape);
    const ids = new Set<string>();
    const objects = new Set<Shape>();
    for (const node of nodes) {
      if (objects.has(node)) throw new Error(`duplicate shape object: ${node.id}`);
      if (ids.has(node.id) || this.findById(node.id)) throw new Error(`id already exists: ${node.id}`);
      ids.add(node.id);
      objects.add(node);
    }
    // All domain validation precedes the synchronous membership commit.
    if (parent) parent.appendChild(shape, treeMutation);
    else {
      TreeOwnership.claim(shape, this, treeMutation);
      this.#roots.push(shape);
    }
  }

  remove(id: string): Shape {
    const shape = this.requireShape(id);
    const owner = TreeOwnership.ownerOf(shape);
    if (owner === this) {
      const index = this.#roots.indexOf(shape);
      if (index < 0) throw new Error(`invalid root ownership: ${id}`);
      TreeOwnership.release(shape, this, treeMutation);
      this.#roots.splice(index, 1);
    } else if (owner instanceof GroupShape) {
      owner.removeChild(shape, treeMutation);
    } else throw new Error(`invalid owner: ${id}`);
    return shape;
  }

  clone(): SvgDocument {
    const copy = new SvgDocument(this.#width, this.#height);
    for (const root of this.#roots) copy.insert(root.clone());
    return copy;
  }

  private requireShape(id: string): Shape {
    const shape = this.findById(id);
    if (!shape) throw new Error(`no such shape: ${id}`);
    return shape;
  }

  private validateSize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('canvas dimensions must be finite positive numbers');
    }
  }
}
