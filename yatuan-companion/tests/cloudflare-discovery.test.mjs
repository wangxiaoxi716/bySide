import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverLocalAI } from '../dist/live.js';
import { getAIConfig, saveAIConfig } from '../dist/ai.js';

test('hosted HTTPS pages discover their same-origin AI without replacing a custom proxy', async () => {
  const original = new Map(['location', 'localStorage', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const saved = new Map();
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://byside.purechaosspace.com/') });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, options) => {
      assert.equal(url, '/api/health');
      assert.equal(options.cache, 'no-store');
      return Response.json({ configured: true, endpoint: '/api/chat/completions' });
    } });
    assert.equal((await discoverLocalAI()).configured, true);
    assert.equal(getAIConfig().endpoint, '/api/chat/completions');
    saveAIConfig({ endpoint: 'https://my-proxy.example/api/chat/completions' });
    await discoverLocalAI();
    assert.equal(getAIConfig().endpoint, 'https://my-proxy.example/api/chat/completions');
  } finally {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
