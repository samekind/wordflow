"""Build recent exam counts from public paper markup, never from all-time ranks."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import urllib.request
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".local" / "exam-frequency"
ORIGIN = "https://english-exam.lazynote.cn"
FROM_YEAR, TO_YEAR = 2022, 2026
PAPER_PATH = re.compile(
    r"^/(?P<family>cet4|cet6|kaoyan)/paper/"
    r"(?P<key>(?P<year>\d{4})(?:-(?P<month>\d{2})-(?P<form>[1-3])|-english-(?P<kind>one|two)))/$"
)
TOKEN = re.compile(r"[A-Za-z]+(?:['\u2019-][A-Za-z]+)*")
GROUPS = {
    "cet4": ("四级", "cet4"),
    "cet6": ("六级", "cet6"),
    "ky1": ("考研英语一", "ky"),
    "ky2": ("考研英语二", "ky"),
}


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def paper_info(path):
    match = PAPER_PATH.fullmatch(path)
    if not match:
        return None
    info = match.groupdict()
    year = int(info["year"])
    if not FROM_YEAR <= year <= TO_YEAR:
        return None
    if info["month"] and (year, int(info["month"])) > (datetime.now().year, datetime.now().month):
        return None
    if info["family"] == "kaoyan":
        if info["kind"] not in ("one", "two"):
            return None
        group = "ky1" if info["kind"] == "one" else "ky2"
    else:
        if not info["month"] or info["kind"]:
            return None
        group = info["family"]
    return {
        "id": f'{group}-{info["key"]}', "exam": group, "year": year,
        "session": info["key"].rsplit("-", 1)[0] if info["month"] else str(year),
        "url": ORIGIN + path, "path": path,
    }


class Source:
    def __init__(self, offline=False):
        self.offline = offline
        CACHE.mkdir(parents=True, exist_ok=True)

    def html(self, url):
        if urlparse(url).netloc != urlparse(ORIGIN).netloc:
            raise ValueError(f"Unexpected source host: {url}")
        target = CACHE / (digest(url) + ".html")
        if target.exists():
            return target.read_text(encoding="utf-8")
        if self.offline:
            raise FileNotFoundError(f"Uncached source: {url}")
        request = urllib.request.Request(url, headers={"User-Agent": "Wordflow-Exam-Count/1.0"})
        with urllib.request.urlopen(request, timeout=35) as response:
            text = response.read().decode("utf-8")
        if "<html" not in text.lower():
            raise ValueError(f"Not an HTML page: {url}")
        target.write_text(text, encoding="utf-8")
        time.sleep(0.3)
        return text


def discover(source):
    found = {}
    for family in ("cet4", "cet6", "kaoyan"):
        soup = BeautifulSoup(source.html(f"{ORIGIN}/{family}/"), "lxml")
        for link in soup.select("a[href]"):
            info = paper_info(urlparse(urljoin(ORIGIN, link["href"])).path)
            if info:
                found[info["path"]] = info
    return sorted(found.values(), key=lambda item: (item["exam"], item["path"]))


def module_text(element):
    node = BeautifulSoup(str(element), "lxml")
    for extra in node.select("script, style, button, svg, .select-none, [lang^='zh'], [id^='directions']"):
        extra.decompose()
    # Paper rendering includes listening/passage instructions inside each module.
    for element in node.find_all(["div", "p"]):
        text = element.get_text(" ", strip=True)
        if re.fullmatch(
            r"(?:Questions?\s+\d+.*?(?:heard|following passage|passage|recording|conversation)"
            r"|(?:Passage|Section|News Report|Conversation|Recording)\s+(?:One|Two|Three|[A-C]))[.:]?",
            text, re.I,
        ):
            element.decompose()
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def parse_paper(html, info):
    soup = BeautifulSoup(html, "lxml")
    surface = soup.select_one("#paper .exam-paper-surface")
    if not surface:
        raise ValueError(f'Missing isolated paper body: {info["url"]}')
    title = soup.find("h1")
    if not title or str(info["year"]) not in title.get_text():
        raise ValueError(f'Paper year mismatch: {info["url"]}')
    modules = defaultdict(list)
    for node in surface.select("[data-module-slug]"):
        if node.find_parent(attrs={"data-module-slug": True}):
            continue
        text = module_text(node)
        if TOKEN.search(text):
            modules[node["data-module-slug"]].append(text)
    shared = set()
    for link in surface.select("a[href]"):
        path = urlparse(urljoin(ORIGIN, link["href"])).path
        bits = path.rstrip("/").rsplit("/", 1)
        if len(bits) != 2:
            continue
        target = paper_info(bits[0] + "/")
        if target:
            if target["exam"] != info["exam"]:
                raise ValueError(f"Cross-exam shared module: {path}")
            shared.add((target["path"], bits[1]))
    # A module may be repeated in print/mobile markup. Count each body only once.
    return {
        "modules": {slug: list(dict.fromkeys(parts)) for slug, parts in modules.items()},
        "shared": sorted(shared), "sha256": digest(html),
        "title": title.get_text(" ", strip=True),
    }


def resolve_modules(path, parsed, stack=()):
    if path in stack:
        raise ValueError(f"Shared module cycle: {path}")
    current = parsed[path]
    result = {slug: list(parts) for slug, parts in current["modules"].items()}
    for target, slug in current["shared"]:
        if target not in parsed:
            raise ValueError(f"Shared source outside acquired corpus: {target}")
        inherited = resolve_modules(target, parsed, (*stack, path)).get(slug)
        if not inherited:
            raise ValueError(f"Empty shared section: {target} {slug}")
        result.setdefault(slug, []).extend(inherited)
    return {slug: list(dict.fromkeys(parts)) for slug, parts in result.items()}


def normalized_tokens(text):
    text = text.replace("\u00ad", "").replace("\u2010", "-").replace("\u2011", "-")
    for match in TOKEN.finditer(text):
        word = match.group().lower().replace("\u2019", "'")
        if word.endswith("'s"):
            word = word[:-2]
        if (len(word) >= 2 or word in ("a", "i")) and word not in ("directions",):
            yield word


def alias_map(vocabulary):
    """Merge only explicit, unambiguous inflections; retain real headwords."""
    heads = {row["word"].lower() for row in vocabulary}
    candidates = defaultdict(set)
    for row in vocabulary:
        head = row["word"].lower()
        for pair in row.get("exchange", "").split("/"):
            code, separator, value = pair.partition(":")
            if separator and code in ("p", "d", "i", "3", "s", "r", "t"):
                value = value.strip().lower()
                if TOKEN.fullmatch(value):
                    candidates[value].add(head)
    return {
        word: next(iter(lemmas)) for word, lemmas in candidates.items()
        if len(lemmas) == 1 and word not in heads
    }


def count_corpus(papers, parsed, vocabulary):
    aliases = alias_map(vocabulary)
    phrases = {
        row["word"].lower(): re.compile(r"(?<![a-z'])" + re.escape(row["word"].lower()) + r"(?![a-z'])")
        for row in vocabulary if " " in row["word"]
    }
    result = {}
    lexicon_counts = defaultdict(dict)
    heads = {row["word"].lower() for row in vocabulary}
    for group, (title, tag) in GROUPS.items():
        selected = [paper for paper in papers if paper["exam"] == group]
        documents, occurrences, sessions = Counter(), Counter(), defaultdict(set)
        paper_meta = []
        for paper in selected:
            modules = resolve_modules(paper["path"], parsed)
            texts = list(dict.fromkeys(text for parts in modules.values() for text in parts))
            tokens = list(normalized_tokens(" ".join(texts)))
            if len(tokens) < 500:
                raise ValueError(f'Suspiciously short paper ({len(tokens)} tokens): {paper["url"]}')
            counts = Counter(aliases.get(word, word) for word in tokens)
            for phrase, pattern in phrases.items():
                count = sum(len(pattern.findall(text.lower())) for text in texts)
                if count:
                    counts[phrase] = count
            documents.update(word for word in counts if word in heads)
            occurrences.update({word: count for word, count in counts.items() if word in heads})
            for word in counts:
                if word in heads:
                    sessions[word].add(paper["session"])
            paper_meta.append({
                "id": paper["id"], "year": paper["year"], "session": paper["session"],
                "url": paper["url"], "sha256": parsed[paper["path"]]["sha256"],
                "tokens": len(tokens), "modules": sorted(modules),
                "shared": [ORIGIN + path + slug + "/" for path, slug in parsed[paper["path"]]["shared"]],
            })
        entries = []
        for row in vocabulary:
            if tag in row["tags"]:
                word = row["word"].lower()
                entries.append({
                    "word": row["word"], "papers": documents[word],
                    "occurrences": occurrences[word], "sessions": len(sessions[word]),
                })
        entries.sort(key=lambda row: (-row["papers"], -row["occurrences"], row["word"].lower()))
        for word, paper_count in documents.items():
            if paper_count and word in heads:
                lexicon_counts[word][group] = [paper_count, occurrences[word]]
        result[group] = {
            "title": title, "tag": tag, "paperCount": len(selected),
            "sessionCount": len({paper["session"] for paper in selected}),
            "matchedWords": sum(row["papers"] > 0 for row in entries),
            "papers": paper_meta, "words": entries,
        }
    return result, {word: counts for word, counts in lexicon_counts.items() if counts}


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--offline", action="store_true")
    args.add_argument("--discover", action="store_true")
    args.add_argument("--publish", action="store_true")
    args.add_argument("--output", default="outputs/exam-frequency-2022-2026.json")
    options = args.parse_args()
    source = Source(options.offline)
    papers = discover(source)
    coverage = Counter(paper["exam"] for paper in papers)
    print(json.dumps({"discovered": dict(coverage), "papers": [p["id"] for p in papers]}, ensure_ascii=True), flush=True)
    if options.discover:
        return
    expected = {"cet4": 33, "cet6": 33, "ky1": 5, "ky2": 5}
    if dict(coverage) != expected:
        raise ValueError(f"Review source coverage before rebuilding: expected {expected}, got {dict(coverage)}")
    parsed = {}
    for index, paper in enumerate(papers):
        parsed[paper["path"]] = parse_paper(source.html(paper["url"]), paper)
        if (index + 1) % 8 == 0:
            print(f"Acquired {index + 1}/{len(papers)} papers", flush=True)
    vocabulary = json.loads((ROOT / "public/vocabulary/ecdict.json").read_text(encoding="utf-8"))
    exams, lexicon_counts = count_corpus(papers, parsed, vocabulary)
    output = {
        "version": 1, "fromYear": FROM_YEAR, "toYear": TO_YEAR,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": ORIGIN,
        "vocabulary": {
            "file": "public/vocabulary/ecdict.json",
            "sha256": hashlib.sha256((ROOT / "public/vocabulary/ecdict.json").read_bytes()).hexdigest(),
            "scope": "Existing ECDICT-tagged CET4/CET6/NETEM wordbooks, not a claim of complete official syllabi.",
        },
        "method": "Paper coverage descending, then token occurrences. Lowercase and unambiguous ECDICT inflections.",
        "scope": "Printed English passages, questions and options. Excludes instructions, writing directions, answers, explanations, Chinese prompts, listening transcripts and model essays.",
        "sharedPolicy": "Shared sections resolved once per physical paper; repeated copies within one paper removed. Session counts also retained.",
        "rights": "Only independently calculated counts and source URLs are exported. Source passages remain in local verification cache; source reuse authorization is unconfirmed.",
        "exams": exams,
        "lexiconCounts": lexicon_counts,
    }
    destination = ROOT / options.output
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(destination)
    if options.publish:
        published = ROOT / "public/vocabulary/exam-frequency-2022-2026.json"
        published.write_bytes(destination.read_bytes())
    import csv
    for group, data in exams.items():
        with destination.with_name(f"exam-frequency-{group}-{FROM_YEAR}-{TO_YEAR}.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["word", "paper_count", "total_papers", "occurrences", "session_count", "total_sessions"])
            writer.writerows([row["word"], row["papers"], data["paperCount"], row["occurrences"], row["sessions"], data["sessionCount"]] for row in data["words"])
    print(json.dumps({"output": str(destination), "exams": {
        key: {"papers": value["paperCount"], "matched": value["matchedWords"], "words": len(value["words"])}
        for key, value in exams.items()
    }}, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
