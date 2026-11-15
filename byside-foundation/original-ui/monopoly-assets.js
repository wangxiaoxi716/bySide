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
  partner: 'assets/monopoly/avatars/partner.jpg',
});

// The second player is a person in local mode, not the Yatuan opponent.
export function monopolyAvatar(mode, playerIndex) {
  if (playerIndex === 0) return PLAYER_AVATARS.player;
  if (playerIndex === 1 && mode === 'solo') return PLAYER_AVATARS.yatuan;
  if (playerIndex === 1 && mode === 'local') return PLAYER_AVATARS.partner;
  return null;
}

// A house-shaped portrait is an ownership marker; the round portraits are pieces.
export function monopolyOwnerBadge(mode, owner, projection = false) {
  if (owner !== 0 && owner !== 1) return '';
  const avatar = monopolyAvatar(mode, owner);
  if (!avatar) return '';
  const badge = projection ? 'gar-owner-badge' : 'mono-owner-badge';
  return `<span class="${badge} owner-${owner}" aria-hidden="true"><svg viewBox="0 0 48 54" focusable="false"><path d="M3 20 24 3l21 17v30H3Z" fill="currentColor" stroke="#fffef8" stroke-width="2" stroke-linejoin="round"/></svg><img src="${avatar}" alt="" width="96" height="96"></span>`;
}
