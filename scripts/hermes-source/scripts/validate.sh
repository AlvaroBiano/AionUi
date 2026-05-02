#!/usr/bin/env bash
# ============================================================
# AionUI × Hermes Agent — Script de Validação
# ============================================================

set -e

echo "=========================================="
echo "  Validação da Integração"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

ERRORS=0

# 1. Hermes Agent
echo -n "Hermes Agent ... "
if command -v hermes &> /dev/null; then
    pass "$(which hermes)"
else
    fail "não encontrado no PATH"
    ((ERRORS++))
fi

# 2. Hermes version
echo -n "Hermes version ... "
if hermes --version &> /dev/null; then
    pass "$(hermes --version)"
elif hermes --help &> /dev/null; then
    pass "comando disponível"
else
    warn "não foi possível verificar versão"
fi

# 3. AionUI
echo -n "AionUI ... "
if command -v aionui &> /dev/null; then
    pass "cli encontrado"
elif [ -d "/Applications/AionUI.app" ]; then
    pass "macOS app encontrado"
elif [ -f "$HOME/AionUI/AionUI" ]; then
    pass "Linux app encontrado"
else
    warn "não encontrado (opcional para esta validação)"
fi

# 4. Config Hermes
echo -n "Config hermes-agent.json ... "
if [ -f "$HOME/.aionui/agents/hermes-agent.json" ]; then
    pass "encontrado"
else
    warn "não encontrado (execute setup.sh)"
fi

# 5. RAG path
echo -n "RAG Knowledge Base ... "
if [ -d "$HOME/KnowledgeBase/knowledge_db" ]; then
    pass "encontrado"
else
    warn "não encontrado"
fi

# 6. Workspace
echo -n "Workspace ... "
if mkdir -p "$HOME/.hermes/workspace" 2>/dev/null; then
    pass "ok"
else
    fail "erro ao criar"
    ((ERRORS++))
fi

# 7. Team config
echo -n "Team TEN-Clinical ... "
if [ -f "$HOME/.aionui/teams/TEN-Clinical-Team.json" ]; then
    pass "encontrado"
else
    warn "não encontrado (execute setup.sh)"
fi

# 8. Skill TEN
echo -n "Skill Method TEN ... "
if [ -d "$HOME/.aionui/skills/method-ten" ]; then
    pass "encontrada"
else
    warn "não encontrada (execute setup.sh)"
fi

# 9. Python3 (para RAG)
echo -n "Python3 ... "
if command -v python3 &> /dev/null; then
    pass "$(python3 --version)"
else
    fail "não encontrado"
    ((ERRORS++))
fi

# 10. RAG script
echo -n "RAG search script ... "
if [ -f "$HOME/.hermes/scripts/rag_search.py" ]; then
    pass "encontrado"
else
    warn "não encontrado"
fi

echo ""
echo "=========================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ Validação completa — tudo ok!${NC}"
else
    echo -e "${RED}✗ $ERRORS erro(s) encontrado(s)${NC}"
fi
echo "=========================================="

exit $ERRORS
