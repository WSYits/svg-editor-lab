import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as fs from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';
import type { SvgDocument } from '../src/domain/SvgDocument.js';
import type { Shape } from '../src/domain/Shape.js';

const entry = fileURLToPath(new URL('../src/main.js', import.meta.url));
function directory(t: { after(fn: () => void): void }): string {
  const path = fs.mkdtempSync(join(tmpdir(), 'svg-cli-process-')); t.after(() => fs.rmSync(path, { recursive: true, force: true })); return path;
}
function run(lines: readonly string[], newline = true) {
  const result = spawnSync(process.execPath, [entry], { input: lines.join('\n') + (newline ? '\n' : ''), encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0); assert.equal(result.stderr, ''); return result.stdout;
}
function tree(doc: SvgDocument): unknown {
  const ids = new Set<string>(); const objects = new Set<Shape>();
  const nodes = (items: readonly Shape[], parent?: Shape): unknown => items.map(node => {
    assert.equal(ids.has(node.id), false); ids.add(node.id); assert.equal(objects.has(node), false); objects.add(node);
    assert.equal(doc.findById(node.id), node); assert.equal(doc.parentOf(node.id), parent); assert.equal(TreeOwnership.ownerOf(node), parent ?? doc);
    return { id: node.id, type: node.type, attributes: node.getAttributes(), preserved: node.getPreservedAttributes(), children: nodes(node.children, node) };
  });
  return { width: doc.width, height: doc.height, preserved: doc.getPreservedAttributes(), roots: nodes(doc.roots) };
}

test('real process executes all 19 commands, six types, mixed history and persistent round trips', t => {
  const dir = directory(t); const first = join(dir, '中文 第一份.svg'); const second = relative(process.cwd(), join(dir, 'second file.svg'));
  const final = join(dir, 'final.svg'); const malformed = join(dir, 'malformed.svg'); fs.writeFileSync(malformed, '<svg xmlns="http://www.w3.org/2000/svg">');
  const content = '中文 & < > "quoted" \\ path';
  const stdout = run(['', ' # whole-line comment', 'help', 'tree', `read "${join(dir, 'missing.svg')}"`, 'init 400 300',
    'create g scene', 'create g left in scene', 'create g right in scene', 'create rect r 1 2 3 4 #ffffff in left',
    'create circle c 20 30 4 red in right', 'create ellipse e 10 20 3 4 in right', 'create line l 1 2 3 4 black in right',
    'create text t 2 3 "" in left', 'create text empty 0 0 ""', 'create rect tail 0 0 1 1',
    'create box unsupported 1 2 3 4', 'create g r', 'create g bad in missing', 'addto left scene', 'ungroup scene', 'scale r 0',
    'move r 12abc 0', 'set r onload dangerous', 'canvas 10', 'unknown',
    'move left 5 10', 'scale left 2', `set t text ${JSON.stringify(content)}`, 'group joined c r', 'addto left joined',
    'ungroup joined', 'front t', 'back c', 'delete l', 'undo', 'redo', 'undo', 'move missing 1 0', 'redo', 'undo',
    'set r width 9', 'redo', 'tree', 'tree left', 'show t', `save "${first}"`, 'save', 'undo',
    'create rect aux 0 0 1 1', 'undo', `read "${join(dir, 'missing-again.svg')}"`, `save "${join(dir, 'missing-parent', 'out.svg')}"`, 'redo', 'delete aux',
    `save "${second}"`, 'canvas', 'canvas 500 350', 'save', 'init', 'save', `read "${second}"`, `read "${malformed}"`,
    'move missing 1 0', 'undo', 'move r 0 0', 'undo', 'undo', 'redo', 'show r', `save "${final}"`]);
  assert.equal(/^svg> /mu.test(stdout), false); assert.equal(stdout.includes('\x1b'), false); assert.equal(stdout.includes('error: error:'), false);
  for (const error of ['no document.', 'cannot read file:', 'cannot write file:', 'unknown shape type: box', 'id already exists: r', 'no such container: missing',
    'cannot ungroup top-level container: scene', 'scale factor must be positive', 'invalid number: 12abc', 'unknown attribute: onload',
    'expected zero or two dimensions', 'unknown command: unknown', 'nothing to redo', 'nothing to undo', 'undo not allowed after io command', 'no save path.', 'invalid XML']) {
    assert.ok(stdout.includes(`error: ${error}`), error);
  }
  for (const syntax of ['init [w] [h]', 'read <file.svg>', 'save [file.svg]', 'canvas [w] [h]', 'create <type>', 'delete <id>',
    'move <id>', 'scale <id>', 'set <id>', 'group <newGid>', 'ungroup <gid>', 'addto <gid>', 'front <id>', 'back <id>', 'tree [id]', 'show <id>', 'help', 'undo', 'redo']) assert.ok(stdout.includes(syntax), syntax);
  assert.match(stdout, /text#t  parent=g#left/); assert.match(stdout, /canvas resized to 500x350/); assert.match(stdout, /saved to .* \(10 elements\)/);
  const codec = new SvgCodec(); const doc = codec.decode(fs.readFileSync(final, 'utf8')).document;
  assert.deepEqual([doc.width, doc.height], [500, 350]); assert.deepEqual(doc.roots.map(node => node.id), ['scene', 'empty', 'tail']);
  assert.deepEqual(doc.findById('scene')!.children.map(node => node.id), ['left', 'right']);
  assert.deepEqual(doc.findById('left')!.children.map(node => node.id), ['c', 'r', 't']);
  assert.deepEqual(doc.findById('right')!.children.map(node => node.id), ['e', 'l']);
  assert.deepEqual(doc.findById('r')!.getAttributes(), { id: 'r', x: 12, y: 24, width: 9, height: 8, fill: '#ffffff' });
  assert.equal(doc.findById('t')!.getAttribute('text'), content); assert.equal(doc.findById('empty')!.getAttribute('text'), '');
  assert.equal(doc.findById('aux'), undefined); assert.equal(doc.findById('joined'), undefined);
  assert.deepEqual(tree(codec.decode(fs.readFileSync(second, 'utf8')).document), tree(doc));
  assert.deepEqual(tree(codec.decode(codec.encode(doc)).document), tree(doc));
  assert.equal(codec.decode(fs.readFileSync(first, 'utf8')).document.width, 400);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['final.svg', 'malformed.svg', 'second file.svg', '中文 第一份.svg']);
});
test('real read reports auto-id warnings once before success; invalid bytes/XML/SVG leave loaded document usable', t => {
  const dir = directory(t); const good = join(dir, 'other.svg'); const badBytes = join(dir, 'bytes.svg'); const transform = join(dir, 'transform.svg');
  const saved = join(dir, 'saved.svg'); fs.copyFileSync('test/fixtures/svg/task-other.svg', good);
  fs.writeFileSync(badBytes, Buffer.from([0xed, 0xa0, 0x80])); fs.copyFileSync('test/fixtures/svg/task-transform.svg', transform);
  const out = run([`read "${good}"`, `read "${badBytes}"`, `read "${transform}"`, 'tree', `save "${saved}"`]);
  assert.equal(out.match(/warning: assigned id rect1/g)?.length, 1);
  assert.ok(out.indexOf('warning: assigned id') < out.indexOf(`read ${good} (7 elements)`));
  assert.match(out, /error: invalid UTF-8 file encoding/); assert.match(out, /error: transform is not supported/);
  const doc = new SvgCodec().decode(fs.readFileSync(saved, 'utf8')).document;
  assert.equal(doc.roots.length, 5); assert.ok(doc.findById('rect1')); tree(doc);
});
test('EOF without final newline preserves the final command and a large piped burst loses no edits', t => {
  const saved = join(directory(t), 'burst.svg');
  const out = run(['init', 'create rect r 1 2 3 4', ...Array.from({ length: 200 }, () => 'move r 1 0'), `save "${saved}"`], false);
  assert.equal(out.includes('error:'), false); assert.equal(out.match(/moved/g)?.length, 200);
  assert.equal(new SvgCodec().decode(fs.readFileSync(saved, 'utf8')).document.findById('r')!.getAttribute('x'), 201);
});
test('npm run cli builds and starts the actual compiled program with piped EOF', () => {
  const result = spawnSync('npm', ['run', 'cli'], { input: 'init 90 80\ncanvas\n', encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /tsc/); assert.match(result.stdout, /svg-editor 0.1/); assert.match(result.stdout, /canvas 90x80 created/);
  assert.match(result.stdout, /canvas 90x80\n$/); assert.equal(result.stdout.includes('svg>'), false);
});

test('real broken stdout after save exits 1, preserves the saved file, and does not run following commands', { timeout: 10000 }, async t => {
  const dir = directory(t); const path = join(dir, 'saved.svg'); const sentinel = join(dir, 'should-not-exist.svg'); const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let err = ''; let output = ''; let sent = false;
  child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { err += data; });
  child.stdin.on('error', () => { /* Child may close stdin after transport failure. */ });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', data => {
    output += data;
    if (!sent && output.includes('rect#r created')) {
      sent = true;
      child.stdout.once('close', () => { child.stdin.end(`save "${path}"\nmove r 100 0\nsave "${sentinel}"\n`); });
      child.stdout.destroy();
    }
  });
  child.stdin.write('init\ncreate rect r 1 2 3 4\n');
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve([code, signal]));
  });
  assert.equal(sent, true); assert.equal(code, 1); assert.equal(signal, null); assert.match(err, /^terminal failure:/);
  assert.equal(err.includes('cannot write file'), false); assert.equal(fs.existsSync(sentinel), false);
  assert.equal(new SvgCodec().decode(fs.readFileSync(path, 'utf8')).document.findById('r')!.getAttribute('x'), 1);
});

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
test('actual PTY process displays prompts, handles error then next command, and exits on Ctrl-D',
  { skip: process.platform === 'win32' || python.status !== 0, timeout: 15000 }, () => {
    const script = String.raw`
import os, pty, select, sys, time, json, errno
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2]])
transcript = bytearray()
reaped = False
def prompt():
    data = bytearray()
    deadline = time.monotonic() + 4
    while b'svg> ' not in data:
        if time.monotonic() > deadline: raise RuntimeError('prompt timeout')
        if select.select([fd], [], [], .1)[0]:
            chunk = os.read(fd, 65536)
            if not chunk: raise RuntimeError('unexpected EOF')
            data.extend(chunk)
    transcript.extend(data)
try:
    prompt()
    for line in [b'init 77 88\n', b'unknown\n', b'canvas\n', b'help\n']:
        os.write(fd, line); prompt()
    os.write(fd, b'\x04')
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .1)[0]:
            try: chunk = os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
            if not chunk: break
            transcript.extend(chunk)
    else: raise RuntimeError('EOF timeout')
    _, status = os.waitpid(pid, 0)
    reaped = True
    print(json.dumps({'code': os.waitstatus_to_exitcode(status), 'output': transcript.decode('utf8')}))
finally:
    if not reaped:
        try: os.kill(pid, 9)
        except ProcessLookupError: pass
        os.waitpid(pid, 0)
    os.close(fd)
`;
    const result = spawnSync('python3', ['-c', script, process.execPath, entry], { encoding: 'utf8', timeout: 12000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    const report: { code: number; output: string } = JSON.parse(result.stdout);
    assert.equal(report.code, 0); assert.match(report.output, /svg> /); assert.match(report.output, /canvas 77x88 created/);
    assert.match(report.output, /error: unknown command: unknown/); assert.match(report.output, /read <file.svg>/);
    assert.ok((report.output.match(/svg> /g)?.length ?? 0) >= 5);
  });
