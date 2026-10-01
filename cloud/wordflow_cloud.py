#!/usr/bin/env python3
"""Small Wordflow cloud sync. Bind only to the docker bridge or loopback."""
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("WORDFLOW_CLOUD_DIR", "/srv/wordflow"))
DB_PATH = ROOT / "cloud.sqlite"
PEPPER_PATH = ROOT / "pepper"
RELEASE_PATH = ROOT / "release.json"
INDEX_PATH = ROOT / "index.html"
ASSETS = ROOT / "assets"
APK_PATH = ROOT / "releases" / "wordflow.apk"
MAX_BODY = 12 * 1024 * 1024
HOST = os.environ.get("WORDFLOW_BIND", "172.29.0.1")
PORT = int(os.environ.get("WORDFLOW_PORT", "8120"))
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
ALLOWED_ORIGINS = {
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
}


def digest(value):
    return hashlib.sha256(PEPPER_PATH.read_bytes() + value.encode("utf-8")).hexdigest()


def connect():
    db = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        """CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            recovery_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS snapshots (
            account_id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            saved_at TEXT NOT NULL,
            body TEXT NOT NULL
        )"""
    )
    db.commit()
    return db


DB = None
# One sqlite connection is shared by all request threads; serialize use so the
# revision check and the snapshot write happen as one step.
DB_LOCK = threading.Lock()
# Failed recovery attempts per client IP: 5 failures per 15 minutes.
RECOVER_WINDOW = 15 * 60
RECOVER_LIMIT = 5
RECOVER_FAILS = {}
RECOVER_LOCK = threading.Lock()


def recover_blocked(ip, now):
    with RECOVER_LOCK:
        recent = [t for t in RECOVER_FAILS.get(ip, []) if now - t < RECOVER_WINDOW]
        if recent:
            RECOVER_FAILS[ip] = recent
        else:
            RECOVER_FAILS.pop(ip, None)
        return len(recent) >= RECOVER_LIMIT


def recover_failed(ip, now):
    with RECOVER_LOCK:
        RECOVER_FAILS.setdefault(ip, []).append(now)
        if len(RECOVER_FAILS) > 10000:
            RECOVER_FAILS.clear()


def recovery_code():
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return raw[:4] + "-" + raw[4:]


def account_for_token(token):
    with DB_LOCK:
        row = DB.execute("SELECT id FROM accounts WHERE token_hash = ?", (digest(token),)).fetchone()
    return row["id"] if row else None


def snapshot_meta(account_id):
    row = DB.execute(
        "SELECT revision, saved_at FROM snapshots WHERE account_id = ?", (account_id,)
    ).fetchone()
    if not row:
        return {"revision": 0, "savedAt": None}
    return {"revision": row["revision"], "savedAt": row["saved_at"]}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload, extra=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.apply_cors()
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def apply_cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")

    def read_json(self):
        length = int(self.headers.get("Content-Length") or "0")
        if length < 0 or length > MAX_BODY:
            raise ValueError("学习记录超过 12 MB")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def bearer(self):
        header = self.headers.get("Authorization") or ""
        if not header.startswith("Bearer "):
            return None
        return account_for_token(header[7:].strip())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.apply_cors()
        self.end_headers()

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        asset = self.asset_path(path)
        if asset:
            body_size = asset.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", self.asset_type(asset))
            self.send_header("Content-Length", str(body_size))
            self.apply_cors()
            self.end_headers()
            return
        if path == "/releases/wordflow.apk" and APK_PATH.exists():
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.android.package-archive")
            self.send_header("Content-Length", str(APK_PATH.stat().st_size))
            self.apply_cors()
            self.end_headers()
            return
        if path in ("/", "/index.html") and INDEX_PATH.exists():
            body = INDEX_PATH.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        if path == "/healthz":
            body = b'{"ok": true}'
        elif path == "/v1/release" and RELEASE_PATH.exists():
            body = RELEASE_PATH.read_bytes()
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.apply_cors()
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.apply_cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            return self.send_file(INDEX_PATH, "text/html; charset=utf-8")
        if path == "/healthz":
            return self.send_json(200, {"ok": True})
        asset = self.asset_path(path)
        if asset:
            return self.send_file(asset, self.asset_type(asset))
        if path == "/v1/release":
            if not RELEASE_PATH.exists():
                return self.send_json(404, {"error": "还没有发布版本"})
            return self.send_json(200, json.loads(RELEASE_PATH.read_text("utf-8")))
        if path == "/releases/wordflow.apk":
            return self.send_apk()
        account_id = self.bearer()
        if not account_id:
            return self.send_json(401, {"error": "云端登录已失效，请用恢复码重新打开"})
        if path == "/v1/state/meta":
            with DB_LOCK:
                meta = snapshot_meta(account_id)
            return self.send_json(200, meta)
        if path == "/v1/state":
            with DB_LOCK:
                row = DB.execute("SELECT revision, saved_at, body FROM snapshots WHERE account_id = ?", (account_id,)).fetchone()
            if not row:
                return self.send_json(404, {"error": "云端还没有学习记录"})
            return self.send_json(200, {"revision": row["revision"], "savedAt": row["saved_at"], "state": json.loads(row["body"])})
        return self.send_json(404, {"error": "没有这个地址"})

    def asset_path(self, path):
        if not path.startswith("/assets/"):
            return None
        name = path[len("/assets/"):]
        if not name or "/" in name or "\\" in name or name.startswith("."):
            return None
        candidate = ASSETS / name
        return candidate if candidate.is_file() else None

    def asset_type(self, path):
        suffix = path.suffix.lower()
        if suffix == ".svg":
            return "image/svg+xml"
        if suffix == ".png":
            return "image/png"
        if suffix == ".webp":
            return "image/webp"
        if suffix == ".woff2":
            return "font/woff2"
        return "image/jpeg"

    def send_file(self, path, content_type):
        if not path.exists():
            return self.send_json(404, {"error": "页面不存在"})
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def send_apk(self):
        if not APK_PATH.exists():
            return self.send_json(404, {"error": "安装包尚未上传"})
        size = APK_PATH.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.android.package-archive")
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", "attachment; filename=wordflow.apk")
        self.apply_cors()
        self.end_headers()
        with APK_PATH.open("rb") as apk:
            while True:
                chunk = apk.read(1024 * 256)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            payload = self.read_json()
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        except json.JSONDecodeError:
            return self.send_json(400, {"error": "请求不是有效的 JSON"})
        if path == "/v1/accounts":
            return self.create_account()
        if path == "/v1/recover":
            return self.recover(payload.get("recoveryCode") or "")
        return self.send_json(404, {"error": "没有这个地址"})

    def client_ip(self):
        # Caddy (the only public entry) sets X-Forwarded-For to the real peer; take its last hop.
        forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
        return forwarded or self.client_address[0]

    def create_account(self):
        account_id = secrets.token_hex(8)
        token = secrets.token_urlsafe(32)
        code = recovery_code()
        with DB_LOCK:
            DB.execute(
                "INSERT INTO accounts (id, token_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?)",
                (account_id, digest(token), digest(code), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
            )
            DB.commit()
        return self.send_json(201, {"accountId": account_id, "token": token, "recoveryCode": code})

    def recover(self, code):
        ip = self.client_ip()
        now = time.time()
        if recover_blocked(ip, now):
            return self.send_json(429, {"error": "尝试次数过多，请 15 分钟后再试"}, {"Retry-After": str(RECOVER_WINDOW)})
        normalized = "".join(ch for ch in str(code).upper() if ch.isalnum())
        if len(normalized) == 8:
            normalized = normalized[:4] + "-" + normalized[4:]
        with DB_LOCK:
            row = DB.execute("SELECT id FROM accounts WHERE recovery_hash = ?", (digest(normalized),)).fetchone()
            if row:
                token = secrets.token_urlsafe(32)
                DB.execute("UPDATE accounts SET token_hash = ? WHERE id = ?", (digest(token), row["id"]))
                DB.commit()
        if not row:
            recover_failed(ip, now)
            return self.send_json(404, {"error": "恢复码不正确"})
        return self.send_json(200, {"accountId": row["id"], "token": token})

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        if path != "/v1/state":
            return self.send_json(404, {"error": "没有这个地址"})
        account_id = self.bearer()
        if not account_id:
            return self.send_json(401, {"error": "云端登录已失效，请用恢复码重新打开"})
        try:
            payload = self.read_json()
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        except json.JSONDecodeError:
            return self.send_json(400, {"error": "请求不是有效的 JSON"})
        state = payload.get("state")
        if not isinstance(state, dict) or state.get("version") not in (1, 2, 3) or not isinstance(state.get("words"), list):
            return self.send_json(400, {"error": "学习记录格式无效"})
        if state["version"] >= 2 and not isinstance(state.get("learning"), dict):
            return self.send_json(400, {"error": "新版学习数据缺少草稿状态"})
        if state["version"] == 3 and (not isinstance(state["learning"].get("parked"), list) or not isinstance(state.get("contextStories"), list)):
            return self.send_json(400, {"error": "新版学习数据缺少单元或语境记录"})
        base = payload.get("baseRevision")
        force = bool(payload.get("force"))
        body = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        with DB_LOCK:
            current = snapshot_meta(account_id)
            previous = DB.execute("SELECT body FROM snapshots WHERE account_id = ?", (account_id,)).fetchone()
            if previous and json.loads(previous[0]).get("version", 1) > state["version"]:
                return self.send_json(409, {"error": "云端记录已升级，请更新应用后操作，旧版本不能覆盖新版草稿", "revision": current["revision"]})
            if current["revision"] and base != current["revision"] and not force:
                return self.send_json(409, {"error": "云端有更新的记录", "revision": current["revision"], "savedAt": current["savedAt"]})
            revision = current["revision"] + 1
            saved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            DB.execute(
                "INSERT INTO snapshots (account_id, revision, saved_at, body) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(account_id) DO UPDATE SET revision = excluded.revision, saved_at = excluded.saved_at, body = excluded.body",
                (account_id, revision, saved_at, body),
            )
            DB.commit()
        return self.send_json(200, {"revision": revision, "savedAt": saved_at})


def main():
    global DB
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "releases").mkdir(exist_ok=True)
    if not PEPPER_PATH.exists():
        PEPPER_PATH.write_bytes(secrets.token_bytes(32))
        os.chmod(str(PEPPER_PATH), 0o600)
    DB = connect()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("wordflow cloud listening on %s:%s" % (HOST, PORT), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
