/** Synchronous persistence only; no document, history or presentation knowledge. */
export interface FileStore {
  read(path: string): string;
  /** Returns only after replacement succeeds. Must not throw after that point. */
  write(path: string, source: string): void;
}
