# 大富翁双人模式伙伴头像
> Task version: v1
> Status: checking

## Goal
为大富翁双人模式里的「伙伴」生成独立头像，并替换原有的「友」字标记。

## Task Kind
- Kind: capability

## Background / Confirmed Facts
- 用户确认需要优化的是双人模式里的伙伴。
- 已有玩家和芽团的羊毛毡风格头像；双人模式伙伴目前使用「友」字标记。
- 上一项头像任务未覆盖第三位角色，此任务单独补齐双人模式伙伴。

## Requirements
- 生成一张与现有头像配套、可与玩家及芽团区分的原创伙伴头像。
- 在双人模式中的玩家栏、棋盘标记及 AR 投影中显示伙伴头像。
- 单人模式的第二位角色继续显示芽团，游戏规则与同步协议不变。

## Acceptance Criteria
- 双人模式显示玩家和伙伴两张不同的头像，不显示芽团头像。
- 单人模式仍显示玩家和芽团头像；原图及网页用图片可读取。
- 项目语法检查和受影响游戏、投影测试通过。

## External Facts
- Depends on external facts: no
- Why not: 角色和样式以用户请求及现有项目素材为准。

## In Scope
双人伙伴头像生成、展示、资源和必要验证。

## Out of Scope
本人或伙伴的真人肖像复刻、摄像头设备调试、远程推送。

## Risks / Deferred Items
新伙伴是通用卡通形象；实际物理投影未调试。

## Open Questions
无。
