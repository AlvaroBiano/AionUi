#!/bin/bash
# Instala o aionrs bridge como agent customizado no AionUI
# Usage: ./install.sh

set -e

BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$BRIDGE_DIR")"
CONFIG_DIR="${HOME}/.aionui"

echo "=== AionRS Bridge Installation ==="
echo "Bridge dir: $BRIDGE_DIR"
echo "Repo dir: $REPO_DIR"

# Verificar dependências
echo ""
echo "[1/4] Verificando dependências..."

if ! command -v hermes &> /dev/null; then
    echo "  AVISO: 'hermes' não está no PATH"
    echo "  O bridge tentará usar o caminho: ~/.local/bin/hermes"
else
    echo "  hermes encontrado: $(which hermes)"
fi

if [ -d "$HOME/.hermes/hermes-agent/src" ]; then
    echo "  Hermes Agent source: $HOME/.hermes/hermes-agent/src ✓"
else
    echo "  AVISO: Hermes Agent source não encontrado"
fi

# Criar config dir
echo ""
echo "[2/4] Configurando AionUI..."
mkdir -p "$CONFIG_DIR"

# Verificar se o bridge funciona
echo ""
echo "[3/4] Testando bridge..."

if [ -f "$BRIDGE_DIR/test_bridge.py" ]; then
    python3 "$BRIDGE_DIR/test_bridge.py" || echo "  AVISO: Teste falhou (pode ser esperado se não houver API key)"
fi

# Configurar PATH para incluir hermes se necessário
echo ""
echo "[4/4] Verificando PATH..."

if command -v hermes &> /dev/null; then
    echo "  hermes no PATH ✓"
else
    echo "  Adicionando hermes ao PATH..."
    export PATH="$HOME/.local/bin:$PATH"
    if command -v hermes &> /dev/null; then
        echo "  hermes encontrado em ~/.local/bin ✓"
    fi
fi

echo ""
echo "=== Instalação concluída ==="
echo ""
echo "Próximos passos:"
echo "1. Abra o AionUI"
echo "2. Vá em Settings → Agents → Custom Agents"
echo "3. Adicione manualmente:"
echo '   {'
echo '     "id": "hermes-bianinho",'
echo '     "name": "Bianinho (Hermes Agent)",'
echo '     "cliCommand": "python3",'
echo '     "acpArgs": ["'"$BRIDGE_DIR/aionrs_bridge.py"'"],'
echo '     "enabled": true,'
echo '     "supportsStreaming": true'
echo '   }'
echo ""
echo "4. Use o Team Mode para orquestrar Bianinho com outros agents"
