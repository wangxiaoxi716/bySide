# Spec — 游戏桌面 AR 投影
> Task version: v1

## Objective and Success Criteria
三种游戏使用同一个可标定的 AR 画面并实时显示各自状态。

## Architecture Boundaries and Responsibilities
- 游戏页面拥有规则与权威状态；已有 `createChessSession` 负责同浏览器快照通信。
- 投影页面只消费快照并渲染，游戏操作仍由原游戏页面负责。
- `camera-overlay.mjs` 继续负责视频、追踪与 510×300 透视映射，不改动设备流程。
- 投影入口按游戏和房间选择投影内容，并可复用已有投影页面。

## Project Structure / Affected Files
三个游戏的页面和控制器、投影页面和脚本、新的投影展示样式/模块、相关测试与使用说明。

## Interfaces, Data Flow, and Contracts
- 游戏入口传递经过校验的游戏种类与房间 ID；同源消息用于向已打开的投影页切换内容。
- 五子棋和井字棋复用现有房间快照；大富翁创建独立房间并发布包含游戏状态与当前卡片的快照。
- 投影页同一时间仅订阅一个房间，切换时关闭旧订阅，离线时保留最后画面并提示。
- 游戏画面在同一个 510×300 投影根元素内呈现，以复用现有 AR 几何变换。

## Invariants and Compatibility
棋盘规则和原有独立投影/家人端不变；会话仅同源同浏览器可用；重开不产生重复房间；不传输摄像头帧。

## Validation and Error Semantics
非法游戏名、房间 ID 或非同源消息被拒绝；窗口关闭或断开时显示明确状态，保持最后一帧。

## Code and Test Constraints
游戏投影只读；使用受限数据渲染并转义文字。自动测试覆盖游戏状态展示、入口选择、切换与会话；不启动真实摄像头。

## Design Decisions and Alternatives
复用投影根元素和现有会话，避免复制摄像头追踪或为每款游戏创建新的设备会话。

## Open Questions
无。
