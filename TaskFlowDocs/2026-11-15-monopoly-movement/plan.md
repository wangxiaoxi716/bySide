# Plan — 大富翁掷骰和逐格移动
> Task version: v1
> Status: checking

## Spec Pointers
- `spec.md`

## Reference Pointers
- 工作树 `bySide-monopoly`，本地分支 `codex/monopoly-avatars`，基线 `fcafb5f`。

## Related Tasks
- 依赖 `2026-11-15-monopoly-avatars` v1 与 `2026-11-15-monopoly-partner-avatar` v1 的人物头像。

## Skills / Tools Used
- [Plan] `taskflow`；[Test] `browser:control-in-app-browser` 进行本地游戏验证。

## Preconditions
- [x] 用户直接要求骰子转动与逐格行走。
- [x] 已建立本地头像任务回滚点。

## Plan Review
- Verdict: sound
- Coverage: 展示帧、规则结算与投影分别处理。
- Verifiability: 自动测试与本地浏览器观察。
- Layer ownership: 动画不修改规则层或虚构游戏状态。

## Approval
- Status: approved
- Approved by: user（直接要求增加掷骰和行走过程）
- Approved at: 2026-11-15
- Approved version: v1
- Approved scope: 大富翁掷骰、逐格行走和投影同步；未请求推送。

## Steps
### Step 1 — 动画和同步
- Goal: 逐格前进并在到达后结算。
- Dependencies: 现有规则和投影。
- Files: 大富翁与投影展示层及测试。
- Implementation checklist:
  - [x] 增加掷骰、前进动画及操作锁定。
  - [x] 同步投影视图并处理减少动画设置。
- Acceptance: 人类和芽团路径一致，原规则不变。
- Verification: 单元测试与投影测试。
- Rollback: 回到本地基线 `fcafb5f`。
- Status: done

### Step 2 — 验证
- Goal: 核对游戏和投影展示。
- Dependencies: Step 1。
- Files: 测试与本地页面。
- Implementation checklist:
  - [x] 运行语法和相关自动测试。
  - [x] 在本地浏览器验证动画与交互。
- Acceptance: 相关检查通过。
- Verification: `npm run check`、相关 `node --test`、浏览器。
- Rollback: 同上。
- Status: done

## Checkpoints
- 本地基线 `fcafb5f` 保存了伙伴头像；动画改动保留在工作树，尚未推送。

## Verification / Review
- `npm run check`、`git diff --check` 通过；大富翁动画、规则、棋室和投影 35 项相关测试通过。
- 浏览器验证双人模式伙伴连续经过 1、2、3、4 格；芽团也完整播放掷骰与前进过程；卡片在到达后才出现。
- 使用不访问摄像头的临时投影测试页验证跨窗口同步：掷骰、4 格位置和移动动画与游戏窗口一致；已清理临时文件。
- 物理摄像头和实体投影按用户要求未调试；完整测试套件未在本次运行。
- 新测试覆盖规则层真实点数、规则状态与展示帧的边界；没有改动现有预期以掩盖错误。

## Change Log
- 2026-11-15 v1 — 用户请求在已有伙伴头像工作上加入骰子与行走动画。
- 2026-11-15 — 实现并验证动画和投影同步，等待用户查看。

## Follow-ups
实体摄像头投影测试留待用户需要时进行。

## Version History
- v1 — 已实现，等待用户查看。
