import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopCamera } from '../original-ui/desktop-camera.js';
import { createDesktopCompanion } from '../original-ui/desktop-companion.js';

test('desktop camera reuses AR frames without opening or stopping the AR device', async () => {
  let opened = 0, stopped = 0, acquired = 0;
  const camera = createDesktopCamera({ sharedFrame: async () => ({ image: 'shared', label: 'AR 摄像头', shared: true }), startCamera: async () => { opened++; }, stopCamera: () => { stopped++; }, locks: { request: async () => { acquired++; } } });
  assert.equal((await camera.start({})).shared, true);
  assert.equal((await camera.capture()).image, 'shared'); camera.stop();
  assert.equal(opened, 0); assert.equal(acquired, 0); assert.equal(stopped, 0);
});

test('desktop camera releases its lock on permission denial', async () => {
  let held = false;
  const camera = createDesktopCamera({ sharedFrame: async () => null, startCamera: async () => { throw new Error('权限被拒绝'); }, stopCamera() {}, locks: { request: async (_name: string, _options: object, callback: Function) => { held = true; await callback({}); held = false; } } });
  await assert.rejects(camera.start({}), /权限被拒绝/);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(held, false);
});

test('shared-only capture leaves the camera available for AR when no source is connected', async () => {
  let opened = 0, locked = 0;
  const camera = createDesktopCamera({ sharedFrame: async () => null, startCamera: async () => { opened++; }, stopCamera() {}, locks: { request: async () => { locked++; } } });
  await assert.rejects(camera.start({}, '', { sharedOnly: true }), /AR 摄像头/);
  camera.stop();
  assert.equal(opened, 0); assert.equal(locked, 0);
});

test('audio-only companion starts without camera access or visual commands', async () => {
  let opened = 0, options: any;
  const commands: any[] = [];
  const controller = createDesktopCompanion({ config: () => ({ intervalSeconds: 10 }), stopDemo() {},
    createCamera: () => { opened++; throw new Error('camera should remain unused'); },
    createVoice: (value: any) => { options = value; return { start: async () => { value.onReady(); return true; }, stop: async () => {}, send: (command: any) => { commands.push(command); return true; } }; },
  });
  assert.equal(await controller.start({}, { desktopVision: false }), true);
  assert.equal(options.desktopVision, false); assert.equal(opened, 0);
  controller.pauseObservation(); await controller.wake();
  assert.equal(commands.length, 0);
  await controller.stop();
});

test('desktop companion sends audio and camera commands through one session and cleans up on disconnect', async () => {
  let callbacks: any, cameraStops = 0, voiceStops = 0;
  const commands: any[] = [];
  const controller = createDesktopCompanion({ config: () => ({ cameraId: '', intervalSeconds: 10, wakePhrase: '芽团芽团' }), stopDemo() {},
    createCamera: () => ({ start: async () => ({ image: 'initial', label: 'AR 摄像头', shared: true }), capture: async () => ({ image: 'fresh', label: 'AR 摄像头', shared: true }), stop() { cameraStops++; } }),
    createVoice: (options: any) => { callbacks = options; return { start: async () => { options.onReady(); return true; }, stop: async () => { voiceStops++; }, send: (event: any) => { commands.push(event); return true; } }; },
  });
  assert.equal(await controller.start({}), true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(callbacks.desktopVision, true); assert.equal(controller.getStatus().observing, true);
  assert.equal(commands[0].type, 'vision.frame');
  callbacks.onVision({ type: 'vision.capture', captureId: 'fresh-call' });
  await Promise.resolve(); await Promise.resolve();
  assert.ok(commands.some(event => event.type === 'vision.frame' && event.captureId === 'fresh-call'));
  controller.pauseObservation(); assert.equal(controller.getStatus().observing, false);
  assert.ok(commands.some(event => event.type === 'vision.pause'));
  await controller.wake(); assert.equal(controller.getStatus().observing, true);
  await controller.handleText('现在盘子里有什么？'); assert.ok(commands.some(event => event.type === 'input.text'));
  callbacks.onError('实时语音断开'); callbacks.onClose();
  assert.equal(controller.getStatus().active, false); assert.equal(controller.getStatus().error, '实时语音断开'); assert.equal(cameraStops, 2);
  await controller.stop(); assert.equal(voiceStops, 0);
});

test('camera denial keeps voice available and permits an explicit retry', async () => {
  let denied = true, options: any;
  const controller = createDesktopCompanion({ config: () => ({ intervalSeconds: 10 }), stopDemo() {},
    createCamera: () => ({ start: async () => { if (denied) throw new Error('摄像头权限被拒绝'); return { image: 'retry', shared: false }; }, capture: async () => ({ image: 'retry', shared: false }), stop() {} }),
    createVoice: (value: any) => { options = value; return { start: async () => { value.onReady(); return true; }, stop: async () => {}, send: () => true }; },
  });
  assert.equal(await controller.start({}), true); assert.equal(controller.getStatus().active, true);
  assert.equal(controller.getStatus().observing, false); assert.match(controller.getStatus().voiceWarning, /权限/);
  denied = false; await controller.wake(); assert.equal(controller.getStatus().observing, true);
  await controller.stop(); options.onReady(); assert.equal(controller.getStatus().active, false, 'late callbacks cannot revive a stopped session');
});

test('a canceled restart waits for the previous session to close and never reopens devices', async () => {
  let release!: () => void, opened = 0;
  const controller = createDesktopCompanion({ config: () => ({ intervalSeconds: 10 }), stopDemo() {},
    createCamera: () => ({ start: async () => { opened++; return { image: 'frame', shared: false }; }, stop() {} }),
    createVoice: (options: any) => ({ start: async () => { options.onReady(); return true; }, send: () => true, stop: () => new Promise<void>(done => { release = done; }) }),
  });
  await controller.start({});
  const stopped = controller.stop();
  const restarting = controller.start({});
  const canceled = controller.stop();
  release(); await Promise.all([stopped, canceled]);
  assert.equal(await restarting, false);
  assert.equal(opened, 1); assert.equal(controller.getStatus().active, false);
});
