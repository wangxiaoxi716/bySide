# 大富翁玩家与芽团头像
> Task version: v1
> Status: completed

## Goal
为大富翁生成与现有小镇画风一致的玩家和芽团头像，并在游戏中使用。

## Task Kind
- Kind: capability

## Background / Confirmed Facts
- 用户要求生成「我」和芽团的大富翁头像，未提供本人照片；玩家头像为原创卡通形象。
- 现有棋盘与卡片采用温暖羊毛毡风格，芽团是奶油色绒毛团子和两片绿叶。
- 大富翁有单人对芽团、双人同屏和桌面 AR 投影。

## Requirements
- 生成两张独立的同风格图片，并保存原图与网页用图片。
- 单人模式中将玩家和芽团头像用于玩家面板和棋盘位置标记，包括 AR 投影。
- 双人模式中保留第二位真人玩家的独立标识，不将其误标为芽团。
- 保持游戏规则、状态同步与页面无障碍名称。

## Acceptance Criteria
- 两张图片均可在项目中读取；玩家与芽团的图像正确对应。
- 大富翁界面与 AR 投影使用同一组头像；双人模式仍区分两名真人。
- 项目语法检查和受影响游戏、投影的自动测试通过。

## External Facts
- Depends on external facts: no
- Why not: 头像角色、游戏状态与投影要求由用户和现有项目素材确定。

## In Scope
生成与接入头像、资源压缩和相关检查。

## Out of Scope
真人肖像还原、第三位头像、手机摄像头调试、远程推送或合并。

## Risks / Deferred Items
玩家头像为通用卡通形象，未依据本人照片；物理摄像头与投影未调试。

## Open Questions
无阻塞问题。
