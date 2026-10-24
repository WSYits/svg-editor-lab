import type { DocumentIoResult } from '../application/DocumentIoResult.js';
import type { CommandOutput } from './CommandOutput.js';
import type { ShapeView, TreeView } from '../application/QueryView.js';

export class Presenter {
  summary(result: { readonly summary: string }): string { return this.#singleLine(result.summary); }

  output(output: CommandOutput): string {
    // These are presentation shapes, not command names or graphic types.
    switch (output.kind) {
      case 'empty': return '';
      case 'summary': return this.summary(output.value);
      case 'io': return this.documentIo(output.value);
      case 'canvas': return this.canvas(output.value);
      case 'tree': return this.tree(output.value);
      case 'shape': return this.show(output.value);
      case 'help': return this.help(output.value);
    }
  }

  documentIo(result: DocumentIoResult): string {
    return [...result.warnings.map(warning => this.#singleLine(warning)), this.summary(result)].join('\n');
  }

  error(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `error: ${this.#singleLine(message)}`;
  }

  help(syntaxes: readonly string[]): string { return syntaxes.join('\n'); }

  canvas(size: { readonly width: number; readonly height: number }): string {
    return `canvas ${size.width}x${size.height}`;
  }

  tree(view: TreeView): string {
    const lines: string[] = [];
    if (!view.subtree) lines.push(`svg (${view.width}x${view.height})`);
    const visit = (node: ShapeView, prefix: string, last: boolean, root: boolean): void => {
      lines.push(`${prefix}${root ? '' : last ? '└── ' : '├── '}${this.#label(node)}${this.#attributes(node)}`);
      const next = prefix + (root ? '' : last ? '    ' : '│   ');
      node.children.forEach((child, index) => visit(child, next, index === node.children.length - 1, false));
    };
    view.roots.forEach((root, index) => visit(root, '', index === view.roots.length - 1, view.subtree));
    return lines.join('\n');
  }

  show(view: ShapeView): string {
    const parent = view.parentId === undefined ? 'svg' : `g#${this.#singleLine(view.parentId)}`;
    const geometry = this.#attributes(view, false).trim();
    const styles = this.#attributes(view, true).trim();
    return [`${this.#label(view)}  parent=${parent}`, ...[geometry, styles].filter(Boolean).map(line => `  ${line}`)].join('\n');
  }

  #label(view: ShapeView): string { return `${this.#singleLine(view.type)}#${this.#singleLine(view.id)}`; }

  #attributes(view: ShapeView, stylesOnly?: boolean): string {
    return Object.entries(view.attributes).filter(([name]) => name !== 'id')
      .filter(([name]) => stylesOnly === undefined || ['fill', 'stroke', 'stroke-width'].includes(name) === stylesOnly)
      .map(([name, value]) => {
        const label = name === 'width' ? 'w' : name === 'height' ? 'h' : name;
        const display = typeof value === 'number' ? String(value)
          : name === 'text' || /\s|["\\]/u.test(value) ? JSON.stringify(value) : this.#singleLine(value);
        return ` ${label}=${this.#singleLine(display)}`;
      }).join('');
  }

  #singleLine(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu,
      char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
}
