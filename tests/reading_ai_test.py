"""Built-in reading AI: app-only origin, validation, per-paragraph translation, caching and usage log."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeModel(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeModel.calls.append({"auth": self.headers.get("Authorization"), "body": body})
        task = json.loads(body["messages"][1]["content"])
        if "逐段对应" in body["messages"][0]["content"]:
            content = {"paragraphs": ["译文 %d" % (i + 1) for i in range(len(task["paragraphs"]))]}
        elif task.get("question"):
            content = {"answer": "合成回答：" + task["question"]}
        else:
            content = {"answer": "合成导读", "items": [{"word": "resilient", "meaning": "有韧性的", "example": "She is resilient."}, {"word": "", "meaning": "x"}]}
        reply = json.dumps({"data": {"choices": [{"message": {"content": "```json\n" + json.dumps(content, ensure_ascii=False) + "\n```"}}], "usage": {"total_tokens": 42}}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)


class ReadingAITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
        threading.Thread(target=cls.model.serve_forever, daemon=True).start()
        cls.dir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = {**os.environ, "WORDFLOW_CLOUD_DIR": cls.dir.name, "WORDFLOW_BIND": "127.0.0.1", "WORDFLOW_PORT": str(cls.port),
               "LIBRARY_AI_KEY": "fixture-key", "READING_AI_BASE": "http://127.0.0.1:%d/v1" % cls.model.server_address[1],
               "READING_AI_MODEL": "fixture-model", "LIBRARY_AI_GATEWAY_ONLY": "deepseek"}
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / "cloud" / "wordflow_cloud.py")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                cls.call({}, origin=None, path="/healthz", method="GET")
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("cloud server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        cls.model.shutdown()
        cls.dir.cleanup()

    @classmethod
    def call(cls, body, origin="https://localhost", path="/v1/ai/reading", method="POST"):
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        data = json.dumps(body).encode() if method == "POST" else None
        request = urllib.request.Request("http://127.0.0.1:%d%s" % (cls.port, path), data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    article = {"title": "A resilient city", "paragraphs": ["The city recovered quickly.", "People were resilient."]}

    def test_only_the_app_origin_may_call_and_requests_are_validated(self):
        self.assertEqual(self.call({**self.article, "mode": "summary"}, origin=None)[0], 403)
        self.assertEqual(self.call({**self.article, "mode": "summary"}, origin="https://evil.example")[0], 403)
        self.assertEqual(self.call({**self.article, "mode": "poem"})[0], 400)
        self.assertEqual(self.call({"mode": "summary", "title": "x", "paragraphs": []})[0], 400)
        self.assertEqual(self.call({**self.article, "mode": "ask"})[0], 400)
        self.assertEqual(self.call({**self.article, "mode": "explain"})[0], 400)

    def test_translation_matches_paragraphs_and_repeats_come_from_cache(self):
        before = len(FakeModel.calls)
        status, result = self.call({**self.article, "mode": "translate"})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["paragraphs"], ["译文 1", "译文 2"])
        self.assertEqual(result["model"], "fixture-model")
        call = FakeModel.calls[-1]
        self.assertEqual(call["auth"], "Bearer fixture-key")
        self.assertEqual(call["body"]["providerOptions"], {"gateway": {"only": ["deepseek"]}})
        status, again = self.call({**self.article, "mode": "translate"})
        self.assertEqual((status, again["paragraphs"], again.get("cached")), (200, ["译文 1", "译文 2"], True))
        self.assertEqual(len(FakeModel.calls), before + 1)
        log = [json.loads(line) for line in (Path(self.dir.name) / "ai-usage.log").read_text("utf-8").splitlines()]
        self.assertIn({"mode": "translate", "status": "ok", "tokens": 42}, [{k: e.get(k) for k in ("mode", "status", "tokens")} for e in log])
        self.assertTrue(any(e["status"] == "cache" for e in log))

    def test_vocabulary_drops_incomplete_items_and_questions_are_answered(self):
        status, result = self.call({**self.article, "mode": "vocabulary"})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["items"], [{"word": "resilient", "meaning": "有韧性的", "example": "She is resilient."}])
        status, result = self.call({**self.article, "mode": "ask", "question": "城市怎样了？"})
        self.assertEqual((status, result["answer"]), (200, "合成回答：城市怎样了？"))


if __name__ == "__main__":
    unittest.main()
