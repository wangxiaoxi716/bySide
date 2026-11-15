# Plan — 游戏桌面 AR 投影
> Task version: v1
> Status: completed

## Spec Pointers
- `spec.md`

## Reference Pointers
- `yatuan-companion/README.md`、`dist/projection.js`、`dist/camera-overlay.mjs`、`dist/chess-session.js` 和各游戏页面。
- Git 基线 `3394e8a`；工作树 `bySide-monopoly`，独立分支 `codex/game-ar-projection`。
- 无适用的 AGENTS、CONTRIBUTING 或 CODE_STYLE；原工作树干净。
- 交付目标为 GitHub `wangxiaoxi716/bySide` 的 `zt` 和 `main`；仓库未发现 PR 模板，`main` 合并触发 Cloudflare 自动部署。

## Related Tasks
- `TaskFlowDocs/2026-11-15-tic-tac-toe/` v1：既有井字棋；本任务新增跨游戏投影能力。
- `TaskFlowDocs/2026-11-15-yatuan-monopoly/` v3：既有大富翁；本任务新增跨游戏投影能力。

## Skills / Tools Used
- [PRD] Unaided — considered: 用户已确定目标与现有 AR 页面，依据仓库核对现状。
- [Spec] Unaided — considered: 复用游戏会话和 AR 映射，不调整摄像头接入。
- [Plan] Unaided — considered: 按会话、渲染、入口与验证拆分。
- [Plan Review] Unaided — considered: 对照验收和实现边界检查方案。

## Preconditions
- [x] 已检查当前代码、分支和相关任务；用户明确要求修改三个游戏的 VR/AR 投影。
- [x] 用户要求暂停手机设备修复与调试；不进行真实摄像头操作。

## Plan Review
- Verdict: sound
- Coverage: Step 1 实现各游戏的投影、切换和断线；Step 2 核验同步、兼容和文档。
- Verifiability: 自动会话及投影渲染检查验证快照和切换，硬件效果明确留待设备接入后验证。
- Layer ownership: 更新拥有大富翁状态的页面以发布快照，在投影页面消费快照；不修改规则或绕过测试。

## Approval
- Status: approved
- Approved by: user（直接要求实施；具体方案由助手确定）
- Approved at: 2026-11-15
- Approved version: v1
- Approved scope: 让三个现有游戏在现有桌面 VR/AR 投影显示；暂停手机连接修复与调试。

## Steps

### Step 1 — 接入游戏投影
- Goal: 完成三个游戏与现有 AR 画面的实时连接和入口。
- Dependencies: 现有会话、游戏规则和 AR 投影映射。
- Files: `yatuan-companion/dist/` 中的投影和游戏页面与脚本。
- Implementation checklist:
  - [x] 新增三个游戏的投影入口和状态展示。
  - [x] 复用已打开的投影窗口并处理状态同步、切换、断连和返回陪伴。
- Acceptance: 三种游戏可在同一个 AR 根画面投影，保留既有控制能力。
- Verification: 检查投影模块、会话同步和三个游戏页面。
- Rollback: 回退本任务工作树更改，基线 `3394e8a`。
- Status: done

### Step 2 — 检查与说明
- Goal: 检查规则和会话兼容性并记录使用方法。
- Dependencies: Step 1。
- Files: `yatuan-companion/tests/`、`yatuan-companion/README.md`。
- Implementation checklist:
  - [x] 运行语法检查及覆盖相关游戏与投影的自动测试。
  - [x] 记录打开方式、同浏览器限制和实际设备未测试的范围。
- Acceptance: 主要状态与同步可由无摄像头的检查验证。
- Verification: `npm run check` 和相关 `node --test`。
- Rollback: 同上。
- Status: done

## Checkpoints
- 用户授权实现；不执行设备调试。
- 用户明确要求将当前实现推送至 `zt` 并合并到 `main`；真实设备验收仍依用户要求暂缓。

## Verification / Review
- `npm run check` 通过；三个游戏规则、投影几何、房间同步和新增 AR 投影的 72 项测试通过。
- `git diff --check` 通过；本地服务可读取新增投影脚本并返回 JavaScript 类型。
- 新增测试使用模拟的窗口和广播通道验证切换、重连状态、快照、断线及输出转义；未在实际浏览器或摄像头上调试。
- 未运行完整测试套件；实际摄像头连接、物理投影和对位依用户要求暂缓。
- 交付前复核：`npm run check` 及部署工作流要求的 `node --test tests/cloudflare*.test.mjs` 通过（16 项）；`git diff --check` 通过。

## Change Log
- 2026-11-15 v1 — 按用户要求开始跨游戏 AR 投影整合。
- 2026-11-15 — 实现游戏投影与本机状态同步；记录无设备自动检查结果。
- 2026-11-15 — 用户请求推送 `zt` 并合并 `main`，补充部署流程检查。

## Follow-ups
连接好摄像头和投影设备后，再验收实物画面和对位。

## Version History
- v1 — 功能已实现，等待用户在设备可用时验收。
