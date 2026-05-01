#!/usr/bin/env python3
# ============================================================
# BianinhoBridge Python — Electron ↔ Hermes bridge
# Corre dentro de bianinho-venv
# ============================================================

import sys
import json
import os
import socket
import threading
import hashlib
import hmac
import time
import platform
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────
HOME = Path.home()
BINHO_BASE = Path(__file__).parent.parent  # ~/Aionui-Bianinho ou . do install
HERMES_PATH = HOME / ".hermes"

# ── Platform detection ────────────────────────────────────
PLATFORM = platform.system().lower()  # darwin | linux | windows


def get_venv_python():
    """Devolve o path para o Python do venv, ou fallback para python3."""
    if PLATFORM == "darwin" or PLATFORM == "linux":
        venv_python = BINHO_BASE / "bianinho-venv" / "bin" / "python3"
        if venv_python.exists():
            return str(venv_python)
    return "python3"


# ── Logging ────────────────────────────────────────────────
LOG_DIR = BINHO_BASE / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "bianinho_bridge.log"


def log(level: str, msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}\n"
    with open(LOG_FILE, "a") as f:
        f.write(line)
    print(line.strip(), flush=True)


# ── HMAC Auth ──────────────────────────────────────────────
SECRET_FILE = BINHO_BASE / "config" / "bridge_secret.key"


def get_secret() -> bytes:
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes()
    secret = os.urandom(32)
    SECRET_FILE.write_bytes(secret)
    return secret


def verify_hmac(payload: bytes, signature: str) -> bool:
    expected = hmac.new(get_secret(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── Hermes path detection ──────────────────────────────────
def detect_hermes_path() -> str:
    """Deteta o path do Hermes — tenta múltiplaslocalizações."""
    candidates = [
        HERMES_PATH,
        Path.home() / ".hermes",
        Path("/home/alvarobiano/.hermes"),
    ]
    for p in candidates:
        if p.exists() and (p / "hermes-agent").exists() or (p / "config.yaml").exists():
            return str(p)
    # Fallback: usa o que existir
    for p in candidates:
        if p.exists():
            return str(p)
    return str(HERMES_PATH)


# ── Status ─────────────────────────────────────────────────
class BridgeStatus:
    def __init__(self):
        self.started_at = time.time()
        self.messages_processed = 0
        self.errors = 0
        self.last_error: str | None = None
        self.lock = threading.Lock()

    def inc(self, what="messages"):
        with self.lock:
            if what == "messages":
                self.messages_processed += 1
            elif what == "errors":
                self.errors += 1

    def set_error(self, err: str):
        with self.lock:
            self.errors += 1
            self.last_error = err

    def info(self) -> dict:
        with self.lock:
            return {
                "uptime": int(time.time() - self.started_at),
                "messages_processed": self.messages_processed,
                "errors": self.errors,
                "last_error": self.last_error,
                "platform": PLATFORM,
                "hermes_path": str(HERMES_PATH),
            }


status = BridgeStatus()


# ── Command handlers ────────────────────────────────────────
def cmd_status() -> dict:
    return {"ok": True, **status.info()}


def cmd_ping(args: dict) -> dict:
    return {"ok": True, "pong": args.get("echo", "pong"), "platform": PLATFORM}


def cmd_hermes_path(args: dict) -> dict:
    path = detect_hermes_path()
    return {"ok": True, "path": path, "exists": Path(path).exists()}


def cmd_list_skills(args: dict) -> dict:
    """Lista skills do Hermes."""
    skills_dir = Path(detect_hermes_path()) / "skills"
    if not skills_dir.exists():
        return {"ok": False, "error": f"Skills dir not found: {skills_dir}"}

    skills = []
    for f in sorted(skills_dir.iterdir()):
        if f.is_file() and f.suffix == ".md":
            skills.append({"name": f.stem, "size": f.stat().st_size})
        elif f.is_dir():
            # Skill com pasta (template)
            skills.append({"name": f.name, "type": "directory"})

    return {"ok": True, "count": len(skills), "skills": skills}


def cmd_check_hermes(args: dict) -> dict:
    """Verifica se o Hermes está acessível."""
    hermes_path = detect_hermes_path()
    checks = {
        "hermes_path": hermes_path,
        "exists": Path(hermes_path).exists(),
        "config_yaml": Path(hermes_path, "config.yaml").exists(),
        "agent_binary": Path(hermes_path, "hermes-agent").exists(),
        "skills_dir": (Path(hermes_path) / "skills").exists(),
        "sessions_db": Path(hermes_path, "sessions.db").exists(),
    }
    all_ok = all(checks.values())
    return {"ok": all_ok, "checks": checks}


def cmd_echo(args: dict) -> dict:
    """Echo para testar a bridge."""
    return {"ok": True, "echo": args.get("msg", ""), "platform": PLATFORM}


def cmd_platform_info(args: dict) -> dict:
    """Info da plataforma."""
    return {
        "ok": True,
        "system": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
        "machine": platform.machine(),
        "python": platform.python_version(),
    }


# ── Protocolo ──────────────────────────────────────────────
COMMANDS = {
    "ping": cmd_ping,
    "status": cmd_status,
    "hermes_path": cmd_hermes_path,
    "list_skills": cmd_list_skills,
    "check_hermes": cmd_check_hermes,
    "echo": cmd_echo,
    "platform_info": cmd_platform_info,
}


def handle_message(raw: bytes) -> bytes:
    """Processa uma mensagem e devolve resposta."""
    try:
        # Parse
        try:
            msg = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return json.dumps({"ok": False, "error": "Invalid JSON"}).encode()

        cmd = msg.get("cmd", "")
        args = msg.get("args", {})

        if cmd not in COMMANDS:
            return json.dumps({"ok": False, "error": f"Unknown command: {cmd}"}).encode()

        handler = COMMANDS[cmd]
        result = handler(args)
        status.inc("messages")
        return json.dumps(result).encode()

    except Exception as e:
        status.set_error(str(e))
        status.inc("errors")
        log("ERROR", f"Handle error: {e}")
        return json.dumps({"ok": False, "error": str(e)}).encode()


# ── Modo 1: TCP Server (principal) ────────────────────────
def tcp_server(port: int = 18743):
    """Server TCP para receber comandos do Electron."""
    log("INFO", f"Starting TCP server on port {port}")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        sock.bind(("127.0.0.1", port))
        sock.listen(5)
        log("INFO", f"TCP server listening on 127.0.0.1:{port}")
    except OSError as e:
        log("WARN", f"Port {port} em uso — a tentar próximo...")
        port += 1
        sock.bind(("127.0.0.1", port))
        sock.listen(5)
        log("INFO", f"TCP server listening on 127.0.0.1:{port}")

    while True:
        try:
            conn, addr = sock.accept()
            data = b""
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk

            if data:
                response = handle_message(data)
                conn.sendall(len(response).to_bytes(4, "big"))
                conn.sendall(response)

            conn.close()
        except Exception as e:
            log("ERROR", f"Connection error: {e}")


# ── Modo 2: STDIO (alternativo, para debugging) ───────────
def stdio_mode():
    """Lê comandos do stdin, escreve respostas para stdout. Para debugging."""
    log("INFO", "Bridge em modo STDIO")
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            raw = line.strip().encode("utf-8")
            if raw:
                response = handle_message(raw)
                sys.stdout.write(response.decode("utf-8") + "\n")
                sys.stdout.flush()
        except Exception as e:
            log("ERROR", f"STDIO error: {e}")


# ── Entry point ────────────────────────────────────────────
if __name__ == "__main__":
    log("INFO", f"BianinhoBridge starting — platform={PLATFORM}")

    if "--stdio" in sys.argv:
        stdio_mode()
    else:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 18743
        tcp_server(port)
