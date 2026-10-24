import { PreservedAttributes } from './PreservedAttributes.js';
import { Shape } from './Shape.js';
import type { GroupShape } from './GroupShape.js';
import { TreeOwnership } from './TreeOwnership.js';

export class SvgDocument {
  #width: number;
  #height: number;
  #preserved = new PreservedAttributes({}, true);

  constructor(width = 800, height = 600) {
    this.validateSize(width, height);
    this.#width = width;
    this.#height = height;
    TreeOwnership.initializeDocument(this);
  }

  get width(): number { return this.#width; }
  get height(): number { return this.#height; }
  get roots(): readonly Shape[] { return TreeOwnership.childrenOf(this); }

  getPreservedAttributes(): Readonly<Record<string, string>> { return this.#preserved.values; }

  setPreservedAttributes(attributes: Readonly<Record<string, string>>): void {
    const next = new PreservedAttributes(attributes, true);
    this.#preserved = next;
  }

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

  group(newId: string, ids: readonly string[]): GroupShape {
    return TreeOwnership.group(this, newId, ids);
  }

  ungroup(id: string): GroupShape {
    return TreeOwnership.ungroup(this, id);
  }

  clone(): SvgDocument {
    const copy = new SvgDocument(this.#width, this.#height);
    copy.setPreservedAttributes(this.#preserved.values);
    for (const root of this.roots) copy.insert(root.clone());
    return copy;
  }

  private validateSize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('canvas dimensions must be finite positive numbers');
    }
  }
}
