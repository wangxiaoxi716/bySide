import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastChannel } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { createPresentationChannel } from '../original-ui/presentation.mjs';

async function waitFor(sync: any, predicate: (state: any) => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate(sync.getState())) return;
    await delay(10);
  }
  assert.fail(`presentation did not arrive: ${JSON.stringify(sync.getState())}`);
}

test('live captions reach existing and newly opened previews, then clear on stop', async () => {
  const name = `presentation-${crypto.randomUUID()}`;
  const home = createPresentationChannel({ channel: new BroadcastChannel(name) });
  const preview = createPresentationChannel({ channel: new BroadcastChannel(name) });
  let reopened: any;
  try {
    const session = home.begin({ motion: 'listening', speech: '正在听你说话…' });
    await waitFor(preview, state => state?.motion === 'listening');
    session.update({ motion: 'speaking', speech: '芽团：我在这里。' });
    await waitFor(preview, state => state?.speech === '芽团：我在这里。');
    reopened = createPresentationChannel({ channel: new BroadcastChannel(name) });
    await waitFor(reopened, state => state?.motion === 'speaking');
    session.end();
    await waitFor(preview, state => state === null);
    await waitFor(reopened, state => state === null);
  } finally {
    home.close(); preview.close(); reopened?.close();
  }
});

test('a superseded playback cannot clear or overwrite the current caption', () => {
  const sync = createPresentationChannel();
  try {
    const first = sync.begin({ motion: 'speaking', speech: '第一句' });
    const second = sync.begin({ motion: 'speaking', speech: '第二句' });
    first.end();
    first.update({ speech: '迟到的第一句' });
    assert.deepEqual(sync.getState(), { motion: 'speaking', speech: '第二句' });
    second.end();
    assert.equal(sync.getState(), null);
  } finally { sync.close(); }
});

test('a crashed sender expires instead of leaving the speaking animation running', async () => {
  const name = `presentation-${crypto.randomUUID()}`;
  const channel = new BroadcastChannel(name);
  const preview = createPresentationChannel({ channel: new BroadcastChannel(name) });
  try {
    channel.postMessage({ type: 'presentation', clock: 1, writer: 'crashed', expiresAt: Date.now() + 100, state: { motion: 'speaking', speech: '未播完' } });
    await waitFor(preview, state => state?.motion === 'speaking');
    await waitFor(preview, state => state === null);
  } finally { channel.close(); preview.close(); }
});
