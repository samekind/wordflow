"""Storage for the online reading library, shared by the pipeline (writer) and the cloud service (reader)."""
import json
import re
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,          -- published | pending_ai | rejected | hidden
  seq INTEGER NOT NULL,          -- bumps on every visible change so clients can sync incrementally
  revision TEXT NOT NULL DEFAULT '',
  retrieved_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,            -- JSON served to the app (published only)
  review TEXT NOT NULL DEFAULT '{}', -- JSON: the AI verdict, reason and model, kept for audit
  image_file TEXT,
  image_type TEXT
);
CREATE INDEX IF NOT EXISTS articles_status_seq ON articles (status, seq);
CREATE TABLE IF NOT EXISTS candidates (
  title TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  position INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'new', -- new | done | skipped
  note TEXT NOT NULL DEFAULT ''
);
"""
ID_PATTERN = re.compile(r"^lib-(en|simple)-[a-z0-9-]{1,80}$")


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def connect(path, readonly=False):
    path = Path(path)
    if readonly:
        db = sqlite3.connect("file:%s?mode=ro" % path.as_posix(), uri=True, check_same_thread=False)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(path), check_same_thread=False)
        db.executescript(SCHEMA)
    db.row_factory = sqlite3.Row
    return db


def next_seq(db):
    return (db.execute("SELECT COALESCE(MAX(seq), 0) FROM articles").fetchone()[0] or 0) + 1


def save_article(db, record):
    """Insert or replace one article. `record` carries the columns plus `body` (dict)."""
    old = db.execute("SELECT status, content_hash FROM articles WHERE id = ?", (record["id"],)).fetchone()
    body = json.dumps(record["body"], ensure_ascii=False, separators=(",", ":"))
    changed = old is None or old["status"] != record["status"] or old["content_hash"] != record["content_hash"]
    seq = next_seq(db) if changed else db.execute("SELECT seq FROM articles WHERE id = ?", (record["id"],)).fetchone()[0]
    db.execute(
        "INSERT INTO articles (id, lang, title, status, seq, revision, retrieved_at, checked_at, content_hash, body, review, image_file, image_type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET status = excluded.status, seq = excluded.seq, revision = excluded.revision, "
        "retrieved_at = excluded.retrieved_at, checked_at = excluded.checked_at, content_hash = excluded.content_hash, "
        "body = excluded.body, review = excluded.review, image_file = excluded.image_file, image_type = excluded.image_type",
        (record["id"], record["lang"], record["title"], record["status"], seq, record.get("revision", ""),
         record["retrieved_at"], record["checked_at"], record["content_hash"], body,
         json.dumps(record.get("review", {}), ensure_ascii=False), record.get("image_file"), record.get("image_type")),
    )
    db.commit()


def set_status(db, article_id, status):
    row = db.execute("SELECT status FROM articles WHERE id = ?", (article_id,)).fetchone()
    if not row or row["status"] == status:
        return False
    db.execute("UPDATE articles SET status = ?, seq = ? WHERE id = ?", (status, next_seq(db), article_id))
    db.commit()
    return True


def published_page(db, since, limit):
    """Articles that changed after `since`, the ids still published, and whether more pages remain."""
    limit = max(1, min(int(limit), 60))
    rows = db.execute(
        "SELECT seq, body FROM articles WHERE status = 'published' AND seq > ? ORDER BY seq LIMIT ?", (int(since), limit + 1)
    ).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    ids = [r["id"] for r in db.execute("SELECT id FROM articles WHERE status = 'published' ORDER BY seq")]
    cursor = rows[-1]["seq"] if rows else int(since)
    return {
        "version": 1,
        "generatedAt": utc_now(),
        "cursor": cursor,
        "more": more,
        "ids": ids,
        "articles": [json.loads(r["body"]) for r in rows],
    }


def image_for(db, article_id):
    if not ID_PATTERN.match(article_id):
        return None
    row = db.execute(
        "SELECT image_file, image_type FROM articles WHERE id = ? AND status = 'published' AND image_file IS NOT NULL",
        (article_id,),
    ).fetchone()
    return (row["image_file"], row["image_type"]) if row else None
