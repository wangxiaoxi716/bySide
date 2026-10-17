#!/usr/bin/env python3
"""Optional, local-only black-stone detector. No model means no detections."""

import argparse
import base64
import binascii
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


DEFAULT_ORIGIN = "http://127.0.0.1:4173"
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 4_000_000
DATA_URL = re.compile(r"^data:image/(?:jpeg|png|webp);base64,(.+)$", re.DOTALL)


class ImageValidationError(ValueError):
    pass


def parse_classes(values):
    """Accept repeated CLI arguments and comma-separated exact names or IDs."""
    selectors = []
    for value in values or []:
        for item in value.split(","):
            item = item.strip()
            if not item:
                raise ValueError("--classes 不能包含空类别。")
            selector = int(item) if item.isdecimal() else item
            if selector not in selectors:
                selectors.append(selector)
    return selectors


def normalize_names(names):
    if isinstance(names, (list, tuple)):
        names = dict(enumerate(names))
    if not isinstance(names, dict) or not names:
        raise ValueError("模型没有提供有效的类别名称。")
    result = {}
    for key, value in names.items():
        key = int(key)
        if key < 0 or not isinstance(value, str) or not value.strip():
            raise ValueError("模型类别信息无效。")
        result[key] = value
    return result


def resolve_classes(selectors, names):
    if not selectors:
        raise ValueError("请用 --classes 明确指定模型里代表黑色棋子的类别 ID 或名称。")
    selected = []
    for selector in selectors:
        if isinstance(selector, int):
            matches = [selector] if selector in names else []
        else:
            matches = [key for key, value in names.items() if value == selector]
        if len(matches) != 1:
            raise ValueError("指定的黑子类别不存在或不唯一；请检查 /health 的 classes。")
        if matches[0] not in selected:
            selected.append(matches[0])
    return selected


def validate_origin(origin):
    """Origin values are exact, loopback-only origins without a path."""
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except (ValueError, TypeError):
        return False
    return (
        parsed.scheme in ("http", "https")
        and parsed.hostname in ("localhost", "127.0.0.1", "::1")
        and not parsed.username and not parsed.password
        and not parsed.path and not parsed.query and not parsed.fragment
        and port is not None and 1 <= port <= 65535
        and origin == "%s://%s" % (parsed.scheme, parsed.netloc)
    )


def decode_image(data_url):
    if not isinstance(data_url, str):
        raise ImageValidationError("image 必须是 JPEG、PNG 或 WebP 的 base64 data URL。")
    match = DATA_URL.fullmatch(data_url)
    if not match:
        raise ImageValidationError("仅接受内存中的 JPEG、PNG 或 WebP data URL，不接受文件路径或远程 URL。")
    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except (ValueError, binascii.Error):
        raise ImageValidationError("图片 base64 无效。")
    if not raw or len(raw) > MAX_BODY_BYTES:
        raise ImageValidationError("图片为空或超过大小限制。")
    # Pillow is optional until a real model is configured.
    from PIL import Image, UnidentifiedImageError
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as original:
                width, height = original.size
                if (original.format not in ("JPEG", "PNG", "WEBP")
                        or width <= 0 or height <= 0
                        or width * height > MAX_IMAGE_PIXELS):
                    raise ImageValidationError("图片必须是 JPEG、PNG 或 WebP，且不超过 400 万像素。")
                # Do not rotate: coordinates must match the browser's camera canvas.
                original.load()
                return original.convert("RGB")
    except (UnidentifiedImageError, OSError, SyntaxError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageValidationError("无法解码图片，或图片超过像素限制。")


def load_ultralytics(model_path):
    # The supplied model must already exist. Never install optional dependencies
    # or resolve a bare model name by downloading weights at runtime.
    os.environ["YOLO_AUTOINSTALL"] = "false"
    os.environ["YOLO_VERBOSE"] = "false"
    from ultralytics import YOLO
    from ultralytics.utils import SETTINGS
    SETTINGS.update({"sync": False})
    model = YOLO(str(model_path), task="detect")
    if getattr(model, "task", "detect") != "detect":
        raise ValueError("需要目标检测模型，不能使用分类、分割或姿态模型。")
    return model


class YoloEngine:
    def __init__(self, model_path=None, selectors=None, loader=load_ultralytics,
                 image_decoder=decode_image):
        self.model_path = model_path
        self.selectors = selectors or []
        self.loader = loader
        self.image_decoder = image_decoder
        self.model = None
        self.names = {}
        self.selected_ids = []
        self.ready = False
        self.code = "model_not_configured"
        self.reason = "还没有配置棋子识别模型；摄像头标定可以使用，YOLO 自动识别尚未就绪。"
        self._prepared = False

    def prepare(self):
        if self._prepared:
            return
        self._prepared = True
        if not self.model_path:
            return
        raw_path = str(self.model_path)
        if "://" in raw_path or raw_path.startswith("//"):
            self.code, self.reason = "invalid_model", "只允许已存在的本机 .pt 或 .onnx 文件，不下载模型。"
            return
        path = Path(raw_path).expanduser()
        if path.suffix.lower() not in (".pt", ".onnx") or not path.is_file():
            self.code, self.reason = "invalid_model", "找不到本机 .pt 或 .onnx 模型文件；不会自动下载。"
            return
        try:
            self.model = self.loader(path.resolve())
            self.names = normalize_names(self.model.names)
        except ModuleNotFoundError as exc:
            dependency = exc.name.split(".")[0] if exc.name else "推理依赖"
            self.code = "missing_dependency"
            self.reason = "缺少 %s；请在虚拟环境中安装 vision/requirements.txt。" % dependency
            return
        except Exception:
            self.code = "model_load_failed"
            self.reason = "模型加载失败。请确认它是可由 Ultralytics 加载的本机检测模型，且依赖齐全。"
            return
        try:
            self.selected_ids = resolve_classes(self.selectors, self.names)
        except ValueError as exc:
            self.code, self.reason = "classes_not_configured", str(exc)
            return
        self.ready, self.code, self.reason = True, "ready", "黑子识别模型已就绪。"

    def health(self):
        return {
            "ready": self.ready, "engine": "yolo",
            "model": Path(str(self.model_path)).name if self.model_path else None,
            "code": self.code, "reason": self.reason,
            "classes": [{"id": key, "name": value} for key, value in sorted(self.names.items())],
            "selectedClasses": [{"id": key, "name": self.names[key]} for key in self.selected_ids],
            "maxImagePixels": MAX_IMAGE_PIXELS, "maxBodyBytes": MAX_BODY_BYTES,
        }

    def detect(self, data_url, confidence):
        image = self.image_decoder(data_url)
        try:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise ImageValidationError("图片超过 400 万像素限制。")
            results = self.model.predict(
                source=image, conf=confidence, classes=self.selected_ids,
                device="cpu", imgsz=640, max_det=225,
                save=False, save_txt=False, save_crop=False,
                show=False, verbose=False, stream=False,
            )
            detections = []
            for result in results:
                if result.boxes is None:
                    continue
                boxes = result.boxes.xywh.cpu().tolist()
                scores = result.boxes.conf.cpu().tolist()
                ids = result.boxes.cls.cpu().tolist()
                for box, score, class_id in zip(boxes, scores, ids):
                    class_id = int(class_id)
                    values = [float(value) for value in box] + [float(score)]
                    if (class_id not in self.selected_ids or len(box) != 4
                            or not all(math.isfinite(value) for value in values)
                            or score < confidence or score > 1):
                        continue
                    x, y, box_width, box_height = values[:4]
                    if not (0 <= x < width and 0 <= y < height and box_width > 0 and box_height > 0):
                        continue
                    detections.append({
                        "x": x, "y": y, "width": box_width, "height": box_height,
                        "confidence": float(score), "className": "black_stone",
                        "sourceClassId": class_id, "sourceClassName": self.names[class_id],
                    })
            return {"ready": True, "engine": "yolo", "width": width,
                    "height": height, "detections": detections[:225]}
        finally:
            image.close()


class ChessHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_server(engine, port=4181, origins=None):
    origins = tuple(origins or (DEFAULT_ORIGIN,))
    if not all(validate_origin(origin) for origin in origins):
        raise ValueError("--origin 必须是带端口的本机 http/https Origin，不含路径。")
    engine.prepare()
    inference_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "ChessVision/1.0"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            # Camera frames, body contents and per-request URLs are never logged.
            pass

        def reply(self, status, payload=None):
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8") if payload is not None else b""
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                # Needed by browsers that preflight local-network requests.
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if encoded:
                self.wfile.write(encoded)

        def error(self, status, code, reason):
            self.reply(status, {"ready": False, "engine": "yolo", "error": code, "reason": reason})

        def guard(self, require_origin=False):
            port = self.server.server_port
            allowed_hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port, "[::1]:%d" % port}
            if self.headers.get("Host") not in allowed_hosts:
                self.error(403, "host_not_allowed", "仅接受本机 Host。")
                return False
            origin = self.headers.get("Origin")
            if (origin is not None and origin not in origins) or (require_origin and origin is None):
                self.error(403, "origin_not_allowed", "网页 Origin 不在本机白名单中。")
                return False
            return True

        def do_GET(self):
            if not self.guard():
                return
            if self.path == "/health":
                self.reply(200, engine.health())
            else:
                self.error(404, "not_found", "仅支持 /health 和 /detect。")

        def do_OPTIONS(self):
            if not self.guard(require_origin=True):
                return
            if self.path not in ("/health", "/detect"):
                self.error(404, "not_found", "未知接口。")
                return
            requested = self.headers.get("Access-Control-Request-Method", "")
            headers = self.headers.get("Access-Control-Request-Headers", "")
            if requested not in ("GET", "POST") or any(part.strip().lower() != "content-type" for part in headers.split(",") if part.strip()):
                self.error(403, "preflight_not_allowed", "只允许 GET/POST 和 Content-Type 请求头。")
                return
            self.reply(204)

        def do_POST(self):
            if not self.guard(require_origin=True):
                return
            if self.path != "/detect":
                self.error(404, "not_found", "未知接口。")
                return
            if self.headers.get("Transfer-Encoding"):
                self.error(400, "invalid_body", "不接受流式请求体。")
                return
            if self.headers.get_content_type() != "application/json":
                self.error(415, "invalid_content_type", "请发送 application/json。")
                return
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                length = -1
            if length < 0:
                self.error(411, "length_required", "需要有效的 Content-Length。")
                return
            if length > MAX_BODY_BYTES:
                self.error(413, "body_too_large", "请求体不能超过 4 MiB，请缩小摄像头画面。")
                return
            if not engine.ready:
                self.error(503, engine.code, engine.reason)
                return
            if not inference_lock.acquire(blocking=False):
                self.error(429, "detector_busy", "上一张画面仍在识别，请稍后重试。")
                return
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("请求体不完整。")
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise ValueError("请求体必须是 JSON 对象。")
                confidence = payload.get("confidence", 0.6)
                if (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
                        or not math.isfinite(confidence) or not 0 < confidence <= 1):
                    raise ValueError("confidence 必须是大于 0、且不超过 1 的数。")
            except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
                self.error(400, "invalid_body", "JSON 无效。")
            except ValueError as exc:
                self.error(400, "invalid_body", str(exc))
            except (TimeoutError, OSError):
                self.error(408, "body_timeout", "读取请求体超时。")
            else:
                try:
                    self.reply(200, engine.detect(payload.get("image"), float(confidence)))
                except ImageValidationError as exc:
                    self.error(422, "invalid_image", str(exc))
                except Exception:
                    self.error(503, "inference_failed", "模型推理失败，请检查模型格式、依赖和图像尺寸。")
            finally:
                inference_lock.release()

    server = ChessHTTPServer(("127.0.0.1", port), Handler)
    server.inference_lock = inference_lock
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description="芽团五子棋本机 YOLO 黑子识别服务（不自动下载模型）")
    parser.add_argument("--model", help="已存在的本机 .pt 或 .onnx 检测模型")
    parser.add_argument("--classes", action="append", help="黑子类别 ID/名称，可重复或逗号分隔；必须明确指定")
    parser.add_argument("--port", type=int, default=4181)
    parser.add_argument("--origin", action="append", help="允许的精确本机网页 Origin，可重复")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port 必须在 1–65535 之间。")
    try:
        engine = YoloEngine(args.model, parse_classes(args.classes))
        server = create_server(engine, args.port, args.origin)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print("棋子识别服务：http://127.0.0.1:%d" % args.port, flush=True)
    print(engine.reason, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
