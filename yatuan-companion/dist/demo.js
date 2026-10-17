import { getState, updateState } from './state.js';

/** All stages are labelled simulations. No camera inference or meal is saved. */
export const DEMO_STEPS = Object.freeze([
  Object.freeze({ title: '初见', description: '演示开始：两片嫩叶的小芽团来到你的桌边。', duration: 6000 }),
  Object.freeze({ title: '示例餐食出现', description: '演示餐食入场：展示米饭、青菜与豆腐的示例搭配。', duration: 6000 }),
  Object.freeze({ title: '确认食材', description: '演示确认步骤：模拟用户确认主食、蔬菜和蛋白质来源。', duration: 6000 }),
  Object.freeze({ title: '对话回应', description: '演示陪伴回应：小精灵陪你慢慢吃饭，叶片逐渐舒展。', duration: 6000 }),
  Object.freeze({ title: '花苞', description: '演示成长加速：把长期积累压缩展示，头顶出现一颗花苞。', duration: 6000 }),
  Object.freeze({ title: '多花绽放', description: '演示最终形态：三朵小花绽放，留下共同成长的想象。', duration: 6000 }),
]);

const STEPS = [
  { mood: 'curious', activity: '陪伴', speech: '【演示】你好呀，我来桌边陪你啦。', energy: 62, intimacy: 12, growth: 18, growthStage: 0, flowerCount: 1 },
  { mood: 'eating', activity: '用餐', speech: '【演示】米饭、青菜和豆腐，小碗准备好啦。', energy: 68, intimacy: 14, growth: 26, growthStage: 0, flowerCount: 1 },
  { mood: 'listening', activity: '用餐', speech: '【演示】主食、蔬菜、蛋白质，这餐搭配挺丰富。', energy: 76, intimacy: 17, growth: 40, growthStage: 1, flowerCount: 1 },
  { mood: 'happy', activity: '陪伴', speech: '【演示】我陪你，慢慢吃。叶子也舒展开啦。', energy: 82, intimacy: 21, growth: 54, growthStage: 1, flowerCount: 1 },
  { mood: 'curious', activity: '陪伴', speech: '【演示】看，一颗小花苞！', energy: 89, intimacy: 25, growth: 76, growthStage: 2, flowerCount: 1 },
  { mood: 'happy', activity: '陪伴', speech: '【演示】三朵小花，是我们一起过的日子。', energy: 96, intimacy: 30, growth: 100, growthStage: 3, flowerCount: 3 },
];
const RESTORE_FIELDS = Object.freeze(Object.keys(STEPS[0]));
const TOTAL_DURATION = DEMO_STEPS.reduce((total, step) => total + step.duration, 0);
const listeners = new Set();
const browser = typeof window !== 'undefined' ? window : null;
const tabId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
let channel = null;
let owner = null;
let revision = 0;
let remoteRevision = -1;
let remoteSnapshot = null;
let demo = emptyDemo();
let snapshot = null;
let timer = null;
let elapsedBeforeRun = 0;
let runStartedAt = 0;

function emptyDemo() { return { running: false, paused: false, index: 0, progress: 0, done: false }; }
function clearTimer() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
function notify(broadcast = true) {
  for (const listener of listeners) {
    try { listener(getDemoState()); }
    catch (error) { console.error('Demo subscriber failed:', error); }
  }
  if (broadcast && isDemoOwner()) publishState();
}
function captureSnapshot() {
  if (!owner) {
    owner = { id: tabId, startedAt: Date.now(), session: `${tabId}:${Math.random().toString(36).slice(2)}` };
    revision = 0;
  }
  if (snapshot) return;
  const state = getState();
  snapshot = Object.fromEntries(RESTORE_FIELDS.map(key => [key, state[key]]));
}
function stepStart(index) {
  return DEMO_STEPS.slice(0, index).reduce((total, step) => total + step.duration, 0);
}
function elapsedNow() {
  if (!demo.running || demo.paused) return elapsedBeforeRun;
  return Math.min(TOTAL_DURATION, elapsedBeforeRun + Math.max(0, Date.now() - runStartedAt));
}
function indexAt(elapsed) {
  let boundary = 0;
  for (let index = 0; index < DEMO_STEPS.length; index++) {
    boundary += DEMO_STEPS[index].duration;
    if (elapsed < boundary) return index;
  }
  return DEMO_STEPS.length - 1;
}
function applyStep(index) {
  demo.index = index;
  updateState(STEPS[index]);
}
function tick() {
  if (!demo.running || demo.paused) return;
  const elapsed = elapsedNow();
  const index = indexAt(elapsed);
  if (index !== demo.index) applyStep(index);
  demo.progress = Math.min(1, elapsed / TOTAL_DURATION);
  if (elapsed >= TOTAL_DURATION) {
    elapsedBeforeRun = TOTAL_DURATION;
    demo = { ...demo, running: false, paused: false, done: true, progress: 1 };
    clearTimer();
  }
  notify();
}
function startTimer() {
  clearTimer();
  runStartedAt = Date.now();
  timer = setInterval(tick, 100);
  // Avoid keeping test runners or non-browser consumers alive just for a demo.
  timer?.unref?.();
}

// Independent from persisted pet state: progress is broadcast, never stored
// every 100 ms. A mirror page forwards controls to the single timer owner.
function post(message) {
  try { channel?.postMessage({ protocol: 1, sender: tabId, ...message }); }
  catch { /* Local demonstration still works in restricted browser contexts. */ }
}
function publishState(target) {
  if (!isDemoOwner()) return;
  post({ type: 'state', target, owner, revision: ++revision, demo, snapshot });
}
function remoteCommand(name, index, extra = {}) {
  if (!owner || isDemoOwner()) return false;
  post({ type: 'command', target: owner.id, session: owner.session, name, index, ...extra });
  return true;
}
function validOwner(candidate) {
  return candidate && typeof candidate.id === 'string' && candidate.id.length < 150 &&
    typeof candidate.session === 'string' && candidate.session.length < 250 &&
    Number.isFinite(candidate.startedAt);
}
function validDemo(value) {
  return value && typeof value.running === 'boolean' && typeof value.paused === 'boolean' &&
    typeof value.done === 'boolean' && Number.isInteger(value.index) &&
    value.index >= 0 && value.index < DEMO_STEPS.length &&
    Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 1;
}
function copySnapshot(value) {
  if (!value || typeof value !== 'object' || !RESTORE_FIELDS.every(key => key in value)) return null;
  return Object.fromEntries(RESTORE_FIELDS.map(key => [key, value[key]]));
}
function earlierOwner(a, b) {
  return a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.id < b.id);
}
function receive(event) {
  const message = event.data;
  if (!message || message.protocol !== 1 || message.sender === tabId ||
      (message.target && message.target !== tabId)) return;
  if (message.type === 'hello') {
    publishState(message.sender);
    return;
  }
  if (message.type === 'command') {
    if (!isDemoOwner() || message.session !== owner.session) return;
    if (message.name === 'start') startDemo();
    else if (message.name === 'pause') pauseDemo();
    else if (message.name === 'resume') resumeDemo();
    else if (message.name === 'step') goToStep(message.index);
    else if (message.name === 'stop') stopLocal(message.restore !== false);
    return;
  }
  if (message.type === 'release') {
    if (owner?.id !== message.sender || owner.session !== message.session) return;
    clearTimer();
    owner = null;
    snapshot = null;
    remoteSnapshot = null;
    remoteRevision = -1;
    elapsedBeforeRun = 0;
    demo = emptyDemo();
    notify(false);
    return;
  }
  if (message.type !== 'state' || !validOwner(message.owner) ||
      message.owner.id !== message.sender || !validDemo(message.demo) ||
      !Number.isSafeInteger(message.revision)) return;
  if (owner && owner.session !== message.owner.session && earlierOwner(owner, message.owner)) {
    // Concurrent start clicks settle on the older claim. The losing tab drops
    // its timer on receipt, so two controllers cannot keep running a demo.
    if (isDemoOwner()) publishState(message.sender);
    return;
  }
  const sameSession = owner?.session === message.owner.session;
  if (sameSession && message.revision <= remoteRevision) return;
  clearTimer();
  snapshot = null;
  owner = { ...message.owner };
  remoteRevision = message.revision;
  remoteSnapshot = copySnapshot(message.snapshot);
  demo = { running: message.demo.running, paused: message.demo.paused,
    index: message.demo.index, progress: message.demo.progress, done: message.demo.done };
  elapsedBeforeRun = demo.progress * TOTAL_DURATION;
  notify(false);
}
if (browser) {
  try {
    const Broadcast = browser.BroadcastChannel ?? globalThis.BroadcastChannel;
    if (Broadcast) {
      channel = new Broadcast('yatuan-companion:demo:v1');
      channel.addEventListener('message', receive);
      post({ type: 'hello' });
    }
  } catch { channel = null; }
}

export function isDemoOwner() { return owner?.id === tabId; }
export function getDemoState() { return { ...demo }; }
export function subscribeDemo(listener) {
  if (typeof listener !== 'function') throw new TypeError('subscribeDemo expects a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function startDemo() {
  if (remoteCommand('start')) return getDemoState();
  captureSnapshot();
  clearTimer();
  elapsedBeforeRun = 0;
  demo = { running: true, paused: false, index: 0, progress: 0, done: false };
  applyStep(0);
  startTimer();
  notify();
  return getDemoState();
}
export function pauseDemo() {
  if (remoteCommand('pause')) return getDemoState();
  if (!demo.running || demo.paused) return getDemoState();
  tick();
  if (!demo.running) return getDemoState();
  elapsedBeforeRun = elapsedNow();
  demo.paused = true;
  clearTimer();
  notify();
  return getDemoState();
}
export function resumeDemo() {
  if (remoteCommand('resume')) return getDemoState();
  if (!snapshot || demo.done) return getDemoState();
  if (demo.running && !demo.paused) return getDemoState();
  demo = { ...demo, running: true, paused: false, done: false };
  startTimer();
  notify();
  return getDemoState();
}
function stopLocal(restore = true) {
  clearTimer();
  const previousOwner = owner;
  const previous = snapshot;
  snapshot = null;
  elapsedBeforeRun = 0;
  runStartedAt = 0;
  demo = emptyDemo();
  // Restore only the temporary presentation/progress fields. Real chats,
  // memories, saved meals, custom images and character selection are preserved.
  if (restore && previous) updateState(previous);
  owner = null;
  remoteSnapshot = null;
  remoteRevision = -1;
  notify(false);
  if (previousOwner?.id === tabId) post({ type: 'release', session: previousOwner.session });
  return getDemoState();
}
export function stopDemo() {
  if (owner && !isDemoOwner()) {
    // Restore synchronously on the requesting page. If the caller immediately
    // resets all data, a later owner acknowledgement cannot resurrect old data.
    const restore = remoteSnapshot;
    if (restore) updateState(restore);
    remoteCommand('stop', undefined, { restore: !restore });
    demo = emptyDemo();
    notify(false);
    return getDemoState();
  }
  return stopLocal();
}
export function goToStep(index) {
  if (typeof index !== 'number' || !Number.isFinite(index)) return getDemoState();
  if (remoteCommand('step', index)) return getDemoState();
  const nextIndex = Math.max(0, Math.min(DEMO_STEPS.length - 1, Math.round(index)));
  const wasPlaying = demo.running && !demo.paused;
  captureSnapshot();
  clearTimer();
  elapsedBeforeRun = stepStart(nextIndex);
  demo = { running: true, paused: !wasPlaying, index: nextIndex,
    progress: elapsedBeforeRun / TOTAL_DURATION, done: false };
  applyStep(nextIndex);
  if (wasPlaying) startTimer();
  notify();
  return getDemoState();
}
export function disposeDemo() {
  // Unmounting/closing a mirror must not send a stop command to the owner.
  if (isDemoOwner()) stopLocal();
  clearTimer();
  listeners.clear();
  channel?.close();
  channel = null;
  owner = null;
  remoteSnapshot = null;
  demo = emptyDemo();
}
