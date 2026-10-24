/** Presentation values only; never contain mutable domain objects. */
export interface ShapeView {
  readonly id: string;
  readonly type: string;
  readonly parentId: string | undefined;
  readonly attributes: Readonly<Record<string, string | number>>;
  readonly children: readonly ShapeView[];
}
export interface TreeView {
  readonly width: number;
  readonly height: number;
  readonly subtree: boolean;
  readonly roots: readonly ShapeView[];
}
