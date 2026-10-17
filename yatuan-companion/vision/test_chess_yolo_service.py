"""Run with python3 -B -m unittest discover -s vision -p 'test_*.py' -v.

These tests use a fake model; they do not download weights or require ML packages.
"""

import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

import chess_yolo_service as vision


class FakeTensor:
    def __init__(self, value):
        self.value = value

    def cpu(self):
        return self

    def tolist(self):
        return self.value


class FakeBoxes:
    xywh = FakeTensor([[320, 240, 20, 18], [20, 30, 10, 10], [50, 60, 12, 12]])
    conf = FakeTensor([0.92, 0.99, 0.3])
    cls = FakeTensor([1, 0, 1])


class FakeResult:
    boxes = FakeBoxes()


class FakeImage:
    size = (640, 480)
    closed = False

    def close(self):
        self.closed = True


class FakeModel:
    names = {0: "white_stone", 1: "black_stone"}

    def predict(self, **kwargs):
        self.last_options = kwargs
        return [FakeResult()]


class EngineTests(unittest.TestCase):
    def test_missing_model_is_honest_and_never_loads_dependencies(self):
        def forbidden(_path):
            self.fail("No model must not load ML dependencies")
        engine = vision.YoloEngine(loader=forbidden)
        engine.prepare()
        health = engine.health()
        self.assertFalse(health["ready"])
        self.assertEqual(health["code"], "model_not_configured")
        self.assertEqual(health["classes"], [])

    def test_url_missing_file_and_wrong_extension_are_not_loaded(self):
        for path in ["https://example.org/weights.pt", "//example.org/weights.pt", "/missing/weights.pt", "model.yaml"]:
            engine = vision.YoloEngine(path, [0], loader=lambda _path: self.fail("must not load"))
            engine.prepare()
            self.assertEqual(engine.code, "invalid_model")
            self.assertFalse(engine.ready)

    def test_class_selector_parsing_exact_names_and_ids(self):
        self.assertEqual(vision.parse_classes(["1, black_stone", "1", "黑子"]), [1, "black_stone", "黑子"])
        self.assertEqual(vision.resolve_classes(["black_stone", 1], FakeModel.names), [1])
        with self.assertRaises(ValueError):
            vision.parse_classes(["1,,2"])
        for selected in ([], ["BLACK_STONE"], [9]):
            with self.assertRaises(ValueError):
                vision.resolve_classes(selected, FakeModel.names)

    def test_model_requires_explicit_black_class_and_exposes_names(self):
        with tempfile.NamedTemporaryFile(suffix=".pt") as weights:
            engine = vision.YoloEngine(weights.name, loader=lambda _path: FakeModel())
            engine.prepare()
            self.assertFalse(engine.ready)
            self.assertEqual(engine.code, "classes_not_configured")
            self.assertEqual(engine.health()["model"], Path(weights.name).name)
            self.assertEqual(engine.health()["classes"][1], {"id": 1, "name": "black_stone"})

    def test_missing_dependency_has_actionable_diagnostic(self):
        def missing(_path):
            raise ModuleNotFoundError("missing dependency", name="ultralytics")
        with tempfile.NamedTemporaryFile(suffix=".pt") as weights:
            engine = vision.YoloEngine(weights.name, [1], loader=missing)
            engine.prepare()
            self.assertEqual(engine.code, "missing_dependency")
            self.assertIn("ultralytics", engine.reason)
            self.assertIn("vision/requirements.txt", engine.reason)

    def test_returns_camera_pixel_centers_and_filters_other_classes(self):
        model, frame = FakeModel(), FakeImage()
        with tempfile.NamedTemporaryFile(suffix=".onnx") as weights:
            engine = vision.YoloEngine(weights.name, ["black_stone"],
                                       loader=lambda _path: model, image_decoder=lambda _url: frame)
            engine.prepare()
            result = engine.detect("test image", 0.6)
        self.assertTrue(result["ready"])
        self.assertEqual((result["width"], result["height"]), (640, 480))
        self.assertEqual(result["detections"], [{"x": 320.0, "y": 240.0,
                         "width": 20.0, "height": 18.0, "confidence": 0.92,
                         "className": "black_stone", "sourceClassId": 1,
                         "sourceClassName": "black_stone"}])
        self.assertEqual(model.last_options["classes"], [1])
        self.assertFalse(model.last_options["save"])
        self.assertTrue(frame.closed)

    def test_invalid_image_payload_rejected_before_pillow_import(self):
        for value in [None, "https://example.com/a.jpg", "data:image/jpeg;base64,%%%", "data:image/svg+xml;base64,AAAA"]:
            with self.assertRaises(vision.ImageValidationError):
                vision.decode_image(value)

    def test_pixel_limit_applies_even_with_custom_image_decoder(self):
        frame = FakeImage()
        frame.size = (4000, 4000)
        with tempfile.NamedTemporaryFile(suffix=".pt") as weights:
            engine = vision.YoloEngine(weights.name, [1], loader=lambda _path: FakeModel(), image_decoder=lambda _url: frame)
            engine.prepare()
            with self.assertRaises(vision.ImageValidationError):
                engine.detect("test image", 0.6)
        self.assertTrue(frame.closed)

    def test_origins_are_exact_loopback_origins(self):
        for origin in [vision.DEFAULT_ORIGIN, "http://localhost:4173", "http://[::1]:4173"]:
            self.assertTrue(vision.validate_origin(origin))
        for origin in ["null", "http://example.com:4173", "http://localhost:4173/", "http://user@localhost:4173", "http://localhost", "http://localhost:4173?x=1"]:
            self.assertFalse(vision.validate_origin(origin))


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.weights = tempfile.NamedTemporaryFile(suffix=".pt")
        self.engine = vision.YoloEngine(self.weights.name, [1],
                                       loader=lambda _path: FakeModel(), image_decoder=lambda _url: FakeImage())
        self.server = vision.create_server(self.engine, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.weights.close()

    def request(self, method="GET", path="/health", body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw) if raw else None
        finally:
            connection.close()

    def post(self, payload=None, extra_headers=None):
        headers = {"Origin": vision.DEFAULT_ORIGIN, "Content-Type": "application/json"}
        headers.update(extra_headers or {})
        return self.request("POST", "/detect", json.dumps(payload or {"image": "test", "confidence": 0.6}), headers)

    def test_health_local_cli_and_allowed_browser(self):
        status, _headers, payload = self.request()
        self.assertEqual(status, 200)
        self.assertTrue(payload["ready"])
        status, headers, _ = self.request(headers={"Origin": vision.DEFAULT_ORIGIN})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], vision.DEFAULT_ORIGIN)

    def test_disallowed_origin_null_origin_and_rebinding_host(self):
        for headers in [{"Origin": "http://evil.example"}, {"Origin": "null"}, {"Host": "evil.example"}]:
            status, returned_headers, _ = self.request(headers=headers)
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", returned_headers)
        status, _, _ = self.request("POST", "/detect", "{}", {"Content-Type": "application/json"})
        self.assertEqual(status, 403)

    def test_cors_and_private_network_preflight(self):
        status, headers, payload = self.request("OPTIONS", "/detect", headers={
            "Origin": vision.DEFAULT_ORIGIN, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertIsNone(payload)

    def test_inference_returns_only_black_detections(self):
        status, _, payload = self.post()
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["detections"]), 1)
        self.assertEqual(payload["detections"][0]["x"], 320)

    def test_missing_model_returns_503_without_fake_detections(self):
        self.engine.ready = False
        self.engine.code = "model_not_configured"
        status, _, payload = self.post()
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"], "model_not_configured")
        self.assertNotIn("detections", payload)

    def test_body_limit_is_checked_before_reading_body(self):
        status, _, payload = self.post(extra_headers={"Content-Length": str(vision.MAX_BODY_BYTES + 1)})
        self.assertEqual(status, 413)
        self.assertEqual(payload["error"], "body_too_large")

    def test_confidence_and_json_validation(self):
        for confidence in [True, 0, -1, 1.1, "0.6", float("nan")]:
            status, _, payload = self.post({"image": "test", "confidence": confidence})
            self.assertEqual(status, 400)
            self.assertEqual(payload["error"], "invalid_body")
        for raw in ["not json", b"\xff", "[" * 2000 + "0" + "]" * 2000]:
            status, _, _ = self.request("POST", "/detect", raw, {"Origin": vision.DEFAULT_ORIGIN, "Content-Type": "application/json"})
            self.assertEqual(status, 400)

    def test_inference_lock_rejects_concurrent_requests(self):
        self.server.inference_lock.acquire()
        try:
            status, _, payload = self.post()
            self.assertEqual(status, 429)
            self.assertEqual(payload["error"], "detector_busy")
        finally:
            self.server.inference_lock.release()

    def test_image_errors_are_explicit(self):
        def invalid(_image):
            raise vision.ImageValidationError("图片无效")
        self.engine.image_decoder = invalid
        status, _, payload = self.post()
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"], "invalid_image")


if __name__ == "__main__":
    unittest.main()
