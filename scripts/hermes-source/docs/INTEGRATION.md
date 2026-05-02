# Integração AionUI × Hermes Agent (Bianinho)

## Visão Geral

O AionUI detecta e usa agents via dois mecanismos principais:

1. **ACP CLI Detection** — detecta agents conhecidos no PATH (ex: `hermes`, `claude`, `codex`)
2. **Custom Agents** — agents definidos pelo usuário via config JSON

O Hermes Agent está **nativamente registrado** em `POTENTIAL_ACP_CLIS` como `'hermes'`. No entanto, o protocolo ACP do Hermes (JSON-RPC para editores) é diferente do protocolo que o AionUI usa para agents (aionrs JSON Stream). Por isso, usamos um **bridge de protocolo**.

---

## Arquitetura do Bridge

```
AionUI (Electron)
    │
    │  stdio — linha JSON por linha
    ▼
aionrs_bridge.py  ← tradutor de protocolo
    │
    │  subprocess (Python venv do hermes-agent)
    ▼
Hermes AIAgent.chat()  ← API Python do Hermes
    │
    ▼
MiniMax M2.7 / M2.1  ← modelos
```

### Por que um bridge?

| Aspecto | Hermes ACP | AionUI aionrs |
|---|---|---|
| Protocolo | JSON-RPC 2.0 (LSP-like) | aionrs JSON Stream |
| Inicialização | handshake `initialize` | `ready` event |
| Streaming | `notification` messages | `text_delta` events |
| Ferramentas | `tools/call` | `tool_request` / `tool_result` |
| Fim | sem marker | `stream_end` event |

Os protocolos são incompatíveis — o bridge faz a tradução.

---

## Detalhes do Bridge

### Arquivo

`scripts/aionrs-bridge/aionrs_bridge.py`

### Inicialização

```python
# 1. Lê config do Hermes (venv Python)
venv_python = '/home/alvarobiano/.hermes/hermes-agent/venv/bin/python'

# 2. Cria wrapper SubprocessHermes
class SubprocessHermes:
    def chat(self, message: str) -> str:
        # Executa AIAgent.chat() via subprocess
        # Usa o Python do venv para ter todas as deps
        script = f'''
import sys
sys.path.insert(0, '{hermes_root}')
from run_agent import AIAgent
agent = AIAgent(provider='minimax', model='MiniMax-M2.7', ...)
print(agent.chat({repr(message)}), end='')
'''
        result = subprocess.run([venv_python, '-c', script], ...)
        return result.stdout
```

### Loop Principal

```python
def main():
    hermes = HermesBridge()
    protocol = AionrsProtocol(hermes)

    protocol.send_ready()  # AionUI espera isso primeiro!

    for line in sys.stdin:
        protocol.handle(line.strip())
```

### Eventos Enviados

```python
# Ready
{'type': 'ready', 'version': '1.0.0', 'session_id': '...',
 'capabilities': {'tool_approval': True, 'thinking': True, ...}}

# Streaming
{'type': 'stream_start', 'msg_id': 'test-1'}
{'type': 'text_delta', 'text': 'Olá! Eu sou o ', 'msg_id': 'test-1'}
{'type': 'text_delta', 'text': 'Bianinho...', 'msg_id': 'test-1', 'is_finish': True}
{'type': 'stream_end', 'msg_id': 'test-1'}
```

### Comandos Recebidos

```python
{'type': 'message', 'msg_id': '...', 'content': 'Olá?'}
{'type': 'ping'}
{'type': 'stop'}
{'type': 'tool_approve', 'call_id': '...'}
{'type': 'tool_deny', 'call_id': '...', 'reason': '...'}
{'type': 'set_config', 'model': 'MiniMax-M2.7', 'thinking': True}
{'type': 'set_mode', 'mode': 'default'}
```

---

## Custom Agent Config

```json
{
  "id": "hermes-bianinho",
  "name": "Bianinho (Hermes Agent)",
  "cliCommand": "python3",
  "defaultCliPath": "/usr/bin/python3",
  "acpArgs": ["/path/to/aionrs_bridge.py"],
  "enabled": true,
  "supportsStreaming": true
}
```

Ou via wrapper shell:

```bash
#!/bin/bash
# hermes-wrapper.sh
exec /home/alvarobiano/.hermes/hermes-agent/venv/bin/python \
  /path/to/aionrs_bridge.py "$@"
```

```json
{
  "cliCommand": "/path/to/hermes-wrapper.sh"
}
```

---

## Hermes Agent Nativo (ACP)

O Hermes também suporta `hermes acp` — modo editor para VS Code/Zed/JetBrains. Este modo usa JSON-RPC 2.0:

```python
# Exemplo de comunicação ACP com Hermes
import subprocess, json

proc = subprocess.Popen(['hermes', 'acp'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

# Initialize
init = {'jsonrpc':'2.0','id':1,'method':'initialize','params':{
    'protocolVersion':'1.0','capabilities':{},'clientInfo':{'name':'aionui','version':'1.0'}}}
proc.stdin.write((json.dumps(init)+'\n').encode())
proc.stdin.flush()

# Chat
msg = {'jsonrpc':'2.0','id':2,'method':'chat/message','params':{'content':'Olá'}}
proc.stdin.write((json.dumps(msg)+'\n').encode())
proc.stdin.flush()
```

Este modo **não é compatível** com o aionrs protocol do AionUI sem bridge.

---

## Teste do Bridge

```bash
# Teste rápido
echo '{"type":"message","msg_id":"t1","content":"Olá"}' | \
  python3 scripts/aionrs-bridge/aionrs_bridge.py

# Teste completo
python3 scripts/aionrs-bridge/test_bridge.py
```

Resultado esperado:
```
{"type": "ready", ...}
{"type": "stream_start", "msg_id": "t1"}
{"type": "text_delta", "text": "Olá! Eu sou o **Bianinho**...", "msg_id": "t1"}
{"type": "stream_end", "msg_id": "t1"}
```

---

## Caminhos Importantes

| Componente | Caminho |
|---|---|
| Bridge | `scripts/aionrs-bridge/aionrs_bridge.py` |
| Hermes root | `/home/alvarobiano/.hermes/hermes-agent/` |
| Hermes venv | `/home/alvarobiano/.hermes/hermes-agent/venv/bin/python` |
| run_agent.py | `/home/alvarobiano/.hermes/hermes-agent/run_agent.py` |
| RAG KB | `~/repos/hermes-agent/rag/knowledge_base/` |
| Hermes binary | `/home/alvarobiano/.local/bin/hermes` |
