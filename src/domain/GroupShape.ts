import { Shape, type AttributeValue } from './Shape.js';
import { TreeOwnership, treeMutation } from './TreeOwnership.js';

export class GroupShape extends Shape {
  readonly #children: Shape[];

  constructor(id: string, children: readonly Shape[] = []) {
    super(id);
    const ids = new Set([id]);
    const objects = new Set<Shape>();
    for (const child of children) {
      TreeOwnership.assertDetached(child);
      for (const node of TreeOwnership.nodes(child)) {
        if (objects.has(node)) throw new Error(`duplicate shape object: ${node.id}`);
        if (ids.has(node.id)) throw new Error(`id already exists: ${node.id}`);
        objects.add(node);
        ids.add(node.id);
      }
    }
    this.#children = [...children];
    for (const child of this.#children) TreeOwnership.claim(child, this, treeMutation);
  }

  get type(): string {
    return 'g';
  }

  override get children(): readonly Shape[] {
    return Object.freeze([...this.#children]);
  }

  move(dx: number, dy: number): void {
    this.requireNumber(dx, 'dx');
    this.requireNumber(dy, 'dy');
    this.transform(child => child.move(dx, dy));
  }

  scale(factor: number): void {
    this.requireScaleFactor(factor);
    this.transform(child => child.scale(factor));
  }

  clone(): GroupShape {
    const copy = new GroupShape(this.id, this.#children.map(child => child.clone()));
    this.copyStylesTo(copy);
    return copy;
  }

  /** @internal Only SvgDocument may change membership after construction. */
  appendChild(child: Shape, access: symbol): void {
    TreeOwnership.requireAccess(access);
    TreeOwnership.claim(child, this, access);
    this.#children.push(child);
  }

  /** @internal Membership removal does not dismantle the removed subtree. */
  removeChild(child: Shape, access: symbol): void {
    TreeOwnership.requireAccess(access);
    const index = this.#children.indexOf(child);
    if (index < 0) throw new Error(`no such child: ${child.id}`);
    TreeOwnership.release(child, this, access);
    this.#children.splice(index, 1);
  }

  protected getOwnAttributes(): Readonly<Record<string, AttributeValue>> {
    return {};
  }

  protected setOwnAttribute(attribute: string, _value: AttributeValue): void {
    throw new Error(`unknown attribute: ${attribute}`);
  }

  private transform(operation: (child: Shape) => void): void {
    const before = this.#children.flatMap(child => TreeOwnership.nodes(child))
      .map(shape => ({ shape, attributes: shape.getAttributes() }));
    try {
      for (const child of this.#children) operation(child);
    } catch (error) {
      // Built-in setters accept these previously valid primitive values. Geometry
      // never changes styles or membership, so restoring attributes preserves ids
      // and object identity without allocating replacement nodes.
      for (const { shape, attributes } of before) {
        for (const [attribute, value] of Object.entries(attributes)) {
          if (attribute !== 'id') shape.setAttribute(attribute, value);
        }
      }
      throw error;
    }
  }
}
