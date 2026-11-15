import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelService } from '../server/src/modules';

test('DeepSeek thinking defaults off through compatible providers and can be configured', async () => {
  const keys = ['YATUAN_AI_ENDPOINT', 'YATUAN_AI_MODEL', 'YATUAN_AI_KEY', 'YATUAN_AI_THINKING'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    process.env.YATUAN_AI_ENDPOINT = 'https://compatible.example/v1/chat/completions';
    process.env.YATUAN_AI_KEY = 'test-only';
    process.env.YATUAN_AI_MODEL = 'deepseek-v4.1-flash';
    delete process.env.YATUAN_AI_THINKING;
    const model = new ModelService();
    await model.chat([{ role: 'user', content: 'hello' }]);
    assert.deepEqual(requests.at(-1).thinking, { type: 'disabled' });

    process.env.YATUAN_AI_THINKING = 'enabled';
    await model.chat([{ role: 'user', content: 'hello' }]);
    assert.deepEqual(requests.at(-1).thinking, { type: 'enabled' });

    process.env.YATUAN_AI_MODEL = 'other-provider-model';
    process.env.YATUAN_AI_THINKING = 'auto';
    await model.chat([{ role: 'user', content: 'hello' }]);
    assert.equal('thinking' in requests.at(-1), false);

    process.env.YATUAN_AI_THINKING = 'invalid';
    await assert.rejects(model.chat([{ role: 'user', content: 'hello' }]), /YATUAN_AI_THINKING/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
