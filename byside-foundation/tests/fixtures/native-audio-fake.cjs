#!/usr/bin/env node
const readline = require('node:readline');
const send = event => process.stdout.write(`${JSON.stringify(event)}\n`);
if (process.argv.includes('--fail')) { send({ type: 'error', message: '麦克风权限被拒绝' }); process.exitCode = 1; }
else {
  const format = rate => ({ encoding: 'pcm_s16le', rate, channels: 1 });
  send({ type: 'ready', protocolVersion: process.argv.includes('--wrong-version') ? '9.0' : '1.0', input: format(16000), output: format(24000) });
  setInterval(() => send({ type: 'capture', audio: Buffer.alloc(640, 4).toString('base64') }), 20);
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const event = JSON.parse(line);
    if (event.type === 'play') send({ type: 'played', id: event.id });
    if (event.type === 'stop') process.exit(0);
  });
}
