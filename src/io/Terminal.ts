/** Only terminal transport is asynchronous; editor operations remain synchronous. */
export interface Terminal {
  lines(): AsyncIterable<string>;
  write(text: string): Promise<void>;
  writeError(text: string): Promise<void>;
  prompt(): Promise<void>;
  close(): Promise<void>;
}
