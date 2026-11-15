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
