import * as fs from 'node:fs';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import type { FileStore } from './FileStore.js';

/** A narrow syscall seam for deterministic IO failure tests. */
export type FileOperations = Pick<typeof fs, 'openSync' | 'fstatSync' | 'lstatSync' | 'readSync' |
  'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'unlinkSync'>;

export class LocalFileStore implements FileStore {
  readonly #maxBytes: number;
  readonly #fs: FileOperations;

  constructor(maxBytes = 1024 * 1024, operations: FileOperations = fs) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes >= Number.MAX_SAFE_INTEGER) {
      throw new Error('file byte limit must be a positive safe integer below MAX_SAFE_INTEGER');
    }
    this.#maxBytes = maxBytes;
    this.#fs = Object.freeze({ ...operations });
  }

  read(path: string): string {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    let descriptor: number | undefined;
    try {
      const target = this.#path(path);
      this.#regularTarget(target, false);
      descriptor = this.#fs.openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = this.#fs.fstatSync(descriptor);
      if (!stat.isFile()) throw new Error('not a regular file');
      tooLarge = stat.size > this.#maxBytes;
      // fstat is only an early rejection. Read at most limit + 1 actual bytes,
      // including when the file grows or reports a misleading size.
      while (!tooLarge) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, this.#maxBytes + 1 - total));
        const count = this.#fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (count === 0) break;
        chunks.push(buffer.subarray(0, count)); total += count;
        tooLarge = total > this.#maxBytes;
      }
      const closing = descriptor; descriptor = undefined;
      this.#fs.closeSync(closing);
    } catch (cause) {
      throw new Error(`cannot read file: ${path}`, { cause });
    } finally {
      if (descriptor !== undefined) {
        try { this.#fs.closeSync(descriptor); } catch { /* Preserve the primary read failure. */ }
      }
    }
    if (tooLarge) throw new Error('SVG byte limit exceeded');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
    } catch (cause) {
      throw new Error('invalid UTF-8 file encoding', { cause });
    }
  }

  write(path: string, source: string): void {
    let descriptor: number | undefined;
    let temporary: string | undefined;
    try {
      const target = this.#path(path);
      this.#regularTarget(target, true);
      const candidate = join(dirname(target), `.${basename(target)}.svg-editor-${randomUUID()}.tmp`);
      const bytes = Buffer.from(source, 'utf8');
      // Prepare the payload before creating any file. Record ownership only
      // after exclusive creation; never unlink a collision.
      descriptor = this.#fs.openSync(candidate, 'wx', 0o600);
      temporary = candidate;
      let offset = 0;
      while (offset < bytes.length) {
        const written = this.#fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
        if (written <= 0) throw new Error('file write made no progress');
        offset += written;
      }
      this.#fs.fsyncSync(descriptor);
      // Do not retry close after an error: descriptor ownership is ambiguous on
      // some OSes. A close failure still prevents replacement of the old target.
      const closing = descriptor; descriptor = undefined;
      this.#fs.closeSync(closing);
      this.#regularTarget(target, true);
      this.#fs.renameSync(temporary, target);
      // Nothing fallible (including cleanup or directory fsync) follows rename.
      temporary = undefined;
    } catch (cause) {
      throw new Error(`cannot write file: ${path}`, { cause });
    } finally {
      if (descriptor !== undefined) {
        try { this.#fs.closeSync(descriptor); } catch { /* Keep the original failure. */ }
      }
      if (temporary !== undefined) {
        try { this.#fs.unlinkSync(temporary); } catch { /* Best effort; target was not replaced. */ }
      }
    }
  }

  #path(path: string): string {
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) throw new Error('invalid file path');
    return resolve(path);
  }

  #regularTarget(path: string, allowMissing: boolean): void {
    let stat;
    try { stat = this.#fs.lstatSync(path); }
    catch (error) {
      if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('expected a regular file, not a symlink or directory');
  }
}
