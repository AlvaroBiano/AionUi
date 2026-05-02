# Quick Start — AionUI × Bianinho

Este guia leva você de zero a tudo funcionando.

---

## 1. Pré-requisitos

- Linux Mint/Ubuntu (este servidor) ou macOS
- Node.js 18+ (para build do AionUI)
- Python 3.10+
- Hermes Agent já instalado: `~/.local/bin/hermes`

---

## 2. Instalar AionUI

```bash
# Clone este repositório de integração
cd ~/repos/aionui-hermes-ten

# Execute o script de instalação do AionUI
chmod +x scripts/install-aionui-linux.sh
./scripts/install-aionui-linux.sh
```

O script vai:
- Instalar dependências do sistema (Xvfb, etc.)
- Clonar o AionUI (se não existir)
- Instalar npm packages
- Buildar o Electron app
- Configurar aliases

---

## 3. Testar o Bridge (Bianinho via AionUI)

```bash
# Teste direto do bridge
cd ~/repos/aionui-hermes-ten
python3 scripts/aionrs-bridge/test_bridge.py
```

Resultado esperado:
```
=== Teste do aionrs Bridge ===
  ready event: ✓
  stream_start event: ✓
  stream_end event: ✓
  text_delta event: ✓
Teste APROVADO
```

---

## 4. Iniciar o AionUI

```bash
# Com Xvfb (headless, sem GUI)
xvfb-run /home/alvarobiano/repos/aionui/out/AionUi

# Ou com alias (depois de source ~/.bashrc)
aionui-start
```

O AionUI vai abrir. Vá para:
- **Settings → Agents → Custom Agents** → Add → cole o conteúdo de `scripts/config/custom-agent-hermes.json`

---

## 5. Configurar Team Mode

1. Abra AionUI
2. Vá para **Team** → **Settings** → **Import Team Config**
3. Selecione `config/team-ten-full.yaml`
4. A equipa "TEN — Clínica & Tecnologia" aparece com:
   - **Bianinho** (líder) — Hermes Agent
   - **Bianinho SAC** (especialista) — leads e matrículas
   - **Claude Code** (coding)
   - **Gemini Search** (web search)

---

## 6. Usar o Bianinho

No AionUI, selecione o agent **Bianinho (Hermes)** na barra lateral.

Exemplos de comandos:

```
/bianinho O que é o Método TEN?
/bianinho Triagem: ansiedade grave com insônia há 3 meses
/bianinho Pesquisar: eficácia da terapia cognitivo-comportamental para depression
/bianinho Configurar cron job para monitorizar o servidor
/bbianinho Fazer backup do siteTen
```

---

## 7. Estrutura de Ficheiros

```
aionui-hermes-ten/
├── config/
│   ├── team-ten-full.yaml     # Config completo do Team Mode
│   └── custom-agent-hermes.json  # Config do custom agent
├── scripts/
│   ├── aionrs-bridge/
│   │   ├── aionrs_bridge.py  # Bridge principal ★
│   │   ├── test_bridge.py    # Teste
│   │   └── install.sh        # Instalação do bridge
│   ├── install-aionui-linux.sh  # Script instalação AionUI
│   └── aionui.desktop        # Entry para Linux
├── docs/
│   ├── QUICK_START.md        # Este guia
│   ├── SETUP.md              # Guia detalhado
│   ├── INTEGRATION.md        # Detalhes técnicos
│   └── TEAM_MODE.md          # Team Mode
└── .aionui-skills/
    └── method-ten/
        └── SKILL.md          # Skill do Método TEN
```

---

## 8. Resolução de Problemas

### "AionUI não abre"
```bash
# Verificar se Xvfb está a funcionar
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
./aionui
```

### "Bridge não responde"
```bash
# Testar manualmente
echo '{"type":"message","msg_id":"t1","content":"teste"}' | \
  python3 scripts/aionrs-bridge/aionrs_bridge.py

# Ver logs
tail -f ~/.hermes/logs/agent.log
```

### "Hermes não encontrado"
```bash
# Verificar se hermes está no PATH
which hermes || echo "Hermes não está no PATH"
# Adicionar se necessário
export PATH="$HOME/.local/bin:$PATH"
```

### "npm install falha"
```bash
# Limpar e tentar novamente
cd ~/repos/aionui
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

---

## 9. Comandos Úteis

```bash
# Ver status do Hermes
hermes status

# Ver logs do agent
hermes logs --tail 50

# Reiniciar gateway
hermes gateway restart

# Testar RAG
hermes rag query "Método TEN"

# Ver cron jobs
hermes cron list
```

---

## 10. Próximos Passos

Depois de tudo configurado:

1. **Personalize os prompts** em `config/team-ten-full.yaml`
2. **Adiciona Q&As** ao SAC Bot para leads específicos
3. **Configura webhooks** para Hotmart/Eduzz/Kiwify
4. **Automatiza backup** com cron jobs
5. **Explora Team Mode** — adiciona mais agents conforme necessidade
