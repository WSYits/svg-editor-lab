import { Shape } from './Shape.js';
import type { GroupShape } from './GroupShape.js';
import { TreeOwnership } from './TreeOwnership.js';

export class SvgDocument {
  #width: number;
  #height: number;

  constructor(width = 800, height = 600) {
    this.validateSize(width, height);
    this.#width = width;
    this.#height = height;
    TreeOwnership.initializeDocument(this);
  }

  get width(): number { return this.#width; }
  get height(): number { return this.#height; }
  get roots(): readonly Shape[] { return TreeOwnership.childrenOf(this); }

  resize(width: number, height: number): void {
    this.validateSize(width, height);
    this.#width = width;
    this.#height = height;
  }

  findById(id: string): Shape | undefined {
    return TreeOwnership.findById(this, id);
  }

  parentOf(id: string): GroupShape | undefined {
    return TreeOwnership.parentOf(this, id);
  }

  insert(shape: Shape, parentId?: string): void {
    TreeOwnership.insert(this, shape, parentId);
  }

  remove(id: string): Shape {
    return TreeOwnership.remove(this, id);
  }

  addTo(groupId: string, id: string): void {
    TreeOwnership.addTo(this, groupId, id);
  }

  front(id: string): void {
    TreeOwnership.front(this, id);
  }

  back(id: string): void {
    TreeOwnership.back(this, id);
  }

  clone(): SvgDocument {
    const copy = new SvgDocument(this.#width, this.#height);
    for (const root of this.roots) copy.insert(root.clone());
    return copy;
  }

  private validateSize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('canvas dimensions must be finite positive numbers');
    }
  }
}
