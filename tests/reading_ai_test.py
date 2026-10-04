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
    wrong_ids = False

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeModel.calls.append({"auth": self.headers.get("Authorization"), "body": body})
        system = body["messages"][0]["content"]
        if "response_format" not in body:  # plain-text chat
            last = body["messages"][-1]["content"]
            if "boom" in last:
                self.send_response(500)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            content = "合成回复：" + last
            reply = json.dumps({"choices": [{"message": {"content": content}}], "usage": {"total_tokens": 7}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)
            return
        task = json.loads(body["messages"][1]["content"])
        if "小故事" in system:
            content = {"title": "A Story", "paragraphs": [{"words": [w["word"] for w in task], "english": "Stories use %s." % ", ".join(w["word"] for w in task), "translation": "故事。"}]}
        elif "助记教练" in system:
            ids = [w["wordId"] for w in task]
            if FakeModel.wrong_ids:
                ids = ["other"] * len(ids)
            content = {"lessons": [{"wordId": i, "mnemonic": "联想", "example": "An example.", "translation": "例句。"} for i in ids]}
        elif "逐段对应" in system:
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


class ServerCase(unittest.TestCase):
    extra_env = {}

    @classmethod
    def setUpClass(cls):
        cls.model = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
        threading.Thread(target=cls.model.serve_forever, daemon=True).start()
        cls.dir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = {**os.environ, "WORDFLOW_CLOUD_DIR": cls.dir.name, "WORDFLOW_BIND": "127.0.0.1", "WORDFLOW_PORT": str(cls.port),
               "LIBRARY_AI_KEY": "fixture-key", "READING_AI_BASE": "http://127.0.0.1:%d/v1" % cls.model.server_address[1],
               "READING_AI_MODEL": "fixture-model", "LIBRARY_AI_GATEWAY_ONLY": "deepseek", **cls.extra_env}
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
    words = [{"id": "w1", "word": "resilient", "meaning": "adj. 有韧性的"}, {"id": "w2", "word": "recover", "meaning": "v. 恢复"}]

    def chat(self, body, **kwargs):
        return self.call(body, path="/v1/ai/chat", **kwargs)


class ReadingAITests(ServerCase):
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

    def test_stories_and_lessons_for_words_are_validated_and_never_cached(self):
        before = len(FakeModel.calls)
        status, result = self.call({"mode": "story", "words": self.words})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["story"]["title"], "A Story")
        self.assertIn("resilient, recover", result["story"]["paragraphs"][0]["english"])
        self.assertEqual(self.call({"mode": "story", "words": self.words})[0], 200)
        self.assertEqual(len(FakeModel.calls), before + 2, "asking again writes another story")
        self.assertEqual(FakeModel.calls[-1]["body"]["max_tokens"], 6000)
        self.assertEqual(result["story"]["paragraphs"][0].keys(), {"english", "translation"}, "the model's word plan is not passed on")
        status, result = self.call({"mode": "lessons", "words": self.words})
        self.assertEqual(status, 200, result)
        self.assertEqual([lesson["wordId"] for lesson in result["lessons"]], ["w1", "w2"])
        self.assertEqual(result["lessons"][0]["question"], "")

    def test_story_prompt_asks_for_a_paragraph_per_three_to_five_words(self):
        def system_for(count):
            words = [{"id": "w%d" % i, "word": "word%d" % i, "meaning": "词%d" % i} for i in range(count)]
            self.assertEqual(self.call({"mode": "story", "words": words})[0], 200)
            return FakeModel.calls[-1]["body"]["messages"][0]["content"]
        for count, paragraphs in ((1, 1), (4, 1), (5, 2), (14, 4), (32, 8), (40, 8)):
            self.assertTrue(system_for(count).endswith("本次共 %d 个词，请写 %d 段。" % (count, paragraphs)), (count, paragraphs))
        prompt = system_for(14)
        for rule in ("每段承载 3 至 5 个目标词", "不同的义项", "原形", "words"):
            self.assertIn(rule, prompt)

    def test_word_requests_are_bounded_and_mismatched_lessons_are_rejected(self):
        self.assertEqual(self.call({"mode": "story", "words": []})[0], 400)
        self.assertEqual(self.call({"mode": "story", "words": self.words * 21})[0], 400, "duplicates and more than 40 words")
        self.assertEqual(self.call({"mode": "lessons", "words": [{"id": str(i), "word": "w", "meaning": "m"} for i in range(9)]})[0], 400)
        self.assertEqual(self.call({"mode": "lessons", "words": [{"id": "a", "word": "", "meaning": "m"}]})[0], 400)
        self.assertEqual(self.call({"mode": "story", "words": "resilient"})[0], 400)
        self.assertEqual(self.call({"mode": "story", "words": self.words}, origin="https://evil.example")[0], 403)
        FakeModel.wrong_ids = True
        try:
            self.assertEqual(self.call({"mode": "lessons", "words": self.words})[0], 502)
        finally:
            FakeModel.wrong_ids = False


    def test_chat_is_app_only_validated_and_carries_the_context_to_the_model(self):
        ask = {"device": "device-aaaaaaaa", "messages": [{"role": "user", "content": "这篇讲什么？"}]}
        self.assertEqual(self.chat(ask, origin=None)[0], 403)
        self.assertEqual(self.chat({"device": "device-aaaaaaaa", "messages": []})[0], 400)
        self.assertEqual(self.chat({"device": "device-aaaaaaaa", "messages": [{"role": "assistant", "content": "hi"}]})[0], 400)
        self.assertEqual(self.chat({"device": "device-aaaaaaaa", "messages": [{"role": "system", "content": "x"}]})[0], 400)
        self.assertEqual(self.chat({"device": "device-aaaaaaaa", "task": {"type": "poem", "sentence": "x"}})[0], 400)
        status, result = self.chat({**ask, "context": {"kind": "article", "title": "A resilient city", "text": "The city recovered."}})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["reply"], "合成回复：这篇讲什么？")
        self.assertIsInstance(result["remaining"], int)
        system = FakeModel.calls[-1]["body"]["messages"][0]["content"]
        self.assertIn("A resilient city", system)
        self.assertIn("The city recovered.", system)
        self.assertNotIn("response_format", FakeModel.calls[-1]["body"])

    def test_sentence_and_word_tasks_are_built_on_the_server_and_cached(self):
        before = len(FakeModel.calls)
        task = {"device": "device-bbbbbbbb", "task": {"type": "sentence", "sentence": "The city recovered quickly."}}
        status, result = self.chat(task)
        self.assertEqual(status, 200, result)
        self.assertIn("The city recovered quickly.", result["reply"])
        self.assertIn("译成", FakeModel.calls[-1]["body"]["messages"][-1]["content"])
        status, again = self.chat(task)
        self.assertEqual((status, again.get("cached")), (200, True))
        self.assertEqual(len(FakeModel.calls), before + 1)
        status, result = self.chat({"device": "device-bbbbbbbb", "task": {"type": "word", "word": "resilient", "sentence": "People were resilient."}})
        self.assertEqual(status, 200, result)
        self.assertIn("resilient", FakeModel.calls[-1]["body"]["messages"][-1]["content"])

    def test_failed_chat_calls_are_not_charged(self):
        device = "device-cccccccc"
        _, first = self.chat({"device": device, "messages": [{"role": "user", "content": "hello"}]})
        status, failed = self.chat({"device": device, "messages": [{"role": "user", "content": "boom"}]})
        self.assertEqual(status, 502, failed)
        _, third = self.chat({"device": device, "messages": [{"role": "user", "content": "hello again"}]})
        self.assertEqual(third["remaining"], first["remaining"] - 1)


class OwnProviderTests(ServerCase):
    extra_env = {"READING_AI_KEY": "app-own-key"}

    def test_a_dedicated_app_key_is_used_without_the_library_gateway_options(self):
        status, result = self.chat({"device": "device-own-1", "task": {"type": "sentence", "sentence": "Hello there."}})
        self.assertEqual(status, 200, result)
        call = FakeModel.calls[-1]
        self.assertEqual(call["auth"], "Bearer app-own-key")
        self.assertNotIn("providerOptions", call["body"])


class QuotaTests(ServerCase):
    extra_env = {"AI_DAILY_LIMIT": "6"}

    def test_each_device_has_its_own_daily_allowance_and_stories_cost_more(self):
        def ask(device, text="hi"):
            return self.chat({"device": device, "messages": [{"role": "user", "content": text}]})
        for index in range(6):
            status, result = ask("device-quota-1", "q%d" % index)
            self.assertEqual((status, result["remaining"]), (200, 5 - index))
        status, result = ask("device-quota-1", "one more")
        self.assertEqual((status, result["remaining"]), (429, 0))
        self.assertIn("明天", result["error"])
        # The IP ceiling is 5x the device allowance, so another device on the same address still works.
        self.assertEqual(ask("device-quota-2")[0], 200)
        status, result = self.call({"mode": "story", "words": self.words, "device": "device-quota-3"})
        self.assertEqual((status, result["remaining"]), (200, 1))
        status, result = self.call({"mode": "story", "words": self.words, "device": "device-quota-3"})
        self.assertEqual(status, 429, result)
        self.assertEqual(ask("device-quota-3")[0], 200, "a chat still fits in what is left")


if __name__ == "__main__":
    unittest.main()
