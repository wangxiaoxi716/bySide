# Plan — 大富翁房产归属标识
> Task version: v1
> Status: checking

No spec required — 只调整既有游戏和投影展示，不改变游戏状态及同步协议。

## Reference Pointers
- `yatuan-companion/dist/monopoly.js`、`game-ar-view.js` 和现有玩家头像；基座入口为 `byside-foundation/original-ui`。
- 工作树 `/Users/wujie/Documents/ChatGPT/论文讲解/bySide-monopoly`，分支 `codex/monopoly-avatars`，基线 `05e93be`。

## Related Tasks
- 依赖已归档的大富翁头像与动作任务，不修改其历史。

## Skills / Tools Used
- [Plan] `taskflow` — 记录需求及双入口同步。
- [Test] `browser:control-in-app-browser` — 本地验证实际购买后的图形展示。

## Preconditions
- [x] 用户明确要求房间归属应醒目，并避免依赖小字。
- [x] 现有头像可以区分玩家和两种对手。

## Plan Review
- Verdict: sound
- Coverage: 游戏棋盘、投影、头像映射、双入口与窄屏布局。
- Verifiability: 自动验证未购和已购标识，浏览器验证实际购买后的画面。
- Layer ownership: 展示层读取游戏规则层产生的 owner，不改变状态。

## Approval
- Status: approved
- Approved by: user（直接请求醒目的购买归属图形）
- Approved at: 2026-11-15
- Approved version: v1
- Approved scope: 两个入口中大富翁购买归属的视觉展示及投影。

## Steps
### Step 1 — 实现
- Goal: 为已购买格子增加头像徽章和颜色区分。
- Dependencies: 现有玩家头像及游戏 owner。
- Files: 资源映射、棋盘和投影展示及样式、两套入口。
- Implementation checklist:
  - [x] 房主使用房形头像徽章与颜色边框，棋子继续用圆形头像。
  - [x] 投影与基座入口采用一致样式。
- Acceptance: 已购房间一眼可辨，无主房间不出现标识。
- Verification: 自动测试与浏览器购买操作。
- Rollback: 回退基线 `05e93be` 之后的本任务更改。
- Status: done

### Step 2 — 验证
- Goal: 核对玩家和两种对手的归属显示。
- Dependencies: Step 1。
- Files: 游戏及投影相关测试。
- Implementation checklist:
  - [x] 运行语法、游戏和投影检查。
  - [x] 浏览器查看购买后的标识与窄屏布局。
- Acceptance: 相关检查通过。
- Verification: `npm run check`、相关 `node --test`、浏览器。
- Rollback: 同上。
- Status: done

## Checkpoints
- 两套入口和投影均使用相同的房形头像及绿色／暖橙色边框。

## Verification / Review
- `npm run check` 和 `git diff --check` 通过；原入口相关测试 37 项，基座入口相关测试 27 项通过。
- 本地浏览器实际购买双方房产，确认头像、颜色和留在原地的房主标记；用不访问摄像头的投影测试页核对双方标记。
- 375 像素宽的棋盘布局演示中，房形徽章与圆形棋子可同时显示；临时测试页面已清理。
- 未改动游戏核心状态或计费规则；实体投影设备未调试。

## Change Log
- 2026-11-15 v1 — 用户要求用明显图形标明购买房间的归属。
- 2026-11-15 — 已实现并验证，等待用户查看。

## Follow-ups
实体投影设备测试留待用户需要时进行。

## Version History
- v1 — 已实现，等待用户查看。
