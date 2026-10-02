"""Reading library pipeline and API: text selection, word statistics, AI validation, publishing rules."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cloud"))
import library_pipeline as pipeline  # noqa: E402
import library_store as store  # noqa: E402

LEAD = (
    "A bridge is a structure built to cross a river, a road or a valley so that people and vehicles can pass safely. "
    "Many bridges are made of stone, steel or concrete, and the design depends on the length of the gap."
)
SECOND = (
    "The oldest bridges were simple logs or flat stones laid across a stream. Later builders learned to use arches, "
    "which carry the weight of the bridge into the ground on both sides of the water."
)
THIRD = (
    "Modern suspension bridges hang the road from long steel cables. Engineers test every part of the design before "
    "the first cable is installed, because a small mistake can be dangerous for thousands of travelers."
)
FOURTH = (
    "Bridges also shape the cities around them. A well placed bridge can shorten a long walk to school, bring fresh food to a market, and let ambulances reach a hospital quickly when every minute matters."
)
EXTRACT = "\n\n".join([LEAD, "== History ==", SECOND, THIRD, FOURTH, "== See also ==", "This should never appear in the reading text at all, really."])


def good_review(count):
    return {
        "verdict": "accept", "reason": "叙述清楚", "cefr": "B1", "topic": "城市", "tags": ["桥梁", "工程"],
        "intro": "介绍桥梁的类型和演变。", "translations": ["第%d段译文。" % (i + 1) for i in range(count)],
    }


class TextTests(unittest.TestCase):
    def test_paragraphs_stop_at_closing_sections_and_skip_headings(self):
        paragraphs = pipeline.select_paragraphs(EXTRACT)
        self.assertEqual(paragraphs[0], LEAD)
        self.assertEqual(len(paragraphs), 4)
        self.assertFalse(any("never appear" in p for p in paragraphs))

    def test_pronunciation_and_citations_are_removed(self):
        text = pipeline.clean_paragraph("The tomato (/təˈmɑːtoʊ/ listen) is red.[1] It grows (  ) well.")
        self.assertEqual(text, "The tomato is red. It grows well.")

    def test_vital_list_titles_follow_the_list_order_and_skip_unsuitable_sections(self):
        wikitext = "\n".join([
            "==Clothing and fashion ==", "# {{Icon|B}} '''''[[Clothing]]''''' ([[Wikipedia:Vital articles/Level 2|Level 2]])",
            "# {{Icon|C}} [[Belt (clothing)|Belt]]", "## {{Icon|C}} [[Perfume]]", "# {{Icon|C}} [[Belt (clothing)|Belt]]",
            "* not a numbered entry [[Skipped]]", "# [[Category:Hidden]] only",
            "==Politics and government==", "# [[Parliament]]",
            "==Astronomy==", "===Planetary science===", "# [[Mars]]",
        ])
        self.assertEqual(
            pipeline.titles_from_wikitext(wikitext, "生活"),
            [("Clothing", "生活"), ("Belt (clothing)", "生活"), ("Perfume", "生活"), ("Mars", "探索")],
        )

class StatsTests(unittest.TestCase):
    def setUp(self):
        self.ranks = {"the": 0, "a": 1, "is": 2, "of": 3, "and": 4, "river": 1200, "bridge": 2500, "cable": 4000, "suspension": 8000}

    def test_rare_words_ignore_names_and_common_words(self):
        stats = pipeline.analyze(["The suspension cable crosses the river near Zorbaville. The bridge is old."], self.ranks)
        words = [w for w, _ in stats["rare"]]
        self.assertIn("suspension", words)
        self.assertIn("cable", words)
        self.assertNotIn("zorbaville", words)
        self.assertNotIn("river", words)
        self.assertGreater(stats["rareRatio"], 0)

    def test_final_level_sits_between_ai_and_statistics_and_ties_go_to_statistics(self):
        easy = {"rareRatio": 0.0, "grade": 4}
        hard = {"rareRatio": 0.3, "grade": 18}
        self.assertEqual(pipeline.reconcile("A2", easy), "A2")
        self.assertEqual(pipeline.reconcile("B1", easy), "A2")
        self.assertEqual(pipeline.reconcile("C1", easy), "B1")
        self.assertEqual(pipeline.reconcile("C1", hard), "C2")
        self.assertEqual(pipeline.reconcile("B2", hard), "C1")

    def test_statistical_level_spans_a2_to_c2(self):
        levels = [pipeline.stat_cefr({"rareRatio": ratio, "grade": 6}) for ratio in (0.02, 0.07, 0.12, 0.2, 0.3)]
        self.assertEqual(levels, ["A2", "B1", "B2", "C1", "C2"])

    def test_wordlist_maps_inflected_forms_to_the_rank_of_the_headword(self):
        ranks = pipeline.load_wordlist(ROOT / "cloud" / "library-wordlist.txt")
        self.assertEqual(ranks["was"], ranks["be"])
        self.assertLess(ranks["the"], 5)
        for form in ("are", "more", "were"):
            self.assertLess(ranks[form], pipeline.RARE_RANK)
        self.assertEqual(pipeline.rank_of("Bridges", {"bridges": 7}), 7)


class ReviewTests(unittest.TestCase):
    def test_accepts_a_complete_review_and_rejects_count_mismatch(self):
        self.assertEqual(pipeline.validate_review(good_review(3), 3)["cefr"], "B1")
        with self.assertRaises(ValueError):
            pipeline.validate_review(good_review(2), 3)

    def test_every_level_from_a2_to_c2_is_accepted_and_explicit_rejects_are_not(self):
        for level in ("A2", "B1", "B2", "C1", "C2"):
            self.assertEqual(pipeline.validate_review({**good_review(1), "cefr": level}, 1)["cefr"], level)
        with self.assertRaises(ValueError):
            pipeline.validate_review({**good_review(1), "cefr": "A1"}, 1)
        self.assertEqual(pipeline.validate_review({"verdict": "reject", "reason": "争议"}, 3)["verdict"], "reject")

    def test_translation_must_be_chinese_and_topic_must_be_known(self):
        with self.assertRaises(ValueError):
            pipeline.validate_review({**good_review(1), "translations": ["English only"]}, 1)
        with self.assertRaises(ValueError):
            pipeline.validate_review({**good_review(1), "topic": "八卦"}, 1)


class FakeAI:
    ready = True

    def __init__(self, review=None):
        self.review_value = review
        self.calls = 0

    def review(self, title, paragraphs, stats):
        self.calls += 1
        return {**(self.review_value or good_review(len(paragraphs))), "model": "fake"}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.dir.name) / "library.sqlite")
        self.ranks = pipeline.load_wordlist(ROOT / "cloud" / "library-wordlist.txt")
        self.page = {"title": "Bridge", "extract": EXTRACT, "revisions": [{"revid": 101}], "categories": [{"title": "Category:Bridges"}], "pageprops": {}}
        self.original_fetch = pipeline.fetch_page
        self.original_image = pipeline.fetch_image
        pipeline.fetch_page = lambda lang, title: self.page
        pipeline.fetch_image = lambda *args: None

    def tearDown(self):
        pipeline.fetch_page = self.original_fetch
        pipeline.fetch_image = self.original_image
        self.db.close()
        self.dir.cleanup()

    def article(self, article_id="lib-simple-bridge"):
        return self.db.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()

    def test_accepted_article_is_published_with_source_license_and_translations(self):
        result = pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, FakeAI())
        self.assertTrue(result.startswith("published"))
        body = json.loads(self.article()["body"])
        self.assertEqual(body["source"], "Simple English Wikipedia")
        self.assertEqual(body["license"]["name"], "CC BY-SA 4.0")
        self.assertEqual(body["sourceUrl"], "https://simple.wikipedia.org/wiki/Bridge")
        self.assertEqual(len(body["translations"]), len(body["paragraphs"]))
        self.assertEqual(body["revision"], "101")
        self.assertIn(body["level"], ("easy", "standard"))

    def test_everyday_titles_are_queued_once_and_ahead_of_everything_else(self):
        self.db.execute("INSERT INTO candidates (title, topic, position) VALUES ('Quantum field theory', '科学', 0)")
        first = pipeline.add_basic_candidates(self.db)
        self.assertGreater(first, 50)
        self.assertEqual(pipeline.add_basic_candidates(self.db), 0)
        queue = [r["title"] for r in self.db.execute("SELECT title FROM candidates WHERE state = 'new' ORDER BY position")]
        self.assertEqual(queue[-1], "Quantum field theory")
        self.assertEqual(queue[0], "Dog")

    def test_regrade_moves_published_articles_and_makes_clients_fetch_them_again(self):
        pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, FakeAI())
        before = self.article()["seq"]
        body = json.loads(self.article()["body"])
        review = json.loads(self.article()["review"])
        review["cefr"] = "C2"  # as if the AI had judged it harder than the statistics did
        self.db.execute("UPDATE articles SET review = ? WHERE id = 'lib-simple-bridge'", (json.dumps(review),))
        expected = pipeline.reconcile("C2", body["stats"])
        self.assertNotEqual(expected, body["cefr"])
        self.assertEqual(pipeline.regrade(self.db), 1)
        self.assertEqual(json.loads(self.article()["body"])["cefr"], expected)
        self.assertGreater(self.article()["seq"], before)
        self.assertEqual(pipeline.regrade(self.db), 0)

    def test_a_short_plain_page_is_judged_again_after_the_rules_were_loosened(self):
        self.page = {**self.page, "extract": "Dogs are animals. " * 3}
        self.assertEqual(pipeline.process(self.db, "simple", "Bridge", "", self.ranks, FakeAI()), "rejected: 正文太短")
        self.page = {**self.page, "extract": EXTRACT}
        self.assertTrue(pipeline.process(self.db, "simple", "Bridge", "", self.ranks, FakeAI()).startswith("published"))

    def test_without_an_ai_key_articles_wait_and_are_not_served(self):
        ai = pipeline.DeepSeek()
        ai.key = ""
        self.assertEqual(pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, ai), "pending_ai")
        self.assertEqual(self.article()["status"], "pending_ai")
        self.assertEqual(store.published_page(self.db, 0, 10)["articles"], [])

    def test_ai_rejection_and_rule_rejection_keep_the_reason_and_stay_hidden(self):
        reject = FakeAI({"verdict": "reject", "reason": "列表式内容"})
        self.assertIn("列表式内容", pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, reject))
        self.assertEqual(json.loads(self.article()["review"])["by"], "ai")
        self.page = {**self.page, "title": "Mercy", "categories": [{"title": "Category:Living people"}]}
        self.assertIn("Living people", pipeline.process(self.db, "en", "Mercy", "社会", self.ranks, FakeAI()))
        self.assertEqual(store.published_page(self.db, 0, 10)["articles"], [])

    def test_same_revision_is_not_reviewed_twice_and_hidden_stays_hidden(self):
        ai = FakeAI()
        pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, ai)
        self.assertEqual(pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, ai), "unchanged")
        self.assertEqual(ai.calls, 1)
        self.assertTrue(store.set_status(self.db, "lib-simple-bridge", "hidden"))
        self.page = {**self.page, "revisions": [{"revid": 102}]}
        self.assertEqual(pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, ai), "hidden")
        self.assertEqual(store.published_page(self.db, 0, 10)["ids"], [])

    def test_sync_pages_report_changes_and_removals_by_sequence(self):
        pipeline.process(self.db, "simple", "Bridge", "城市", self.ranks, FakeAI())
        first = store.published_page(self.db, 0, 10)
        self.assertEqual(first["ids"], ["lib-simple-bridge"])
        self.assertEqual(len(first["articles"]), 1)
        self.assertEqual(store.published_page(self.db, first["cursor"], 10)["articles"], [])
        store.set_status(self.db, "lib-simple-bridge", "hidden")
        self.assertEqual(store.published_page(self.db, first["cursor"], 10)["ids"], [])


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        library = Path(cls.dir.name) / "library"
        db = store.connect(library / "library.sqlite")
        (library / "images").mkdir(parents=True)
        (library / "images" / "lib-simple-bridge.jpg").write_bytes(b"\xff\xd8fake")
        for number, status in enumerate(["published", "hidden"]):
            article_id = "lib-simple-bridge" if number == 0 else "lib-simple-secret"
            store.save_article(db, {
                "id": article_id, "lang": "simple", "title": "Bridge", "status": status, "revision": "1", "retrieved_at": store.utc_now(),
                "checked_at": store.utc_now(), "content_hash": "h%d" % number, "body": {"id": article_id, "title": "Bridge"},
                "image_file": "lib-simple-bridge.jpg" if number == 0 else None, "image_type": "image/jpeg" if number == 0 else None,
            })
        db.close()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        env = {**os.environ, "WORDFLOW_CLOUD_DIR": cls.dir.name, "WORDFLOW_BIND": "127.0.0.1", "WORDFLOW_PORT": str(cls.port)}
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / "cloud" / "wordflow_cloud.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                cls.get("/healthz")
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
    def get(cls, path):
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (cls.port, path), timeout=5) as response:
            return response.status, response.headers, response.read()

    def test_index_lists_only_published_articles_without_an_account(self):
        status, _, body = self.get("/v1/library?since=0&limit=5")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["ids"], ["lib-simple-bridge"])
        self.assertEqual([a["id"] for a in data["articles"]], ["lib-simple-bridge"])
        self.assertFalse(data["more"])

    def test_images_are_served_only_for_published_articles_with_safe_ids(self):
        status, headers, body = self.get("/v1/library/image/lib-simple-bridge")
        self.assertEqual((status, headers["Content-Type"], body), (200, "image/jpeg", b"\xff\xd8fake"))
        for bad in ("lib-simple-secret", "..%2F..%2Fcloud.sqlite", "lib-simple-nope"):
            with self.assertRaises(Exception):
                self.get("/v1/library/image/" + bad)

    def test_empty_library_is_a_valid_response(self):
        empty = tempfile.TemporaryDirectory()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        env = {**os.environ, "WORDFLOW_CLOUD_DIR": empty.name, "WORDFLOW_BIND": "127.0.0.1", "WORDFLOW_PORT": str(port)}
        proc = subprocess.Popen([sys.executable, str(ROOT / "cloud" / "wordflow_cloud.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try:
                    with urllib.request.urlopen("http://127.0.0.1:%d/v1/library" % port, timeout=2) as response:
                        data = json.loads(response.read())
                    break
                except Exception:
                    time.sleep(0.1)
            self.assertEqual(data["articles"], [])
            self.assertEqual(data["ids"], [])
        finally:
            proc.terminate()
            proc.wait(5)
            empty.cleanup()


if __name__ == "__main__":
    unittest.main()
