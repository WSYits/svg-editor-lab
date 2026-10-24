import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { HistoryManager } from '../src/application/HistoryManager.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { RectShape } from '../src/domain/RectShape.js';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import type { FileStore } from '../src/io/FileStore.js';
import { LocalFileStore, type FileOperations } from '../src/io/LocalFileStore.js';

function fixture(t: { after(fn: () => void): void }): { directory: string; path: string } {
  const directory = fs.mkdtempSync(join(tmpdir(), 'svg-io-failures-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, 'file.svg') };
}
function seeded(files: FileStore, disabled = false, codec = new SvgCodec()): EditorService {
  const doc = new SvgDocument(300, 200); doc.insert(new RectShape('r', 1, 2, 3, 4));
  const service = new EditorService(new EditorSession(doc, 'original.svg'), new HistoryManager(), files, codec);
  service.execute(new MoveCommand('r', 1, 0)); service.execute(new SetAttributeCommand('r', 'fill', 'red')); service.undo();
  if (disabled) service.resizeCanvas(300, 200);
  return service;
}
function capture(service: EditorService): unknown {
  return { xml: new SvgCodec().encode(service.getDocumentSnapshot()!), path: service.defaultSavePath, history: service.getHistoryStatus() };
}
function branchIntact(service: EditorService, disabled: boolean): void {
  if (disabled) { assert.throws(() => service.redo(), /undo not allowed after io command/); return; }
  service.redo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('fill'), 'red');
  service.undo(); service.undo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
}
const valid = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="1" y="2" width="3" height="4"/></svg>';

for (const disabled of [false, true]) {
  for (const [name, bytes, error] of [
    ['UTF-8', Buffer.from([0xed, 0xa0, 0x80]), /invalid UTF-8 file encoding/],
    ['oversize', Buffer.alloc(1025, 0x20), /SVG byte limit exceeded/],
    ['XML', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), /invalid XML/],
    ['semantics', Buffer.from(valid.replace('<rect ', '<path ')), /unknown shape type/],
    ['units', Buffer.from(valid.replace('width="100"', 'width="100%"')), /length|number/],
    ['transform', Buffer.from(valid.replace('<rect ', '<rect transform="scale(2)" ')), /transform/],
    ['encoding declaration', Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>' + valid), /only XML 1.0 UTF-8/],
  ] as const) {
    test(`failed read ${name} preserves complete ${disabled ? 'disabled' : 'two-stack'} state`, t => {
      const { path } = fixture(t); fs.writeFileSync(path, bytes);
      const service = seeded(new LocalFileStore(1024), disabled); const before = capture(service);
      assert.throws(() => service.read(path), error); assert.deepEqual(capture(service), before); branchIntact(service, disabled);
      assert.deepEqual(fs.readFileSync(path), bytes);
    });
  }
  for (const kind of ['missing read', 'directory read', 'missing parent save', 'directory save'] as const) {
    test(`${kind} preserves complete ${disabled ? 'disabled' : 'two-stack'} state`, t => {
      const { directory, path } = fixture(t); const service = seeded(new LocalFileStore(), disabled); const before = capture(service);
      const action = kind === 'missing read' ? () => service.read(path) : kind === 'directory read' ? () => service.read(directory)
        : kind === 'missing parent save' ? () => service.save(join(directory, 'absent', 'out.svg')) : () => service.save(directory);
      assert.throws(action, /cannot (read|write) file/); assert.deepEqual(capture(service), before); branchIntact(service, disabled);
    });
  }
  for (const stage of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync'] as const) {
    test(`save ${stage} failure preserves old bytes and all ${disabled ? 'disabled' : 'two-stack'} state`, t => {
      const { directory, path } = fixture(t); fs.writeFileSync(path, 'old target bytes');
      const operations: FileOperations = { ...fs };
      if (stage === 'closeSync') t.mock.method(operations, stage, (descriptor: number) => { fs.closeSync(descriptor); throw new Error('close failed'); });
      else t.mock.method(operations, stage, () => { throw Object.assign(new Error('injected IO failure'), { code: 'EACCES' }); });
      const service = seeded(new LocalFileStore(1024, operations), disabled); const before = capture(service);
      assert.throws(() => service.save(path), { message: `cannot write file: ${path}` });
      assert.equal(fs.readFileSync(path, 'utf8'), 'old target bytes'); assert.deepEqual(capture(service), before);
      assert.deepEqual(fs.readdirSync(directory), ['file.svg']); branchIntact(service, disabled);
    });
  }
}

for (const operation of ['read', 'save'] as const) {
  for (const disabled of [false, true]) {
    for (const stage of ['clone', 'history', 'result'] as const) {
      test(`${operation} ${stage} preparation failure preserves state and does not write (disabled=${disabled})`, t => {
        const { path } = fixture(t); fs.writeFileSync(path, valid); const files = new LocalFileStore();
        let writes = 0; const store: FileStore = { read: p => files.read(p), write(p, source) { writes++; files.write(p, source); } };
        const service = seeded(store, disabled); const before = capture(service);
        const clones = SvgDocument.prototype.clone; let calls = 0;
        let restore: () => void;
        if (stage === 'clone') {
          const spy = t.mock.method(SvgDocument.prototype, 'clone', function(this: SvgDocument): SvgDocument {
            // read's new Session is its first clone; save snapshots then clones into its new Session.
            if (++calls === (operation === 'read' ? 1 : 2)) throw new Error('injected Session clone failure');
            return clones.call(this);
          }); restore = () => spy.mock.restore();
        } else if (stage === 'history') {
          const spy = t.mock.method(HistoryManager.prototype, 'resetBoundary', () => { throw new Error('injected history preparation failure'); });
          restore = () => spy.mock.restore();
        } else {
          let preparingResult = false; const reset = HistoryManager.prototype.resetBoundary;
          const roots = Object.getOwnPropertyDescriptor(SvgDocument.prototype, 'roots')!.get!;
          const history = t.mock.method(HistoryManager.prototype, 'resetBoundary', function(this: HistoryManager): HistoryManager {
            const next = reset.call(this); preparingResult = true; return next;
          });
          const getter = t.mock.getter(SvgDocument.prototype, 'roots', function(this: SvgDocument) {
            if (preparingResult) throw new Error('injected result preparation failure'); return roots.call(this);
          }); restore = () => { history.mock.restore(); getter.mock.restore(); };
        }
        assert.throws(() => operation === 'read' ? service.read(path) : service.save(path), /injected/);
        restore(); assert.equal(writes, 0); assert.equal(fs.readFileSync(path, 'utf8'), valid);
        assert.deepEqual(capture(service), before); branchIntact(service, disabled);
      });
    }
  }
}

test('encoding failure does not touch disk or clear history', t => {
  const { path } = fixture(t); fs.writeFileSync(path, 'old'); const codec = new SvgCodec(); const service = seeded(new LocalFileStore(), false, codec);
  const before = capture(service); t.mock.method(codec, 'encode', () => { throw new Error('injected encoding failure'); });
  assert.throws(() => service.save(path), /injected encoding/); assert.equal(fs.readFileSync(path, 'utf8'), 'old');
  assert.deepEqual(capture(service), before); branchIntact(service, false);
});
test('candidate snapshot clone failure before encoding does not touch target', t => {
  const { path } = fixture(t); fs.writeFileSync(path, 'old'); const service = seeded(new LocalFileStore()); const before = capture(service);
  const spy = t.mock.method(SvgDocument.prototype, 'clone', () => { throw new Error('snapshot clone failed'); });
  assert.throws(() => service.save(path), /snapshot clone failed/); spy.mock.restore();
  assert.equal(fs.readFileSync(path, 'utf8'), 'old'); assert.deepEqual(capture(service), before); branchIntact(service, false);
});
test('failed SVG validation after missing-id candidates emits no result or partial new state', t => {
  const { path } = fixture(t); fs.writeFileSync(path, valid.replace('</svg>', '<rect id="bad" x="0" y="0" width="-1" height="1"/></svg>'));
  const service = seeded(new LocalFileStore()); const before = capture(service);
  assert.throws(() => service.read(path)); assert.deepEqual(capture(service), before); branchIntact(service, false);
});
test('read snapshots isolate retained decoder document and warnings', t => {
  const codec = new SvgCodec(); const doc = new SvgDocument(); doc.insert(new RectShape('r', 1, 2, 3, 4)); const warnings = ['warning: retained'];
  t.mock.method(codec, 'decode', () => ({ document: doc, warnings }));
  const service = new EditorService(undefined, undefined, { read: () => valid, write() {} }, codec);
  const result = service.read('source.svg'); doc.remove('r'); warnings[0] = 'changed';
  assert.ok(service.getDocumentSnapshot()!.findById('r')); assert.deepEqual(result.warnings, ['warning: retained']);
});
for (const operation of ['read', 'save'] as const) {
  test(`${operation} rejects synchronous reentrant writes, permits reads, and releases guard after failure`, () => {
    let fail = true; let service: EditorService;
    const inspect = (): void => {
      const before = capture(service);
      for (const action of [() => service.init(), () => service.save('nested.svg'), () => service.read('nested.svg'), () => service.undo()]) {
        assert.throws(action, /editor operation already in progress/);
      }
      service.getCanvasSize(); service.getTreeView(); assert.deepEqual(capture(service), before);
      if (fail) throw new Error('injected persistence failure');
    };
    const store: FileStore = { read() { inspect(); return valid; }, write() { inspect(); } };
    service = seeded(store); const before = capture(service);
    assert.throws(() => operation === 'read' ? service.read('file.svg') : service.save('file.svg'), /injected persistence/);
    assert.deepEqual(capture(service), before); fail = false;
    if (operation === 'read') service.read('file.svg'); else service.save('file.svg');
    assert.equal(service.getHistoryStatus().disabled, true); service.init();
  });
}
test('save observes old official state during write and performs no clone or history preparation after replacement', t => {
  const { path } = fixture(t); const local = new LocalFileStore(); let service: EditorService; let replaced = false; let before: unknown;
  const store: FileStore = {
    read: p => local.read(p),
    write(p, source) {
      assert.deepEqual(capture(service), before); local.write(p, source); replaced = true;
    },
  };
  service = seeded(store); before = capture(service);
  const clone = SvgDocument.prototype.clone; const reset = HistoryManager.prototype.resetBoundary;
  const cloneSpy = t.mock.method(SvgDocument.prototype, 'clone', function(this: SvgDocument): SvgDocument {
    assert.equal(replaced, false); return clone.call(this);
  });
  const historySpy = t.mock.method(HistoryManager.prototype, 'resetBoundary', function(this: HistoryManager): HistoryManager {
    assert.equal(replaced, false); return reset.call(this);
  });
  const result = service.save(path); cloneSpy.mock.restore(); historySpy.mock.restore();
  assert.equal(replaced, true); assert.match(result.summary, /^saved to /); assert.equal(service.defaultSavePath, path);
  assert.equal(service.getHistoryStatus().disabled, true); assert.equal(service.getHistoryStatus().undoCount, 0);
  assert.equal(new SvgCodec().encode(service.getDocumentSnapshot()!), fs.readFileSync(path, 'utf8'));
});
