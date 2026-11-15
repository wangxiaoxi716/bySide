# Plan — 大富翁双人模式伙伴头像
> Task version: v1
> Status: completed

No spec required — 仅为现有角色映射添加静态图片，不更改游戏状态或窗口协议。

## Reference Pointers
- `yatuan-companion/dist/monopoly-assets.js`、`monopoly.js`、`game-ar-view.js` 与 `monopoly-art.md`。
- 同一任务工作树 `bySide-monopoly`、本地分支 `codex/monopoly-avatars`，基线 `7263433`。

## Related Tasks
- 依赖 `TaskFlowDocs/2026-11-15-monopoly-avatars/` v1 的玩家和芽团头像及展示映射；本任务单独新增双人模式伙伴。

## Skills / Tools Used
- [PRD] `imagegen` — 参照已有头像生成可辨认的羊毛毡伙伴形象。
- [Plan] Unaided — 复用现有模式映射和图片样式。
- [Plan Review] Unaided — 对照两种模式和投影输出核验。
- [Test] `browser:control-in-app-browser` — 验证单人和双人模式头像资源与实际展示。

## Preconditions
- [x] 用户确认是双人模式的伙伴。
- [x] 已保留前一项头像更改的本地回滚点。

## Plan Review
- Verdict: sound
- Coverage: Step 1 保存并接入头像；Step 2 检验单人和双人身份、图片与投影。
- Verifiability: 检查图片资源、两种模式的头像映射和渲染结果。
- Layer ownership: 修改展示层的角色映射，不改变游戏规则或伪造状态。

## Approval
- Status: approved
- Approved by: user（直接请求优化并确认双人模式伙伴）
- Approved at: 2026-11-15
- Approved version: v1
- Approved scope: 双人模式伙伴头像生成及接入。

## Steps
### Step 1 — 伙伴头像和接入
- Goal: 将「友」字标记替换为配套插画。
- Dependencies: 已有玩家和芽团头像。
- Files: 大富翁头像资源、`dist/monopoly-assets.js` 和头像说明。
- Implementation checklist:
  - [x] 保存原图与网页尺寸图片。
  - [x] 双人模式使用伙伴头像并保持单人芽团映射。
- Acceptance: 玩家栏、棋盘和 AR 投影都按模式显示对应人物。
- Verification: 角色映射及资源加载自动测试。
- Rollback: 回退到本地基线 `7263433`。
- Status: done

### Step 2 — 检查
- Goal: 验证模式切换与图片加载。
- Dependencies: Step 1。
- Files: `tests/`、浏览器中的本地游戏页面。
- Implementation checklist:
  - [x] 检查两种模式和 AR 头像输出。
  - [x] 记录图片与提示词。
- Acceptance: 相关测试通过、浏览器可加载图片。
- Verification: `npm run check`、相关 `node --test`、本地页面检查。
- Rollback: 同上。
- Status: done

## Checkpoints
- 伙伴头像已通过内置 ImageGen 生成，并接入游戏和投影。

## Verification / Review
- `npm run check`、`git diff --check` 和大富翁、会话、AR 相关的 31 项测试通过。
- 本地浏览器确认双人模式的伙伴头像在玩家栏和棋盘加载，单人模式仍显示芽团；物理投影设备未调试。

## Change Log
- 2026-11-15 v1 — 用户确认优化双人模式伙伴。
- 2026-11-15 — 完成伙伴图像、模式映射和相关检查。
- 2026-11-15 — 用户要求推送并合并；将伙伴头像同步到 main 新增的基座入口并验证。

## Follow-ups
如需真人外貌，可在获得参考照片后另行调整。

## Version History
- v1 — 已实现，等待用户查看。
