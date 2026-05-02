# BianinhoBridge

> Electron ↔ Hermes IPC bridge — Phase 1 complete

**BianinhoBridge** é um bridge TCP que permite ao renderer process do Electron comunicar com o agente Hermes via IPC. Executa como subprocess Python isolado e expone comandos para RAG, inbox, skills, memória, e mais.

## Arquitetura

```
┌─────────────────────┐     IPC (tcpSend)      ┌──────────────────────┐
│  Electron Main       │ ─────────────────────▶│  Python Bridge       │
│  (bianinhoBridge.ts) │                       │  (bianinho_bridge.py) │
│                      │ ◀──────────────────── │                      │
│  ipcMain.handle(...) │     JSON response      │  TCP server :18743   │
└─────────────────────┘                        └──────────────────────┘
                                                        │
                    ┌───────────────────────────────────┼────────────────────┐
                    ▼                                   ▼                    ▼
              ┌──────────┐                       ┌────────────┐         ┌──────────┐
              │ Hermes   │                       │ RAG DB     │         │ Skills   │
              │ ~/.hermes│                       │ LanceDB    │         │ Sandbox  │
              └──────────┘                       └────────────┘         └──────────┘
```

## Comandos Disponíveis

### Sistema

| Comando | Descrição |
|---------|-----------|
| `ping` | Health check — retorna pong |
| `status` | Estado do bridge (uptime, errors, rate limit hits) |
| `platform_info` | Info do sistema (OS, machine, python version) |
| `check_hermes` | Verifica instalação do Hermes |
| `list_skills` | Lista skills disponíveis |

### RAG

| Comando | Descrição |
|---------|-----------|
| `rag_search` | Pesquisa com access control |
| `rag_stats` | Estatísticas do RAG |
| `rag_backup` | Backup pre-write |
| `rag_restore` | Restore de backup |
| `rag_list_backups` | Lista backups disponíveis |

### Inbox

| Comando | Descrição |
|---------|-----------|
| `inbox_list` | Lista items do inbox |
| `inbox_add` | Adiciona item ao inbox |
| `inbox_done` | Marca item como done |
| `inbox_delete` | Remove item do inbox |

### Skills

| Comando | Descrição |
|---------|-----------|
| `skill_execute` | Executa skill em sandbox isolado |
| `skill_validate` | Valida se skill existe e retorna permissão |

### Cycle

| Comando | Descrição |
|---------|-----------|
| `cycle_status` | Estado do ciclo autónomo |
| `cycle_trigger` | Força um ciclo manual |

### Memória / Config

| Comando | Descrição |
|---------|-----------|
| `memory_get` | Lê chave da memória |
| `memory_set` | Escreve par key/value na memória |
| `config_get` | Lê config do Hermes |
| `config_set` | Escreve config do Hermes |

### Snapshot

| Comando | Descrição |
|---------|-----------|
| `snapshot_export` | Export encriptado do estado |
| `snapshot_import` | Import de snapshot |

## Segurança

### Rate Limiting
- **100 pedidos / minuto** por client_id
- Token bucket algorithm
- Headers `X-RateLimit-*` na resposta

### Autenticação HMAC
- Token opcional: `{timestamp}.{hmac_sha256}`
- Gerado automaticamente no lado Python
- Fallback: comandos funcionam sem token (para dev)

### Payload Validation
Todos os payloads são validados contra schemas:
- `rag_search`: query (1-1000 chars), category, topK (1-100), score_threshold (0-1.0)
- `inbox_add`: content (1-5000 chars), priority, tags, source
- `skill_execute`: skill_name, params
- etc.

### Skills Sandbox
Permissões por nível:
- **safe**: execução livre
- **sensitive**: terminal, file_write, github, cron_create
- **dangerous**: file_delete, system_exec, kill_process, db_delete (requer confirmação UI)

Resource limits:
- CPU: 60s hard cap
- RAM: 500MB max
- Ficheiros abertos: 100 max

### RAG Access Control
Três níveis de acesso:
- `full`: Bianinho admin — tudo
- `read_sac`: SAC Bot — só `sac_leads`
- `read_personal`: Álvaro — metodoten, livros, memoria, default, api, prd_collection

### Backup / Rollback
- 3 níveis: pre-write, diário, semanal
- Mantém últimos 10 backups pre-write
- Restore automático em caso de falha

## Formato do Protocolo

### Request
```json
{
  "cmd": "command_name",
  "args": { ... },
  "token": "optional_hmac_token"
}
```

### Response
```json
{
  "ok": true,
  "data": { ... }
}
```

### Erro
```json
{
  "ok": false,
  "error": "Error message",
  "details": { ... }
}
```

## Configuração

| Variável | Default | Descrição |
|----------|---------|-----------|
| `BRIDGE_PORT` | 18743 | Porta TCP do bridge |
| `MAX_RETRIES` | 2 | Tentativas de reconnect |
| `RETRY_DELAY` | 300ms | Delay entre retries |

Paths:
- `HERMES_PATH`: `~/.hermes`
- `RAG_DIR`: `~/KnowledgeBase/knowledge_db`
- `BACKUP_DIR`: `~/.hermes/backups`
- `LOG_DIR`: `{app}/logs`

## API Reference

Ver [SPEC.md](./SPEC.md) para a especificação OpenAPI completa.

## Instalação

O bridge é iniciado automaticamente pelo `bianinhoBridge.ts` no primeiro IPC call.

Para desenvolvimento:
```bash
cd scripts
python3 bianinho_bridge.py 18743
```

## Logs

Logs em `{BINHO_BASE}/logs/bianinho_bridge.log`:
```
[2025-05-01 12:00:00] [INFO] New bridge secret generated
[2025-05-01 12:00:01] [INFO] Bridge started on port 18743
[2025-05-01 12:00:05] [INFO] Backup created: pre_write_manual_20250501_120005
```

## Setup Scripts

Este diretório contém scripts de setup e manutenção para o BianinhoBridge:

### setup-first-run.sh

Executa a configuração inicial após instalação. Deve ser corrido uma vez.

```bash
# Uso
bash scripts/setup-first-run.sh

# O que faz:
# - Verifica requisitos do sistema (Python 3.10+, módulos)
# - Cria estrutura de directórios (~/.hermes, ~/KnowledgeBase)
# - Configura venv Python com dependências
# - Gera bridge secret
# - Inicializa RAG database (LanceDB)
# - Configura cron jobs
# - Cria launcher scripts em ~/bin/
```

### server-export-kb.sh

Exporta a knowledge base para um servidor remoto.

```bash
# Exportar KB
bash scripts/server-export-kb.sh export

# Listar exports recentes
bash scripts/server-export-kb.sh list

# Ver configuração
bash scripts/server-export-kb.sh config
```

**Configuração** (`~/.hermes/config/kb-export.conf`):
```bash
EXPORT_ENDPOINT=http://localhost:8080/api/kb/import
EXPORT_API_KEY=your_api_key_here
EXPORT_BATCH_SIZE=100
```

### create-kb-archive.sh

Cria arquivos comprimidos da knowledge base para backup.

```bash
# Criar novo arquivo
bash scripts/create-kb-archive.sh create

# Listar arquivos existentes
bash scripts/create-kb-archive.sh list

# Limpar arquivos antigos (default: 30 dias)
bash scripts/create-kb-archive.sh clean

# Verificar integridade de arquivo
bash scripts/create-kb-archive.sh verify [archive]

# Extrair arquivo
bash scripts/create-kb-archive.sh extract [archive] [destino]
```

**Variáveis de ambiente:**
- `RETENTION_DAYS=30` — dias antes de limpar arquivos antigos

**Output:**
- Arquivos em `~/KnowledgeBase/archives/`
- Nome format: `kb_archive_YYYYMMDD_HHMMSS.tar.gz`
- Checksum SHA256 gerado automaticamente
