import type { SvgDocument } from '../domain/SvgDocument.js';

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/** An isolated session value. Replacing a session is the service's job. */
export class EditorSession {
  readonly #document: SvgDocument | undefined;
  readonly #defaultSavePath: string | undefined;

  constructor(document?: SvgDocument, defaultSavePath?: string) {
    if (document === undefined && defaultSavePath !== undefined) {
      throw new Error('a default save path requires a document');
    }
    this.#document = document?.clone();
    this.#defaultSavePath = defaultSavePath;
  }

  get hasDocument(): boolean { return this.#document !== undefined; }
  get defaultSavePath(): string | undefined { return this.#defaultSavePath; }

  getCanvasSize(): CanvasSize | undefined {
    if (this.#document === undefined) return undefined;
    return Object.freeze({ width: this.#document.width, height: this.#document.height });
  }

  getDocumentSnapshot(): SvgDocument | undefined {
    return this.#document?.clone();
  }
}
