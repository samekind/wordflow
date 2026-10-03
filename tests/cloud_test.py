"""Cloud sync service: revision conflicts, concurrent uploads and recovery throttling."""
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class CloudTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = {**os.environ, "WORDFLOW_CLOUD_DIR": cls.dir.name, "WORDFLOW_BIND": "127.0.0.1", "WORDFLOW_PORT": str(cls.port)}
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / "cloud" / "wordflow_cloud.py")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                cls.call("GET", "/healthz")
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("cloud server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        cls.dir.cleanup()

    @classmethod
    def call(cls, method, path, body=None, token=None, ip=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if ip:
            headers["X-Forwarded-For"] = ip
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request("http://127.0.0.1:%d%s" % (cls.port, path), data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    def state(self, n):
        return {"version": 1, "words": [], "reviews": [], "lessons": [], "goal": n}

    def test_stale_upload_conflicts_and_concurrent_uploads_do_not_both_win(self):
        _, account = self.call("POST", "/v1/accounts", {})
        token = account["token"]
        status, first = self.call("PUT", "/v1/state", {"state": self.state(1), "baseRevision": 0}, token)
        self.assertEqual((status, first["revision"]), (200, 1))
        status, _ = self.call("PUT", "/v1/state", {"state": self.state(2), "baseRevision": 0}, token)
        self.assertEqual(status, 409)
        results = []
        def upload(goal):
            results.append(self.call("PUT", "/v1/state", {"state": self.state(goal), "baseRevision": 1}, token)[0])
        threads = [threading.Thread(target=upload, args=(g,)) for g in range(10, 18)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(sorted(results).count(200), 1, results)
        self.assertEqual(self.call("GET", "/v1/state/meta", token=token)[1]["revision"], 2)

    def test_sentence_speech_is_app_only_and_validates_its_input(self):
        def fetch(query, origin):
            headers = {"Origin": origin} if origin else {}
            request = urllib.request.Request("http://127.0.0.1:%d/v1/tts?%s" % (self.port, query), headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code
        self.assertEqual(fetch("accent=us&text=Hello+there.", None), 403)
        self.assertEqual(fetch("accent=us&text=Hello+there.", "https://example.com"), 403)
        self.assertEqual(fetch("accent=xx&text=Hello+there.", "http://localhost"), 400)
        self.assertEqual(fetch("accent=us&text=12345", "http://localhost"), 400)
        self.assertEqual(fetch("accent=us&text=" + "a" * 201, "http://localhost"), 400)
        self.assertEqual(fetch("accent=us&text=", "http://localhost"), 400)

    def test_recovery_is_throttled_per_client(self):
        _, account = self.call("POST", "/v1/accounts", {})
        code = account["recoveryCode"]
        for _ in range(5):
            self.assertEqual(self.call("POST", "/v1/recover", {"recoveryCode": "0000-0000"}, ip="203.0.113.9")[0], 404)
        self.assertEqual(self.call("POST", "/v1/recover", {"recoveryCode": code}, ip="203.0.113.9")[0], 429)
        status, recovered = self.call("POST", "/v1/recover", {"recoveryCode": " " + code.lower().replace("-", "") + " "}, ip="198.51.100.4")
        self.assertEqual((status, recovered["accountId"]), (200, account["accountId"]))
        self.assertEqual(self.call("GET", "/v1/state/meta", token=account["token"])[0], 401)
        self.assertEqual(self.call("GET", "/v1/state/meta", token=recovered["token"])[0], 200)

    def test_new_learning_state_roundtrips_and_cannot_be_downgraded(self):
        _, account = self.call("POST", "/v1/accounts", {})
        token = account["token"]
        state = {**self.state(20), "version": 2, "learning": {"drafts": {"learn": {"id": "fixture-draft"}}, "receipts": []}}
        status, saved = self.call("PUT", "/v1/state", {"state": state, "baseRevision": 0}, token)
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", "/v1/state", token=token)[1]["state"], state)
        status, _ = self.call("PUT", "/v1/state", {"state": self.state(20), "baseRevision": saved["revision"], "force": True}, token)
        self.assertEqual(status, 409)

    def test_unit_tasks_and_context_cache_roundtrip_and_reject_v2_writer(self):
        _, account = self.call("POST", "/v1/accounts", {})
        token = account["token"]
        state = {**self.state(20), "version": 3, "learning": {"method": "context", "drafts": {}, "parked": [{"id": "unit-1", "day": 0}]}, "contextStories": [{"id": "context:unit-1:0", "taskId": "unit-1"}]}
        status, saved = self.call("PUT", "/v1/state", {"state": state, "baseRevision": 0}, token)
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", "/v1/state", token=token)[1]["state"], state)
        status, _ = self.call("PUT", "/v1/state", {"state": {**state, "version": 2}, "baseRevision": saved["revision"], "force": True}, token)
        self.assertEqual(status, 409)
        self.assertEqual(self.call("GET", "/v1/state", token=token)[1]["state"], state)


if __name__ == "__main__":
    unittest.main()
