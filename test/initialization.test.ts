import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('compiled entry starts and exits successfully without requiring input', () => {
  const entry = fileURLToPath(new URL('../src/main.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), 'svg-editor: project initialized');
});
