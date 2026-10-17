import {getMotionAsset} from './animations.js';
// Existing approved artwork is displayed through native SVG viewports and
// silhouette clips. No network image service is required at runtime.
let serial = 0;
export const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
export const characterName = s => s.character === 'human' ? '小予' : s.character === 'custom' ? '我的伙伴' : '芽团';
export const stages = ['初见 · 双叶', '相伴 · 舒叶', '积累 · 花苞', '绽放 · 初花'];

export function icon(name, size = 20) {
    const paths = {
        home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
        sprout: 'M12 21v-9M12 14C3 15 3 7 3 4c8 0 10 5 9 10Zm0-4C12 3 17 2 21 2c0 7-4 11-9 10',
        bowl: 'M3 12h18c0 6-4 9-9 9s-9-3-9-9ZM7 3v4m5-5v5m5-4v4',
        heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
        book: 'M12 5C8 2 4 3 2 4v16c3-2 7-1 10 1m0-16c4-3 8-2 10-1v16c-3-2-7-1-10 1V5',
        chat: 'M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM7 10h.01M12 10h.01M17 10h.01',
        camera: 'M3 6h4l2-3h6l2 3h4v15H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
        mic: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V4Zm-3 7v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
        send: 'm22 2-7 20-4-9L2 9 22 2ZM11 13 22 2',
        projector: 'M3 3h18v13H3V3Zm9 13v6m-5 0 5-4 5 4',
        settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
        arrow: 'M5 12h14m-5-5 5 5-5 5',
        chevron: 'm9 5 7 7-7 7',
        plus: 'M12 5v14M5 12h14',
        close: 'm6 6 12 12M6 18 18 6',
        play: 'm8 4 13 8-13 8V4Z',
        pause: 'M8 4v16M16 4v16',
        reset: 'M3 11a9 9 0 1 1 2 7M3 4v7h7',
        upload: 'M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6',
        check: 'm5 12 4 4L19 6',
        volume: 'm11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
        moon: 'M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13Z',
        sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
        spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
        more: 'M4 12h.01M12 12h.01M20 12h.01',
        trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
        image: 'M3 3h18v18H3Zm0 13 6-6 5 5 3-3 4 4M15 7h.01',
        leaf: 'M20 3C3 1 0 16 8 19c8 4 15-3 12-16ZM5 21 16 8',
        link: 'M9 15 15 9M7 14l-2 2a3 3 0 0 0 4 4l4-4m-2-8 4-4a3 3 0 0 1 4 4l-2 2'
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
}

function flower(style, cls = '') {
    const colors = {cream: ['#fff6d8', '#e7ab43'], pink: ['#f7bbcd', '#eaa246'], blue: ['#c6dbe8', '#e3b853']};
    const [p, c] = colors[style] || colors.cream;
    return `<svg class="grown-flower ${cls}" viewBox="0 0 90 125" aria-hidden="true"><path d="M25 123Q25 80 47 45" fill="none" stroke="#77934a" stroke-width="5"/><path d="M31 91Q8 83 15 68Q37 66 35 85" fill="#97b55c"/><g fill="${p}" stroke="#e9dbb2" stroke-width=".8">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="48" cy="27" rx="12" ry="20" transform="rotate(${a} 48 46)"/>`).join('')}</g><circle cx="48" cy="46" r="9" fill="${c}"/></svg>`;
}

export function characterArt(state, {className = ''} = {}) {
    const asset = getMotionAsset(state);
    if (asset) {
        const media = /\.(webm|mp4)$/.test(asset) ? `<video src="${esc(asset)}" autoplay loop muted playsinline aria-label="伙伴动作"></video>` : `<img src="${esc(asset)}" alt="伙伴动作">`;
        return `<div class="character animated-character ${className}">${media}</div>`;
    }
    const id = `pet-clip-${++serial}`;
    const human = state.character === 'human';
    if (state.character === 'custom' && state.customImage) {
        return `<div class="character custom-character ${className} mood-${state.mood}"><img src="${esc(state.customImage)}" alt="你上传的伙伴形象"></div>`;
    }
    const petPath = 'M77 370C61 304 125 266 213 262C223 221 270 180 355 197C333 225 313 239 284 247C311 242 340 253 356 271C327 288 293 282 272 277C331 279 368 317 377 352C389 331 415 338 425 360C432 383 412 400 391 407C381 460 350 491 303 502C323 519 281 532 253 523C235 530 212 522 210 515C201 529 159 530 148 517C111 508 85 491 71 468C43 474 27 455 39 426C38 406 53 381 77 370Z';
    const humanPath = 'M676 693C680 672 712 664 735 681C759 694 768 718 762 743C766 765 758 778 749 786L758 811C764 835 755 853 747 862L745 890C746 912 749 933 752 950C770 953 785 962 781 974C775 987 748 989 730 977L719 965C709 976 698 983 683 978L679 987C660 997 632 989 632 976L630 966L583 969L581 899C572 891 571 880 578 872C587 862 606 860 628 861L633 845C627 831 634 802 647 787L655 761C643 744 651 707 676 693Z';
    return `<div class="character ${human ? 'human-character' : 'yatuan-character'} ${className} mood-${esc(state.mood)} motion-${esc(state.motion || 'idle')} stage-${state.growthStage}"><svg class="character-art" viewBox="${human ? '555 650 245 360' : '15 175 420 365'}" role="img" aria-label="${human ? '小予，人物陪伴形象' : '芽团，头顶两片嫩叶的小精灵'}"><defs><clipPath id="${id}"><path d="${human ? humanPath : petPath}"/></clipPath></defs><image href="assets/${human ? 'human-reference.png' : 'yatuan-reference.png'}" width="1536" height="1024" clip-path="url(#${id})"/></svg>${!human && state.growthStage === 2 ? '<span class="bud-stem"><i></i></span>' : ''}${!human && state.growthStage === 3 ? Array.from({length: state.flowerCount}, (_, i) => flower(state.flowerStyle, `flower-${i}`)).join('') : ''}${human && state.growthStage > 1 ? '<span class="human-sprout">🌱</span>' : ''}</div>`;
}

export function miniStats(s) {
    return `<div class="mini-stat"><span>活力</span><i><b style="width:${s.energy}%"></b></i></div><div class="mini-stat pink"><span>亲密</span><i><b style="width:${s.intimacy}%"></b></i></div><div class="mini-stat amber"><span>成长</span><i><b style="width:${s.growth}%"></b></i></div>`;
}
