#!/bin/bash
# ============================================================
# BianinhoBridge — Export Knowledge Base to Server
# Exports RAG knowledge base to a remote server endpoint
# ============================================================

set -e

# ── Paths ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINHO_BASE="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_BIN="$BINHO_BASE/venv/bin"

# ── Config ─────────────────────────────────────────────────
KB_SOURCE="$HOME/KnowledgeBase/knowledge_db"
EXPORT_CONFIG="$HOME/.hermes/config/kb-export.conf"
ARCHIVE_DIR="$HOME/KnowledgeBase/archives"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

# ── Cores ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoBridge — KB Export to Server"
    echo "=============================================="
    echo ""
}

# ── Load Config ─────────────────────────────────────────────
load_config() {
    if [ -f "$EXPORT_CONFIG" ]; then
        source "$EXPORT_CONFIG"
    else
        warn "Config not found: $EXPORT_CONFIG"
        warn "Using defaults"
        EXPORT_ENDPOINT="http://localhost:8080/api/kb/import"
        EXPORT_API_KEY=""
        EXPORT_BATCH_SIZE=100
    fi

    : "${EXPORT_ENDPOINT:=http://localhost:8080/api/kb/import}"
    : "${EXPORT_API_KEY:=}"
    : "${EXPORT_BATCH_SIZE:=100}"
}

# ── Check Prerequisites ─────────────────────────────────────
check_prereqs() {
    info "A verificar pré-requisitos..."

    if [ ! -d "$KB_SOURCE" ]; then
        error "KB source not found: $KB_SOURCE"
    fi

    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        error "curl or wget required"
    fi

    if ! "$VENV_BIN/python" -c "import lancedb" 2>/dev/null; then
        error "lancedb module not available"
    fi

    success "Pré-requisitos OK"
}

# ── Prepare Export ─────────────────────────────────────────
prepare_export() {
    info "A preparar dados para export..."

    mkdir -p "$ARCHIVE_DIR"
    local export_tmp="$ARCHIVE_DIR/export_tmp_$TIMESTAMP"
    mkdir -p "$export_tmp"

    # Export metadata
    if [ -f "$KB_SOURCE/_metadata" ]; then
        cp "$KB_SOURCE/_metadata" "$export_tmp/metadata.json"
    fi

    # Export RAG data via Python
    "$VENV_BIN/python" << EXPORT_SCRIPT
import lancedb
import json
from pathlib import Path

kb_source = Path("$KB_SOURCE")
export_tmp = Path("$export_tmp")

try:
    db = lancedb.connect(str(kb_source / ".lancedb"))

    # List all tables
    table_names = db.table_names()
    print(f"Tables found: {table_names}")

    all_data = {"tables": {}, "exported_at": "$TIMESTAMP"}

    for table_name in table_names:
        table = db.open_table(table_name)
        df = table.to_arrow().to_pandas()
        all_data["tables"][table_name] = df.to_dict(orient="records")
        print(f"  Exported {len(df)} records from {table_name}")

    # Save to JSON
    output_file = export_tmp / "rag_export.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False, default=str)

    print(f"Export saved to: {output_file}")

except Exception as e:
    print(f"Export error: {e}")
    # Create empty export
    all_data = {"tables": {}, "exported_at": "$TIMESTAMP", "error": str(e)}
    output_file = export_tmp / "rag_export.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)
EXPORT_SCRIPT

    echo "$export_tmp"
}

# ── Upload to Server ────────────────────────────────────────
upload_to_server() {
    local export_path="$1"

    info "A enviar para servidor..."
    info "Endpoint: $EXPORT_ENDPOINT"

    if [ -z "$EXPORT_API_KEY" ]; then
        warn "No API key configured — proceeding without auth"
    fi

    # Create multipart form data
    local files=("$export_path/rag_export.json")
    [ -f "$export_path/metadata.json" ] && files+=("$export_path/metadata.json")

    # Try curl first
    if command -v curl &>/dev/null; then
        local curl_opts=(-s -X POST)
        curl_opts+=(-F "files=@${files[0]}"")

        if [ -n "$EXPORT_API_KEY" ]; then
            curl_opts+=(-H "Authorization: Bearer $EXPORT_API_KEY")
        fi

        curl_opts+=(-F "timestamp=$TIMESTAMP")
        curl_opts+=("$EXPORT_ENDPOINT")

        if curl "${curl_opts[@]}" 2>/dev/null | head -20; then
            success "Upload completed"
        else
            warn "Upload failed or server not available"
        fi
    else
        warn "curl not available — skipping server upload"
    fi

    # Create local archive as backup
    local archive_name="kb_export_${TIMESTAMP}.tar.gz"
    local archive_path="$ARCHIVE_DIR/$archive_name"

    tar -czf "$archive_path" -C "$export_path" . 2>/dev/null && success "Archive created: $archive_path" || warn "Archive creation failed"

    # Cleanup temp dir
    rm -rf "$export_path"

    echo "$archive_path"
}

# ── List Recent Exports ────────────────────────────────────
list_exports() {
    info "Exportes recentes em $ARCHIVE_DIR:"

    if [ ! -d "$ARCHIVE_DIR" ] || [ -z "$(ls -A "$ARCHIVE_DIR" 2>/dev/null)" ]; then
        echo "  Nenhum export encontrado"
        return
    fi

    ls -lt "$ARCHIVE_DIR" | head -20 | tail -10 | while read line; do
        echo "  $line"
    done
}

# ── Main ───────────────────────────────────────────────────
main() {
    header
    load_config
    check_prereqs

    local export_path=$(prepare_export)
    local archive_path=$(upload_to_server "$export_path")

    echo ""
    echo "=============================================="
    success "KB Export concluído!"
    echo ""
    echo "  Archive: $archive_path"
    echo "  Timestamp: $TIMESTAMP"
    echo "=============================================="
}

# ── CLI Args ───────────────────────────────────────────────
case "${1:-export}" in
    export)
        main
        ;;
    list)
        list_exports
        ;;
    config)
        echo "Export Config: $EXPORT_CONFIG"
        echo "Endpoint: ${EXPORT_ENDPOINT:-not set}"
        echo "Batch Size: ${EXPORT_BATCH_SIZE:-100}"
        echo "API Key: ${EXPORT_API_KEY:+configured}"
        ;;
    *)
        echo "Usage: $0 {export|list|config}"
        exit 1
        ;;
esac
