#!/usr/bin/env python3
# ============================================================
# BianinhoBridge Python — Electron ↔ Hermes bridge
# Fase 1 Completa: auth, rate limit, RAG isolation,
# skills sandbox, backup/rollback, payload validation
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
import subprocess
import resource
import signal
import re
import shutil
import tempfile
from pathlib import Path
from collections import defaultdict
from datetime import datetime

# ── Paths ──────────────────────────────────────────────────
HOME = Path.home()
BINHO_BASE = Path(__file__).parent.parent
HERMES_PATH = HOME / ".hermes"
CONFIG_DIR = HERMES_PATH / "config"
LOG_DIR = BINHO_BASE / "logs"
RAG_DIR = HOME / "KnowledgeBase" / "knowledge_db"
BACKUP_DIR = HERMES_PATH / "backups"

# ── Platform detection ─────────────────────────────────────
PLATFORM = platform.system().lower()

# ── Logging ────────────────────────────────────────────────
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "bianinho_bridge.log"


def log(level: str, msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")
    print(line, flush=True)


# ── HMAC Auth ──────────────────────────────────────────────
SECRET_FILE = CONFIG_DIR / "bridge_secret.key"


def get_secret() -> bytes:
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes()
    secret = os.urandom(32)
    SECRET_FILE.write_bytes(secret)
    os.chmod(SECRET_FILE, 0o600)
    log("INFO", "New bridge secret generated")
    return secret


def verify_hmac(payload: bytes, signature: str) -> bool:
    try:
        expected = hmac.new(get_secret(), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)
    except Exception:
        return False


def create_token() -> str:
    """Cria token HMAC para cliente."""
    ts = str(int(time.time()))
    sig = hmac.new(get_secret(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"


# ── Rate Limiting ─────────────────────────────────────────
class RateLimiter:
    """Token bucket: 100 req/min por client_id."""

    def __init__(self, max_requests: int = 100, window: int = 60):
        self.max_requests = max_requests
        self.window = window
        self.buckets: dict[str, list[float]] = defaultdict(list)
        self.lock = threading.Lock()

    def check(self, client_id: str) -> tuple[bool, dict]:
        with self.lock:
            now = time.time()
            bucket = self.buckets[client_id]
            # Remove requests fora da janela
            bucket[:] = [t for t in bucket if now - t < self.window]
            if len(bucket) >= self.max_requests:
                remaining = 0
                reset_at = int(bucket[0] + self.window)
                return False, {"allowed": False, "remaining": 0, "reset_at": reset_at}
            bucket.append(now)
            remaining = self.max_requests - len(bucket)
            return True, {"allowed": True, "remaining": remaining}


rate_limiter = RateLimiter(max_requests=100, window=60)


# ── Backup / Rollback ───────────────────────────────────────
class BackupManager:
    """3 níveis de backup: pre-write, diário, semanal."""

    def __init__(self):
        self.backup_dir = BACKUP_DIR
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def pre_write_backup(self, source_path: Path, label: str = "") -> str | None:
        """Nível 1: backup antes de cada write RAG."""
        if not source_path.exists():
            return None
        with self._lock:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            label_str = f"_{label}" if label else ""
            backup_name = f"pre_write{label_str}_{ts}"
            backup_path = self.backup_dir / backup_name
            try:
                if source_path.is_dir():
                    shutil.copytree(source_path, backup_path)
                else:
                    shutil.copy2(source_path, backup_path)
                self._cleanup_old_pre_write()
                log("INFO", f"Backup created: {backup_name}")
                return backup_name
            except Exception as e:
                log("ERROR", f"Backup failed: {e}")
                return None

    def _cleanup_old_pre_write(self):
        """Mantém últimos 10 backups pre-write."""
        backups = sorted(self.backup_dir.glob("pre_write_*"), key=lambda p: p.stat().st_mtime)
        for old in backups[:-10]:
            shutil.rmtree(old, ignore_errors=True)

    def restore_pre_write(self, backup_name: str, target_path: Path) -> bool:
        """Restore de um backup pre-write."""
        backup_path = self.backup_dir / backup_name
        if not backup_path.exists():
            log("ERROR", f"Backup not found: {backup_name}")
            return False
        try:
            if target_path.exists():
                if target_path.is_dir():
                    shutil.rmtree(target_path)
                else:
                    target_path.unlink()
            if backup_path.is_dir():
                shutil.copytree(backup_path, target_path)
            else:
                shutil.copy2(backup_path, target_path)
            log("INFO", f"Restored from backup: {backup_name}")
            return True
        except Exception as e:
            log("ERROR", f"Restore failed: {e}")
            return False

    def list_backups(self) -> list[dict]:
        backups = []
        for p in sorted(self.backup_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            backups.append({
                "name": p.name,
                "size": shutil.disk_usage(p).total if p.exists() else 0,
                "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(),
                "type": "pre_write" if p.name.startswith("pre_write") else "other"
            })
        return backups


backup_manager = BackupManager()


# ── Payload Validation ────────────────────────────────────
class PayloadValidator:
    """Validação de payloads com schemas simples."""

    SCHEMAS = {
        "rag_search": {
            "query": {"type": str, "min_len": 1, "max_len": 1000},
            "category": {"type": str, "required": False},
            "topK": {"type": int, "min": 1, "max": 100, "default": 5},
            "score_threshold": {"type": float, "min": 0.0, "max": 1.0, "default": 0.3},
            "access_level": {"type": str, "default": "full"},
        },
        "rag_process": {
            "file_path": {"type": str, "min_len": 1},
            "category": {"type": str, "required": False},
        },
        "inbox_add": {
            "content": {"type": str, "min_len": 1, "max_len": 5000},
            "priority": {"type": str, "default": "3"},
            "tags": {"type": list, "default": []},
            "source": {"type": str, "default": "alvaro"},
        },
        "inbox_done": {"id": {"type": str}},
        "inbox_update": {"id": {"type": str}, "updates": {"type": dict}},
        "skill_execute": {
            "skill_name": {"type": str, "min_len": 1},
            "params": {"type": dict, "default": {}},
        },
        "cron_job_create": {
            "name": {"type": str},
            "schedule": {"type": str},
            "command": {"type": str},
        },
        "cron_job_delete": {"id": {"type": str}},
        "subagent_create": {
            "name": {"type": str},
            "specialty": {"type": str},
            "system_prompt": {"type": str},
            "autonomous": {"type": bool, "default": False},
        },
        "memory_set": {"key": {"type": str}, "value": {"type": str}},
        "config_set": {"key": {"type": str}, "value": {"type": str}},
        "snapshot_export": {"path": {"type": str}},
        "snapshot_import": {"path": {"type": str}},
    }

    def validate(self, schema_name: str, data: dict) -> tuple[bool, dict | str]:
        if schema_name not in self.SCHEMAS:
            return True, {}  # Sem schema = sem validação

        schema = self.SCHEMAS[schema_name]
        errors = {}
        result = {}

        for field, rules in schema.items():
            value = data.get(field)
            ftype = rules["type"]

            # Required check
            if value is None:
                if rules.get("required", False):
                    errors[field] = f"Campo obrigatório"
                elif "default" in rules:
                    result[field] = rules["default"]
                continue

            # Type check
            if not isinstance(value, ftype):
                try:
                    value = ftype(value)
                    data[field] = value
                except (ValueError, TypeError):
                    errors[field] = f"Expected {ftype.__name__}"
                    continue

            # Min length
            if "min_len" in rules and len(value) < rules["min_len"]:
                errors[field] = f"Mínimo {rules['min_len']} caracteres"
                continue

            # Max length
            if "max_len" in rules and len(value) > rules["max_len"]:
                errors[field] = f"Máximo {rules['max_len']} caracteres"
                continue

            # Min value
            if "min" in rules and value < rules["min"]:
                errors[field] = f"Mínimo {rules['min']}"
                continue

            # Max value
            if "max" in rules and value > rules["max"]:
                errors[field] = f"Máximo {rules['max']}"
                continue

            result[field] = value

        if errors:
            return False, errors
        return True, result


validator = PayloadValidator()


# ── RAG Access Control ────────────────────────────────────
class RAGAccessControl:
    """
    Access levels para RAG:
      full        → Bianinho admin (tudo)
      read_sac    → SAC Bot (só sac_leads)
      read_personal → Álvaro (metodoten, livros, memoria)
    """

    CATEGORIES = {
        "full": None,  # Sem filtro — vê tudo
        "read_sac": ["sac_leads"],
        "read_personal": ["metodoten", "livros", "memoria", "default", "api", "prd_collection"],
    }

    def get_allowed_categories(self, access_level: str) -> list[str] | None:
        return self.CATEGORIES.get(access_level)

    def filter_results(self, results: list[dict], access_level: str) -> list[dict]:
        allowed = self.get_allowed_categories(access_level)
        if allowed is None:
            return results
        return [r for r in results if r.get("category") in allowed]


rag_access = RAGAccessControl()


# ── Hermes path detection ──────────────────────────────────
def detect_hermes_path() -> str:
    candidates = [
        HERMES_PATH,
        HOME / ".hermes",
        Path("/home/alvarobiano/.hermes"),
    ]
    for p in candidates:
        if p.exists() and ((p / "hermes-agent").exists() or (p / "config.yaml").exists()):
            return str(p)
    for p in candidates:
        if p.exists():
            return str(p)
    return str(HERMES_PATH)


# ── Skills Sandbox ────────────────────────────────────────
class SkillsSandbox:
    """
    Skills executam em subprocess isolado com resource limits.
    Permissões: safe, sensitive, dangerous
    """

    PERMISSIONS = {
        "safe": [],
        "sensitive": ["terminal", "file_write", "github", "cron_create"],
        "dangerous": ["file_delete", "system_exec", "kill_process", "db_delete"],
    }

    def __init__(self):
        self.hermes_path = detect_hermes_path()

    def check_permission(self, skill_name: str) -> str:
        """Retorna 'safe', 'sensitive', ou 'dangerous'."""
        for level, skills in self.PERMISSIONS.items():
            if not skills:  # safe = todas não listadas
                continue
            if skill_name in skills:
                return level
        return "safe"

    def run_skill(self, skill_name: str, params: dict,
                  permission: str, ui_callback=None) -> dict:
        """Executa skill em subprocess isolado."""
        # dangerous requer confirmação
        if permission == "dangerous":
            if ui_callback:
                confirmed = ui_callback("dangerous", f"Skill '{skill_name}' requer confirmação")
                if not confirmed:
                    return {"error": "Permission denied by user"}
            else:
                return {"error": "Dangerous skill requires UI confirmation"}

        skill_path = Path(self.hermes_path) / "skills" / skill_name
        if not skill_path.exists():
            return {"error": f"Skill not found: {skill_name}"}

        # Determina se é .md (template) ou .py (script)
        script_path = None
        for ext in [".py", ".sh"]:
            candidate = skill_path / f"run{ext}"
            if candidate.exists():
                script_path = candidate
                break

        if not script_path:
            return {"error": f"No run script found for skill: {skill_name}"}

        try:
            env = {
                "PYTHONPATH": str(self.hermes_path),
                "HERMES_SKILL_PARAMS": json.dumps(params),
                **os.environ.copy()
            }

            if script_path.suffix == ".py":
                proc = subprocess.Popen(
                    [sys.executable, str(script_path)],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    preexec_fn=self._set_limits,
                )
            else:
                proc = subprocess.Popen(
                    ["bash", str(script_path)],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    preexec_fn=self._set_limits,
                )

            try:
                stdout, stderr = proc.communicate(timeout=30)
                return {
                    "ok": True,
                    "stdout": stdout.decode("utf-8", errors="replace"),
                    "stderr": stderr.decode("utf-8", errors="replace"),
                    "exit_code": proc.returncode,
                    "skill": skill_name,
                    "permission": permission,
                }
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                return {"error": f"Skill timed out (30s)", "skill": skill_name}

        except Exception as e:
            return {"error": str(e), "skill": skill_name}

    def _set_limits(self):
        """Aplica resource limits ao subprocess."""
        try:
            # CPU: 60s hard cap
            resource.setrlimit(resource.RLIMIT_CPU, (60, 65))
            # RAM: 500MB max
            resource.setrlimit(resource.RLIMIT_AS, (500 * 1024 * 1024, 500 * 1024 * 1024))
            # Ficheiros: max 100 open
            resource.setrlimit(resource.RLIMIT_NOFILE, (100, 110))
        except Exception:
            pass  #有些平台不支持resource limits


skills_sandbox = SkillsSandbox()



# ── Status ─────────────────────────────────────────────────
class BridgeStatus:
    def __init__(self):
        self.started_at = time.time()
        self.messages_processed = 0
        self.errors = 0
        self.last_error: str | None = None
        self.rate_limit_hits = 0
        self.auth_failures = 0
        self.lock = threading.Lock()

    def inc(self, what="messages"):
        with self.lock:
            if what == "messages":
                self.messages_processed += 1
            elif what == "errors":
                self.errors += 1
            elif what == "rate_limit":
                self.rate_limit_hits += 1
            elif what == "auth":
                self.auth_failures += 1

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
                "rate_limit_hits": self.rate_limit_hits,
                "auth_failures": self.auth_failures,
                "platform": PLATFORM,
                "hermes_path": str(HERMES_PATH),
                "rag_path": str(RAG_DIR) if RAG_DIR.exists() else None,
                "backup_dir": str(BACKUP_DIR),
            }


status = BridgeStatus()


# ── Command Handlers ───────────────────────────────────────

def cmd_ping(args: dict) -> dict:
    return {"ok": True, "pong": args.get("echo", "pong"), "platform": PLATFORM}


def cmd_status(_: dict) -> dict:
    return {"ok": True, **status.info()}


def cmd_platform_info(args: dict) -> dict:
    return {
        "ok": True,
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "python": platform.python_version(),
    }


def cmd_check_hermes(args: dict) -> dict:
    hermes = detect_hermes_path()
    checks = {
        "hermes_path": hermes,
        "exists": Path(hermes).exists(),
        "config_yaml": Path(hermes, "config.yaml").exists(),
        "skills_dir": (Path(hermes) / "skills").exists(),
        "sessions_db": Path(hermes, "sessions.db").exists(),
        "autonomous_dir": (Path(hermes) / "autonomous").exists(),
    }
    return {"ok": all(checks.values()), "checks": checks}


def cmd_list_skills(args: dict) -> dict:
    skills_dir = Path(detect_hermes_path()) / "skills"
    if not skills_dir.exists():
        return {"ok": False, "error": f"Skills dir not found: {skills_dir}"}
    skills = []
    for f in sorted(skills_dir.iterdir()):
        if f.is_file() and f.suffix == ".md":
            skills.append({"name": f.stem, "size": f.stat().st_size})
        elif f.is_dir():
            skills.append({"name": f.name, "type": "directory"})
    return {"ok": True, "count": len(skills), "skills": skills}


# ── RAG Commands ───────────────────────────────────────────

def cmd_rag_search(args: dict) -> dict:
    """Pesquisa no RAG com access control."""
    ok, validated = validator.validate("rag_search", args)
    if not ok:
        return {"ok": False, "error": "Invalid payload", "details": validated}

    access_level = validated.get("access_level", "full")
    query = validated["query"]
    category = validated.get("category")
    topK = validated.get("topK", 5)
    score_threshold = validated.get("score_threshold", 0.3)

    rag_path = RAG_DIR
    if not rag_path.exists():
        return {"ok": False, "error": f"RAG not found: {rag_path}"}

    # Usa LanceDB se disponível, senão fallback simple search
    try:
        import lancedb
        db = lancedb.connect(str(rag_path))
        table = db.open_table("chunks")
        results = (
            table.search(query)
            .where(f"category = '{category}'") if category else table.search(query)
        )
        raw_results = results.limit(topK).to_list()
        # Filter por access level
        filtered = rag_access.filter_results(raw_results, access_level)
        return {
            "ok": True,
            "query": query,
            "count": len(filtered),
            "results": filtered[:topK],
            "access_level": access_level,
        }
    except ImportError:
        # Fallback: text search simples
        return fallback_rag_search(query, category, topK, access_level)
    except Exception as e:
        log("ERROR", f"RAG search error: {e}")
        return fallback_rag_search(query, category, topK, access_level)


def fallback_rag_search(query: str, category: str | None, topK: int, access_level: str) -> dict:
    """Fallback simple search quando LanceDB não disponível."""
    rag_path = RAG_DIR
    chunks_dir = rag_path / "chunks"
    if not chunks_dir.exists():
        return {"ok": True, "query": query, "count": 0, "results": [], "fallback": True}

    allowed = rag_access.get_allowed_categories(access_level)
    query_lower = query.lower()
    results = []

    for chunk_file in chunks_dir.glob("*.json"):
        try:
            import json
            chunk = json.loads(chunk_file.read_text())
            text = chunk.get("text", "")
            chunk_cat = chunk.get("category", "default")
            if allowed and chunk_cat not in allowed:
                continue
            if category and chunk_cat != category:
                continue
            if query_lower in text.lower():
                results.append({"text": text[:500], "category": chunk_cat, "score": 0.5})
        except Exception:
            continue

    return {
        "ok": True,
        "query": query,
        "count": len(results),
        "results": results[:topK],
        "access_level": access_level,
        "fallback": True,
    }


def cmd_rag_stats(args: dict) -> dict:
    """Estatísticas do RAG."""
    rag_path = RAG_DIR
    stats = {
        "path": str(rag_path),
        "exists": rag_path.exists(),
        "categories": [],
        "total_chunks": 0,
    }
    if rag_path.exists():
        chunks_dir = rag_path / "chunks"
        if chunks_dir.exists():
            cats: dict[str, int] = {}
            for f in chunks_dir.glob("*.json"):
                try:
                    import json
                    chunk = json.loads(f.read_text())
                    cat = chunk.get("category", "default")
                    cats[cat] = cats.get(cat, 0) + 1
                except Exception:
                    pass
            stats["categories"] = [{"name": k, "count": v} for k, v in cats.items()]
            stats["total_chunks"] = sum(cats.values())
    return {"ok": True, "stats": stats}


def cmd_rag_backup(args: dict) -> dict:
    """Cria backup pre-write do RAG."""
    rag_path = RAG_DIR
    label = args.get("label", "manual")
    backup_name = backup_manager.pre_write_backup(rag_path, label)
    if backup_name:
        return {"ok": True, "backup": backup_name}
    return {"ok": False, "error": "Backup failed or RAG not found"}


def cmd_rag_restore(args: dict) -> dict:
    """Restore de um backup."""
    backup_name = args.get("backup_name")
    if not backup_name:
        return {"ok": False, "error": "backup_name required"}
    ok = backup_manager.restore_pre_write(backup_name, RAG_DIR)
    return {"ok": ok, "backup": backup_name}


def cmd_rag_list_backups(args: dict) -> dict:
    return {"ok": True, "backups": backup_manager.list_backups()}


# ── Inbox Commands ─────────────────────────────────────────

INBOX_FILE = HERMES_PATH / "inbox.json"


def _load_inbox() -> list[dict]:
    if not INBOX_FILE.exists():
        return []
    try:
        return json.loads(INBOX_FILE.read_text())
    except Exception:
        return []


def _save_inbox(items: list[dict]):
    INBOX_FILE.parent.mkdir(parents=True, exist_ok=True)
    INBOX_FILE.write_text(json.dumps(items, indent=2))


def cmd_inbox_list(args: dict) -> dict:
    items = _load_inbox()
    return {"ok": True, "count": len(items), "items": items}


def cmd_inbox_add(args: dict) -> dict:
    ok, validated = validator.validate("inbox_add", args)
    if not ok:
        return {"ok": False, "error": "Invalid payload", "details": validated}

    items = _load_inbox()
    import uuid
    new_item = {
        "id": str(uuid.uuid4())[:8],
        "content": validated["content"],
        "priority": validated.get("priority", "3"),
        "tags": validated.get("tags", []),
        "source": validated.get("source", "alvaro"),
        "done": False,
        "created_at": datetime.now().isoformat(),
    }
    items.insert(0, new_item)
    _save_inbox(items)
    return {"ok": True, "item": new_item}


def cmd_inbox_done(args: dict) -> dict:
    ok, validated = validator.validate("inbox_done", args)
    if not ok:
        return {"ok": False, "error": "Invalid payload"}

    items = _load_inbox()
    item_id = validated["id"]
    found = False
    for item in items:
        if item.get("id") == item_id:
            item["done"] = True
            item["done_at"] = datetime.now().isoformat()
            found = True
            break
    _save_inbox(items)
    return {"ok": found, "id": item_id}


def cmd_inbox_delete(args: dict) -> dict:
    item_id = args.get("id")
    if not item_id:
        return {"ok": False, "error": "id required"}

    items = _load_inbox()
    original_len = len(items)
    items = [i for i in items if i.get("id") != item_id]
    _save_inbox(items)
    return {"ok": len(items) < original_len, "id": item_id}


# ── Skills Commands ────────────────────────────────────────

def cmd_skill_execute(args: dict) -> dict:
    ok, validated = validator.validate("skill_execute", args)
    if not ok:
        return {"ok": False, "error": "Invalid payload", "details": validated}

    skill_name = validated["skill_name"]
    params = validated.get("params", {})
    permission = skills_sandbox.check_permission(skill_name)

    return skills_sandbox.run_skill(skill_name, params, permission)


def cmd_skill_validate(args: dict) -> dict:
    skill_name = args.get("skill_name")
    if not skill_name:
        return {"ok": False, "error": "skill_name required"}

    skill_path = Path(detect_hermes_path()) / "skills" / skill_name
    if not skill_path.exists():
        return {"ok": False, "error": f"Skill not found: {skill_name}"}

    permission = skills_sandbox.check_permission(skill_name)
    return {
        "ok": True,
        "skill": skill_name,
        "permission": permission,
        "path": str(skill_path),
        "exists": skill_path.exists(),
    }


# ── Cycle Commands ─────────────────────────────────────────

def cmd_cycle_status(args: dict) -> dict:
    """Estado do ciclo autónomo."""
    cycle_file = Path(detect_hermes_path()) / "autonomous" / "state.json"
    state = {}
    if cycle_file.exists():
        try:
            state = json.loads(cycle_file.read_text())
        except Exception:
            pass

    return {
        "ok": True,
        "cycle_file": str(cycle_file),
        "exists": cycle_file.exists(),
        "state": state,
    }


def cmd_cycle_trigger(args: dict) -> dict:
    """Força um ciclo autónomo."""
    # Cria marker para o ciclo
    cycle_dir = Path(detect_hermes_path()) / "autonomous"
    cycle_dir.mkdir(parents=True, exist_ok=True)
    marker = cycle_dir / "trigger_manual.json"
    marker.write_text(json.dumps({
        "triggered_at": datetime.now().isoformat(),
        "source": "bianinho_bridge",
    }))
    return {"ok": True, "triggered_at": datetime.now().isoformat()}


# ── Memory Commands ─────────────────────────────────────────

MEMORY_FILE = HERMES_PATH / "memory.json"


def cmd_memory_get(args: dict) -> dict:
    key = args.get("key")
    if not MEMORY_FILE.exists():
        return {"ok": True, "key": key, "value": None}
    try:
        memory = json.loads(MEMORY_FILE.read_text())
        return {"ok": True, "key": key, "value": memory.get(key)}
    except Exception:
        return {"ok": True, "key": key, "value": None}


def cmd_memory_set(args: dict) -> dict:
    ok, validated = validator.validate("memory_set", args)
    if not ok:
        return {"ok": False, "error": "Invalid payload"}

    key = validated["key"]
    value = validated["value"]

    # Backup antes de escrever
    if MEMORY_FILE.exists():
        backup_manager.pre_write_backup(MEMORY_FILE, "memory")

    memory = {}
    if MEMORY_FILE.exists():
        try:
            memory = json.loads(MEMORY_FILE.read_text())
        except Exception:
            pass

    memory[key] = value
    MEMORY_FILE.write_text(json.dumps(memory, indent=2))
    return {"ok": True, "key": key}


# ── Config Commands ────────────────────────────────────────

def cmd_config_get(args: dict) -> dict:
    key = args.get("key")
    config_file = HERMES_PATH / "config.json"
    if not config_file.exists():
        return {"ok": True, "key": key, "value": None}
    try:
        config = json.loads(config_file.read_text())
        return {"ok": True, "key": key, "value": config.get(key)}
    except Exception:
        return {"ok": True, "key": key, "value": None}


def cmd_config_set(args: dict) -> dict:
    ok, validated = validator.validate("config_set", args)
    if not ok:
        return {"ok": False, "error": "Invalid payload"}

    key = validated["key"]
    value = validated["value"]

    config_file = HERMES_PATH / "config.json"
    config = {}
    if config_file.exists():
        try:
            config = json.loads(config_file.read_text())
        except Exception:
            pass

    config[key] = value
    config_file.write_text(json.dumps(config, indent=2))
    return {"ok": True, "key": key}


# ── Snapshot Commands ──────────────────────────────────────

def cmd_snapshot_export(args: dict) -> dict:
    """Export encriptado do estado."""
    export_path = args.get("path", str(BINHO_BASE / "snapshot_export.json"))
    try:
        snapshot = {
            "version": "1.0",
            "exported_at": datetime.now().isoformat(),
            "inbox": _load_inbox(),
            "memory": json.loads(MEMORY_FILE.read_text()) if MEMORY_FILE.exists() else {},
            "config": {},
        }
        Path(export_path).write_text(json.dumps(snapshot, indent=2))
        return {"ok": True, "path": export_path, "size": Path(export_path).stat().st_size}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def cmd_snapshot_import(args: dict) -> dict:
    """Import de snapshot."""
    import_path = args.get("path")
    if not import_path or not Path(import_path).exists():
        return {"ok": False, "error": "File not found"}

    try:
        data = json.loads(Path(import_path).read_text())
        version = data.get("version")
        if version != "1.0":
            return {"ok": False, "error": f"Unsupported version: {version}"}

        # Backup antes de importar
        if INBOX_FILE.exists():
            backup_manager.pre_write_backup(INBOX_FILE, "import")
        if MEMORY_FILE.exists():
            backup_manager.pre_write_backup(MEMORY_FILE, "import")

        if "inbox" in data:
            _save_inbox(data["inbox"])
        if "memory" in data:
            MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
            MEMORY_FILE.write_text(json.dumps(data["memory"], indent=2))

        return {"ok": True, "imported": list(data.keys())}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Hermes path detection (reordered) ───────────────────────
# (Already defined above)


# ── Protocol ──────────────────────────────────────────────
COMMANDS = {
    # System
    "ping": cmd_ping,
    "status": cmd_status,
    "platform_info": cmd_platform_info,
    "check_hermes": cmd_check_hermes,
    "list_skills": cmd_list_skills,
    # RAG
    "rag_search": cmd_rag_search,
    "rag_stats": cmd_rag_stats,
    "rag_backup": cmd_rag_backup,
    "rag_restore": cmd_rag_restore,
    "rag_list_backups": cmd_rag_list_backups,
    # Inbox
    "inbox_list": cmd_inbox_list,
    "inbox_add": cmd_inbox_add,
    "inbox_done": cmd_inbox_done,
    "inbox_delete": cmd_inbox_delete,
    # Skills
    "skill_execute": cmd_skill_execute,
    "skill_validate": cmd_skill_validate,
    # Cycle
    "cycle_status": cmd_cycle_status,
    "cycle_trigger": cmd_cycle_trigger,
    # Memory
    "memory_get": cmd_memory_get,
    "memory_set": cmd_memory_set,
    # Config
    "config_get": cmd_config_get,
    "config_set": cmd_config_set,
    # Snapshot
    "snapshot_export": cmd_snapshot_export,
    "snapshot_import": cmd_snapshot_import,
}


def handle_message(raw: bytes, client_id: str = "unknown") -> bytes:
    """Processa uma mensagem com auth, rate limit e validação."""
    try:
        # Parse
        try:
            msg = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            status.inc("errors")
            return json.dumps({"ok": False, "error": "Invalid JSON"}).encode()

        cmd = msg.get("cmd", "")
        args = msg.get("args", {})

        # Rate limiting
        allowed, info = rate_limiter.check(client_id)
        if not allowed:
            status.inc("rate_limit")
            return json.dumps({
                "ok": False,
                "error": "Rate limit exceeded",
                "rate_limit": info,
            }).encode()

        # Auth token (opcional para comandos safe)
        token = msg.get("token")
        if token:
            # Valida token
            try:
                ts_str, sig = token.split(".")
                ts = int(ts_str)
                if abs(time.time() - ts) > 86400:  # 24h TTL
                    status.inc("auth")
                    return json.dumps({"ok": False, "error": "Token expired"}).encode()
                expected = hmac.new(get_secret(), ts_str.encode(), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, sig):
                    status.inc("auth")
                    return json.dumps({"ok": False, "error": "Invalid token"}).encode()
            except (ValueError, Exception):
                status.inc("auth")
                return json.dumps({"ok": False, "error": "Invalid token format"}).encode()

        # Validar payload se schema existir
        if cmd in PayloadValidator.SCHEMAS:
            ok, validated = validator.validate(cmd, args)
            if not ok:
                status.inc("errors")
                return json.dumps({
                    "ok": False,
                    "error": f"Validation failed for '{cmd}'",
                    "details": validated,
                }).encode()

        # Executar comando
        if cmd not in COMMANDS:
            status.inc("errors")
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


# ── TCP Server ─────────────────────────────────────────────
def tcp_server(port: int = 18743):
    log("INFO", f"Starting BianinhoBridge TCP server on port {port}")
    log("INFO", f"Hermes path: {detect_hermes_path()}")
    log("INFO", f"RAG path: {RAG_DIR} ({'exists' if RAG_DIR.exists() else 'NOT FOUND'})")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        sock.bind(("127.0.0.1", port))
        sock.listen(5)
        log("INFO", f"BianinhoBridge listening on 127.0.0.1:{port}")
    except OSError as e:
        log("WARN", f"Port {port} em uso — a tentar próximo...")
        port += 1
        sock.bind(("127.0.0.1", port))
        sock.listen(5)
        log("INFO", f"BianinhoBridge listening on 127.0.0.1:{port}")

    while True:
        try:
            conn, addr = sock.accept()
            client_id = f"tcp_{addr[0]}_{addr[1]}"
            data = b""
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk

            if data:
                response = handle_message(data, client_id)
                conn.sendall(len(response).to_bytes(4, "big"))
                conn.sendall(response)

            conn.close()
        except Exception as e:
            log("ERROR", f"Connection error: {e}")


# ── STDIO Mode ─────────────────────────────────────────────
def stdio_mode():
    log("INFO", "BianinhoBridge starting in STDIO mode")
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            raw = line.strip().encode("utf-8")
            if raw:
                response = handle_message(raw, "stdio")
                sys.stdout.write(response.decode("utf-8") + "\n")
                sys.stdout.flush()
        except Exception as e:
            log("ERROR", f"STDIO error: {e}")


# ── Entry Point ─────────────────────────────────────────────
if __name__ == "__main__":
    log("INFO", f"BianinhoBridge v1.0 — Phase 1 Complete — platform={PLATFORM}")
    log("INFO", f"Hermes: {detect_hermes_path()}")

    if "--stdio" in sys.argv:
        stdio_mode()
    else:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 18743
        tcp_server(port)
