/**
 * Local prototype state. Chat replies are deterministic demo rules, not an AI
 * service. Camera images are never inferred or uploaded by this module.
 * Cross-window sync applies only to tabs under the same browser origin.
 */
const STORAGE_KEY = 'yatuan-companion:state:v1';
const CHANNEL_NAME = 'yatuan-companion:sync:v1';
const SCHEMA_VERSION = 1;
const MAX_IMAGE_CHARS = 1_000_000;
const IMAGE_BUDGET = 1_600_000;
const MAX_CHAT = 120;
const MAX_MEMORIES = 80;
const MAX_MEALS = 60;
const browser = typeof window !== 'undefined' ? window : null;
const listeners = new Set();
const writer = makeId();
let logicalClock = 0;
let latestStamp = { clock: 0, writer: '' };
let channel = null;
let warningQueued = false;

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function clean(value, length = 1000) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, length) : '';
}
function number(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function choice(value, values, fallback) { return values.includes(value) ? value : fallback; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function warn(reason) {
  // Schedule so a UI listener registered immediately after import sees startup errors.
  if (warningQueued) return;
  warningQueued = true;
  queueMicrotask(() => {
    warningQueued = false;
    if (!browser?.dispatchEvent) return;
    try {
      const EventCtor = browser.CustomEvent ?? globalThis.CustomEvent;
      if (EventCtor) browser.dispatchEvent(new EventCtor('storage-warning', { detail: { reason } }));
    } catch { /* State remains usable even in restricted webviews. */ }
  });
}
function imageData(value, warnings = false) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_CHARS || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(value)) {
    if (warnings) warn('image-limit');
    return null;
  }
  return value;
}
function defaultState() {
  const at = Date.now();
  const speech = '回来啦，今天想聊些什么？';
  return {
    character: 'yatuan', customImage: null, mood: 'happy', motion: 'idle', activity: '陪伴',
    liveProgress: { lastMealAt: 0, lastChatAt: 0 },
    energy: 86, intimacy: 12, growth: 18, growthStage: 0,
    flowerStyle: 'cream', flowerCount: 1, speech,
    chat: [{ id: makeId(), role: 'assistant', text: speech, at }],
    memories: [], meals: [], personality: 'gentle', sound: false,
    projection: { scale: 1, x: 32, y: 32, showStats: true }, createdAt: at,
  };
}
function sanitize(raw, warnings = false) {
  const fallback = defaultState();
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const projection = value.projection && typeof value.projection === 'object' ? value.projection : {};
  const itemTime = at => number(at, Date.now(), 0, 1e15);
  const itemId = id => clean(id, 100) || makeId();
  const result = {
    character: choice(value.character, ['yatuan', 'human', 'custom'], fallback.character),
    customImage: imageData(value.customImage, warnings),
    mood: choice(value.mood, ['happy', 'curious', 'sleepy', 'eating', 'listening'], fallback.mood),
    motion: choice(value.motion, ['idle', 'listening', 'thinking', 'speaking', 'happy', 'eating', 'sleeping'], 'idle'),
    liveProgress: { lastMealAt: number(value.liveProgress?.lastMealAt, 0, 0, 1e15), lastChatAt: number(value.liveProgress?.lastChatAt, 0, 0, 1e15) },
    activity: choice(value.activity, ['陪伴', '用餐'], fallback.activity),
    energy: Math.round(number(value.energy, fallback.energy, 0, 100)),
    intimacy: Math.round(number(value.intimacy, fallback.intimacy, 0, 100)),
    growth: Math.round(number(value.growth, fallback.growth, 0, 100)),
    growthStage: Math.round(number(value.growthStage, fallback.growthStage, 0, 3)),
    flowerStyle: choice(value.flowerStyle, ['cream', 'pink', 'blue'], fallback.flowerStyle),
    flowerCount: Math.round(number(value.flowerCount, fallback.flowerCount, 1, 3)),
    speech: clean(value.speech, 600) || fallback.speech,
    chat: Array.isArray(value.chat) ? value.chat.slice(-MAX_CHAT).map(item => ({
      id: itemId(item?.id), role: choice(item?.role, ['user', 'assistant'], 'assistant'),
      text: clean(item?.text, 2000), at: itemTime(item?.at),
    })).filter(item => item.text) : fallback.chat,
    memories: Array.isArray(value.memories) ? value.memories.slice(-MAX_MEMORIES).map(item => ({
      id: itemId(item?.id), text: clean(item?.text, 500), at: itemTime(item?.at),
    })).filter(item => item.text) : [],
    meals: Array.isArray(value.meals) ? value.meals.slice(-MAX_MEALS).map(item => ({
      id: itemId(item?.id), description: clean(item?.description, 1000),
      groups: Array.isArray(item?.groups) ? [...new Set(item.groups.map(group => clean(group, 40)).filter(Boolean))].slice(0, 12) : [],
      image: imageData(item?.image, warnings), source: clean(item?.source, 60) || '手动确认',
      advice: clean(item?.advice, 1200), at: itemTime(item?.at),
    })).filter(item => item.description || item.groups.length) : [],
    personality: choice(value.personality, ['gentle', 'lively', 'witty'], fallback.personality),
    sound: typeof value.sound === 'boolean' ? value.sound : fallback.sound,
    projection: {
      scale: number(projection.scale, 1, 0.5, 2),
      x: number(projection.x, 32, 0, 3840), y: number(projection.y, 32, 0, 2160),
      showStats: typeof projection.showStats === 'boolean' ? projection.showStats : true,
    },
    createdAt: number(value.createdAt, fallback.createdAt, 0, 1e15),
  };
  // Keep the newest pictures within a conservative localStorage budget. Older
  // meal descriptions and confirmations survive even if their preview expires.
  let remaining = IMAGE_BUDGET - (result.customImage?.length ?? 0);
  for (let i = result.meals.length - 1; i >= 0; i--) {
    const picture = result.meals[i].image;
    if (!picture) continue;
    if (picture.length <= remaining) remaining -= picture.length;
    else result.meals[i].image = null;
  }
  if (result.character === 'custom' && !result.customImage) result.character = 'yatuan';
  return result;
}
function readEnvelope(value) {
  try {
    const envelope = typeof value === 'string' ? JSON.parse(value) : value;
    if (!envelope || envelope.schema !== SCHEMA_VERSION || !envelope.state ||
        !Number.isSafeInteger(envelope.clock) || envelope.clock < 0 ||
        typeof envelope.writer !== 'string' || envelope.writer.length > 100) return null;
    return envelope;
  } catch { return null; }
}
function storage() { return browser ? browser.localStorage : globalThis.localStorage; }
let state = defaultState();
try {
  const saved = storage()?.getItem(STORAGE_KEY);
  if (saved) {
    const envelope = readEnvelope(saved);
    if (envelope) {
      state = sanitize(envelope.state);
      logicalClock = envelope.clock;
      latestStamp = { clock: envelope.clock, writer: envelope.writer };
    } else warn('invalid-data');
  }
} catch { warn('unavailable'); }
function notify() {
  for (const listener of listeners) {
    try { listener(getState()); } catch (error) { console.error('State subscriber failed:', error); }
  }
}
function isNewer(envelope) {
  return envelope.clock > latestStamp.clock ||
    (envelope.clock === latestStamp.clock && envelope.writer > latestStamp.writer);
}
function receive(input) {
  const envelope = readEnvelope(input);
  if (!envelope || envelope.writer === writer) return;
  logicalClock = Math.max(logicalClock, envelope.clock);
  if (!isNewer(envelope)) return;
  latestStamp = { clock: envelope.clock, writer: envelope.writer };
  state = sanitize(envelope.state);
  notify();
  // Never re-persist/re-broadcast a received state: no echo loops.
}
if (browser?.addEventListener) {
  browser.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY && event.newValue) receive(event.newValue);
  });
  try {
    const Broadcast = browser.BroadcastChannel ?? globalThis.BroadcastChannel;
    if (Broadcast) {
      channel = new Broadcast(CHANNEL_NAME);
      channel.addEventListener('message', event => receive(event.data));
    }
  } catch { /* The storage event still synchronizes compatible tabs. */ }
  browser.addEventListener('pagehide', event => {
    if (!event.persisted) channel?.close();
  });
}
function commit(next) {
  state = sanitize(next, true);
  logicalClock += 1;
  latestStamp = { clock: logicalClock, writer };
  const envelope = { schema: SCHEMA_VERSION, clock: logicalClock, writer, state };
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(envelope)); }
  catch { warn('quota-or-unavailable'); }
  notify();
  try { channel?.postMessage(envelope); } catch { /* Local state remains usable. */ }
  return getState();
}
export function getState() { return clone(state); }
export function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('subscribe expects a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function updateState(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return getState();
  return commit({ ...state, ...partial, projection: { ...state.projection, ...(partial.projection ?? {}) } });
}
export function setCharacter(id) {
  if (!['yatuan', 'human', 'custom'].includes(id)) return getState();
  return updateState({ character: id });
}
export function setMood(id) {
  if (!['happy', 'curious', 'sleepy', 'eating', 'listening'].includes(id)) return getState();
  return updateState({ mood: id, activity: id === 'eating' ? '用餐' : '陪伴' });
}
function remember(list, text) {
  const content = clean(text, 500);
  if (!content || list.some(item => item.text.replace(/\s/g, '') === content.replace(/\s/g, ''))) return list;
  return [...list, { id: makeId(), text: content, at: Date.now() }].slice(-MAX_MEMORIES);
}
export function addMemory(text) { return updateState({ memories: remember(state.memories, text) }); }
export function deleteMemory(id) {
  return updateState({ memories: state.memories.filter(item => item.id !== id) });
}
function extractMemory(text) {
  const explicit = text.match(/(?:请|帮我|请帮我)?记住[：:，,\s]*(.+)/);
  if (explicit && !/^(?:了?吗|什么|哪些|了吗|没有)[？?。！!]*$/.test(explicit[1])) {
    return clean(explicit[1].replace(/[。！!]+$/, ''), 500);
  }
  // Questions about preferences are recall requests, not new memories.
  if (/[？?]|(?:什么|哪些|记得)/.test(text)) return '';
  const preference = text.match(/我(?:最)?(?:不喜欢|不爱吃|不爱|讨厌|喜欢|爱吃|偏爱)[^。！？!?\n]{1,400}/);
  return preference ? clean(preference[0], 500) : '';
}
function styleReply(reply, personality) {
  if (personality === 'lively') return `${reply} 🌱`;
  if (personality === 'witty') return `${reply} 我的两片小叶子也在认真听。`;
  return reply;
}
export function sendChat(input) {
  const text = clean(input, 2000);
  if (!text) return '';
  const memory = extractMemory(text);
  let memories = state.memories;
  let reply;
  let mood = 'happy';
  if (memory) {
    memories = remember(memories, memory);
    reply = `好，我把“${memory}”记在这台设备里了。你随时可以在「回忆」里查看或删除。`;
  } else if (/(?:记得|记住|偏好|了解我)|我(?:不)?喜欢(?:吃)?什么/.test(text)) {
    reply = memories.length
      ? `我记着这些小事：${memories.slice(-5).map(item => item.text).join('；')}。有变化也可以告诉我。`
      : '我们的小本子还是空的。你可以说“我喜欢……”或“请记住……”，我会存到这台设备的回忆里。';
    mood = 'curious';
  } else if (/(难过|伤心|孤独|委屈|压力|焦虑|心情不好|不开心|烦躁)/.test(text)) {
    reply = '听起来今天有些不容易。我在这里陪你。你想慢慢说说发生了什么，还是先一起安静待一会儿？';
    mood = 'listening';
  } else if (/(累了|好累|困了|想睡|睡觉|晚安)/.test(text)) {
    reply = '那就让今天慢一点吧。休息也算在认真照顾自己。等你回来，我们再接着聊。';
    mood = 'sleepy';
  } else if (/(摄像头|看到了?什么|看见|盘子里|识别|照片里)/.test(text)) {
    reply = '这版可以预览摄像头和记录照片，尚未连接图像识别。你可以在「饮食」里确认食材，也可以直接告诉我盘子里有什么。';
    mood = 'curious';
  } else if (/(吃饭|午饭|晚饭|早餐|早饭|开饭|吃什么|饮食|蔬菜|蛋白质)/.test(text)) {
    reply = '我把小碗准备好啦。可以在「饮食」里记录这顿饭，并确认有哪些食材。我们一起看看有没有主食、蔬菜和蛋白质来源，慢慢吃。';
    mood = 'eating';
  } else if (/(下棋|五子棋|手工|编织)/.test(text)) {
    reply = '这个活动已经放进我们的小屋啦，完整互动还在准备中。你可以先去「生活」看看，等它开放再一起玩。';
    mood = 'curious';
  } else if (/(谢谢|喜欢你|爱你|开心|好消息|成功|完成了)/.test(text)) {
    reply = '能陪你分享这个片刻，我的小叶子都舒展开了。愿意再跟我说一点吗？';
  } else if (/(你好|嗨|回来|早上好|早安)/.test(text)) {
    reply = '你来啦，我的小角落一直在这里。今天想聊聊近况，还是让我陪你吃顿饭？';
  } else {
    reply = '我听到了。这个演示版会根据一些简单规则回应，也能记住你明确告诉我的偏好。你可以继续说说今天的事，或告诉我喜欢什么。';
    mood = 'listening';
  }
  reply = styleReply(reply, state.personality);
  const growth = Math.min(100, state.growth + 1);
  const earnedStage = growth >= 90 ? 3 : growth >= 65 ? 2 : growth >= 35 ? 1 : 0;
  const at = Date.now();
  commit({ ...state, memories, speech: reply, mood,
    activity: mood === 'eating' ? '用餐' : '陪伴',
    intimacy: Math.min(100, state.intimacy + 1), growth,
    growthStage: Math.max(state.growthStage, earnedStage),
    chat: [...state.chat, { id: makeId(), role: 'user', text, at }, { id: makeId(), role: 'assistant', text: reply, at: at + 1 }],
  });
  return reply;
}
export function saveMeal(input = {}) {
  const description = clean(input.description, 1000);
  const groups = Array.isArray(input.groups) ? [...new Set(input.groups.map(group => clean(group, 40)).filter(Boolean))].slice(0, 12) : [];
  if (!description && !groups.length) return null;
  const labels = groups.join(' ');
  const vegetables = /蔬菜|vegetable/i.test(labels);
  const protein = /蛋白|肉蛋|豆|鱼|protein/i.test(labels);
  const grains = /主食|谷物|grain|carb/i.test(labels);
  const missing = [!vegetables && '蔬菜', !protein && '蛋白质来源', !grains && '主食'].filter(Boolean);
  let advice;
  if (!groups.length) advice = '这顿饭已按你的描述记录。补充确认食物类别后，我们可以一起看看搭配。';
  else if (missing.length) advice = `按你确认的类别，这次还没有记录到${missing.join('、')}；如果实际上有，补充记录即可。下次也可以试着丰富搭配。`;
  else advice = '你确认的记录里有主食、蔬菜和蛋白质来源，搭配很丰富。吃得舒服、慢慢享用就好。';
  advice += '这是一条一般搭配提示，不是对营养含量或健康状况的判断。';
  const meal = { id: makeId(), description, groups, image: imageData(input.image, true),
    source: clean(input.source, 60) || '手动确认', advice, at: Date.now() };
  const speech = groups.length ? '这顿饭记好啦，谢谢你认真照顾自己。我陪你，慢慢吃。' : '这顿饭记好啦，之后也可以补充食材类别。我陪你，慢慢吃。';
  const growth = Math.min(100, state.growth + 3);
  commit({ ...state, meals: [...state.meals, meal], mood: 'eating', activity: '用餐', speech,
    energy: Math.min(100, state.energy + 2), intimacy: Math.min(100, state.intimacy + 1), growth,
    growthStage: Math.max(state.growthStage, growth >= 90 ? 3 : growth >= 65 ? 2 : growth >= 35 ? 1 : 0),
  });
  return clone(meal);
}
export function setGrowth(stage) {
  const growthStage = Math.round(number(stage, state.growthStage, 0, 3));
  return updateState({ growthStage });
}
export function resetData() {
  // A persisted reset envelope supersedes earlier writes and also resets other
  // open projection/control tabs. No hidden copy of old chats is retained.
  return commit(defaultState());
}
