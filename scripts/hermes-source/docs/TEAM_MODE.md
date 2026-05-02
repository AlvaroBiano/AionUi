# Team Mode — AionUI

## O que é

O **Team Mode** do AionUI permite orquestrar múltiplos agents de IA como uma equipa. Cada agent tem um papel definido, e o líder (leader) coordena as tarefas.

## Estrutura da Equipa TEN

```
┌─────────────────────────────────────────────────────────┐
│              TEN — Clínica & Tecnologia                  │
│                                                         │
│  ┌─────────────┐                                        │
│  │  BIANINHO   │ ← Líder (leader)                      │
│  │  (Hermes)   │   Coordena, delega, responde          │
│  └──────┬──────┘                                        │
│         │                                               │
│  ┌──────┴──────┬──────────────┬─────────────┐         │
│  │             │              │             │            │
│  ▼             ▼              ▼             ▼            │
│ Bianinho  Claude Code    Gemini     Bianinho SAC        │
│ SAC        (coding)     (web search) (leads)            │
│  │             │              │             │            │
└──────────────┼──────────────┼─────────────┼────────────┘
```

## Papéis

| Agent | Role | Responsabilidade |
|---|---|---|
| Bianinho | `leader` | Coordenação geral, decisões, método TEN |
| Claude Code | `coding` | Programação, implementação de features |
| Gemini | `web-search` | Pesquisa web, estudos científicos |
| Bianinho SAC | `specialist` | Leads, WhatsApp, conversão |

## Configuração Completa

### Ficheiro: `config/team-ten-full.yaml`

O ficheiro YAML define:
- ID e nome da equipa
- Agentes (com prompts e roles)
- Canais de comunicação (mailbox, task)
- Regras de orquestração

### Importar para o AionUI

1. Abra o AionUI
2. Vá para **Team** → **Settings** → **Import Team Config**
3. Selecione `config/team-ten-full.yaml`
4. A equipa aparece na barra lateral

### Alternativa: Config Manual

1. Abra o AionUI
2. Vá para **Team** → **Add Teammate**
3. Adicione cada agent manualmente:
   - **Bianinho (Hermes)**: Custom agent `hermes-bianinho`
   - **Claude Code**: `claude` ou `codex`
   - **Gemini**: `gemini`
   - **Bianinho SAC**: Custom agent

## Como Funciona

### Mailbox

Cada agent tem uma **mailbox** — uma fila de mensagens. Quando um agent recebe uma mensagem na mailbox, ele acorda (wake) e processa.

```
User message → Leader (Bianinho)
    ↓ delega
Claude Code mailbox → Claude Code acorda → processa
    ↓ devolve
Leader mailbox ← resultado
    ↓
User ← resposta
```

### Task Board

Tarefas são criadas e atribuídas automaticamente:

```
/code implement feature X
  → Task criada: "Implement feature X"
  → Atribuída a: Claude Code
  → Status: pending → in_progress → done
```

### Wake Rules

Regras que determinam qual agent acordar:

```yaml
wake_rules:
  - trigger: "message contains 'code' or 'implement'"
    wake: "claude-code"
  - trigger: "message contains 'search' or 'pesquisa'"
    wake: "gemini"
  - trigger: "message contains 'lead' or 'whatsapp'"
    wake: "hermes-sac"
  - trigger: "default"
    wake: "hermes-bianinho"
```

## Comandos de Equipa

No AionUI Team Mode, use:

```
@bianinho O que é o Método TEN?
@claude-code implementa webhook para Hotmart
@gemini pesquisa estudos sobre TCC para ansiedade
@hermes-sac lead com dúvida sobre preço
```

## Personalização

### Editar Prompts

Edite `config/team-ten-full.yaml` para personalizar o comportamento de cada agent:

```yaml
agents:
  - id: "hermes-bianinho"
    prompt: |
      Você é o Bianinho...
      [SEU PROMPT PERSONALIZADO AQUI]
```

### Adicionar Novos Agents

```yaml
agents:
  - id: "meu-agent"
    name: "Meu Agent"
    role: "specialist"
    type: "custom"
    enabled: true
    prompt: |
      Você é...
```

### Configurar Canais

```yaml
channels:
  - name: "mailbox-projeto-x"
    type: "mailbox"
    agents: ["hermes-bianinho", "claude-code"]
```

## Status dos Agentes

| Status | Significado |
|---|---|
| `pending` | Nunca foi ativado |
| `idle` | Ativo mas sem tarefa |
| `active` | Processando tarefa |
| `failed` | Erro na última execução |
| `offline` | Não disponível |

## Troubleshooting

### Agent não acorda
- Verificar se está `enabled: true`
- Verificar se o CLI path está correto
- Verificar se o agent está no `team.agents` array

### Mensagem não chega
- Verificar `wake_rules` — talvez o trigger não esteja a funcionar
- Verificar mailbox: **Team** → **Mailbox** → ver mensagens pendentes

### Agent falha sempre
- Verificar logs: `Settings` → **Logs**
- Verificar se o CLI está acessível: `which [cli-name]`

## Ficheiros Relacionados

- `config/team-ten-full.yaml` — Configuração completa da equipa
- `.aionui-skills/method-ten/SKILL.md` — Skill do Método TEN
- `scripts/aionrs-bridge/` — Bridge de integração com Hermes
