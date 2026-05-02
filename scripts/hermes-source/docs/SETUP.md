# Setup Completo — AionUI × Bianinho

Este guia explica como configurar tudo, passo a passo.

---

## Índice

1. [Pré-requisitos](#pré-requisitos)
2. [Instalar Hermes Agent](#instalar-hermes-agent)
3. [Instalar AionUI](#instalar-aionui)
4. [Configurar o Bridge](#configurar-o-bridge)
5. [Configurar Custom Agent](#configurar-custom-agent)
6. [Configurar Team Mode](#configurar-team-mode)
7. [Testar Tudo](#testar-tudo)
8. [Resolução de Problemas](#resolução-de-problemas)

---

## Pré-requisitos

### Hardware

- 4+ GB RAM
- 10+ GB disco
- Linux Mint/Ubuntu ou macOS

### Software

- **Node.js** 18+ (`node --version`)
- **Python** 3.10+ (`python3 --version`)
- **Git** (`git --version`)
- **Xvfb** (Linux, para Electron headless)
- **Hermes Agent** instalado

### Verificar

```bash
node --version   # deve ser >= 18
python3 --version # deve ser >= 3.10
git --version
which hermes     # deve mostrar o caminho do hermes
```

---

## Instalar Hermes Agent

Se o Hermes Agent ainda não está instalado:

```bash
# Clonar
git clone https://github.com/NousResearch/Hermes-Agent.git ~/repos/hermes-agent

# Setup
cd ~/repos/hermes-agent
./setup-hermes.sh

# Verificar
hermes --version
```

### Configurar API Key

```bash
# Adicionar ao ~/.bashrc
echo 'export MINIMAX_API_KEY="sua_chave_aqui"' >> ~/.bashrc
source ~/.bashrc

# Ou editar ~/.hermes/.env
nano ~/.hermes/.env
```

---

## Instalar AionUI

### Opção A:macOS

```bash
brew install --cask aionui
```

### Opção B: Linux (Build from Source)

```bash
cd ~/repos/aionui-hermes-ten
chmod +x scripts/install-aionui-linux.sh
./scripts/install-aionui-linux.sh
```

O script vai:
1. Instalar dependências do sistema (Xvfb, libgtk, etc.)
2. Clonar o AionUI do GitHub
3. Instalar npm packages
4. Buildar o Electron app

### Opção C: Docker

```bash
# Ainda não disponível — usar opção A ou B
```

---

## Configurar o Bridge

O **bridge** traduz entre o protocolo do AionUI (aionrs) e o Hermes Agent.

### Testar o Bridge

```bash
cd ~/repos/aionui-hermes-ten
python3 scripts/aionrs-bridge/test_bridge.py
```

Deve mostrar:
```
ready event: ✓
stream_start event: ✓
stream_end event: ✓
text_delta event: ✓
```

### Configuração Manual

```bash
# Tornar executável
chmod +x scripts/aionrs-bridge/aionrs_bridge.py

# Teste rápido
echo '{"type":"message","msg_id":"t1","content":"Olá"}' | \
  python3 scripts/aionrs-bridge/aionrs_bridge.py
```

---

## Configurar Custom Agent

No AionUI:

1. **Settings** → **Agents** → **Custom Agents**
2. Clicar **Add**
3. Preencher:

```json
{
  "id": "hermes-bianinho",
  "name": "Bianinho (Hermes)",
  "description": "Agente autônomo do Álvaro Bianoi — Método TEN, RAG e SAC Bot",
  "cliCommand": "python3",
  "defaultCliPath": "/usr/bin/python3",
  "acpArgs": ["/home/alvarobiano/repos/aionui-hermes-ten/scripts/aionrs-bridge/aionrs_bridge.py"],
  "enabled": true,
  "supportsStreaming": true,
  "env": {}
}
```

Ou usar o config pronto:

```bash
# Copiar para a clipboard
cat ~/repos/aionui-hermes-ten/scripts/config/custom-agent-hermes.json
# Colar no AionUI Settings → Agents → Custom Agents → Add
```

---

## Configurar Team Mode

### Importar Config

1. Abrir **AionUI**
2. Ir para **Team** → **Settings** → **Import Team Config**
3. Selecionar: `~/repos/aionui-hermes-ten/config/team-ten-full.yaml`

### Config Manual

1. **Team** → **Add Teammate**
2. Adicionar agents:

| Agent | Type | CLI/Config |
|---|---|---|
| Bianinho | Custom | `hermes-bianinho` |
| Claude Code | Preset | `claude` ou `codex` |
| Gemini | Preset | `gemini` |
| Bianinho SAC | Custom | `hermes-sac` |

3. Definir líder: **Bianinho** (hermes-bianinho)
4. Configurar roles conforme tabela acima

---

## Testar Tudo

### 1. Bridge

```bash
python3 scripts/aionrs-bridge/test_bridge.py
```

### 2. Hermes Agent

```bash
hermes chat --oneshot "Olá, quem é você?"
```

### 3. Custom Agent no AionUI

1. Abrir AionUI
2. Selecionar **Bianinho (Hermes)** na barra lateral
3. Enviar mensagem: "Olá, quem é você?"
4. Verificar resposta streaming

### 4. Team Mode

1. Abrir AionUI
2. Ir para **Team**
3. Selecionar **TEN — Clínica & Tecnologia**
4. Enviar: "@bianinho O que é o Método TEN?"
5. Verificar delegação para Claude Code ou Gemini se aplicável

---

## Resolução de Problemas

### "hermes: command not found"

```bash
# Adicionar ao PATH
export PATH="$HOME/.local/bin:$PATH"

# Ou criar alias
echo 'alias hermes="$HOME/.local/bin/hermes"' >> ~/.bashrc
```

### "AionUI não abre (Linux)"

```bash
# Instalar Xvfb
sudo apt-get install -y xvfb libgtk-3-0

# Rodar com Xvfb
xvfb-run /caminho/para/AionUi
```

### "Bridge não responde"

```bash
# Verificar se Python do Hermes venv funciona
/home/alvarobiano/.hermes/hermes-agent/venv/bin/python \
  -c "import sys; sys.path.insert(0,'/home/alvarobiano/.hermes/hermes-agent'); from run_agent import AIAgent; print('OK')"

# Ver logs do Hermes
tail -f ~/.hermes/logs/agent.log
```

### "Custom agent não aparece"

Verificar se o `acpArgs` tem o caminho correto para o bridge:
```json
"acpArgs": ["/home/alvarobiano/repos/aionui-hermes-ten/scripts/aionrs-bridge/aionrs_bridge.py"]
```

### "Team Mode não funciona"

1. Verificar se todos os agents estão `enabled: true`
2. Verificar se o líder está definido: `leader: "hermes-bianinho"`
3. Reiniciar o AionUI

---

## Estrutura Final

```
~
├── .hermes/                    # Hermes Agent
│   ├── hermes-agent/          # Código fonte
│   ├── .env                   # MINIMAX_API_KEY
│   └── logs/                  # Logs
├── repos/
│   ├── aionui-hermes-ten/     # ESTE REPOSITÓRIO
│   │   ├── config/
│   │   │   ├── team-ten-full.yaml
│   │   │   └── custom-agent-hermes.json
│   │   ├── scripts/
│   │   │   └── aionrs-bridge/
│   │   │       └── aionrs_bridge.py
│   │   └── docs/
│   │       ├── QUICK_START.md
│   │       ├── SETUP.md
│   │       ├── INTEGRATION.md
│   │       └── TEAM_MODE.md
│   └── aionui/                # AionUI (git clone)
│       └── out/AionUi         # Executável
└── .local/bin/
    └── hermes                  # Symlink para Hermes
```

---

## Próximos Passos

1. ✅ Configurar AionUI
2. ✅ Configurar Bianinho como custom agent
3. ✅ Configurar Team Mode
4. ⬜ Personalizar prompts para o consultório
5. ⬜ Integrar com Hotmart/Eduzz/Kiwify
6. ⬜ Configurar webhooks do SAC Bot
7. ⬜ Automatizar backups
