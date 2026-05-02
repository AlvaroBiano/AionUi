#!/bin/bash
# ============================================================
# BianinhoBridge — Create Knowledge Base Archive
# Creates compressed, timestamped archives of the KB
# ============================================================

set -e

# ── Paths ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINHO_BASE="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_BIN="$BINHO_BASE/venv/bin"

# ── Config ─────────────────────────────────────────────────
KB_SOURCE="$HOME/KnowledgeBase/knowledge_db"
ARCHIVE_DIR="$HOME/KnowledgeBase/archives"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# ── Cores ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoBridge — Create KB Archive"
    echo "=============================================="
    echo ""
}

# ── Check Prerequisites ─────────────────────────────────────
check_prereqs() {
    info "A verificar pré-requisitos..."

    if [ ! -d "$KB_SOURCE" ]; then
        error "KB source not found: $KB_SOURCE"
    fi

    if ! command -v tar &>/dev/null; then
        error "tar required"
    fi

    mkdir -p "$ARCHIVE_DIR"

    success "Pré-requisitos OK"
}

# ── Create Archive ─────────────────────────────────────────
create_archive() {
    info "A criar arquivo..."

    local archive_name="kb_archive_${TIMESTAMP}.tar.gz"
    local archive_path="$ARCHIVE_DIR/$archive_name"
    local temp_dir="$ARCHIVE_DIR/temp_archive_$TIMESTAMP"

    mkdir -p "$temp_dir"

    # Export database to JSON
    info "A exportar dados RAG..."
    "$VENV_BIN/python" << EXPORT_SCRIPT
import lancedb
import json
from pathlib import Path
from datetime import datetime

kb_source = Path("$KB_SOURCE")
temp_dir = Path("$temp_dir")

try:
    db = lancedb.connect(str(kb_source / ".lancedb"))
    table_names = db.table_names()

    all_data = {
        "version": "1.0",
        "exported_at": "$TIMESTAMP",
        "tables": {}
    }

    for table_name in table_names:
        table = db.open_table(table_name)
        df = table.to_arrow().to_pandas()
        all_data["tables"][table_name] = {
            "count": len(df),
            "records": df.to_dict(orient="records")
        }
        print(f"  {table_name}: {len(df)} records")

    output_file = temp_dir / "rag_data.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False, default=str)
    print(f"RAG data saved: {output_file}")

except Exception as e:
    print(f"Error exporting RAG: {e}")
    # Create placeholder
    with open(temp_dir / "rag_data.json", "w") as f:
        json.dump({"error": str(e), "exported_at": "$TIMESTAMP"}, f)

# Copy metadata
if Path("$KB_SOURCE/_metadata").exists():
    import shutil
    shutil.copy("$KB_SOURCE/_metadata", temp_dir / "metadata.json")
EXPORT_SCRIPT

    # Copy any additional KB files
    info "A copiar ficheiros..."
    if [ -d "$KB_SOURCE" ]; then
        find "$KB_SOURCE" -maxdepth 1 -type f \( -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.md" \) -exec cp {} "$temp_dir/" \; 2>/dev/null || true
    fi

    # Create manifest
    cat > "$temp_dir/manifest.json" << EOF
{
  "version": "1.0",
  "created_at": "$TIMESTAMP",
  "source": "$KB_SOURCE",
  "archive_type": "full",
  "retention_days": $RETENTION_DAYS,
  "files": []
}
EOF

    find "$temp_dir" -type f -exec basename {} \; | jq -R -s 'split("\n") | map(select(length > 0))' > "$temp_dir/files.json"
    jq '.files = input' "$temp_dir/manifest.json" "$temp_dir/files.json" > "$temp_dir/manifest_final.json" 2>/dev/null || mv "$temp_dir/manifest.json" "$temp_dir/manifest_final.json"

    # Create compressed archive
    info "A comprimir arquivo..."
    tar -czf "$archive_path" -C "$temp_dir" . 2>/dev/null

    local size=$(du -h "$archive_path" | cut -f1)
    local records=$(grep -o '"count":[0-9]*' "$temp_dir/rag_data.json" 2>/dev/null | head -5 || echo "?")

    # Cleanup
    rm -rf "$temp_dir"

    success "Arquivo criado: $archive_path ($size)"

    # Create checksum
    local checksum_file="${archive_path}.sha256"
    sha256sum "$archive_path" > "$checksum_file"
    success "Checksum: $checksum_file"

    echo "$archive_path"
}

# ── List Archives ──────────────────────────────────────────
list_archives() {
    info "Arquivos em $ARCHIVE_DIR:"

    if [ ! -d "$ARCHIVE_DIR" ] || [ -z "$(ls -A "$ARCHIVE_DIR" 2>/dev/null)" ]; then
        echo "  Nenhum arquivo encontrado"
        return
    fi

    echo ""
    printf "  %-40s %10s %s\n" "NOME" "TAMANHO" "DATA"
    echo "  -------------------------------------------"
    ls -1t "$ARCHIVE_DIR" | grep -E '\.tar\.gz$' | while read name; do
        local full="$ARCHIVE_DIR/$name"
        local size=$(du -h "$full" 2>/dev/null | cut -f1 || echo "?")
        local date=$(date -r "$full" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "?")
        printf "  %-40s %10s %s\n" "$name" "$size" "$date"
    done
}

# ── Clean Old Archives ─────────────────────────────────────
clean_old() {
    info "A limpar arquivos com mais de $RETENTION_DAYS dias..."

    local count=0
    find "$ARCHIVE_DIR" -name "kb_archive_*.tar.gz" -type f -mtime +$RETENTION_DAYS -exec rm -v {} \; && count=$((count+1)) 2>/dev/null || true
    find "$ARCHIVE_DIR" -name "kb_export_*.tar.gz" -type f -mtime +$RETENTION_DAYS -exec rm -v {} \; && count=$((count+1)) 2>/dev/null || true
    find "$ARCHIVE_DIR" -name "*.sha256" -type f -mtime +$RETENTION_DAYS -exec rm -v {} \; 2>/dev/null || true

    if [ $count -gt 0 ]; then
        success "Limpeza concluída: $count ficheiros removidos"
    else
        info "Nenhum ficheiro para limpar"
    fi
}

# ── Verify Archive ─────────────────────────────────────────
verify_archive() {
    local archive="${1:-latest}"

    if [ "$archive" = "latest" ]; then
        archive=$(ls -t "$ARCHIVE_DIR"/kb_archive_*.tar.gz 2>/dev/null | head -1)
        if [ -z "$archive" ]; then
            error "No archives found"
        fi
    fi

    if [ ! -f "$archive" ]; then
        error "Archive not found: $archive"
    fi

    info "A verificar: $archive"

    # Check checksum
    local checksum_file="${archive}.sha256"
    if [ -f "$checksum_file" ]; then
        if sha256sum --check "$checksum_file" 2>/dev/null; then
            success "Checksum OK"
        else
            error "Checksum FAILED"
        fi
    else
        warn "No checksum file found"
    fi

    # Test extraction
    local test_dir="$ARCHIVE_DIR/verify_$$"
    mkdir -p "$test_dir"
    if tar -tzf "$archive" -C "$test_dir" > /dev/null 2>&1; then
        success "Archive integrity OK"
    else
        error "Archive corrupted or incomplete"
    fi
    rm -rf "$test_dir"
}

# ── Extract Archive ─────────────────────────────────────────
extract_archive() {
    local archive="${1:?Usage: $0 extract <archive> [dest]}"
    local dest="${2:-$ARCHIVE_DIR/restore_${TIMESTAMP}}"

    if [ ! -f "$archive" ]; then
        archive="$ARCHIVE_DIR/$archive"
    fi

    if [ ! -f "$archive" ]; then
        error "Archive not found: $archive"
    fi

    info "A extrair: $archive"
    info "Destino: $dest"

    mkdir -p "$dest"
    tar -xzf "$archive" -C "$dest"

    success "Extraído para: $dest"
}

# ── Main ───────────────────────────────────────────────────
main() {
    header
    check_prereqs

    create_archive

    echo ""
    echo "=============================================="
    success "Archive creation concluído!"
    echo ""
    echo "  Ver档案: $0 list"
    echo "  Limpar antigos: $0 clean"
    echo "  Verificar: $0 verify [archive]"
    echo "=============================================="
}

# ── CLI Args ───────────────────────────────────────────────
case "${1:-create}" in
    create)
        main
        ;;
    list)
        list_archives
        ;;
    clean)
        clean_old
        ;;
    verify)
        verify_archive "${2:-latest}"
        ;;
    extract)
        extract_archive "${2:-}" "${3:-}"
        ;;
    *)
        echo "Usage: $0 {create|list|clean|verify|extract}"
        echo ""
        echo "Commands:"
        echo "  create        Create new archive (default)"
        echo "  list          List existing archives"
        echo "  clean         Remove archives older than RETENTION_DAYS"
        echo "  verify [file] Verify archive integrity"
        echo "  extract [a] [d]  Extract archive to destination"
        exit 1
        ;;
esac
