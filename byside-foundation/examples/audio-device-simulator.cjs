#!/usr/bin/env node
// Protocol example only: sends silent input and simulates playback timing.
// Replace these parts with your device SDK; this example has no microphone or speaker.
const readline = require('node:readline');
const send = event => process.stdout.write(`${JSON.stringify(event)}\n`);
const format = rate => ({ encoding: 'pcm_s16le', rate, channels: 1 });
const timers = new Set();
let nextPlayback = Date.now();
send({ type: 'ready', protocolVersion: '1.0', input: format(16000), output: format(24000) });
const capture = setInterval(() => send({ type: 'capture', audio: Buffer.alloc(640).toString('base64') }), 20);
readline.createInterface({ input: process.stdin }).on('line', line => {
  let command; try { command = JSON.parse(line); } catch { return; }
  if (command.type === 'play') {
    const pcm = Buffer.from(command.audio, 'base64');
    nextPlayback = Math.max(Date.now(), nextPlayback) + pcm.length / 2 / 24000 * 1000;
    const timer = setTimeout(() => { timers.delete(timer); send({ type: 'played', id: command.id }); }, Math.max(0, nextPlayback - Date.now()));
    timers.add(timer);
  } else if (command.type === 'flush') {
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); nextPlayback = Date.now();
  } else if (command.type === 'stop') {
    clearInterval(capture); for (const timer of timers) clearTimeout(timer); process.exit(0);
  }
});
