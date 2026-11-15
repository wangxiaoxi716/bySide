# Plan — 芽团大富翁
> Task version: v2
> Status: in_progress

No spec required — 独立的本地棋盘游戏，规则直接由核心模块表达。

## Reference Pointers
- `yatuan-companion/dist/chess.html`、`tic-tac-toe.html`、`tic-tac-toe-core.js` 和 `chess.css`。
- `yatuan-companion/README.md`、`.github/workflows/deploy-cloudflare.yml`。
- 任务工作树 `bySide-monopoly`，本地分支 `codex/monopoly`，基于 main 的 `058a503`；交付目标为用户的远程 `zt` 分支。

## Related Tasks
- 已合并的井字棋功能：共享棋室入口，玩法和验收独立。

## Skills / Tools Used
- [PRD] `imagegen` — purpose: 创建用户要求的游戏卡片插画；outcome: succeeded；incorporated: 使用芽团风格的地产卡与事件卡，并为 16 个棋盘格生成地点插画。
- [Plan] Unaided — 参考现有游戏流程设计本地对战；considered: 工作拆解与设计。
- [Test] Unaided — 设计资金、回合、胜负和浏览器验证；considered: testing strategy。

## Preconditions
- [x] 已检查现有仓库文档、分支和基线。
- [x] 用户明确要求实现大富翁并生成卡片图片。

## Plan Review
- Verdict: sound
- Coverage: 核心规则、卡片、入口及交互分别由实现和验证步骤覆盖。
- Verifiability: 核心逻辑可确定性测试，图像和页面可通过浏览器核验。
- Layer ownership: 在规则模块验证资金和状态，在界面验证真实操作。

## Approval
- Status: approved
- Approved by: user（原始请求及逐格配图请求）
- Approved at: 2026-11-15
- Approved version: v2
- Approved scope: 制作大富翁、生成卡片并为每个棋盘格生成插画。

## Steps
### Step 1 — Implement and verify
- Goal: 交付带卡片插画的本地大富翁游戏。
- Dependencies: main 上的棋室结构和静态服务。
- Files: `yatuan-companion/dist/`、`tests/`、`README.md`。
- Implementation checklist:
  - [ ] 完成规则、两种模式、卡片界面、16 格插画和棋室入口。
  - [ ] 运行规则测试与语法检查，验证桌面和移动操作。
  - [ ] 提交至用户的 zt 分支。
- Acceptance: 两种模式均可完成对局，两类卡片及 16 个格子的插画可见，规则与资金正确。
- Verification: Node 测试和浏览器检查。
- Rollback: 回退本次提交。
- Status: in_progress

## Checkpoints
已从最新 main 建立独立工作树；事件卡和地产卡已生成，逐格插画生成中。

## Verification / Review
待执行。

## Change Log
- 2026-11-15 v1 — 依用户请求开始开发。
- 2026-11-15 v2 — 按用户追加要求，为每个棋盘格生成对应插画。

## Follow-ups
跨设备联机及存档不在本次范围。

## Version History
- v1 — 游戏及卡片。
- v2 — 增加 16 格逐格插画。
