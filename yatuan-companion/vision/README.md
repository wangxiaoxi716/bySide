# 实物落子：本机 YOLO 识别服务

这个目录为棋盘投影提供**可选的本机黑子检测接口**。它不会修改原来的聊天、摄像头陪伴服务或 `.env`，也不需要 AI API Key。

目前项目**没有训练好的黑子识别模型**。没有模型时，服务可以启动，`/health` 会明确返回 `ready: false`。界面的四角标定、225 个交叉点坐标和手动标点验证可以先使用；不能把这些验证当作 YOLO 已经识别了真实棋子。

## 先运行没有模型的服务

从 `yatuan-companion` 项目目录运行：

```sh
python3 vision/chess_yolo_service.py
```

此时无需安装任何机器学习依赖。保持这个终端开着，原来运行网页的终端也保持运行。服务只监听 `127.0.0.1:4181`；在浏览器打开 [本机健康检查](http://127.0.0.1:4181/health) 能看到模型尚未配置的原因。

## 有黑子检测模型之后

建议使用 Python 3.10 或 3.11 创建独立虚拟环境。以下安装会下载推理依赖，首次安装可能较大；它不会下载棋子模型。

```sh
python3 -m venv "$HOME/.venvs/yatuan-vision"
source "$HOME/.venvs/yatuan-vision/bin/activate"
python -m pip install -r vision/requirements.txt
python vision/chess_yolo_service.py \
  --model /你的本机路径/black-stones.pt \
  --classes black_stone
```

虚拟环境放在项目外，避免把大量依赖一起上传到代码仓库。也支持由 Ultralytics 导出的检测模型 `.onnx`。如果模型的黑子类别是 ID `1`，改成 `--classes 1`。多个黑子类别可以写 `--classes black_stone,black_stone_reflection`，或者重复 `--classes`。必须明确指定模型中实际代表**黑色棋子**的类别；不能默认把通用模型的第 0 类当黑子。名称区分大小写，`/health` 的 `classes` 会列出模型的类别，`selectedClasses` 是当前启用的黑子类别。

`--model` 必须是已经存在的本机文件。程序拒绝模型 URL、缺失文件和其他后缀，并关闭运行时依赖自动安装。只加载你信任来源的模型；尤其 `.pt` 是可执行反序列化格式。程序不下载预训练权重，也不保证任意来源的 ONNX 都能兼容 Ultralytics。

网页默认使用 `http://127.0.0.1:4173`。如果你实际用的是 `http://localhost:4173`，需要精确允许它：

```sh
python vision/chess_yolo_service.py \
  --model /你的本机路径/black-stones.pt --classes black_stone \
  --origin http://127.0.0.1:4173 --origin http://localhost:4173
```

网页的识别服务地址固定为 `http://127.0.0.1:4181`，请使用默认端口。CLI 的 `--port` 仅供单独调试；改变端口时需同时调整 `dist/chess-vision-ui.js` 的 `SERVICE`。该接口只允许带端口的本机 Origin，不开放给公网或其他设备。它适用于“电脑接投影仪 + USB 摄像头”的本机链路；手机远程访问这个服务不在本次实现范围内。

## 从真实落子到投影的一步

1. 电脑网页持有权威棋局，投影窗口显示同一盘棋；投影棋盘保持居中。
2. 摄像头需要同时看清棋盘四角和棋子。根据相机画面标定最外侧四个交叉点，不是棋盘装饰边框。改变相机、投影仪、缩放或棋盘位置后重新标定。
3. 前端把一张摄像头图片送到 `/detect`。本服务只给出黑子的边界框中心，不识别格子或修改棋局。
4. 前端用四角映射得到 225 个交叉点在相机里的坐标，把新黑子中心匹配到最近的合法交叉点，处理重复棋子、距离过远和未稳定的检测。
5. 确认是轮到人的合法落子后，电脑棋局添加黑子，芽团再计算白子，两个窗口同步更新。网页点击落子也走同一个权威棋局。

投影里的黑子图案与真实黑色棋子可能同时出现在相机画面里，模型必须能区分它们。需要用你的投影亮度、桌面材质和相机角度训练/验证，不能只用普通棋盘照片推断实物识别效果。标定和坐标匹配正确，不代表模型一定识别准确。

## 模型准备

建议至少标注 `black_stone`；可以同时标注 `white_stone`、`hand` 和 `projected_stone` 来提供容易混淆的场景，但接口只输出你明确选择的黑子类别。训练集需要包含真实棋子、投影棋子图案、手遮挡、反光、阴影、不同位置与亮度，以及没有实物棋子的空棋盘。把一段独立采集的真实演示作为验证数据，不要只检查训练图片。

可参考 [Ultralytics 自定义检测模型文档](https://docs.ultralytics.com/tasks/detect/) 和 [推理输出说明](https://docs.ultralytics.com/modes/predict/)。这里使用原图像素单位的 `xywh`：`x/y` 是边界框中心，不是左上角。没有一个本项目已验证、开箱即用的黑子模型；拿到模型之后还需要在真实设备上验收误检、漏检和重复落子。

## 接口契约

```text
GET /health
200 { ready, engine: "yolo", model, code, reason,
      classes: [{id, name}], selectedClasses: [{id, name}],
      maxImagePixels: 4000000, maxBodyBytes: 4194304 }

POST /detect
Origin: http://127.0.0.1:4173
Content-Type: application/json
{ "image": "data:image/jpeg;base64,...", "confidence": 0.6 }

200 { "ready": true, "engine": "yolo", "width": 1280, "height": 720,
      "detections": [{ "x": 642.2, "y": 351.5, "width": 22, "height": 20,
                       "confidence": 0.93, "className": "black_stone",
                       "sourceClassId": 1, "sourceClassName": "black_stone" }] }
```

`confidence` 范围为 `(0, 1]`，缺省 `0.6`。图片只接受 JPEG、PNG、WebP data URL，JSON 请求体最多 4 MiB，解码后最多 400 万像素。不接受图片 URL、文件路径或上传后落盘。服务不保存相机图片，也不记录请求内容。输入相机画面应与标定画面同方向、同尺寸；服务不自动旋转图片。

错误返回 `{ready:false,engine:"yolo",error,reason}`。常见状态：`403` 来源不允许，`413` 请求太大，`422` 图片无效，`429` 上一帧仍在处理，`503` 模型未就绪或推理失败。前端遇到这些情况应暂停自动落子并展示原因，不能用随机坐标代替检测结果。

## 自检

```sh
python3 -B -m unittest discover -s vision -p 'test_*.py' -v
```

测试使用假模型验证像素坐标、黑子类别过滤、跨域、大小限制、并发和未配置模型时的行为，不需要安装 ML 依赖。它不替代实际 YOLO 模型和 USB 摄像头的现场识别测试。
