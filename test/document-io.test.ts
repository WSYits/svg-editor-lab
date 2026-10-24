import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { HistoryManager } from '../src/application/HistoryManager.js';
import { DocumentIoResult } from '../src/application/DocumentIoResult.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { GroupCommand } from '../src/application/commands/GroupCommand.js';
import { UngroupCommand } from '../src/application/commands/UngroupCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import type { Shape } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import type { FileStore } from '../src/io/FileStore.js';
import { LocalFileStore } from '../src/io/LocalFileStore.js';

function fixture(t: { after(fn: () => void): void }): string {
  const directory = fs.mkdtempSync(join(tmpdir(), 'svg-document-io-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory;
}
function document(): SvgDocument {
  const doc = new SvgDocument(400, 300);
  const text = new TextShape('t', 1, 2, '中文 😀 & <>'); text.setPreservedAttributes({ 'font-size': '16', 'data-note': 'retained' });
  doc.insert(new GroupShape('outer', [new GroupShape('inner', [text]), new RectShape('r', 1, 2, 3, 4)]));
  doc.setPreservedAttributes({ 'data-root': 'root' }); return doc;
}
function seeded(files: FileStore = new LocalFileStore(), codec = new SvgCodec()): EditorService {
  const service = new EditorService(new EditorSession(document(), 'original.svg'), new HistoryManager(), files, codec);
  service.execute(new MoveCommand('r', 1, 0)); service.execute(new SetAttributeCommand('t', 'text', 'changed'));
  service.undo(); return service;
}
function capture(service: EditorService): unknown {
  const doc = service.getDocumentSnapshot();
  return { xml: doc ? new SvgCodec().encode(doc) : undefined, path: service.defaultSavePath, history: service.getHistoryStatus() };
}
function boundary(service: EditorService): void {
  assert.deepEqual(service.getHistoryStatus(), { undoCount: 0, redoCount: 0, disabled: true, canUndo: false, canRedo: false });
  assert.throws(() => service.undo(), { message: 'undo not allowed after io command' });
  assert.throws(() => service.redo(), { message: 'undo not allowed after io command' });
}
function invariants(doc: SvgDocument): void {
  const ids = new Set<string>(); const seen = new Set<object>();
  const visit = (nodes: typeof doc.roots, parent?: Shape): void => {
    for (const node of nodes) {
      assert.equal(ids.has(node.id), false); ids.add(node.id);
      assert.equal(seen.has(node), false); seen.add(node);
      assert.equal(doc.findById(node.id), node); assert.equal(doc.parentOf(node.id), parent);
      assert.equal(TreeOwnership.ownerOf(node), parent ?? doc);
      // Structural traversal only; no graphic-type behavior dispatch.
      if (node.children.length) visit(node.children, node);
    }
  }; visit(doc.roots);
}

test('real save new/overwrite/alternate/default paths round trip full tree and metadata', t => {
  const directory = fixture(t); const path = join(directory, '中文 空格.svg'); const alternate = join(directory, 'alternate.svg');
  const service = seeded(); const codec = new SvgCodec(); const xml = codec.encode(service.getDocumentSnapshot()!);
  const result = service.save(path); assert.equal(result.summary, `saved to ${path} (4 elements)`);
  assert.deepEqual(result.warnings, []); assert.equal(service.defaultSavePath, path); boundary(service);
  assert.equal(fs.readFileSync(path, 'utf8'), xml);
  const reloaded = codec.decode(fs.readFileSync(path, 'utf8')).document; invariants(reloaded); assert.equal(codec.encode(reloaded), xml);
  service.execute(new MoveCommand('r', 3, 0)); service.save(); boundary(service);
  assert.equal(codec.decode(fs.readFileSync(path, 'utf8')).document.findById('r')!.getAttribute('x'), 5);
  service.save(alternate); assert.equal(service.defaultSavePath, alternate); boundary(service);
  assert.equal(fs.readFileSync(alternate, 'utf8'), fs.readFileSync(path, 'utf8'));
});
test('read without an existing document imports missing ids and stable warnings only on success', t => {
  const directory = fixture(t); const path = join(directory, 'other.svg');
  fs.copyFileSync('test/fixtures/svg/task-other.svg', path);
  const service = new EditorService(undefined, undefined, new LocalFileStore());
  const result = service.read(path); assert.equal(result.summary, `read ${path} (7 elements)`);
  assert.deepEqual(result.warnings, ['warning: assigned id rect1 to unnamed <rect>']);
  assert.throws(() => Object.assign(result.warnings, { 0: 'pollution' }), TypeError);
  assert.equal(service.defaultSavePath, path); invariants(service.getDocumentSnapshot()!); boundary(service);
  const snapshot = service.getDocumentSnapshot()!; snapshot.remove('rect1');
  assert.ok(service.getDocumentSnapshot()!.findById('rect1'));
});
test('read and save relative paths preserve the supplied path and resolve from cwd without expansion', t => {
  const directory = fixture(t); const path = relative(process.cwd(), join(directory, '~ $HOME *.svg'));
  const service = seeded(); service.save(path); assert.equal(service.defaultSavePath, path);
  service.init(); service.read(path); assert.equal(service.defaultSavePath, path);
  service.execute(new MoveCommand('r', 2, 0)); service.undo(); service.redo(); service.save(); boundary(service);
  assert.ok(fs.existsSync(path));
});
test('read replaces both history branches; subsequent failure/query/success/undo/redo obey boundary rules and path', t => {
  const directory = fixture(t); const path = join(directory, 'input.svg'); fs.writeFileSync(path, new SvgCodec().encode(document()));
  const service = seeded(); service.read(path); boundary(service);
  const before = capture(service); assert.throws(() => service.execute(new MoveCommand('missing', 1, 0)), /no such shape/);
  service.getTreeView(); service.getCanvasSize(); assert.deepEqual(capture(service), before);
  service.execute(new MoveCommand('r', 2, 0)); assert.equal(service.getHistoryStatus().disabled, false);
  service.undo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
  assert.throws(() => service.undo(), { message: 'nothing to undo' });
  service.redo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 3);
  assert.equal(service.defaultSavePath, path);
  service.resizeCanvas(600, 400); assert.equal(service.defaultSavePath, path); boundary(service);
  service.init(); assert.equal(service.defaultSavePath, undefined); boundary(service);
});
test('save boundary re-enables only after successful edit and never reverts default path through history', t => {
  const path = join(fixture(t), 'saved.svg'); const service = seeded(); service.save(path); boundary(service);
  const before = capture(service); assert.throws(() => service.execute(new MoveCommand('r', Infinity, 0)));
  assert.deepEqual(capture(service), before); service.execute(new MoveCommand('r', 0, 0));
  service.undo(); assert.equal(service.defaultSavePath, path); assert.throws(() => service.undo(), /nothing to undo/);
  service.redo(); assert.equal(service.defaultSavePath, path);
});
test('read/structure edits/undo/redo/save/read maintain semantic state and independent ownership', t => {
  const directory = fixture(t); const input = join(directory, 'in.svg'); const output = join(directory, 'out.svg'); const codec = new SvgCodec();
  fs.writeFileSync(input, codec.encode(document())); const service = seeded(); service.read(input);
  service.execute(new GroupCommand('mixed', ['t', 'r'])); const grouped = codec.encode(service.getDocumentSnapshot()!);
  service.execute(new UngroupCommand('mixed')); service.undo(); assert.equal(codec.encode(service.getDocumentSnapshot()!), grouped);
  service.redo(); service.execute(new SetAttributeCommand('t', 'text', 'roundtrip 中文 😀'));
  const expected = codec.encode(service.getDocumentSnapshot()!); service.save(output); service.read(output);
  const first = service.getDocumentSnapshot()!; const second = service.getDocumentSnapshot()!;
  assert.equal(codec.encode(first), expected); assert.equal(codec.encode(second), expected); invariants(first); invariants(second);
  assert.notEqual(first.findById('t'), second.findById('t'));
  assert.deepEqual(first.findById('t')!.getPreservedAttributes(), { 'font-size': '16', 'data-note': 'retained' });
});
test('no-document and no-default-path errors occur without disk operations', () => {
  const files: FileStore = { read() { throw new Error('unexpected read'); }, write() { throw new Error('unexpected write'); } };
  const service = new EditorService(undefined, undefined, files);
  assert.throws(() => service.save(), { message: "no document. use 'init' or 'read' first" });
  service.init(); const before = capture(service);
  assert.throws(() => service.save(), { message: 'no save path. provide a file path' }); assert.deepEqual(capture(service), before);
});
test('unconfigured service cannot announce a fake file success', () => {
  const service = new EditorService(); assert.throws(() => service.read('a.svg'), /not configured/);
  service.init(); const before = capture(service); assert.throws(() => service.save('a.svg'), /not configured/);
  assert.deepEqual(capture(service), before);
});
test('IO result defensively captures warnings and exposes no callbacks or document references', () => {
  const warnings = ['warning: original']; const result = new DocumentIoResult('read ok', warnings);
  warnings[0] = 'changed'; assert.deepEqual(result.warnings, ['warning: original']);
  assert.throws(() => Object.assign(result, { summary: 'changed' }), TypeError);
  assert.throws(() => Object.assign(result.warnings, { 0: 'changed' }), TypeError);
  assert.equal(result.summary, 'read ok'); assert.deepEqual(Object.keys(result), []);
});
test('a consumer/output failure after save cannot roll back or relabel the successful persistence', t => {
  const path = join(fixture(t), 'saved.svg'); const service = seeded();
  const result = service.save(path);
  assert.throws(() => { assert.match(result.summary, /^saved to /); throw new Error('consumer output failed'); }, /consumer output/);
  assert.equal(service.defaultSavePath, path); boundary(service);
  assert.equal(new SvgCodec().encode(service.getDocumentSnapshot()!), fs.readFileSync(path, 'utf8'));
});
