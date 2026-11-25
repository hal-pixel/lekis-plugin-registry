import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.PluginError = class extends Error {
  constructor(code, message) { super(message); this.code = code; }
};
// Resolving a page must work without platform, network or native-code access.
globalThis.host = new Proxy({}, {
  get() { throw new Error('video() must not access host APIs'); },
});
const { video } = await import('../index.js');

test('video follows the source contract and preserves exact IDs', async () => {
  for (const id of ['dQw4w9WgXcQ', 'M4-XU0a2hf0', 'abcdefghij_']) {
    assert.deepEqual(await video({ id }), {
      url: `https://www.youtube.com/watch?v=${id}`,
      title: 'YouTube',
    });
  }
});

test('video rejects URLs, malformed IDs and non-string input', async () => {
  for (const id of [
    '', 'short', 'abcdefghijkl', 'abcdefghij_\n', 'abcdefghij_\r',
    'abcdefghij_&list=other', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'abcdefghij_|42', '../abcdefghij_', null, 12345678901, {}, ['abcdefghij_'],
  ]) {
    await assert.rejects(video({ id }), { code: 'unavailable' });
  }
  await assert.rejects(video(), { code: 'unavailable' });
});

test('published manifest declares video and permits its exact page host', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url)));
  assert.ok(manifest.kinds.includes('source'));
  assert.ok(manifest.kinds.includes('video'));
  assert.ok(manifest.permissions.network.includes('www.youtube.com'));
  assert.equal(manifest.minAppVersion, '0.5.4');
});
