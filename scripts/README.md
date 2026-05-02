# BianinhoBridge — AionUI + Hermes Integration

## O Que É

BianinhoBridge é o layer de comunicação entre o AionUI (Electron/Node.js) e o Bianinho (Python). Corre como processo sidecar em Python, comunicado por TCP na porta `18743`.

## Instalação

### Opção 1: DMG (Mac)
```bash
# Descarrega o DMG de:
# https://github.com/AlvaroBiano/AionUi/releases

# Ou usa o installer shell:
curl -fsSL https://raw.githubusercontent.com/AlvaroBiano/AionUi/main/scripts/install.sh | bash
```

### Opção 2: Clone directo (Linux/Mac)
```bash
git clone https://github.com/AlvaroBiano/AionUi.git ~/AionUI-Bianinho
cd ~/AionUI-Bianinho
bash scripts/install.sh
```

## Transferir Knowledge Base para o Mac

A knowledge base (~600MB comprimido) contém todo o contexto do Bianinho. Para ter tudo local no Mac:

**1. No servidor Linux — criar e servir o archive:**
```bash
cd ~/AionUI-Bianinho
bash scripts/serve-kb.sh both
# Isto cria o archive e inicia um servidor HTTP na porta 8877
# Mostra o IP do servidor (ex: 192.168.1.100)
```

**2. No Mac — descarregar a KB:**
```bash
# Opção A: via curl (o servidor mostra este comando)
curl -o ~/Downloads/bianinho-kb.tar.gz http://192.168.1.100:8877/download

# Opção B: via browser
# Abre http://192.168.1.100:8877/download no browser

# Opção C: via USB
# Copia o ficheiro /tmp/bianinho-kb-mac.tar.gz do servidor para USB
# No Mac: tar -xzf bianinho-kb-mac.tar.gz -C ~/Library/ApplicationSupport/AionUI/
```

**3. Setup interactivo no Mac:**
```bash
bash ~/AionUI-Bianinho/scripts/setup-mac.sh
```

Este script pede:
- API key da MiniMax
- IP do servidor (opcional — para conectar ao Hermes remoto)
- KB (descarregar ou importar de ficheiro)

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

## Protocolo

Cliente envia:
```json
{
  "cmd": "ping",
  "args": {"echo": "test"},
  "token": "***"  // opcional
}
```

Servidor responde com 4 bytes length prefix + JSON:
```
[0x00][0x00][0x00][0x2D]{"ok": true, "pong": "test", "platform": "linux"}
```

## Testar

```bash
# Ping
echo '{"cmd":"ping","args":{"echo":"ok"}}' | nc -N 127.0.0.1 18743
```

## Scripts

| Script | Descrição |
|--------|-----------|
| `install.sh` | Instalador principal (clone + deps + build) |
| `setup-mac.sh` | Setup interactivo no Mac (KB, API key, servidor) |
| `serve-kb.sh` | Servir KB via HTTP para download no Mac |
| `benchmark_bridge.py` | Benchmark de latência da bridge |
| `benchmark_memory.py` | Benchmark de memória |
| `bianinho_bridge.py` | Bridge TCP Python (22 comandos) |

## Segurança

- **HMAC auth**: Token com TTL de 24h
- **Rate limiting**: 100 req/min por cliente
- **Skills sandbox**: subprocess isolado com resource limits
- **Backup/rollback**: 3 níveis (pre-write, diário, semanal)
- **RAG isolation**: access levels (full, read_sac, read_personal)

## Acesso à Bridge

- **Porta**: `18743` (TCP localhost)
- **Token**: gerado em `~/.hermes/config/bridge_secret.key`

## Uninstall

```bash
# Remover completamente:
rm -rf ~/AionUI-Bianinho
rm -rf ~/Library/ApplicationSupport/AionUI
rm -f ~/bin/aionui-bianinho
rm -f ~/bin/bianinho
pkill -f bianinho_bridge
```
