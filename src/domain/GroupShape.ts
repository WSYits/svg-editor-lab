import { Shape, type AttributeValue } from './Shape.js';
import { TreeOwnership } from './TreeOwnership.js';

export class GroupShape extends Shape {
  constructor(id: string, children: readonly Shape[] = []) {
    super(id);
    TreeOwnership.initializeGroup(this, children);
  }

  get type(): string {
    return 'g';
  }

  override get children(): readonly Shape[] {
    return TreeOwnership.childrenOf(this);
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
    const copy = new GroupShape(this.id, this.children.map(child => child.clone()));
    this.copyCommonStateTo(copy);
    return copy;
  }

  protected getOwnAttributes(): Readonly<Record<string, AttributeValue>> {
    return {};
  }

  protected setOwnAttribute(attribute: string, _value: AttributeValue): void {
    throw new Error(`unknown attribute: ${attribute}`);
  }

  private transform(operation: (child: Shape) => void): void {
    const before = this.children.flatMap(child => TreeOwnership.nodes(child))
      .map(shape => ({ shape, attributes: shape.getAttributes() }));
    try {
      for (const child of this.children) operation(child);
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
