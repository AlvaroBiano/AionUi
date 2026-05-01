# BianinhoBridge — AionUI + Hermes Integration

## O Que É

BianinhoBridge é o layer de comunicação entre o AionUI (Electron/Node.js) e o Bianinho (Python). Corre como processo sidecar em Python, comunicado por TCP na porta `18743`.

## Instalação

```bash
# Clonar o fork
git clone https://github.com/AlvaroBiano/AionUi.git ~/repos/aionui-custom
cd ~/repos/aionui-custom

# Criar venv Python
python3 -m venv bianinho-venv
source bianinho-venv/bin/activate
pip install requests paho-mqtt psutil

# Instalar dependências Node
npm install

# Build Electron
bunx electron-vite build

# Iniciar bridge (ou deixa o AionUI iniciá-lo)
./bianinho-venv/bin/python3 scripts/bianinho_bridge.py 18743 &
```

## Comandos da Bridge

### Sistema
- `ping` — teste de conectividade
- `status` — estado da bridge (uptime, messages, errors)
- `platform_info` — info do SO
- `check_hermes` — verifica se Hermes está acessível

### RAG
- `rag_search` — pesquisa com access control
- `rag_stats` — estatísticas dos chunks
- `rag_backup` — cria backup pre-write
- `rag_restore` — restaura de backup
- `rag_list_backups` — lista backups disponíveis

### Inbox
- `inbox_list` — lista tarefas
- `inbox_add` — adiciona tarefa
- `inbox_done` — marca como concluída
- `inbox_delete` — remove tarefa

### Skills
- `list_skills` — lista skills disponíveis
- `skill_execute` — executa skill em sandbox
- `skill_validate` — valida permissão de skill

### Ciclo Autónomo
- `cycle_status` — estado do ciclo
- `cycle_trigger` — força ciclo manual

### Memória
- `memory_get` / `memory_set` — acesso à memória factual

### Snapshots
- `snapshot_export` / `snapshot_import` — backup encriptado do estado

## Protocolo

Cliente envia:
```json
{
  "cmd": "ping",
  "args": {"echo": "test"},
  "token": "17456xxxx.sig"  // opcional
}
```

Servidor responde com 4 bytes length prefix + JSON:
```
[0x00][0x00][0x00][0x2D]{"ok": true, "pong": "test", "platform": "linux"}
```

## Testar

```bash
# Ping
timeout 5 bash -c 'echo "{\"cmd\":\"ping\",\"args\":{\"echo\":\"ok\"}}" | nc -N 127.0.0.1 18743'

# Ver resposta com parsing
timeout 5 bash -c 'echo "{\"cmd\":\"status\",\"args\":{}}" | nc -N 127.0.0.1 18743' | python3 -c "
import sys; d=sys.stdin.buffer.read()
import json
print(json.loads(d[4:].decode()))
"
```

## Uninstall

```bash
# Para remover completamente:
rm -rf ~/repos/aionui-custom
rm -rf ~/.local/share/aionui-bianinho
rm -f ~/bin/aionui-bianinho
pkill -f bianinho_bridge
# Remove crontab entries do SyncedUpdater
crontab -l | grep -v synced_updater | crontab - || true
```

## Segurança

- **HMAC auth**: Token com TTL de 24h
- **Rate limiting**: 100 req/min por cliente
- **Skills sandbox**: subprocess isolado com resource limits (CPU 60s, RAM 500MB)
- **Payload validation**: schemas para todos os comandos
- **Backup/rollback**: 3 níveis (pre-write, diário, semanal)
- **RAG isolation**: access levels (full, read_sac, read_personal)

## Acesso à Bridge
- **Porta**: `18743` (TCP localhost)
- **Interface**: Unix socket fallback → TCP localhost
- **Token**: gerado em `~/.hermes/config/bridge_secret.key`

## Benchmarks (Fase 4)

### Latência Bridge (01/05/2026)
| Comando | P95 | Target | Status |
|---------|-----|--------|--------|
| ping | 0.22ms | 50ms | ✅ OK |
| status | 0.24ms | 100ms | ✅ OK |
| check_hermes | 0.26ms | 200ms | ✅ OK |

### Memória Bridge (01/05/2026)
| Métrica | Actual | Target | Status |
|---------|--------|--------|--------|
| RSS | 9.5 MB | 500 MB | ✅ OK |
| VMS | 15.3 MB | — | OK |

### Unit Tests
```
34 tests — 100% PASSED (pytest)
  - Auth: 6 tests
  - Rate Limit: 5 tests
  - RAG: 4 tests
  - Skills: 7 tests
  - Protocol: 10 tests
  - Integration: 2 tests
```

### Segurança (SAST)
| Severidade | Qtd | Estado |
|------------|-----|--------|
| 🔴 Crítica | 2 | em `sac-agent-local` (não afectar bridge) |
| 🟡 Média | 2 | RAG input sanitization recomendada |
| ✅ Protegido | 2 | SQL injection (parametrized), passwords (bcrypt) |

Executar benchmarks:
```bash
python3 scripts/benchmark_bridge.py
python3 scripts/benchmark_memory.py
```
