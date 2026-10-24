import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { ConsoleTerminal } from '../src/io/ConsoleTerminal.js';
import { Repl } from '../src/cli/Repl.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { EditorService } from '../src/application/EditorService.js';

function streams(tty = false) {
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  let out = ''; let err = '';
  const output = Object.assign(new Writable({ write(chunk, _encoding, callback) { out += chunk.toString(); callback(); } }), { isTTY: tty, columns: 80 });
  const error = new Writable({ write(chunk, _encoding, callback) { err += chunk.toString(); callback(); } });
  return { input, output, error, result: () => ({ out, err }) };
}
test('pipe input queues an entire burst, handles CRLF and final line without newline, and emits no prompts', async () => {
  const s = streams(); const service = new EditorService();
  const terminal = new ConsoleTerminal(s.input, s.output, s.error);
  const running = new Repl(new CommandDispatcher(service), terminal).run();
  s.input.end('init 20 30\r\n\r\n#comment\r\nunknown\r\ncanvas');
  assert.equal(await running, 0); assert.match(s.result().out, /canvas 20x30 created/);
  assert.match(s.result().out, /error: unknown command: unknown/); assert.match(s.result().out, /canvas 20x30\n$/);
  assert.equal(s.result().out.includes('svg>'), false); assert.equal(s.result().err, '');
  assert.equal(s.input.listenerCount('error'), 0); assert.equal(s.output.listenerCount('error'), 0); assert.equal(s.error.listenerCount('error'), 0);
  assert.equal(s.input.isPaused(), true); await terminal.close();
});
test('pre-ended input is EOF rather than an indefinitely pending iterator', async () => {
  const s = streams(); s.input.resume(); s.input.end(); await new Promise<void>(resolve => s.input.once('end', resolve));
  const terminal = new ConsoleTerminal(s.input, s.output, s.error);
  assert.equal(await new Repl(new CommandDispatcher(new EditorService()), terminal).run(), 0);
  assert.equal(s.result().out.split('\n').length, 2); assert.equal(s.result().err, '');
});
test('TTY transport displays svg> with readline echo and closes on EOF', async () => {
  const s = streams(true); const service = new EditorService(); const terminal = new ConsoleTerminal(s.input, s.output, s.error);
  const running = new Repl(new CommandDispatcher(service), terminal).run();
  await setImmediate(); s.input.write('init 20 30\r'); await setImmediate(); await setImmediate();
  s.input.write('canvas\r'); await setImmediate(); await setImmediate(); s.input.write('\x04');
  assert.equal(await running, 0); assert.match(s.result().out, /svg> /); assert.match(s.result().out, /canvas 20x30/);
  assert.equal(s.result().err, ''); assert.deepEqual(service.getCanvasSize(), { width: 20, height: 30 });
});
test('input TTY alone with redirected stdout uses pipe mode without ANSI prompts', async () => {
  const s = streams(); s.input.isTTY = true; const terminal = new ConsoleTerminal(s.input, s.output, s.error);
  const running = new Repl(new CommandDispatcher(new EditorService()), terminal).run(); s.input.end('init\ncanvas\n');
  assert.equal(await running, 0); assert.equal(s.result().out.includes('svg>'), false); assert.equal(s.result().out.includes('\x1b'), false);
});
test('input stream error stops the session with one transport diagnostic', async () => {
  const s = streams(); const service = new EditorService(); const terminal = new ConsoleTerminal(s.input, s.output, s.error);
  const running = new Repl(new CommandDispatcher(service), terminal).run();
  await setImmediate(); s.input.emit('error', new Error('injected input failure'));
  assert.equal(await running, 1); assert.equal(service.hasDocument, false); assert.match(s.result().err, /^terminal failure:/);
});
test('asynchronous writable failure is handled without unhandled error or command execution', async () => {
  const s = streams(); const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('injected EPIPE')); } });
  const service = new EditorService(); const terminal = new ConsoleTerminal(s.input, output, s.error);
  assert.equal(await new Repl(new CommandDispatcher(service), terminal).run(), 1);
  assert.equal(service.hasDocument, false); assert.match(s.result().err, /^terminal failure:/); assert.equal(output.listenerCount('error'), 0);
});
test('terminal input cannot be started twice or after close', async () => {
  const s = streams(); const terminal = new ConsoleTerminal(s.input, s.output, s.error);
  terminal.lines(); assert.throws(() => terminal.lines(), /single use/); await terminal.close();
  assert.throws(() => terminal.lines(), /single use/);
});
for (const stream of ['input', 'output'] as const) {
  test(`abrupt ${stream} close without an error event stops rather than hanging`, { timeout: 3000 }, async () => {
    const s = streams(); const service = new EditorService(); const terminal = new ConsoleTerminal(s.input, s.output, s.error);
    const running = new Repl(new CommandDispatcher(service), terminal).run();
    await setImmediate(); s[stream].destroy();
    assert.equal(await running, 1); assert.equal(service.hasDocument, false); assert.match(s.result().err, /^terminal failure:/);
    assert.equal(s.input.listenerCount('error'), 0); assert.equal(s.output.listenerCount('error'), 0);
    assert.equal(s.input.listenerCount('close'), 0); assert.equal(s.output.listenerCount('close'), 0);
  });
}
