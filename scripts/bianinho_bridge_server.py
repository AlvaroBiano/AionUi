#!/usr/bin/env python3
"""
BianinhoBridge HTTP Server — expõe API do Bianinho via HTTP na rede Tailscale
O AionUI no MacLiga-se a este servidor em vez de um bridge local.
"""

import sys
import json
import os
import re
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import subprocess
import threading
import time
import hashlib
import hmac as hmac_lib

# ── Paths ─────────────────────────────────────────────────────────────────────
HOME = Path.home()
HERMES_PATH = HOME / ".hermes"
CONFIG_DIR = HERMES_PATH / "config"
RAG_DIR = HOME / "KnowledgeBase" / "knowledge_db"
BRIDGE_SECRET_FILE = HERMES_PATH / "bridge_secret.key"

# RAG server local
RAG_HOST = "127.0.0.1"
RAG_PORT = 3101

# Tailscale IP do servidor
BIND_HOST = "100.79.189.95"
BIND_PORT = 18743

# ── Logging ────────────────────────────────────────────────────────────────────
LOG_FILE = HERMES_PATH / "logs" / "bianinho_bridge_server.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

def log(level: str, msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")
    print(line, flush=True)

# ── HMAC Auth ─────────────────────────────────────────────────────────────────
def get_secret() -> bytes:
    if BRIDGE_SECRET_FILE.exists():
        return BRIDGE_SECRET_FILE.read_bytes()
    secret = os.urandom(32)
    BRIDGE_SECRET_FILE.write_bytes(secret)
    os.chmod(BRIDGE_SECRET_FILE, 0o600)
    log("INFO", "New bridge secret generated")
    return secret

def verify_hmac(payload_bytes: bytes, signature: str) -> bool:
    try:
        expected = hmac_lib.new(get_secret(), payload_bytes, hashlib.sha256).hexdigest()
        return hmac_lib.compare_digest(expected, signature)
    except Exception:
        return False

def create_token() -> str:
    ts = str(int(time.time()))
    sig = hmac_lib.new(get_secret(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"

# ── RAG helpers ───────────────────────────────────────────────────────────────
def rag_search(query: str, category: str = "chunks", topK: int = 5) -> dict:
    """Pesquisa no RAG via HTTP local."""
    import urllib.request, urllib.error
    try:
        url = f"http://{RAG_HOST}:{RAG_PORT}/search?q={urllib.parse.quote(query)}&k={topK}&collection={category}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log("ERROR", f"rag_search failed: {e}")
        return {"results": [], "error": str(e)}

def rag_stats() -> dict:
    """Estatísticas do RAG."""
    import urllib.request
    try:
        req = urllib.request.Request(f"http://{RAG_HOST}:{RAG_PORT}/health")
        with urllib.request.urlopen(req, timeout=5) as r:
            return {"stats": json.loads(r.read())}
    except Exception as e:
        log("ERROR", f"rag_stats failed: {e}")
        return {"stats": {"total_chunks": 0, "categories": []}}

# ── Hermes CLI helpers ────────────────────────────────────────────────────────
HERMES_CLI = str(HERMES_PATH / "hermes-agent" / "venv" / "bin" / "python" if (HERMES_PATH / "hermes-agent" / "venv" / "bin" / "python").exists() else "python3")

def hermes_cmd(args: list, timeout: int = 30) -> dict:
    """Executa comando hermes CLI e retorna JSON."""
    try:
        result = subprocess.run(
            [HERMES_CLI, "-m", "hermes_cli.main"] + args,
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "HERMES_HOME": str(HERMES_PATH)}
        )
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"ok": False, "error": result.stdout or result.stderr}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Command timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ── Inbox ─────────────────────────────────────────────────────────────────────
INBOX_FILE = HERMES_PATH / "inbox.json"

def inbox_load() -> list:
    if not INBOX_FILE.exists():
        return []
    try:
        return json.loads(INBOX_FILE.read_text())
    except:
        return []

def inbox_save(items: list):
    INBOX_FILE.write_text(json.dumps(items, indent=2))

def inbox_list() -> dict:
    items = inbox_load()
    return {"count": len(items), "items": items}

def inbox_add(content: str, priority: str = "medium", tags: list = None, source: str = "aionui") -> dict:
    items = inbox_load()
    item = {
        "id": f"inb_{int(time.time()*1000)}",
        "content": content,
        "priority": priority,
        "tags": tags or [],
        "source": source,
        "done": False,
        "createdAt": time.time()
    }
    items.insert(0, item)
    inbox_save(items)
    return {"ok": True, "item": item}

def inbox_done(id: str) -> dict:
    items = inbox_load()
    for item in items:
        if item.get("id") == id:
            item["done"] = not item.get("done", False)
            inbox_save(items)
            return {"ok": True, "item": item}
    return {"ok": False, "error": "Item not found"}

def inbox_delete(id: str) -> dict:
    items = inbox_load()
    new_items = [i for i in items if i.get("id") != id]
    if len(new_items) == len(items):
        return {"ok": False, "error": "Item not found"}
    inbox_save(new_items)
    return {"ok": True}

# ── Skills ────────────────────────────────────────────────────────────────────
SKILLS_DIR = HERMES_PATH / "skills"

def list_skills() -> dict:
    if not SKILLS_DIR.exists():
        return {"count": 0, "skills": []}
    skills = []
    for d in SKILLS_DIR.iterdir():
        if d.is_dir():
            size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            skills.append({"name": d.name, "size": size})
    return {"count": len(skills), "skills": skills}

# ── Memory ────────────────────────────────────────────────────────────────────
MEMORY_FILE = HERMES_PATH / "memory.json"

def memory_load() -> dict:
    if not MEMORY_FILE.exists():
        return {}
    try:
        return json.loads(MEMORY_FILE.read_text())
    except:
        return {}

def memory_save(data: dict):
    MEMORY_FILE.write_text(json.dumps(data, indent=2))

def memory_get(key: str) -> dict:
    data = memory_load()
    return {"key": key, "value": data.get(key, "")}

def memory_set(key: str, value: str) -> dict:
    data = memory_load()
    data[key] = value
    memory_save(data)
    return {"ok": True}

# ── Config ─────────────────────────────────────────────────────────────────────
CONFIG_FILE = HERMES_PATH / "config.json"

def config_load() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text())
    except:
        return {}

def config_save(data: dict):
    CONFIG_FILE.write_text(json.dumps(data, indent=2))

def config_get(key: str = None) -> dict:
    data = config_load()
    if key:
        return {"key": key, "value": data.get(key, "")}
    return {"config": data}

def config_set(key: str, value: str) -> dict:
    data = config_load()
    data[key] = value
    config_save(data)
    return {"ok": True}

# ── Cycle status ───────────────────────────────────────────────────────────────
CYCLE_FILE = HERMES_PATH / "cycle_state.json"

def cycle_status() -> dict:
    if not CYCLE_FILE.exists():
        return {"running": False, "lastRun": None, "nextRun": None}
    try:
        return json.loads(CYCLE_FILE.read_text())
    except:
        return {"running": False, "lastRun": None, "nextRun": None}

# ── Platform info ─────────────────────────────────────────────────────────────
import platform as platform_mod

def platform_info() -> dict:
    return {
        "os": platform_mod.system(),
        "release": platform_mod.release(),
        "machine": platform_mod.machine(),
        "python_version": platform_mod.python_version(),
        "hostname": platform_mod.node(),
    }

# ── Hermes check ───────────────────────────────────────────────────────────────
def check_hermes() -> dict:
    checks = {
        "hermes_path": str(HERMES_PATH),
        "hermes_exists": HERMES_PATH.exists(),
        "skills_exists": SKILLS_DIR.exists(),
        "rag_exists": RAG_DIR.exists(),
        "inbox_writable": os.access(HERMES_PATH, os.W_OK),
    }
    return {"ok": all(checks.values()), "checks": checks}

# ── HTTP Handler ───────────────────────────────────────────────────────────────
class BianinhoHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, format, *args):
        pass  # silencioso

    def send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def read_json(self) -> dict:
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len == 0:
            return {}
        return json.loads(self.rfile.read(content_len))

    def extract_token(self) -> tuple[bool, str]:
        """Extrai e valida HMAC token do header Authorization."""
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return True, ""  # sem token = permitido (dev mode)
        token = auth[7:]
        parts = token.split(".")
        if len(parts) != 2:
            return False, "Invalid token format"
        ts, sig = parts
        # Token válido por 5 minutos
        if abs(int(ts) - int(time.time())) > 300:
            return False, "Token expired"
        if not verify_hmac(ts.encode(), sig):
            return False, "Invalid signature"
        return True, ""

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        ok, err = self.extract_token()
        if not ok:
            return self.send_json({"ok": False, "error": err}, 401)

        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/ping":
            return self.send_json({"ok": True, "pong": "bianinho_bridge_http"})
        elif path == "/status":
            uptime = int(time.time() - START_TIME)
            return self.send_json({
                "ok": True, "uptime": uptime,
                "messagesProcessed": 0, "errors": 0
            })
        elif path == "/platform_info":
            return self.send_json(platform_info())
        elif path == "/check_hermes":
            return self.send_json(check_hermes())
        elif path == "/hermes_path":
            return self.send_json({"path": str(HERMES_PATH), "exists": HERMES_PATH.exists()})
        elif path == "/list_skills":
            return self.send_json(list_skills())
        elif path == "/rag_stats":
            return self.send_json(rag_stats())
        elif path == "/inbox_list":
            return self.send_json(inbox_list())
        elif path == "/cycle_status":
            return self.send_json(cycle_status())
        elif path == "/sync_status":
            return self.send_json({"lastSync": 0, "pendingChanges": 0, "direction": "idle", "errors": []})
        elif path == "/memory":
            key = parse_qs(parsed.query).get("key", [""])[0]
            return self.send_json(memory_get(key))
        elif path == "/config":
            key = parse_qs(parsed.query).get("key", [None])[0]
            return self.send_json(config_get(key) if key else config_get())
        else:
            return self.send_json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        ok, err = self.extract_token()
        if not ok:
            return self.send_json({"ok": False, "error": err}, 401)

        parsed = urlparse(self.path)
        path = parsed.path
        try:
            body = self.read_json()
        except json.JSONDecodeError:
            return self.send_json({"ok": False, "error": "Invalid JSON"}, 400)

        if path == "/rag_search":
            result = rag_search(
                query=body.get("query", ""),
                category=body.get("category", "chunks"),
                topK=body.get("topK", 5)
            )
            return self.send_json(result)
        elif path == "/inbox_add":
            result = inbox_add(
                content=body.get("content", ""),
                priority=body.get("priority", "medium"),
                tags=body.get("tags", []),
                source=body.get("source", "aionui")
            )
            return self.send_json(result)
        elif path == "/inbox_done":
            result = inbox_done(body.get("id", ""))
            return self.send_json(result)
        elif path == "/inbox_delete":
            result = inbox_delete(body.get("id", ""))
            return self.send_json(result)
        elif path == "/memory_set":
            result = memory_set(body.get("key", ""), body.get("value", ""))
            return self.send_json(result)
        elif path == "/config_set":
            result = config_set(body.get("key", ""), body.get("value", ""))
            return self.send_json(result)
        elif path == "/cycle_trigger":
            return self.send_json({"ok": True, "triggered": int(time.time())})
        elif path == "/token":
            # Gera um token HMAC para o cliente
            return self.send_json({"token": create_token()})
        else:
            return self.send_json({"ok": False, "error": "Not found"}, 404)

START_TIME = time.time()

def main():
    log("INFO", f"Iniciando BianinhoBridge HTTP Server em {BIND_HOST}:{BIND_PORT}")
    server = HTTPServer((BIND_HOST, BIND_PORT), BianinhoHandler)
    log("INFO", f"BianinhoBridge HTTP Server iniciado em http://{BIND_HOST}:{BIND_PORT}")
    log("INFO", "Endpoints: GET /ping, /status, /platform_info, /check_hermes, /list_skills, /rag_stats, /inbox_list, /cycle_status")
    log("INFO", "Endpoints: POST /rag_search, /inbox_add, /inbox_done, /inbox_delete, /memory_set, /config_set, /token")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("INFO", "Servidor encerrado")
        server.shutdown()

if __name__ == "__main__":
    main()
