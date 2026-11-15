// Drop the supplied GIF/WebP/WebM files in assets/motions/, then map them here.
// Keys can also be stage-specific: "yatuan:2:speaking" before "yatuan:speaking".
// Paths are local assets only. Leave a key absent to retain the current artwork.
export const MOTION_ASSETS = {
  // 'yatuan:idle': 'assets/motions/yatuan-idle.gif',
  // 'yatuan:listening': 'assets/motions/yatuan-listening.gif',
  // 'yatuan:thinking': 'assets/motions/yatuan-thinking.gif',
  // 'yatuan:speaking': 'assets/motions/yatuan-speaking.webm',
  // 'yatuan:happy': 'assets/motions/yatuan-happy.gif',
  // 'yatuan:eating': 'assets/motions/yatuan-eating.gif',
  // 'yatuan:sleeping': 'assets/motions/yatuan-sleeping.gif',
};
export function getMotionAsset(state) {
  const motion = state.motion && state.motion !== 'idle' ? state.motion : state.mood === 'sleepy' ? 'sleeping' : state.mood === 'curious' ? 'idle' : state.mood;
  const path = MOTION_ASSETS[`${state.character}:${state.growthStage}:${motion}`] || MOTION_ASSETS[`${state.character}:${motion}`] || MOTION_ASSETS[`${state.character}:idle`];
  return typeof path === 'string' && /^assets\/motions\/[a-zA-Z0-9_./-]+\.(?:gif|webp|png|webm|mp4)$/.test(path) && !path.includes('..') ? path : '';
}
