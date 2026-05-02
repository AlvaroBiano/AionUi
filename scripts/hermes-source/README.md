# AionUI × Hermes Agent — Bianinho no AionUI

**Integração entre AionUI (plataforma multi-agent cowork) e Hermes Agent (Bianinho).**

- Repo: https://github.com/AlvaroBiano/aionui-hermes-ten
- AionUI: [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) (23k+ stars, Apache-2.0)
- Bianinho: Hermes Agent do Álvaro Bianoi — Método TEN, RAG, SAC Bot

---

## Arquitetura da Integração

```
┌──────────────────────────────────────────────────────┐
│                   AionUI (Frontend)                 │
│     Team Mode + Multi-Agent + UI em tempo real       │
└───────────────────────┬──────────────────────────────┘
                        │ aionrs JSON Stream Protocol
                        │ (stdio — subprocess)
                        ▼
┌──────────────────────────────────────────────────────┐
│           aionrs_bridge.py (nosso bridge)           │
│   Traduz: aionrs JSON ↔ Hermes AIAgent Python API    │
└───────────────────────┬──────────────────────────────┘
                        │ Python API (AIAgent.chat)
                        ▼
┌──────────────────────────────────────────────────────┐
│               Hermes Agent (Bianinho)                │
│  • RAG Knowledge Base (Método TEN)                   │
│  • SAC Bot (WhatsApp +5548991286513)                │
│  • Cron jobs autônomos (mandate + inbox)             │
│  • MiniMax M2.7 + M2.1                              │
└──────────────────────────────────────────────────────┘
```

**Alternativa (sem bridge):** Hermes Agent já está registrado como potential ACP CLI no AionUI (`'hermes'` in `POTENTIAL_ACP_CLIS`). Se detectado no PATH, o AionUI vai usar `hermes --experimental-acp`.

---

## Quick Start

### 1. Pré-requisitos

- AionUI instalado: `brew install --cask aionui` (macOS) ou Docker/Linux
- Hermes Agent em `~/.local/bin/hermes` ou no PATH
- Python 3.10+

### 2. Configurar Custom Agent

No AionUI, vá em **Settings → Agents → Custom Agents** e adicione:

```json
{
  "id": "hermes-bianinho",
  "name": "Bianinho (Hermes)",
  "cliCommand": "python3",
  "defaultCliPath": "/usr/bin/python3",
  "acpArgs": ["/home/alvarobiano/repos/aionui-hermes-ten/scripts/aionrs-bridge/aionrs_bridge.py"],
  "enabled": true,
  "supportsStreaming": true,
  "env": {}
}
```

Ou use o script de instalação:

```bash
cd ~/repos/aionui-hermes-ten/scripts/aionrs-bridge
chmod +x install.sh
./install.sh
```

### 3. Testar o Bridge

```bash
cd ~/repos/aionui-hermes-ten/scripts/aionrs-bridge
python3 test_bridge.py
```

Saída esperada: `ready` → `stream_start` → `text_delta` (streaming) → `stream_end`

---

## O Bridge (aionrs_bridge.py)

O `aionrs_bridge.py` é o coração da integração.

### Protocolo

| Direção | Tipo | Descrição |
|---|---|---|
| `stdout → AionUI` | `ready` | Handshake inicial |
| `stdout → AionUI` | `stream_start` | Início de resposta |
| `stdout → AionUI` | `text_delta` | Chunk de texto (streaming) |
| `stdout → AionUI` | `thinking` | Output de raciocínio |
| `stdout → AionUI` | `tool_request` | Requisição de ferramenta |
| `stdout → AionUI` | `tool_result` | Resultado de ferramenta |
| `stdout → AionUI` | `stream_end` | Fim de resposta |
| `stdout → AionUI` | `error` | Erro |
| `stdout → AionUI` | `pong` | Resposta a ping |
| `stdin ← AionUI` | `message` | Mensagem do usuário |
| `stdin ← AionUI` | `stop` | Parar operação |
| `stdin ← AionUI` | `ping` | Keepalive |
| `stdin ← AionUI` | `tool_approve` | Aprovar ferramenta |
| `stdin ← AionUI` | `tool_deny` | Negar ferramenta |
| `stdin ← AionUI` | `set_config` | Mudar configuração |

### Como funciona internamente

```
AionUI (stdio)
  ↓ JSON linha
aionrs_bridge.py
  ↓ subprocess (hermes-agent venv Python)
  → AIAgent.chat(message)
  ↓
Hermes Agent (Bianinho)
  ↓ resposta
aionrs_bridge.py
  ↓ text_delta chunks
AionUI (stdio)
```

O bridge usa subprocess com o Python do venv do hermes-agent (`~/.hermes/hermes-agent/venv/bin/python`) para garantir todas as dependências. Cada mensagem cria um subprocess separado (simples mas funcional — ~2-3s por mensagem).

---

## Team Mode

O AionUI permite orquestrar múltiplos agents em equipe. Bianinho pode ser:

1. **Leader** — coordena a equipe
2. **Teammate** — executa tarefas específicas

### Configuração Team Mode

```yaml
# config/team-ten-clinical.yaml
team:
  name: "TEN-Clinical"
  leader: "hermes-bianinho"
  members:
    - id: "hermes-bianinho"
      role: "teammate"
      prompt: |
        Você é Bianinho — extensão digital do Álvaro Bianoi.
        Especialista em Método TEN e APC. Responde com precisão
        e usa perguntas reflexivas para engajar leads.
    - id: "claude-code"
      role: "coding"
    - id: "gemini"
      role: "web-search"
```

---

## Estrutura do Repositório

```
aionui-hermes-ten/
├── README.md                      # Este arquivo
├── CLAUDE.md                      # Contexto para AI agents
├── AGENTS.md                      # Convenções anti-dados fictícios
├── config/
│   ├── hermes-agent.json         # Config do Hermes como agent AionUI
│   ├── aionui-env.yaml           # Template variáveis de ambiente
│   └── custom-agent-hermes.json  # Config custom agent (deprecated)
├── docs/
│   ├── SETUP.md                  # Guia de instalação detalhado
│   ├── INTEGRATION.md            # Detalhes técnicos
│   └── TEAM_MODE.md              # Config Team Mode
├── scripts/
│   ├── setup.sh                  # Configuração automática
│   ├── validate.sh               # Validação pré-commit
│   └── aionrs-bridge/
│       ├── aionrs_bridge.py      # Bridge principal (★)
│       ├── test_bridge.py         # Teste de integração
│       ├── install.sh             # Instalação custom agent
│       └── README.md             # Documentação do bridge
└── .aionui-skills/
    └── method-ten/
        └── SKILL.md              # Skill Método TEN para AionUI
```

---

## Status da Integração

| Componente | Status | Notas |
|---|---|---|
| Bridge aionrs | ✅ Funcional | Protocolo 100% correto, testado |
| Hermes AIAgent via bridge | ✅ Funcional | Bianinho responde corretamente |
| Custom Agent no AionUI | 🔲 Pendente | Requer AionUI instalado no cliente |
| Team Mode | 🔲 Pendente | Requer AionUI instalado |
| Hermes ACP nativo | ⚠️  Protocolo diferente | Hermes usa JSON-RPC, AionUI usa aionrs |

---

## Referências

- AionUI: https://github.com/iOfficeAI/AionUi
- Hermes Agent: https://github.com/NousResearch/Hermes-Agent
- Protocolo aionrs: `src/process/agent/aionrs/protocol.ts` no AionUI
- ACP Detector: `src/process/agent/acp/AcpDetector.ts` no AionUI
