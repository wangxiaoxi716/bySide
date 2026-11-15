# 芽团大富翁美术素材

这些图片使用 Codex 内置 ImageGen 生成。保留了两张卡片原图，棋盘和骰子图片使用适合网页加载的 JPEG 副本；文字由网页渲染，便于保持准确和可读。

- 地产卡原图：`dist/assets/monopoly/property-card.png`
- 事件卡原图：`dist/assets/monopoly/event-card.png`
- 棋盘格图片：`dist/assets/monopoly/tiles/`，按棋盘顺序编号 00–15。
- 骰子图片：`dist/assets/monopoly/dice/die-1.jpg` 至 `die-6.jpg`。

## 卡片提示词

地产卡：

> Create a single portrait property card artwork for a warm family board game, in the same tactile 3D storybook style as a soft fuzzy cream-colored sprout mascot with two green leaves. Show a tiny cozy cottage among hills and garden flowers, with the mascot nearby. Warm ivory paper, sage green, honey, and muted terracotta. Straight-on upright card with a narrow green border; illustration in upper two thirds and a blank ivory area below for app-generated text. No text, letters, numbers, logo, collage or watermark.

事件卡：

> Use case: stylized-concept. Asset type: portrait illustrated chance-event card artwork for the same cozy family board game. Create one single upright card filling the image, no perspective, in a polished, tactile 3D storybook diorama style. A charming round fuzzy pale-wheat sprout mascot with two green leaves discovers a glowing golden envelope and a small pair of dice among leaves and flowers. Warm ivory, sage green, honey and muted terracotta, subtle paper texture, soft diffuse light. Leave a quiet pale lower area where the application can place its own text. No text, no letters, no numbers, no logo, no watermark, no collage, no multiple cards.

## 棋盘格提示词

每张图使用以下共同提示词，并替换 `{subject}`：

> Create ONE square game-board tile illustration, straight-on and centered, for a charming cozy family board game. Style: handcrafted wool-felt miniature diorama, soft natural light, muted sage green, warm ivory, honey, and terracotta; charming, instantly recognizable at small size. Subject: {subject}. One complete isolated scene, uncluttered square composition, no text, letters, numbers, logo, watermark, cards, or collage.

| 格子 | subject |
| --- | --- |
| 00 出发 | a welcoming wooden village gateway beside a winding path and a little green flag |
| 01 蘑菇小站 | a tiny red-capped mushroom kiosk with a small lantern and a bench |
| 02 惊喜来信 | a glowing golden sealed envelope resting among leaves and daisies |
| 03 小叶面包房 | a cozy cream cottage bakery with a loaf of bread beside its door |
| 04 歇脚小站 | a quiet wooden bench beneath a leafy tree with a little teapot |
| 05 花园邮局 | a tiny cream post office cottage with a friendly red mailbox and envelopes |
| 06 惊喜来信 | a wrapped golden gift box tied with a green leafy ribbon among flowers |
| 07 茶香小屋 | a cozy little teahouse with a steaming teacup and tea leaves |
| 08 小镇庆典 | a cheerful village fair with warm lanterns and a little coin jar |
| 09 云朵书店 | a charming tiny bookshop with colorful books and a cloud-shaped sign without text |
| 10 惊喜来信 | a glowing four-leaf clover among daisies and tiny golden stars |
| 11 山丘旅店 | a welcoming little hillside inn with warm windows and a lantern |
| 12 草地野餐 | a picnic blanket on grass with a basket of bread, fruit and a teapot |
| 13 向日葵农场 | a sunflower farm with a small wooden wheelbarrow and a cottage |
| 14 惊喜来信 | a small open treasure chest with golden coins and a green sprout |
| 15 暖阳花房 | a little sunlit glass greenhouse filled with flowers and plants |

## 骰子提示词

每张图使用以下模板，并分别替换 `{layout}` 和 `{n}`：

> Create ONE square artwork of a single dice face for a cozy wool-felt board game. Perfectly front-on, no perspective, showing only one flat ivory rounded-square die face on a plain pale cream background. Dark sage-green circular felt pips. The die must show exactly {layout}. Count carefully: exactly {n} dark dots total, no extra dots or shapes, no other sides. Soft tactile handmade felt texture and warm lighting. No text, numbers, letters, logos, symbols, stitches resembling dots, watermark, or collage.

1. ONE single dot exactly at the center
2. TWO dots only, one at the upper left and one at the lower right
3. THREE dots only, one at the upper left, one at the center, and one at the lower right
4. FOUR dots only, one at each of the four corners of the face
5. FIVE dots only, one at each of the four corners and one at the center
6. SIX dots only, arranged in two vertical columns of three

## 玩家与芽团头像

使用 Codex 内置 ImageGen 分别生成，参考 `dist/assets/yatuan-reference.png` 的芽团形象和 `dist/assets/monopoly/tiles/01-mushroom.jpg` 的羊毛毡风格。玩家头像是原创通用卡通形象，不代表真实人物外貌。网页和 AR 投影使用压缩副本。

- 玩家原图：`dist/assets/monopoly/avatars/player-original.png`；网页图：`dist/assets/monopoly/avatars/player.jpg`。
- 芽团原图：`dist/assets/monopoly/avatars/yatuan-original.png`；网页图：`dist/assets/monopoly/avatars/yatuan.jpg`。
- 双人模式伙伴原图：`dist/assets/monopoly/avatars/partner-original.png`；网页图：`dist/assets/monopoly/avatars/partner.jpg`。

玩家头像提示词：

> Use case: stylized-concept. Asset type: one square illustrated player avatar for a cozy digital board game, designed to be legible at very small size. Reference image 1 is the visual style/world and 2 is the wool-felt town color and material reference. Create a friendly gender-neutral human adventurer avatar with short dark brown hair, kind simple dark eyes, peach cheeks, a sage-green knit top and a tiny warm smile. Head and shoulders centered, facing forward, face filling most of the frame; gentle peach-cream circular backdrop and warm ivory corners. Tactile handcrafted wool-felt, soft 3D storybook toy, matching the accompanying fuzzy sprout mascot and board art. This is a fictional generic human avatar, not a depiction of a specific real person. Clean silhouette, no body text, no logo, no letters, no watermark, no collage, no extra characters, one single square image.

芽团头像提示词：

> Use case: stylized-concept. Asset type: one square mascot portrait avatar for the same cozy board game, designed to be legible at very small size. Reference image 1 is the exact identity of Yatuan: a small round cream fuzzy character, two green leaves sprouting from the top, simple dark oval eyes, soft rosy cheeks, tiny smiling mouth. Preserve that character's appearance, and take the handcrafted wool-felt textures and muted palette from image 2. Show only one centered close-up Yatuan portrait, facing forward and filling most of the frame, with enough margin to include both leaves; pale sage-green circular backdrop and warm ivory corners. Tactile handmade miniature, soft natural light, charming and clean, matching a friendly human player avatar. No human, no extra character, no clothing, no hats, no words, no letters, no logo, no watermark, no collage.

伙伴头像提示词：

> Use case: stylized-concept. Asset type: one square illustrated avatar for the second human player in a cozy board game. Image 1 is the existing player portrait; image 2 is the matching mascot portrait. Create a different, friendly and gender-neutral companion character in the exact same handmade wool-felt storybook style and framing as image 1. Warm expressive face, round dark eyes and rosy cheeks, soft medium-length dark chestnut hair, no hat, wearing a muted terracotta cardigan. Head and shoulders centered, facing forward, face large and clear enough for a very small game token. A warm pale rose circular background, cream corners; gentle diffuse lighting, soft natural felt fibers. The companion must be clearly distinguishable from the hat-wearing first player and from the cream sprout mascot, while belonging to the same cozy game world. One person only, one single square image, no text, letters, numbers, logo, watermark, symbols, collage, or extra characters.
