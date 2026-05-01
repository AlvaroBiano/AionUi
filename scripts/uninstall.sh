#!/usr/bin/env bash
# ============================================================
# BianinhoBridge Uninstall Script
# Remove completamente o AionUI + Bianinho do sistema
# ============================================================

set -e

echo "🗑️  Desinstalando BianinhoBridge + AionUI..."
echo

# 1. Matar processos
echo "[1/6] A matar processos..."
pkill -f "bianinho_bridge" 2>/dev/null || true
pkill -f "AionUI" 2>/dev/null || true
pkill -f "electron" 2>/dev/null || true
echo "  ✓ Processos terminados"

# 2. Remover atalhos
echo "[2/6] A remover atalhos..."
rm -f ~/bin/aionui-bianinho
rm -f ~/.local/share/applications/aionui-bianinho.desktop
rm -f ~/.local/share/applications/geekhub.desktop
echo "  ✓ Atalhos removidos"

# 3. Remover directórios de instalação
echo "[3/6] A remover ficheiros..."
rm -rf ~/repos/aionui-custom
rm -rf ~/.local/share/aionui-bianinho
rm -rf ~/.config/aionui-bianinho
echo "  ✓ Ficheiros removidos"

# 4. Remover sudoers (se existir)
echo "[4/6] A remover sudoers..."
rm -f /etc/sudoers.d/bianinho-admin 2>/dev/null || true
echo "  ✓ Sudoers removido"

# 5. Remover crontab entries do SyncedUpdater
echo "[5/6] A limpar crontab..."
(crontab -l 2>/dev/null | grep -v "synced_updater\|bianinho" || true) | crontab - 2>/dev/null || true
echo "  ✓ Crontab limpa"

# 6. Confirmar
echo "[6/6] Verificação..."
remaining=$(ls -la ~/repos/aionui-custom 2>/dev/null || echo "não existe")
if [[ "$remaining" == "não existe" ]]; then
    echo "  ✓ Desinstalação completa"
else
    echo "  ⚠ Ainda existem ficheiros"
    echo "  $remaining"
fi

echo
echo "✅ BianinhoBridge + AionUI removido com sucesso."
echo "   Os seus dados em ~/.hermes/ foram mantidos."
