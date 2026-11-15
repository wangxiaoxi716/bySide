// Pure rules shared by the live loop and its tests. AI output is untrusted data.
const MOODS = ['happy', 'curious', 'sleepy', 'eating', 'listening'];
const GROUPS = ['主食', '蔬菜', '蛋白质', '水果', '奶类'];
const clean = (s, max = 600) => typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
export const DEFAULT_LIVE_CONFIG = { cameraId: '', intervalSeconds: 10, wakePhrase: '芽团芽团' };
export function normalizeLiveConfig(value = {}) {
  const wakePhrase = clean(value.wakePhrase, 20) || DEFAULT_LIVE_CONFIG.wakePhrase;
  return { cameraId: clean(value.cameraId, 300), intervalSeconds: [5, 10, 15].includes(Number(value.intervalSeconds)) ? Number(value.intervalSeconds) : 10, wakePhrase };
}
export function compactSpeech(text) { return String(text || '').replace(/[\s，。！？、,.!?：:]/g, '').toLowerCase(); }
export function voiceCommand(text, wakePhrase = DEFAULT_LIVE_CONFIG.wakePhrase) {
  const compact = compactSpeech(text);
  if (/^(结束陪伴|停止陪伴|退出陪伴)[吧呀啊]?$/.test(compact)) return { type: 'stop' };
  if (/^(暂停观察|别看了|停止观察)[吧呀啊]?$/.test(compact)) return { type: 'pause' };
  if (/^(继续观察|开始观察|看看盘子)[吧呀啊]?$/.test(compact)) return { type: 'wake', text: '' };
  const phrase = compactSpeech(wakePhrase);
  // ASR commonly writes 芽团 as 牙团. Do not match arbitrary one-character words.
  const normalized = phrase === '芽团芽团' ? compact.replace(/牙团/g, '芽团') : compact;
  const offset = normalized.indexOf(phrase);
  if (phrase.length >= 2 && offset >= 0 && offset <= 2) return { type: 'wake', text: normalized.slice(offset + phrase.length) };
  return { type: 'text', text: clean(text, 1000) };
}
export function parseLiveReply(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(trimmed); } catch { throw new Error('模型没有返回可用的观察结果。请确认所选模型支持图片与 JSON 指令。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.reply !== 'string' || typeof value.platePresent !== 'boolean') {
    throw new Error('模型返回的观察格式不完整，本次没有更新成长状态。');
  }
  const foods = Array.isArray(value.foods) ? value.foods.slice(0, 12).map(f => ({ name: clean(f?.name, 50), group: GROUPS.includes(f?.group) ? f.group : '', certain: f?.certain === true })).filter(f => f.name) : [];
  return { reply: clean(value.reply, 400), mood: MOODS.includes(value.mood) ? value.mood : 'curious', platePresent: value.platePresent, foods, shouldSpeak: value.shouldSpeak === true, observation: clean(value.observation, 500) };
}
export function feedbackPatch(state, result, { kind = 'observe', now = Date.now() } = {}) {
  const progress = { lastMealAt: 0, lastChatAt: 0, ...state.liveProgress };
  let gain = 0, energyGain = 0, closeness = 0;
  // Sampling the same meal never gives per-frame rewards. Growth is a game,
  // not a nutritional grade; uncertain/no-plate predictions never earn meal points.
  if (result.platePresent && result.foods.some(f => f.certain && f.group) && now - progress.lastMealAt >= 20 * 60 * 1000) {
    gain += 3; energyGain = 2; progress.lastMealAt = now;
  }
  if (kind === 'chat' && now - progress.lastChatAt >= 60 * 1000) {
    gain += 1; closeness = 1; progress.lastChatAt = now;
  }
  const growth = Math.min(100, state.growth + gain);
  return { mood: result.mood, motion: result.mood === 'eating' ? 'eating' : result.mood === 'sleepy' ? 'sleeping' : 'idle', activity: result.platePresent ? '用餐' : '陪伴', growth,
    growthStage: Math.max(state.growthStage, growth >= 90 ? 3 : growth >= 65 ? 2 : growth >= 35 ? 1 : 0),
    energy: Math.min(100, state.energy + energyGain), intimacy: Math.min(100, state.intimacy + closeness), liveProgress: progress };
}
export function shouldAnnounce(result, last, { force = false, now = Date.now() } = {}) {
  if (!result.reply) return false;
  if (force) return true;
  return result.shouldSpeak && compactSpeech(result.reply) !== compactSpeech(last?.text) && (!last || now - last.at >= 18_000);
}
