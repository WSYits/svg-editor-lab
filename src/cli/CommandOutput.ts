import type { CanvasSize } from '../application/EditorSession.js';
import type { DocumentIoResult } from '../application/DocumentIoResult.js';
import type { ShapeView, TreeView } from '../application/QueryView.js';

/** Display values only. Kinds select formatting, never command/domain behavior. */
export type CommandOutput =
  | { readonly kind: 'empty' }
  | { readonly kind: 'summary'; readonly value: { readonly summary: string } }
  | { readonly kind: 'io'; readonly value: DocumentIoResult }
  | { readonly kind: 'canvas'; readonly value: CanvasSize }
  | { readonly kind: 'tree'; readonly value: TreeView }
  | { readonly kind: 'shape'; readonly value: ShapeView }
  | { readonly kind: 'help'; readonly value: readonly string[] };
