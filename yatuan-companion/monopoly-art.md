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
