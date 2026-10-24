import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { LocalFileStore, type FileOperations } from '../src/io/LocalFileStore.js';

function fixture(t: { after(fn: () => void): void }): { directory: string; path: string } {
  const directory = fs.mkdtempSync(join(tmpdir(), 'svg-files-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, '中文 文件.svg') };
}

for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER, 1.5]) {
  test(`rejects invalid file limit ${value}`, () => assert.throws(() => new LocalFileStore(value), /byte limit/));
}
test('real UTF-8 new file and overwrite use same directory replacement without leftovers', t => {
  const { directory, path } = fixture(t); const store = new LocalFileStore();
  store.write(path, '中文 😀 <svg/>');
  assert.equal(store.read(path), '中文 😀 <svg/>');
  const original = fs.statSync(path);
  store.write(path, 'replacement');
  assert.equal(fs.readFileSync(path, 'utf8'), 'replacement');
  assert.equal(store.read(path), 'replacement');
  assert.deepEqual(fs.readdirSync(directory), ['中文 文件.svg']);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path).mode & 0o777, 0o600);
    assert.notEqual(fs.statSync(path).ino, original.ino);
  }
});
test('relative paths use cwd and shell characters remain literal', t => {
  const { directory } = fixture(t); const path = join(directory, '~ $HOME $(echo nope) *.svg');
  const store = new LocalFileStore(); const local = relative(process.cwd(), path);
  store.write(local, 'literal'); assert.equal(store.read(local), 'literal');
  assert.deepEqual(fs.readdirSync(directory), ['~ $HOME $(echo nope) *.svg']);
});
test('UTF-8 BOM and valid replacement character are valid Unicode, not encoding errors', t => {
  const { path } = fixture(t); fs.writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文😀\ufffd')]));
  assert.equal(new LocalFileStore().read(path), '中文😀\ufffd');
});
for (const bytes of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe4, 0xb8], [0xff, 0xfe, 0x3c, 0]]) {
  test(`strict decoding rejects malformed UTF-8 ${bytes}`, t => {
    const { path } = fixture(t); fs.writeFileSync(path, Buffer.from(bytes));
    assert.throws(() => new LocalFileStore().read(path), { message: 'invalid UTF-8 file encoding' });
  });
}
for (const name of ['missing', 'directory', 'empty', 'nul'] as const) {
  test(`read and write reject ${name} paths with stable filesystem errors`, t => {
    const { directory } = fixture(t);
    const path = name === 'missing' ? join(directory, 'absent', 'a.svg') : name === 'directory' ? directory : name === 'empty' ? '' : '\0';
    const store = new LocalFileStore();
    assert.throws(() => store.read(path), { message: `cannot read file: ${path}` });
    assert.throws(() => store.write(path, 'x'), { message: `cannot write file: ${path}` });
  });
}
test('direct symlinks are rejected for reading and replacement without changing the referent', t => {
  const { directory, path } = fixture(t); fs.writeFileSync(path, 'original');
  const link = join(directory, 'link.svg'); fs.symlinkSync(path, link);
  const store = new LocalFileStore();
  assert.throws(() => store.read(link), /cannot read file/);
  assert.throws(() => store.write(link, 'bad'), /cannot write file/);
  assert.equal(fs.readFileSync(path, 'utf8'), 'original'); assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});
test('byte limit is inclusive; oversized regular files reject before reading', t => {
  const { path } = fixture(t); const operations: FileOperations = { ...fs };
  fs.writeFileSync(path, '1234'); assert.equal(new LocalFileStore(4).read(path), '1234');
  fs.appendFileSync(path, '5');
  const spy = t.mock.method(operations, 'readSync', () => { throw new Error('must not read known oversized file'); });
  assert.throws(() => new LocalFileStore(4, operations).read(path), { message: 'SVG byte limit exceeded' });
  assert.equal(spy.mock.callCount(), 0);
});
test('actual-byte loop rejects growing/misreported file after at most limit plus one byte', t => {
  const { path } = fixture(t); fs.writeFileSync(path, '1234567890');
  const operations: FileOperations = { ...fs }; let bytes = 0;
  t.mock.method(operations, 'fstatSync', (descriptor: number) => {
    const stat = fs.fstatSync(descriptor); stat.size = 0; return stat;
  });
  t.mock.method(operations, 'readSync', (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    assert.ok(length <= 5 - bytes);
    const count = fs.readSync(descriptor, buffer, offset, length, position); bytes += count; return count;
  });
  assert.throws(() => new LocalFileStore(4, operations).read(path), { message: 'SVG byte limit exceeded' });
  assert.equal(bytes, 5);
});
test('short reads and short writes complete rather than silently truncating', t => {
  const { path } = fixture(t); const operations: FileOperations = { ...fs };
  t.mock.method(operations, 'writeSync', (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) =>
    fs.writeSync(descriptor, buffer, offset, Math.min(length, 2), position));
  t.mock.method(operations, 'readSync', (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) =>
    fs.readSync(descriptor, buffer, offset, Math.min(length, 1), position));
  const store = new LocalFileStore(100, operations); store.write(path, '中文😀abcdef');
  assert.equal(store.read(path), '中文😀abcdef');
});
for (const phase of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync'] as const) {
  test(`injected ${phase} failure preserves old target and removes owned temporary file`, t => {
    const { directory, path } = fixture(t); fs.writeFileSync(path, 'old');
    const operations: FileOperations = { ...fs };
    if (phase === 'closeSync') t.mock.method(operations, phase, (descriptor: number) => { fs.closeSync(descriptor); throw new Error('injected close'); });
    else t.mock.method(operations, phase, () => { throw new Error(`injected ${phase}`); });
    assert.throws(() => new LocalFileStore(100, operations).write(path, 'new'), { message: `cannot write file: ${path}` });
    assert.equal(fs.readFileSync(path, 'utf8'), 'old');
    assert.deepEqual(fs.readdirSync(directory), ['中文 文件.svg']);
  });
}
test('zero-progress writes reject and clean temporary file', t => {
  const { directory, path } = fixture(t); const operations: FileOperations = { ...fs };
  t.mock.method(operations, 'writeSync', () => 0);
  assert.throws(() => new LocalFileStore(100, operations).write(path, 'new'), /cannot write file/);
  assert.deepEqual(fs.readdirSync(directory), []);
});
test('exclusive-create collision does not remove a file the store did not create', t => {
  const { directory, path } = fixture(t); const operations: FileOperations = { ...fs };
  t.mock.method(operations, 'openSync', (candidate: fs.PathLike) => {
    fs.writeFileSync(candidate, 'other writer'); throw Object.assign(new Error('collision'), { code: 'EEXIST' });
  });
  const unlink = t.mock.method(operations, 'unlinkSync', () => { throw new Error('must not unlink'); });
  assert.throws(() => new LocalFileStore(100, operations).write(path, 'new'), /cannot write file/);
  assert.equal(unlink.mock.callCount(), 0); assert.equal(fs.readdirSync(directory).length, 1);
});
test('cleanup failure preserves original error and target; a residual temp is an explicit limitation', t => {
  const { directory, path } = fixture(t); fs.writeFileSync(path, 'old'); const operations: FileOperations = { ...fs };
  t.mock.method(operations, 'renameSync', () => { throw new Error('rename failure'); });
  t.mock.method(operations, 'unlinkSync', () => { throw new Error('cleanup failure'); });
  assert.throws(() => new LocalFileStore(100, operations).write(path, 'new'), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, `cannot write file: ${path}`);
    assert.ok(error.cause instanceof Error); assert.equal(error.cause.message, 'rename failure'); return true;
  });
  assert.equal(fs.readFileSync(path, 'utf8'), 'old'); assert.equal(fs.readdirSync(directory).length, 2);
});
test('no filesystem operation follows a successful rename', t => {
  const { path } = fixture(t); const operations: FileOperations = { ...fs }; let replaced = false;
  for (const name of ['closeSync', 'fsyncSync', 'unlinkSync'] as const) {
    const original = operations[name];
    t.mock.method(operations, name, (...args: Parameters<typeof original>) => {
      assert.equal(replaced, false); return Reflect.apply(original, operations, args);
    });
  }
  t.mock.method(operations, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => { fs.renameSync(from, to); replaced = true; });
  new LocalFileStore(100, operations).write(path, 'complete'); assert.equal(replaced, true);
});
for (const stage of ['openSync', 'readSync', 'closeSync'] as const) {
  test(`injected read ${stage} failure is a filesystem failure`, t => {
    const { path } = fixture(t); fs.writeFileSync(path, 'data'); const operations: FileOperations = { ...fs };
    if (stage === 'closeSync') t.mock.method(operations, stage, (descriptor: number) => { fs.closeSync(descriptor); throw new Error('close'); });
    else t.mock.method(operations, stage, () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    assert.throws(() => new LocalFileStore(100, operations).read(path), { message: `cannot read file: ${path}` });
  });
}
test('failure after a real partial write never changes the old target', t => {
  const { directory, path } = fixture(t); fs.writeFileSync(path, 'old bytes'); const operations: FileOperations = { ...fs }; let calls = 0;
  t.mock.method(operations, 'writeSync', (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    if (++calls > 1) throw new Error('failure after partial write');
    return fs.writeSync(descriptor, buffer, offset, Math.min(length, 2), position);
  });
  assert.throws(() => new LocalFileStore(100, operations).write(path, 'new bytes'), /cannot write file/);
  assert.equal(calls, 2); assert.equal(fs.readFileSync(path, 'utf8'), 'old bytes');
  assert.deepEqual(fs.readdirSync(directory), ['中文 文件.svg']);
});
test('replacement intentionally creates a private inode and leaves other hard links on old content', { skip: process.platform === 'win32' }, t => {
  const { directory, path } = fixture(t); fs.writeFileSync(path, 'old bytes'); fs.chmodSync(path, 0o644);
  const other = join(directory, 'hard-link.svg'); fs.linkSync(path, other);
  new LocalFileStore().write(path, 'new bytes');
  assert.equal(fs.statSync(path).mode & 0o777, 0o600); assert.equal(fs.readFileSync(path, 'utf8'), 'new bytes');
  assert.equal(fs.readFileSync(other, 'utf8'), 'old bytes'); assert.notEqual(fs.statSync(path).ino, fs.statSync(other).ino);
});
