# BianinhoAgent — Setup Completo (Opção A)

## O Que É

Bundle completo com **TUDO local** no Mac:
- AionUI (Electron)
- Hermes Agent
- Knowledge Base (~65k chunks, Método TEN + livros + SAC)
- 70+ Skills
- BianinhoBridge (TCP bridge Python)

**Funciona 100% offline** após instalação.

## Tamanho

| Componente | Tamanho |
|------------|---------|
| Hermes source | 1.1 MB |
| Python venv (lancedb) | 382 MB |
| Knowledge Base | 1.1 GB → ~500 MB comprimido |
| Skills | 16 MB → ~5 MB comprimido |
| Bridge + config | 1 MB |
| **Total** | **~900 MB** |

## Instalação

### Passo 1 — No servidor (criar e servir bundle)

```bash
cd ~/repos/aionui-custom
bash scripts/export-lean-bundle.sh both
```

O servidor vai:
1. Criar o venv lean (~382MB)
2. Copiar KB (~1.1GB)
3. Criar archive (~900MB)
4. Iniciar servidor HTTP na porta 8878

Anota o IP do servidor que aparece no output.

### Passo 2 — No Mac (descarregar e extrair bundle)

```bash
# Instalar AionUI (se ainda não estiver)
curl -fsSL https://raw.githubusercontent.com/AlvaroBiano/AionUi/main/scripts/install.sh | bash

# Descarregar bundle (~900MB)
curl -o ~/Downloads/bianinho-lean.tar.gz \
  http://IP_SERVIDOR:8878/download

# Ou se preferires por USB:
# Copia o ficheiro /tmp/bianinho-lean-mac.tar.gz do servidor para USB
# Depois no Mac: scp usb:/tmp/bianinho-lean-mac.tar.gz ~/Downloads/

# Extrair para Application Support
mkdir -p ~/Library/ApplicationSupport/AionUI
tar -xzf ~/Downloads/bianinho-lean.tar.gz \
  -C ~/Library/ApplicationSupport/
```

### Passo 3 — No Mac (configurar e iniciar)

```bash
# Setup completo (configura API key e inicia serviços)
bash ~/AionUI-Bianinho/scripts/setup-complete.sh
```

O script pede a **MiniMax API Key** (obtém em https://platform.minimaxi.com).

## Após instalação

```bash
# Iniciar tudo
bash ~/Library/ApplicationSupport/AionUI/bin/hermes-start.sh

# Ou manualmente:
cd ~/Library/ApplicationSupport/AionUI
source ./venv/bin/activate
python3 bianinho_bridge.py &   # Bridge TCP
python3 -m hermes_agent.cli &   # Hermes
open AionUI.app
```

## Ficheiros instalados

```
~/Library/ApplicationSupport/AionUI/
├── hermes/               # Hermes Agent source
├── venv/                 # Python environment (~382MB)
├── knowledge_db/         # Knowledge Base (~1.1GB)
├── skills/               # 70+ skills (~16MB)
├── bianinho_bridge.py    # TCP bridge
├── config/               # Bridges secret, etc.
└── bin/
    ├── hermes            # Launcher script
    └── hermes-start.sh   # Start all services
```

## Fluxo completo

```
Servidor                          Mac
+---------+                  +------------+
|export   | --HTTP:8878-->  |install.sh  |
|bundle   |                  +------------+
|         | --curl:900MB--> |Downloads   |
+---------+                  +------------+
                                    |
                                    v
                            tar -xzf
                                    |
                                    v
                            +---------------+
                            |Application    |
                            |Support/AionUI |
                            +---------------+
                                    |
                                    v
                            setup-complete.sh
                            (API key + start)
                                    |
                                    v
                            +---------------+
                            |100% offline   |
                            |BianinhoAgent  |
                            +---------------+
```

## Resolução de problemas

### "Bundle não encontrado"
```bash
# Verifica que extraíste para o sítio certo
ls ~/Library/ApplicationSupport/AionUI/
```

### "API key inválida"
```bash
nano ~/.hermes/config/.env
# Edita a linha MINIMAX_API_KEY=...
```

### Hermes não responde
```bash
# Ver logs
tail -f ~/Library/ApplicationSupport/AionUI/logs/hermes.log
tail -f ~/Library/ApplicationSupport/AionUI/logs/bridge.log
```

### Reiniciar tudo
```bash
pkill -f bianinho_bridge
pkill -f hermes_agent
bash ~/Library/ApplicationSupport/AionUI/bin/hermes-start.sh
```

## Desinstalar

```bash
rm -rf ~/Library/ApplicationSupport/AionUI
rm -f ~/bin/aionui-bianinho
rm -f ~/bin/bianinho
pkill -f bianinho_bridge
pkill -f hermes_agent
```
