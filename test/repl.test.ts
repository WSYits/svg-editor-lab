import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repl } from '../src/cli/Repl.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { Presenter } from '../src/cli/Presenter.js';
import { EditorService } from '../src/application/EditorService.js';
import type { Terminal } from '../src/io/Terminal.js';
import { LocalFileStore } from '../src/io/LocalFileStore.js';
import { SvgCodec } from '../src/svg/SvgCodec.js';

function terminal(lines: readonly string[]): { terminal: Terminal; out: string[]; err: string[]; counts: { close: number; prompt: number; lines: number } } {
  const out: string[] = []; const err: string[] = []; const counts = { close: 0, prompt: 0, lines: 0 };
  return { out, err, counts, terminal: {
    async *lines() { counts.lines++; for (const line of lines) yield line; },
    async write(text) { out.push(text); }, async writeError(text) { err.push(text); },
    async prompt() { counts.prompt++; }, async close() { counts.close++; },
  } };
}

test('REPL handles blanks/comments, lexical/syntax/business errors, then continues to EOF', async () => {
  const fake = terminal(['', ' # comment', 'unknown', 'move r 1 2', 'init 10', 'init 200 100',
    'create text t 1 2 ""', 'set t text "中文 & <>"', 'scale t 0', 'tree', 'show t', 'help']);
  const service = new EditorService();
  assert.equal(await new Repl(new CommandDispatcher(service), fake.terminal).run(), 0);
  const text = fake.out.join(''); assert.match(text, /error: unknown command: unknown/);
  assert.match(text, /error: no document/); assert.match(text, /error: expected zero or two dimensions/);
  assert.match(text, /scale factor must be positive/); assert.match(text, /svg \(200x100\)/);
  assert.match(text, /text#t  parent=svg/); assert.match(text, /read <file.svg>/);
  assert.equal(text.includes('error: error:'), false); assert.deepEqual(fake.err, []);
  assert.equal(service.getDocumentSnapshot()!.findById('t')!.getAttribute('text'), '中文 & <>');
  assert.equal(fake.counts.close, 1); assert.equal(fake.counts.prompt, 13);
});
test('empty input exits once without executing commands; REPL cannot be run twice', async () => {
  const fake = terminal([]); const service = new EditorService(); const repl = new Repl(new CommandDispatcher(service), fake.terminal);
  assert.equal(await repl.run(), 0); assert.equal(service.hasDocument, false); assert.equal(fake.counts.close, 1);
  await assert.rejects(() => repl.run(), /single use/); assert.equal(fake.counts.close, 1);
});
for (const stage of ['banner', 'input', 'prompt', 'close'] as const) {
  test(`terminal ${stage} failure exits nonzero and closes without command retries`, async () => {
    const fake = terminal(['init']); const service = new EditorService();
    if (stage === 'banner') fake.terminal.write = async () => { throw new Error('broken output'); };
    if (stage === 'input') fake.terminal.lines = async function* () { throw new Error('broken input'); };
    if (stage === 'prompt') fake.terminal.prompt = async () => { throw new Error('broken prompt'); };
    if (stage === 'close') fake.terminal.close = async () => { fake.counts.close++; throw new Error('broken close'); };
    assert.equal(await new Repl(new CommandDispatcher(service), fake.terminal).run(), 1);
    assert.equal(fake.counts.close, 1); assert.equal(fake.err.length, 1);
    assert.equal(service.hasDocument, stage === 'close');
  });
}
test('broken stdout and stderr cause one diagnostic attempt, no fallback loop', async () => {
  const fake = terminal(['init']); let attempts = 0;
  fake.terminal.write = async () => { throw new Error('EPIPE'); };
  fake.terminal.writeError = async () => { attempts++; throw new Error('EPIPE'); };
  assert.equal(await new Repl(new CommandDispatcher(new EditorService()), fake.terminal).run(), 1);
  assert.equal(attempts, 1); assert.equal(fake.counts.close, 1); assert.equal(fake.counts.lines, 0);
});
for (const stage of ['output', 'format'] as const) {
  test(`successful save followed by ${stage} failure preserves disk, session and history without executing next input`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'svg-repl-save-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, '中文 保存.svg'); const fake = terminal(['init', 'create rect r 1 2 3 4', `save "${path}"`, 'move r 100 0']);
    const service = new EditorService(undefined, undefined, new LocalFileStore()); const presenter = new Presenter();
    if (stage === 'output') {
      const write = fake.terminal.write;
      fake.terminal.write = async text => { if (text.startsWith('saved to ')) throw new Error('broken output'); await write(text); };
    } else t.mock.method(presenter, 'documentIo', () => { throw new Error('broken formatter'); });
    assert.equal(await new Repl(new CommandDispatcher(service), fake.terminal, presenter).run(), 1);
    assert.equal(service.defaultSavePath, path); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
    assert.equal(service.getHistoryStatus().disabled, true); assert.equal(service.getHistoryStatus().undoCount, 0);
    assert.equal(readFileSync(path, 'utf8'), new SvgCodec().encode(service.getDocumentSnapshot()!));
    assert.equal(fake.err.length, 1); assert.match(fake.err[0]!, /^terminal failure:/);
    assert.equal(fake.out.join('').includes('error: cannot write file'), false); assert.equal(fake.counts.close, 1);
  });
}
test('formatting failure after an edit does not misclassify, repeat or roll back that edit', async t => {
  const fake = terminal(['move r 5 0', 'move r 100 0']); const service = new EditorService(); const dispatcher = new CommandDispatcher(service);
  dispatcher.dispatch('init'); dispatcher.dispatch('create rect r 1 2 3 4'); const presenter = new Presenter();
  t.mock.method(presenter, 'summary', () => { throw new Error('broken formatter'); });
  assert.equal(await new Repl(dispatcher, fake.terminal, presenter).run(), 1);
  assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 6);
  assert.equal(service.getHistoryStatus().undoCount, 2); service.undo();
  assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
  assert.equal(fake.out.some(text => text.startsWith('error:')), false);
});
test('error-formatting failure is a terminal failure and releases resources', async t => {
  const fake = terminal(['unknown', 'init']); const service = new EditorService(); const presenter = new Presenter();
  t.mock.method(presenter, 'error', () => { throw new Error('formatting'); });
  assert.equal(await new Repl(new CommandDispatcher(service), fake.terminal, presenter).run(), 1);
  assert.equal(service.hasDocument, false); assert.equal(fake.err.length, 1); assert.equal(fake.counts.close, 1);
});
