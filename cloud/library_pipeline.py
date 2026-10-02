#!/usr/bin/env python3
"""Builds the online reading library.

Candidates come from Wikipedia's Vital Articles (level 4) lists. Each title is fetched from Simple English
Wikipedia and English Wikipedia as plain text, filtered by rules, measured against the frequency word list,
then reviewed by an AI model that grades it (CEFR), tags it, writes a one-line summary and a Chinese
translation, and rejects unsuitable text. The English text itself is never rewritten. Only CC BY-SA text
from the wikis is kept, with source, author, license and revision recorded.

Usage:  library_pipeline.py run [--titles N] [--refresh N] [--no-ai]
        library_pipeline.py status
        library_pipeline.py hide <article-id>
"""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library_store as store  # noqa: E402

ROOT = Path(os.environ.get("WORDFLOW_CLOUD_DIR", "/srv/wordflow"))
LIB_DIR = ROOT / "library"
DB_PATH = LIB_DIR / "library.sqlite"
IMG_DIR = LIB_DIR / "images"
WORDLIST = Path(os.environ.get("LIBRARY_WORDLIST", str(Path(__file__).resolve().parent / "library-wordlist.txt")))
USER_AGENT = "WordflowLibrary/1.0 (personal English reading app; contact via the app site)"

SOURCES = {
    "simple": {"api": "https://simple.wikipedia.org/w/api.php", "site": "https://simple.wikipedia.org/wiki/", "name": "Simple English Wikipedia"},
    "en": {"api": "https://en.wikipedia.org/w/api.php", "site": "https://en.wikipedia.org/wiki/", "name": "Wikipedia"},
}
LICENSE = {"name": "CC BY-SA 4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0/"}
TOPICS = ["自然", "科学", "技术", "生活", "文化", "艺术", "健康", "城市", "社会", "探索"]
CEFR = ["A2", "B1", "B2", "C1"]
VITAL_PREFIX = "Wikipedia:Vital articles/Level 4/"
VITAL_PAGES = [
    ("Everyday life", "生活"), ("Biology and health sciences", "自然"), ("Geography", "自然"), ("Physical sciences", "科学"),
    ("Technology", "技术"), ("Arts", "艺术"), ("Society and social sciences", "文化"),
]
# Sections that are mostly politics, war, law, single works or statistics are left out; the AI review is a second filter.
SKIP_SECTION = re.compile(
    r"politic|government|military|\bwars?\b|warfare|weapon|ammunition|armour|artillery|explosive|fortification|incendiary|"
    r"\blaw\b|crime|ethnic|ethnology|ideolog|international organi|united nations|governmental|specific |fictional|folklore|"
    r"superheroes|countries|regions and|cities|morbidity|issues|social status|religio|drugs|sociology|candidates|"
    r"business and economics|companies|employment|banking",
    re.I,
)
SECTION_TOPICS = [
    (re.compile(r"astronom|space|planet|stellar|galactic|cosmolog|celestial|spacecraft|observator", re.I), "探索"),
    (re.compile(r"health|medic|anatomy|physiolog|fitness|reproduct", re.I), "健康"),
    (re.compile(r"animals|plants|fungi|ecolog|zoolog|botany|forest|desert|mountain|islands|water|land relief|peninsula|hydrolog|parks|earth|air\b|natural", re.I), "自然"),
    (re.compile(r"chemi|physics|biochem|cell|genetic|evolution|measurement|units|research|waves|mechanics|atomic|nuclear|particle|thermodyn|electromagnet|color", re.I), "科学"),
    (re.compile(r"comput|electronic|engineering|industry|infrastructure|transport|textile|agricultur|biotech|optical|navigation|media|energy", re.I), "技术"),
    (re.compile(r"architecture|venues|literature|music|performing|visual|film|art", re.I), "艺术"),
    (re.compile(r"culture|language|education|anthropolog|festival|stages of life|family|clothing|cooking|housing|household|sports|recreation|entertainment", re.I), "生活"),
]
BLOCKED_CATEGORY = re.compile(
    r"living people|disambiguation|pornograph|sexual|genocide|massacre|terroris|suicide|abortion|nazi|war crime|slavery|hate speech",
    re.I,
)
END_HEADINGS = {"see also", "references", "external links", "notes", "further reading", "bibliography", "sources", "footnotes", "citations"}
WORD = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
MIN_WORDS, MAX_WORDS, TARGET_WORDS, MAX_PARAGRAPHS = 130, 520, 260, 7
RARE_RANK = 3000
REVIEW_DAYS = 60


# ---------- network ----------
_last_request = {}


def curl_get(url, timeout):
    """Wikimedia answers 403 to HTTP/1.1 from this host's cloud address range, but HTTP/2 passes.
    urllib speaks only HTTP/1.1, so GETs to Wikimedia hosts go through curl."""
    marker = "\n%{http_code}|%{content_type}"
    done = subprocess.run(
        ["curl", "-sS", "--http2", "-L", "--max-redirs", "3", "--max-time", str(int(timeout)), "-A", USER_AGENT, "-w", marker, url],
        capture_output=True, timeout=timeout + 10,
    )
    if done.returncode != 0:
        raise urllib.error.URLError(done.stderr.decode("utf-8", "replace").strip()[:200] or "curl failed")
    body, _, tail = done.stdout.rpartition(b"\n")
    code, _, content_type = tail.decode("ascii", "replace").partition("|")
    if not code.isdigit() or int(code) >= 400:
        reason = "Too Many Requests" if code == "429" else "HTTP " + code
        raise urllib.error.HTTPError(url, int(code) if code.isdigit() else 502, reason, {}, None)
    return body, content_type


def http(url, data=None, headers=None, timeout=40, min_gap=1.3):
    host = urllib.parse.urlsplit(url).netloc
    gap = time.time() - _last_request.get(host, 0)
    if gap < min_gap:
        time.sleep(min_gap - gap)
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
    last = None
    for attempt in range(3):
        try:
            _last_request[host] = time.time()
            if data is None and host.endswith((".wikipedia.org", ".wikimedia.org")) and shutil.which("curl"):
                return curl_get(url, timeout)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            last = error
            # Wikimedia answers some rate limits with 403 "Too Many Requests".
            if error.code not in (429, 500, 502, 503, 504) and "too many" not in str(error.reason).lower():
                break
            retry = error.headers.get("Retry-After", "")
            time.sleep(min(90, int(retry)) if retry.isdigit() else 8 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
            time.sleep(4 * (attempt + 1))
    raise RuntimeError("request failed: %s (%s)" % (url[:120], last))


def wiki_json(lang, **params):
    query = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    body, _ = http("%s?%s" % (SOURCES[lang]["api"], query))
    return json.loads(body.decode("utf-8"))


# ---------- candidates ----------
def section_topic(path, default):
    """Topic hint for a list section, or None when the section is left out."""
    name = " / ".join(path)
    if SKIP_SECTION.search(name):
        return None
    for pattern, topic in SECTION_TOPICS:
        if pattern.search(name):
            return topic
    return default


def titles_from_wikitext(text, default="生活"):
    """(title, topic) pairs in the order a Vital Articles list mentions them, minus skipped sections."""
    found, seen = [], set()
    path = ["", ""]
    for line in text.splitlines():
        heading = re.match(r"^(=+)\s*([^=]+?)\s*=+\s*$", line)
        if heading:
            level = len(heading.group(1))
            if level == 2:
                path = [heading.group(2), ""]
            elif level == 3:
                path = [path[0], heading.group(2)]
            continue
        if not line.startswith("#"):
            continue
        for match in re.finditer(r"\[\[([^\]\|#]+)(?:\|[^\]]*)?\]\]", line):
            title = match.group(1).strip()
            if ":" in title or not title:
                continue
            topic = section_topic([p for p in path if p], default)
            if topic and title not in seen:
                seen.add(title)
                found.append((title, topic))
            break
    return found


def fill_candidates(db, fetch=wiki_json):
    if db.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]:
        return 0
    per_page = []
    for page, default in VITAL_PAGES:
        try:
            data = fetch("en", action="query", prop="revisions", rvprop="content", rvslots="main", titles=VITAL_PREFIX + page)
            text = data["query"]["pages"][0]["revisions"][0]["slots"]["main"]["content"]
        except Exception as error:  # a renamed list must not stop the others
            print("candidate list skipped: %s (%s)" % (page, error))
            continue
        per_page.append(titles_from_wikitext(text, default))
    position, added, seen = 0, 0, set()
    # Interleave lists so each run covers many subjects instead of one list at a time.
    for index in range(max((len(items) for items in per_page), default=0)):
        for items in per_page:
            if index < len(items) and items[index][0] not in seen:
                seen.add(items[index][0])
                db.execute("INSERT INTO candidates (title, topic, position) VALUES (?, ?, ?)", (items[index][0], items[index][1], position))
                position += 1
                added += 1
    db.commit()
    return added


# ---------- text ----------
def clean_paragraph(text):
    text = re.sub(r"\([^()]*(?:listen|[\u0250-\u02ff\u0300-\u036fˈˌ])[^()]*\)", "", text)  # pronunciations
    text = re.sub(r"\[\d+\]|\[citation needed\]|\[[a-z]\]", "", text)
    text = re.sub(r"\(\s*[;,]?\s*\)", "", text)
    return re.sub(r"\s+", " ", text).strip()


def word_count(text):
    return len(WORD.findall(text))


def select_paragraphs(extract):
    """Lead paragraphs of an article as plain prose, whole paragraphs only."""
    paragraphs, total = [], 0
    for line in extract.splitlines():
        line = line.strip()
        if not line:
            continue
        heading = re.match(r"^=+\s*(.*?)\s*=+$", line)
        if heading:
            if heading.group(1).lower() in END_HEADINGS:
                break
            continue
        text = clean_paragraph(line)
        count = word_count(text)
        if count < 14 or not re.search(r"[.!?]['\")]?$", text) or text in paragraphs:
            continue
        if total >= MIN_WORDS and total + count > MAX_WORDS:
            break
        paragraphs.append(text)
        total += count
        if total >= TARGET_WORDS or len(paragraphs) >= MAX_PARAGRAPHS:
            break
    return paragraphs


# ---------- vocabulary statistics ----------
def load_wordlist(path=WORDLIST):
    ranks = {}
    for rank, line in enumerate(Path(path).read_text("utf-8").splitlines()):
        for form in line.split():
            ranks.setdefault(form, rank)
    # Irregular forms the dictionary lists under other headwords ("are" there is the unit of area).
    for form in "am are were more less least cannot isn't aren't wasn't weren't don't doesn't didn't won't can't couldn't wouldn't shouldn't it's that's".split():
        ranks[form] = min(ranks.get(form, 50), 50)
    return ranks


def rank_of(token, ranks):
    token = token.lower().replace("’", "'")
    if token.endswith("'s"):
        token = token[:-2]
    if token in ranks:
        return ranks[token]
    parts = [p for p in re.split(r"[-']", token) if p]
    if len(parts) > 1:
        values = [ranks.get(p) for p in parts]
        return None if None in values else max(values)
    return None


def syllables(word):
    word = word.lower()
    count = len(re.findall(r"[aeiouy]+", word))
    if word.endswith("e") and count > 1 and not word.endswith("le"):
        count -= 1
    return max(1, count)


def analyze(paragraphs, ranks):
    text = " ".join(paragraphs)
    tokens = list(WORD.finditer(text))
    sentences = max(1, len(re.findall(r"[.!?]+(?:\s|$)", text)))
    lowered = {t.group(0).lower() for t in tokens if t.group(0)[0].islower()}
    proper = set()
    for token in tokens:
        value = token.group(0)
        before = text[:token.start()].rstrip()
        sentence_start = not before or before[-1] in ".!?\"“(" 
        if value[0].isupper() and not sentence_start and value.lower() not in lowered:
            proper.add(value.lower())
    counts = {}
    total = 0
    syll = 0
    for token in tokens:
        value = token.group(0)
        key = value.lower()
        if key in proper:
            continue
        total += 1
        syll += syllables(re.sub(r"[^a-z]", "", key) or "a")
        rank = rank_of(key, ranks)
        if len(key) >= 3 and (rank is None or rank >= RARE_RANK):
            counts[key] = counts.get(key, 0) + 1
    rare_total = sum(counts.values())
    rare = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:150]
    grade = 0.39 * (total / sentences) + 11.8 * (syll / max(1, total)) - 15.59
    return {
        "words": word_count(text),
        "sentences": sentences,
        "avgSentence": round(total / sentences, 1),
        "rareRatio": round(rare_total / max(1, total), 4),
        "rare": [[word, count] for word, count in rare],
        "grade": round(grade, 1),
    }


def stat_cefr(stats):
    ratio, grade = stats["rareRatio"], stats["grade"]
    score = ratio * 100 + max(0.0, grade - 8) * 0.8
    if score < 4.5:
        return "A2"
    if score < 8.5:
        return "B1"
    if score < 13:
        return "B2"
    return "C1"


def reconcile(ai_level, stats):
    """The AI judges meaning and style, word statistics judge vocabulary; disagreements settle on the harder-leaning middle."""
    a, b = CEFR.index(ai_level), CEFR.index(stat_cefr(stats))
    if abs(a - b) <= 1:
        return CEFR[a]
    return CEFR[(a + b + 1) // 2]


# ---------- AI review ----------
SYSTEM_PROMPT = """你是面向中国英语学习者的分级阅读库编辑。用户给你一篇维基百科文章的节选（已按段落编号），读者正在备考四六级、考研、雅思。
你的任务：判断它是否适合收入阅读库，并给出分级与辅助材料。绝对不要改写或续写英文原文。
只输出一个 JSON 对象，不要输出其他文字。字段：
{
  "verdict": "accept" 或 "reject",
  "reason": "一句中文，说明收入或拒绝的原因（60 字内）",
  "cefr": "A2" | "B1" | "B2" | "C1" | "C2"   // 综合词汇、句式和概念难度，面向非英语母语者
  "topic": 从 [自然, 科学, 技术, 生活, 文化, 艺术, 健康, 城市, 社会, 探索] 中选一个,
  "tags": 2 到 4 个中文标签，每个 2-8 字,
  "intro": "一句中文导读，说明这篇讲什么（40 字内）",
  "translations": ["第 1 段的中文译文", "第 2 段的中文译文", ...]   // 与英文段落数量和顺序严格一致，忠实通顺
}
应拒绝(reject)的情形：内容像列表、年表、数据表或术语堆砌；含大量公式、符号、非英语文字；正在发生的时事、政治争议、宗教争议、民族与性别争议；
暴力、色情、自残等不适合学习场景的描写；在世人物的评价；明显过时、残缺、广告腔或有事实可疑之处；太短不成篇。
拒绝时 translations 可以为空数组，tags 可为空，intro 可为空字符串。"""


def build_prompt(title, paragraphs, stats):
    numbered = "\n\n".join("[%d] %s" % (i + 1, p) for i, p in enumerate(paragraphs))
    hint = "统计提示：%d 词，平均句长 %.1f 词，罕见词占 %.0f%%。" % (stats["words"], stats["avgSentence"], stats["rareRatio"] * 100)
    return "文章标题：%s\n%s\n请输出 JSON。\n\n%s" % (title, hint, numbered)


def validate_review(data, paragraph_count):
    if not isinstance(data, dict) or data.get("verdict") not in ("accept", "reject"):
        raise ValueError("verdict missing")
    reason = str(data.get("reason") or "").strip()[:120]
    if data["verdict"] == "reject":
        return {"verdict": "reject", "reason": reason or "AI 判断不适合收录"}
    cefr = str(data.get("cefr") or "").strip().upper()
    if cefr == "C2":
        return {"verdict": "reject", "reason": reason or "难度过高"}
    if cefr not in CEFR:
        raise ValueError("cefr invalid")
    topic = str(data.get("topic") or "").strip()
    if topic not in TOPICS:
        raise ValueError("topic invalid")
    translations = data.get("translations")
    if not isinstance(translations, list) or len(translations) != paragraph_count:
        raise ValueError("translation count differs from paragraph count")
    cleaned = []
    for item in translations:
        item = str(item).strip()
        if not item or len(item) > 4000 or not re.search(r"[\u4e00-\u9fff]", item):
            raise ValueError("translation empty or not Chinese")
        cleaned.append(item)
    tags = [str(t).strip() for t in (data.get("tags") or []) if str(t).strip()][:4]
    tags = [t for t in tags if 1 <= len(t) <= 10]
    intro = str(data.get("intro") or "").strip()
    if not intro or len(intro) > 80:
        raise ValueError("intro missing or too long")
    return {"verdict": "accept", "reason": reason, "cefr": cefr, "topic": topic, "tags": tags, "intro": intro, "translations": cleaned}


class DeepSeek:
    def __init__(self):
        self.key = os.environ.get("LIBRARY_AI_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
        self.base = (os.environ.get("LIBRARY_AI_BASE") or "https://api.deepseek.com").rstrip("/")
        self.model = os.environ.get("LIBRARY_AI_MODEL") or "deepseek-flash"
        # Gateways such as Cline route by provider; this pins the upstream, e.g. "deepseek".
        self.only = [name.strip() for name in (os.environ.get("LIBRARY_AI_GATEWAY_ONLY") or "").split(",") if name.strip()]

    @property
    def ready(self):
        return bool(self.key)

    def review(self, title, paragraphs, stats):
        payload = {
            "model": self.model,
            "temperature": 0.2,
            "max_tokens": 6000,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": build_prompt(title, paragraphs, stats)}],
        }
        if self.only:
            payload["providerOptions"] = {"gateway": {"only": self.only}}
        last = None
        for _ in range(2):
            try:
                body, _type = http(
                    self.base + "/chat/completions", data=json.dumps(payload).encode("utf-8"), timeout=240, min_gap=0.5,
                    headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"},
                )
                answer = json.loads(body.decode("utf-8"))
                if isinstance(answer.get("data"), dict):  # some gateways wrap the completion in "data"
                    answer = answer["data"]
                content = answer["choices"][0]["message"]["content"]
                review = validate_review(json.loads(content), len(paragraphs))
                review["model"] = self.model
                return review
            except (ValueError, KeyError, IndexError, RuntimeError) as error:
                last = error
        raise RuntimeError("AI review failed: %s" % last)


# ---------- images ----------
def plain_credit(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()[:300] or "Wikimedia Commons"


def fetch_image(lang, page, article_id):
    """A freely licensed Commons thumbnail for the article, or None."""
    original = (page.get("original") or {}).get("source")
    thumb = (page.get("thumbnail") or {}).get("source")
    if not original or not thumb:
        return None
    parsed = urllib.parse.urlsplit(original)
    if parsed.netloc != "upload.wikimedia.org" or not parsed.path.startswith("/wikipedia/commons/"):
        return None
    filename = urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1])
    try:
        data = wiki_json_commons(filename)
        info = (data["query"]["pages"][0].get("imageinfo") or [None])[0]
        meta = info["extmetadata"]
        license_name = meta.get("LicenseShortName", {}).get("value", "")
        if not re.match(r"^(CC BY(?:-SA)?(?: |$)|CC0|Public domain)", license_name, re.I):
            return None
        thumb_url = urllib.parse.urlsplit(thumb)
        if thumb_url.netloc not in ("upload.wikimedia.org", "thumb.wikimedia.org"):
            return None
        raw, content_type = http(urllib.parse.urlunsplit(thumb_url._replace(query="")), timeout=40)
        kind = content_type.split(";")[0].strip()
        extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(kind)
        if not extension or len(raw) > 600000:
            return None
        IMG_DIR.mkdir(parents=True, exist_ok=True)
        name = "%s.%s" % (article_id, extension)
        (IMG_DIR / name).write_bytes(raw)
        license_url = (meta.get("LicenseUrl", {}).get("value") or "https://creativecommons.org/publicdomain/mark/1.0/").replace("http:", "https:", 1)
        return {
            "file": name, "type": kind,
            "meta": {
                "path": "/v1/library/image/" + article_id, "alt": page.get("title", ""), "sourceUrl": info["descriptionurl"],
                "credit": plain_credit(meta.get("Artist", {}).get("value")), "license": {"name": license_name[:100], "url": license_url},
            },
        }
    except Exception as error:
        print("image skipped for %s: %s" % (article_id, error))
        return None


def wiki_json_commons(filename):
    query = urllib.parse.urlencode({
        "action": "query", "prop": "imageinfo", "iiprop": "extmetadata|url", "titles": "File:" + filename,
        "format": "json", "formatversion": "2",
    })
    body, _ = http("https://commons.wikimedia.org/w/api.php?" + query)
    return json.loads(body.decode("utf-8"))


# ---------- pipeline ----------
def slug(title):
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]
    return base or hashlib.sha1(title.encode("utf-8")).hexdigest()[:10]


def fetch_page(lang, title):
    data = wiki_json(
        lang, action="query", redirects="1", titles=title, prop="extracts|revisions|pageprops|categories|pageimages",
        explaintext="1", exsectionformat="wiki", rvprop="ids|timestamp", cllimit="max", piprop="original|thumbnail", pithumbsize="800",
    )
    page = data["query"]["pages"][0]
    return None if page.get("missing") or page.get("invalid") else page


def rule_reject(page, paragraphs, stats):
    if "disambiguation" in (page.get("pageprops") or {}):
        return "消歧义页"
    for category in page.get("categories") or []:
        if BLOCKED_CATEGORY.search(category.get("title", "")):
            return "分类不适合学习场景：" + category["title"]
    if stats["words"] < MIN_WORDS:
        return "正文太短"
    if stats["rareRatio"] > 0.22:
        return "罕见词比例过高"
    if len(paragraphs) < 2:
        return "不足两个自然段"
    return ""


def process(db, lang, title, topic, ranks, ai, no_ai=False):
    """Fetch, filter, measure and review one article. Returns a short status string."""
    page = fetch_page(lang, title)
    if not page:
        return "missing"
    real_title = page["title"]
    article_id = "lib-%s-%s" % (lang, slug(real_title))
    paragraphs = select_paragraphs(page.get("extract", ""))
    stats = analyze(paragraphs, ranks) if paragraphs else {"words": 0, "rareRatio": 0, "rare": [], "grade": 0, "avgSentence": 0, "sentences": 0}
    revision = str((page.get("revisions") or [{}])[0].get("revid", ""))
    now = store.utc_now()
    content_hash = hashlib.sha256("\n".join(paragraphs).encode("utf-8")).hexdigest()
    existing = db.execute("SELECT status, revision, content_hash FROM articles WHERE id = ?", (article_id,)).fetchone()
    if existing and existing["status"] == "hidden":
        return "hidden"  # taken down by hand; a later edit of the page must not bring it back
    if existing and existing["revision"] == revision and existing["status"] in ("published", "rejected"):
        db.execute("UPDATE articles SET checked_at = ? WHERE id = ?", (now, article_id))
        db.commit()
        return "unchanged"
    base = {"id": article_id, "lang": lang, "title": real_title, "revision": revision, "retrieved_at": now, "checked_at": now, "content_hash": content_hash}
    reason = rule_reject(page, paragraphs, stats)
    if reason:
        store.save_article(db, {**base, "status": "rejected", "body": {}, "review": {"verdict": "reject", "reason": reason, "by": "rules"}})
        return "rejected: " + reason
    if no_ai or not ai.ready:
        store.save_article(db, {**base, "status": "pending_ai", "body": {"paragraphs": paragraphs, "stats": stats}, "review": {}})
        return "pending_ai"
    review = ai.review(real_title, paragraphs, stats)
    if review["verdict"] != "accept":
        store.save_article(db, {**base, "status": "rejected", "body": {}, "review": {**review, "by": "ai"}})
        return "rejected: " + review["reason"]
    cefr = reconcile(review["cefr"], stats)
    image = fetch_image(lang, page, article_id)
    body = {
        "id": article_id, "title": real_title, "wikiTitle": real_title, "lang": lang,
        "level": "easy" if cefr in ("A2", "B1") else "standard", "cefr": cefr, "topic": review["topic"], "tags": review["tags"],
        "intro": review["intro"], "paragraphs": paragraphs, "translations": review["translations"],
        "source": SOURCES[lang]["name"], "sourceUrl": SOURCES[lang]["site"] + urllib.parse.quote(real_title.replace(" ", "_"), safe="_()',!*~-."),
        "author": "Wikipedia contributors", "license": LICENSE, "retrievedAt": now, "revision": revision,
        "stats": {k: stats[k] for k in ("words", "avgSentence", "rareRatio", "grade", "rare")},
    }
    if image:
        body["image"] = image["meta"]
    store.save_article(db, {
        **base, "status": "published", "body": body, "review": {**review, "by": "ai", "statCefr": stat_cefr(stats), "finalCefr": cefr},
        "image_file": image["file"] if image else None, "image_type": image["type"] if image else None,
    })
    return "published " + cefr


def run(titles, refresh, no_ai):
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    db = store.connect(DB_PATH)
    ranks = load_wordlist()
    ai = DeepSeek()
    if not ai.ready and not no_ai:
        print("No AI key configured (LIBRARY_AI_KEY): articles are collected but stay unpublished.")
    print("candidates added: %d" % fill_candidates(db))
    pending = [r for r in db.execute("SELECT id, lang, title FROM articles WHERE status = 'pending_ai' ORDER BY seq")] if ai.ready and not no_ai else []
    for row in pending[:titles * 2]:
        print("%s: %s" % (row["id"], safe(lambda: process(db, row["lang"], row["title"], "", ranks, ai))))
    published = db.execute("SELECT COUNT(*) FROM articles WHERE status = 'published'").fetchone()[0]
    room = max(0, int(os.environ.get("LIBRARY_MAX", "400")) - published)
    if not room:
        print("Library is at its size limit; only refreshing.")
    rows = db.execute("SELECT title, topic FROM candidates WHERE state = 'new' ORDER BY position LIMIT ?", (titles if room else 0,)).fetchall()
    for row in rows:
        results = []
        for lang in ("simple", "en"):
            results.append("%s=%s" % (lang, safe(lambda: process(db, lang, row["title"], row["topic"], ranks, ai, no_ai))))
        db.execute("UPDATE candidates SET state = 'done', note = ? WHERE title = ?", ("; ".join(results)[:300], row["title"]))
        db.commit()
        print("%s -> %s" % (row["title"], "; ".join(results)))
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - REVIEW_DAYS * 86400))
    stale = db.execute("SELECT id, lang, title FROM articles WHERE status = 'published' AND checked_at < ? ORDER BY checked_at LIMIT ?", (cutoff, refresh)).fetchall() if ai.ready and not no_ai else []
    for row in stale:
        print("refresh %s: %s" % (row["id"], safe(lambda: process(db, row["lang"], row["title"], "", ranks, ai, no_ai))))
    status(db)


def safe(call):
    try:
        return call()
    except Exception as error:  # one broken article must not stop the batch
        return "error: %s" % str(error)[:160]


def status(db=None):
    db = db or store.connect(DB_PATH)
    counts = {r["status"]: r["n"] for r in db.execute("SELECT status, COUNT(*) AS n FROM articles GROUP BY status")}
    todo = db.execute("SELECT COUNT(*) FROM candidates WHERE state = 'new'").fetchone()[0]
    print("articles: %s; candidates waiting: %d" % (json.dumps(counts, ensure_ascii=False), todo))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    runner = sub.add_parser("run")
    runner.add_argument("--titles", type=int, default=int(os.environ.get("LIBRARY_BATCH", "20")))
    runner.add_argument("--refresh", type=int, default=10)
    runner.add_argument("--no-ai", action="store_true")
    sub.add_parser("status")
    hide = sub.add_parser("hide")
    hide.add_argument("article_id")
    args = parser.parse_args(argv)
    if args.command == "run":
        run(args.titles, args.refresh, args.no_ai)
    elif args.command == "status":
        status()
    else:
        db = store.connect(DB_PATH)
        print("hidden" if store.set_status(db, args.article_id, "hidden") else "not found or already hidden")


if __name__ == "__main__":
    main()
