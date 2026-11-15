# Plan — 井字棋
> Task version: v1
> Status: checking

No spec required — 独立功能，复用现有棋室样式和窗口通信。

## Reference Pointers
- `yatuan-companion/dist/chess-core.js`、`chess.html`、`chess.js`、`chess-session.js` 和 `tests/chess-core.test.mjs`。
- 仓库没有 CONTRIBUTING、CODE_STYLE、AGENTS 或 TaskFlow 的既有规定；运行方式参见两份 README。
- GitHub `wangxiaoxi716/bySide` 的 `main` 在开始时为 `567a84ab2a22c1f4cb6ef8932e3f53c1c02131db`；任务工作树为 `bySide-zt-work`，分支 `zt`，目标远端 `origin`。

## Related Tasks
无。

## Skills / Tools Used
- [PRD] `GitHub` — purpose: 核对仓库、分支和现有代码；outcome: succeeded；incorporated: 以 main 当前提交为基线。
- [Plan] Unaided — 参照现有棋室分解；considered: 工作拆解与设计。
- [Test] Unaided — 设计游戏规则、对手决策及交互核验；considered: testing strategy。
- [Test] `browser` — purpose: 验证桌面、手机、双窗口与投影；outcome: succeeded；incorporated: 交互和同步结果。

## Preconditions
- [x] 已检查适用的仓库文档和远端目标；没有相关规则冲突。
- [x] 用户明确要求创建 zt 分支并实现井字棋。

## Plan Review
- Verdict: sound
- Coverage: 实现棋盘、陪练、家人窗口和入口后通过自动测试和浏览器核验验收。
- Verifiability: 规则可用单元测试验证，双窗口及视觉布局可用浏览器验证。
- Layer ownership: 测试实际游戏逻辑和页面行为，不修改下游数据掩盖问题。

## Approval
- Status: approved
- Approved by: user（原始开发请求）
- Approved at: 2026-11-15
- Approved version: v1
- Approved scope: 在 zt 分支按现有五子棋方式增加井字棋。

## Steps
### Step 1 — Implement and verify
- Goal: 实现与现有棋室一致的井字棋体验。
- Dependencies: main 的五子棋代码和同源会话通信。
- Files: `yatuan-companion/dist/` 新棋室文件、现有棋室入口、测试和 README。
- Implementation checklist:
  - [x] 实现规则、界面、芽团陪练和家人双窗口演示。
  - [x] 验证规则、交互和已有测试；记录 main 已存在的失败。
- Acceptance: 用户可从五子棋进入井字棋并完整下棋。
- Verification: Node 自动测试、语法检查、浏览器交互检查。
- Rollback: 回退本次提交。
- Status: done

## Checkpoints
从 main 的 `567a84a` 创建 `zt`，已推送空分支。

## Verification / Review
- `npm run check` 通过；井字棋、五子棋核心和窗口会话的 44 项测试通过。
- 完整测试（Node 24，3 秒测试超时）为 203 项通过、5 项失败、1 项取消。未修改的 main 同样复现：演示测试 4 项失败，语音测试 1 项失败和 1 项超时取消；这些问题未在本次变更中修改。
- 浏览器检查了从主页进入、棋类切换、人机落子、悔棋、家人双窗口落子和聊天、投影同步、关闭主棋室后断连、手机选择后确认和获胜后禁用落子。

## Change Log
- 2026-11-15 v1 — 依用户请求开始开发。
- 2026-11-15 — 实现并验证；现有 main 的演示和语音测试问题列为独立后续事项。

## Follow-ups
真实跨设备联机和实体棋盘识别不在本次范围。main 上既有演示与语音测试失败需另行排查。

## Version History
- v1 — 开发中。
