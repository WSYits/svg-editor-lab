import assert from 'node:assert/strict';
import test from 'node:test';
import { Presenter } from '../src/cli/Presenter.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { EditorService } from '../src/application/EditorService.js';
import { CommandResult } from '../src/application/CommandResult.js';

function fixture(): EditorService {
  const s = new EditorService(); const d = new CommandDispatcher(s);
  for (const line of ['init 400 300', 'create g g', 'create circle c 10 20 3 red in g',
    'create g inner in g', 'create text t 1 2 "hello world" in inner', 'create rect r 1 2 3 4']) d.dispatch(line);
  return s;
}
test('tree formats geometry, nested branches, sibling order, styles and Unicode text', () => {
  assert.equal(new Presenter().tree(fixture().getTreeView()), [
    'svg (400x300)', '├── g#g', '│   ├── circle#c cx=10 cy=20 r=3 fill=red',
    '│   └── g#inner', '│       └── text#t x=1 y=2 text="hello world"', '└── rect#r x=1 y=2 w=3 h=4',
  ].join('\n'));
});
test('subtree has no canvas wrapper and show includes real parent plus explicit attributes', () => {
  const s = fixture(); const p = new Presenter();
  assert.equal(p.tree(s.getTreeView('inner')), 'g#inner\n└── text#t x=1 y=2 text="hello world"');
  assert.equal(p.show(s.getShapeView('c')), 'circle#c  parent=g#g\n  cx=10 cy=20 r=3\n  fill=red');
  assert.equal(p.show(s.getShapeView('r')), 'rect#r  parent=svg\n  x=1 y=2 w=3 h=4');
});
test('empty document and empty group format without invented attributes', () => {
  const s = new EditorService(); s.init(); const p = new Presenter();
  assert.equal(p.tree(s.getTreeView()), 'svg (800x600)');
  new CommandDispatcher(s).dispatch('create g empty');
  assert.equal(p.show(s.getShapeView('empty')), 'g#empty  parent=svg');
});
test('error prefix belongs only to Presenter; summary and error escape controls into one line', () => {
  const p = new Presenter();
  assert.equal(p.error(new Error('bad\ninput\r\t')), 'error: bad\\u000ainput\\u000d\\u0009');
  assert.equal(p.error('unknown'), 'error: unknown');
  assert.equal(p.summary(new CommandResult('ok\nnext')), 'ok\\u000anext');
  assert.equal(p.canvas({ width: 1.5, height: 2 }), 'canvas 1.5x2');
});
test('text and identifiers cannot inject new tree lines or terminal control escapes', () => {
  const s = new EditorService(); const d = new CommandDispatcher(s); d.dispatch('init');
  d.dispatch('create text "t\u001b" 1 2 "a\n\u2028b"');
  const output = new Presenter().tree(s.getTreeView());
  assert.equal(output.split('\n').length, 2); assert.equal(output.includes('\u001b'), false); assert.equal(output.includes('\u2028'), false);
  assert.match(output, /\\u001b/); assert.match(output, /\\u2028/);
});
test('help reproduces its supplied immutable command catalogue', () => {
  assert.equal(new Presenter().help(Object.freeze(['help', 'undo'])), 'help\nundo');
});
