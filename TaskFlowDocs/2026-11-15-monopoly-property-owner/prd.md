# 大富翁房产归属标识
> Task version: v1
> Status: checking

## Goal
让购买后的房间能够通过醒目的图形，直接看出是哪位玩家的。

## Task Kind
- Kind: capability

## Background / Confirmed Facts
- 目前游戏在已购买的格子上仅显示很小的“你的／伙伴的”文字，不易辨认。
- 玩家、芽团和双人伙伴已有不同的头像；棋子本身也使用圆形头像。
- 游戏和桌面投影分别有旧入口与基座入口，需要保持一致。

## Requirements
- 已购买格子显示带房屋轮廓的房主头像徽章及对应颜色的醒目边框；普通移动棋子仍为圆形。
- 人类、芽团与双人伙伴的标识对应正确；无人购买的格子不显示标识。
- 桌面投影同步展示房主头像和颜色；保留无障碍文本描述。
- 不改变购买、收费、移动和结算规则。

## Acceptance Criteria
- 买下房间后立即出现清晰、可区分的头像房屋标记，玩家栏颜色可对照。
- 投影和两套前端入口均一致；窗口较小时头像和棋子仍可分辨。
- 相关语法和游戏测试通过，浏览器验证购买后的展示。

## External Facts
- Depends on external facts: no，使用现有游戏和图片。

## In Scope
已有棋盘、投影的房产标记、图例与必要检查。

## Out of Scope
新增地产规则和实体摄像头调试。

## Risks / Deferred Items
实体投影设备暂不调试。

## Open Questions
无。
