import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { Presenter } from '../src/cli/Presenter.js';
import { Tokenizer } from '../src/cli/Tokenizer.js';
import { EditorService } from '../src/application/EditorService.js';
import { DocumentIoResult } from '../src/application/DocumentIoResult.js';
import { LocalFileStore } from '../src/io/LocalFileStore.js';
import { SvgCodec } from '../src/svg/SvgCodec.js';

function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), 'svg-cli-io-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const service = new EditorService(undefined, undefined, new LocalFileStore());
  return { directory, service, dispatcher: new CommandDispatcher(service) };
}
test('Dispatcher read/save use real storage; warnings precede summary and default path works', t => {
  const { directory, service, dispatcher: d } = fixture(t); const path = join(directory, '中文 空格.svg');
  writeFileSync(path, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><text x="1" y="2">中文 &amp; 😀</text></svg>');
  assert.equal(d.dispatch(`read "${path}"`), `warning: assigned id text1 to unnamed <text>\nread ${path} (1 elements)`);
  d.dispatch('set text1 text ""'); assert.equal(d.dispatch('save'), `saved to ${path} (1 elements)`);
  assert.equal(new SvgCodec().decode(readFileSync(path, 'utf8')).document.findById('text1')!.getAttribute('text'), '');
  assert.equal(service.defaultSavePath, path); assert.equal(service.getHistoryStatus().disabled, true);
});
for (const line of ['read', 'read a b', 'save a b']) {
  test(`IO syntax rejects ${line} without changing state`, t => {
    const { service, dispatcher: d } = fixture(t); d.dispatch('init'); d.dispatch('create g g'); d.dispatch('undo');
    const before = [service.getTreeView(), service.getHistoryStatus(), service.defaultSavePath];
    assert.throws(() => d.dispatch(line), /usage:/);
    assert.deepEqual([service.getTreeView(), service.getHistoryStatus(), service.defaultSavePath], before); d.dispatch('redo');
    assert.ok(service.getDocumentSnapshot()!.findById('g'));
  });
}
test('read can execute without document, while save keeps the existing no-document gate', t => {
  const { directory, service, dispatcher: d } = fixture(t);
  assert.throws(() => d.dispatch('read'), /usage: read/);
  assert.throws(() => d.dispatch(`read "${join(directory, 'missing.svg')}"`), /cannot read file/);
  assert.throws(() => d.dispatch('save extra extra'), { message: "no document. use 'init' or 'read' first" });
  assert.equal(service.hasDocument, false);
});
test('Presenter escapes control characters in paths/warnings without breaking one-line messages', () => {
  const p = new Presenter(); const result = new DocumentIoResult('read bad\npath\x1b.svg (1 elements)', ['warning: assigned id t\u2028x']);
  assert.equal(p.documentIo(result), 'warning: assigned id t\\u2028x\nread bad\\u000apath\\u001b.svg (1 elements)');
  assert.equal(p.error(new Error('cannot read file: bad\n\x1b.svg')), 'error: cannot read file: bad\\u000a\\u001b.svg');
  assert.equal(p.summary(result).includes('\n'), false);
});
test('execution returns frozen display values without invoking Presenter or repeating domain work', t => {
  const { service } = fixture(t); const p = new Presenter(); const d = new CommandDispatcher(service, new Tokenizer(), p);
  t.mock.method(p, 'output', () => { throw new Error('formatter must be separate'); });
  const output = d.execute('init'); assert.equal(output.kind, 'summary'); assert.equal(Object.isFrozen(output), true);
  d.execute('create rect r 1 2 3 4'); d.execute('move r 5 0');
  assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 6);
  assert.equal(service.getHistoryStatus().undoCount, 2);
});
