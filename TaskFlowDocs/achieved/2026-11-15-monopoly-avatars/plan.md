# Plan — 大富翁玩家与芽团头像
> Task version: v1
> Status: completed

No spec required — 现有展示层中新增静态图像与角色映射，不改变游戏规则或同步协议。

## Reference Pointers
- `yatuan-companion/monopoly-art.md`、`dist/assets/yatuan-reference.png`、`dist/monopoly.js`、`dist/game-ar-view.js`。
- 本地任务分支 `codex/monopoly-avatars`，基于最新 `origin/main` 的 `7863818`。

## Related Tasks
- `TaskFlowDocs/2026-11-15-yatuan-monopoly/` v3：原有大富翁游戏；新增独立头像素材。
- `TaskFlowDocs/achieved/2026-11-15-game-ar-projection/` v1：复用现有 AR 投影展示。

## Skills / Tools Used
- [PRD] `imagegen` — 根据芽团原设及棋盘图生成两个羊毛毡角色头像。
- [Plan] Unaided — 考虑单人、双人及投影中的角色身份与资源加载。
- [Plan Review] Unaided — 检查验收、映射与测试范围。
- [Test] `browser:control-in-app-browser` — 验证大富翁界面头像加载、棋盘标记及双人模式。

## Preconditions
- [x] 用户明确要求生成玩家和芽团头像。
- [x] 未使用用户照片；继续遵守暂停手机设备调试的要求。

## Plan Review
- Verdict: sound
- Coverage: Step 1 完成头像及两个界面接入，Step 2 检查资源与角色模式。
- Verifiability: 自动测试检查模式身份、文件与投影输出；图像已目视检查。
- Layer ownership: 展示层读取明确的角色头像，保留规则核心与现有状态字段。

## Approval
- Status: approved
- Approved by: user（直接要求生成头像；使用位置由助手依据游戏上下文确定）
- Approved at: 2026-11-15
- Approved version: v1
- Approved scope: 生成并接入大富翁玩家与芽团头像。

## Steps
### Step 1 — 图片与展示
- Goal: 保存并接入两个风格一致的头像。
- Dependencies: 内置 ImageGen，原有大富翁与 AR 视图。
- Files: `yatuan-companion/dist/assets/monopoly/avatars/`、大富翁与 AR 展示文件。
- Implementation checklist:
  - [x] 保存两张生成图与适合网页的图像资源。
  - [x] 将单人模式头像接入玩家面板、棋盘标记和 AR 投影，保留双人标识。
- Acceptance: 两个角色的头像与真实身份对应，双人模式不显示错误的芽团身份。
- Verification: 资源和模式映射、投影渲染检查。
- Rollback: 删除新增头像文件并回退本任务代码更改。
- Status: done

### Step 2 — 检查和说明
- Goal: 验证图片、模式和投影并记录生成提示词。
- Dependencies: Step 1。
- Files: `tests/`、`monopoly-art.md`。
- Implementation checklist:
  - [x] 运行相关自动检查。
  - [x] 记录原图、运行图和提示词。
- Acceptance: 图片资源存在、加载引用正确、游戏和投影相关测试通过。
- Verification: `npm run check` 和相关 `node --test`。
- Rollback: 同上。
- Status: done

## Checkpoints
- 两张头像已由内置 ImageGen 分别生成并接入；原图与网页图均保存在项目内。

## Verification / Review
- `npm run check`、`git diff --check` 通过；大富翁规则、会话与 AR 投影共 31 项相关测试通过。
- 在本地浏览器核验玩家栏和棋盘的两张图片均加载，双人模式中的第二位玩家保留「友」标识。
- 已检查生成原图及 384×384 网页图；物理摄像头和投影设备依用户要求未调试。

## Change Log
- 2026-11-15 v1 — 按用户请求生成并接入头像。
- 2026-11-15 — 完成头像、投影接入和无硬件检查；保留通用玩家形象说明。
- 2026-11-15 — 用户要求推送并合并；将头像同步到 main 新增的基座入口，相关测试和浏览器资源检查通过。

## Follow-ups
如用户希望贴近本人外貌，可在提供参考照片后另行调整。

## Version History
- v1 — 完成实现，等待用户查看。
