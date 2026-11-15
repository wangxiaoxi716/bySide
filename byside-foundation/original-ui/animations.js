// Drop the supplied GIF/WebP/WebM files in assets/motions/, then map them here.
// Keys can also be stage-specific: "yatuan:2:speaking" before "yatuan:speaking".
// Paths are local assets only. Leave a key absent to retain the current artwork.
export const MOTION_ASSETS = {
  'yatuan:idle': 'assets/motions/yatuan-idle.webp',
  'yatuan:happy': 'assets/motions/yatuan-happy.webp',
  'yatuan:curious': 'assets/motions/yatuan-curious.webp',
  'yatuan:listening': 'assets/motions/yatuan-listening.webp',
  'yatuan:thinking': 'assets/motions/yatuan-curious.webp',
  'yatuan:speaking': 'assets/motions/yatuan-speaking.webp',
  'yatuan:eating': 'assets/motions/yatuan-eating.webp',
  'yatuan:sleeping': 'assets/motions/yatuan-sleeping.webp',
};
const DEMO_ASSETS = [
  'assets/motions/yatuan-speaking.webp',
  'assets/motions/yatuan-eating.webp',
  'assets/motions/yatuan-curious.webp',
  'assets/motions/yatuan-happy.webp',
  'assets/motions/yatuan-growth-06.png',
  'assets/motions/yatuan-growth-08.png',
];
export function getMotionAsset(state) {
  const motion = state.motion && state.motion !== 'idle' ? state.motion : state.mood === 'sleepy' ? 'sleeping' : state.mood;
  let path = MOTION_ASSETS[`${state.character}:${state.growthStage}:${motion}`] || MOTION_ASSETS[`${state.character}:${motion}`] || MOTION_ASSETS[`${state.character}:idle`];
  if (state.character === 'yatuan' && Number.isInteger(state.demoStep) && DEMO_ASSETS[state.demoStep]) {
    path = DEMO_ASSETS[state.demoStep];
    if ([4, 5].includes(state.demoStep) && Number.isInteger(state.demoGrowthFrame) && state.demoGrowthFrame >= 5 && state.demoGrowthFrame <= 8) {
      path = `assets/motions/yatuan-growth-${String(state.demoGrowthFrame).padStart(2, '0')}.png`;
    }
  }
  return typeof path === 'string' && /^assets\/motions\/[a-zA-Z0-9_./-]+\.(?:gif|webp|png|webm|mp4)$/.test(path) && !path.includes('..') ? path : '';
}
