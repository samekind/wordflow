import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "exam_frequency", Path(__file__).resolve().parents[1] / "scripts/build-exam-frequency.py"
)
exam = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exam)


class ExamFrequencyTests(unittest.TestCase):
    def test_only_recent_physical_papers_are_accepted(self):
        self.assertIsNone(exam.paper_info("/cet4/paper/2021-12-1/"))
        self.assertIsNone(exam.paper_info("/cet4/paper/2026-06/"))
        self.assertIsNone(exam.paper_info("/cet4/paper/2026-06-1/reading/"))
        self.assertEqual(exam.paper_info("/kaoyan/paper/2024-english-two/")["exam"], "ky2")
        self.assertEqual(exam.paper_info("/cet6/paper/2023-03-2/")["session"], "2023-03")

    def test_parser_excludes_analysis_navigation_directions_and_duplicate_markup(self):
        info = exam.paper_info("/cet4/paper/2024-06-1/")
        html = """<h1>CET4 2024</h1><nav>navigation</nav>
        <section id="paper"><div class="exam-paper-surface">
          <div id="directions-reading">Instruction words</div>
          <div data-module-slug="reading"><span class="select-none">A)</span>
            Researchers discovered evidence.<script>hiddenword</script>
            <div lang="zh-CN">Chinese explanation with English extras</div>
          </div>
          <div data-module-slug="reading">Researchers discovered evidence.</div>
        </div></section><section id="answers">Answer explanation words</section>"""
        parsed = exam.parse_paper(html, info)
        self.assertEqual(parsed["modules"], {"reading": ["Researchers discovered evidence."]})

    def test_shared_module_resolution_and_cycles(self):
        first = "/cet4/paper/2023-03-1/"
        second = "/cet4/paper/2023-03-2/"
        parsed = {
            first: {"modules": {"reading": ["Shared passage."]}, "shared": []},
            second: {"modules": {"other": ["Unique question."]}, "shared": [(first, "reading"), (first, "reading")]},
        }
        self.assertEqual(exam.resolve_modules(second, parsed)["reading"], ["Shared passage."])
        parsed[first]["shared"] = [(second, "reading")]
        with self.assertRaises(ValueError):
            exam.resolve_modules(second, parsed)

    def test_inflections_do_not_overwrite_real_headwords_or_ambiguous_forms(self):
        vocabulary = [
            {"word": "study", "exchange": "s:studies/p:studied/i:studying"},
            {"word": "studies", "exchange": ""},
            {"word": "see", "exchange": "p:saw"},
            {"word": "saw", "exchange": "p:sawed"},
            {"word": "axes", "exchange": ""},
            {"word": "axis", "exchange": "s:axes"},
            {"word": "axe", "exchange": "s:axes"},
        ]
        aliases = exam.alias_map(vocabulary)
        self.assertEqual(aliases["studied"], "study")
        self.assertNotIn("studies", aliases)
        self.assertNotIn("saw", aliases)
        self.assertNotIn("axes", aliases)

    def test_single_letter_words_possessives_and_hyphenated_words(self):
        self.assertEqual(
            list(exam.normalized_tokens("A researcher's long-term plan: I agree. B C D.")),
            ["a", "researcher", "long-term", "plan", "i", "agree"],
        )

    def test_paper_occurrences_and_session_counts_have_distinct_denominators(self):
        papers = [exam.paper_info(f"/cet4/paper/2023-03-{i}/") for i in (1, 2)]
        parsed = {
            papers[0]["path"]: {"modules": {"reading": ["evidence " * 500]}, "shared": [], "sha256": "fixture"},
            papers[1]["path"]: {"modules": {}, "shared": [(papers[0]["path"], "reading")], "sha256": "fixture"},
        }
        data, counts = exam.count_corpus(papers, parsed, [{"word": "evidence", "exchange": "", "tags": ["cet4"]}])
        self.assertEqual(data["cet4"]["words"], [{"word": "evidence", "papers": 2, "occurrences": 1000, "sessions": 1}])
        self.assertEqual(data["cet4"]["paperCount"], 2)
        self.assertEqual(data["cet4"]["sessionCount"], 1)
        self.assertEqual(counts["evidence"]["cet4"], [2, 1000])


if __name__ == "__main__":
    unittest.main()
