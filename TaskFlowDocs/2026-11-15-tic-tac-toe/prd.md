# 基于五子棋实现井字棋
> Task version: v1
> Status: checking

## Goal
在 zt 分支增加与现有棋室风格一致的井字棋。

## Task Kind
- Kind: capability

## Background / Confirmed Facts
现有棋室使用原生 HTML、CSS、JavaScript，本地计算对手落子；家人演示使用同源浏览器窗口通信。

## Requirements
- 提供 3×3 棋盘、先手 X、轮流落子、三连胜负和平局。
- 参考五子棋提供芽团陪练、提示、悔棋、重开、规则说明和家人双窗口本机演示。
- 在五子棋棋室提供井字棋入口，保持现有游戏可用。

## Acceptance Criteria
- 棋局合法，结束后不能继续落子，悔棋和重开可以恢复可玩状态。
- 人机和家人演示可完成完整棋局；家人窗口断连或不在可下棋状态时不能落子。
- 常规检查及自动化测试通过，必要时在浏览器核验桌面和移动布局。

## External Facts
- Depends on external facts: no
- Why not: 游戏规则和集成方式可由需求与仓库现有实现确定。

## In Scope
本地棋盘、陪练、同浏览器家人端、棋室入口及验证。

## Out of Scope
真实异地联网、视频通话和实体棋盘摄像头识别。

## Risks / Deferred Items
同浏览器窗口通信与现有棋室一样仅适用于同源环境。

## Open Questions
无阻塞问题。
