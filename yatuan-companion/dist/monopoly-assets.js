// File names are explicit so missing artwork is caught by tests before deployment.
export const TILE_ART = Object.freeze([
  '00-start', '01-mushroom', '02-mail', '03-bakery',
  '04-rest', '05-post', '06-gift', '07-tea',
  '08-festival', '09-bookshop', '10-clover', '11-inn',
  '12-picnic', '13-farm', '14-treasure', '15-greenhouse',
].map(name => `assets/monopoly/tiles/${name}.jpg`));

export const DICE_ART = Object.freeze(
  Array.from({ length: 6 }, (_, index) => `assets/monopoly/dice/die-${index + 1}.jpg`),
);

export const PLAYER_AVATARS = Object.freeze({
  player: 'assets/monopoly/avatars/player.jpg',
  yatuan: 'assets/monopoly/avatars/yatuan.jpg',
});

// The second player is a person in local mode, not the Yatuan opponent.
export function monopolyAvatar(mode, playerIndex) {
  if (playerIndex === 0) return PLAYER_AVATARS.player;
  if (playerIndex === 1 && mode === 'solo') return PLAYER_AVATARS.yatuan;
  return null;
}
