#!/usr/bin/env python3
"""
Vector Brain Tool - Busca em livros vetorizados via LanceDB.

Este tool permite ao agente buscar em livros baixados da Z-Library
usando busca semântica (embeddings).

Uso:
  query_knowledge(query, top_k, category) -> resultados da busca
  get_stats() -> estatísticas do banco
  process_category(category) -> processa livros de uma categoria
"""

import json
import subprocess
import sys
from typing import Optional

from tools.registry import registry, tool_error

PYTHON_BIN = "/usr/bin/python3"
VECTOR_BRAIN_SCRIPT = "/home/alvarobiano/KnowledgeBase/vector_brain.py"


def check_requirements() -> bool:
    """Verifica se o script existe e é executável."""
    import os
    return os.path.exists(VECTOR_BRAIN_SCRIPT)


def query_knowledge(
    query: str,
    top_k: int = 5,
    category: Optional[str] = None
) -> str:
    """
    Busca por similaridade na base de conhecimento vetorial.
    
    Args:
        query: Pergunta ou texto de busca
        top_k: Número de resultados a retornar (default 5)
        category: Filtrar por categoria (opcional)
    
    Returns:
        JSON com resultados da busca
    """
    cmd = [
        PYTHON_BIN,
        VECTOR_BRAIN_SCRIPT,
        "--action", "query",
        "--query", query,
        "--top-k", str(top_k)
    ]
    if category:
        cmd.extend(["--category", category])
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode != 0:
            return json.dumps({
                "status": "error",
                "error": result.stderr or "Unknown error",
                "output": result.stdout
            })
        
        # Parse the output - it's in a readable format
        # We need to extract just the data part
        output = result.stdout
        
        return json.dumps({
            "status": "success",
            "output": output,
            "raw": True
        })
        
    except subprocess.TimeoutExpired:
        return json.dumps({
            "status": "error",
            "error": "Timeout - busca demorou mais de 60 segundos"
        })
    except Exception as e:
        return json.dumps({
            "status": "error",
            "error": str(e)
        })


def get_knowledge_stats() -> str:
    """Retorna estatísticas do banco de conhecimento."""
    cmd = [
        PYTHON_BIN,
        VECTOR_BRAIN_SCRIPT,
        "--action", "stats"
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            return json.dumps({
                "status": "error",
                "error": result.stderr
            })
        
        return json.dumps({
            "status": "success",
            "output": result.stdout
        })
        
    except Exception as e:
        return json.dumps({
            "status": "error",
            "error": str(e)
        })


def process_category(category: str) -> str:
    """
    Processa todos os livros de uma categoria.
    
    Args:
        category: Nome da categoria (pasta em ~/KnowledgeBase/)
    
    Returns:
        JSON com resultados do processamento
    """
    cmd = [
        PYTHON_BIN,
        VECTOR_BRAIN_SCRIPT,
        "--action", "process",
        "--category", category
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minutos para processar
        )
        
        if result.returncode != 0:
            return json.dumps({
                "status": "error",
                "error": result.stderr
            })
        
        return json.dumps({
            "status": "success",
            "output": result.stdout
        })
        
    except subprocess.TimeoutExpired:
        return json.dumps({
            "status": "error",
            "error": "Timeout - processamento demorou mais de 5 minutos"
        })
    except Exception as e:
        return json.dumps({
            "status": "error",
            "error": str(e)
        })


# --- Tool Schema ---
KNOWLEDGE_QUERY_SCHEMA = {
    "name": "knowledge_query",
    "description": """Busca por similaridade na base de conhecimento vetorial (Cérebro Vetorial).

Use esta ferramenta quando quiser encontrar informações em livros baixados da Z-Library.
A busca usa embeddings semânticos - significa que encontra resultados mesmo quando 
as palavras não são exatamente iguais, mas têm significado相似.

Exemplos de uso:
- "o que este livro diz sobre inteligência emocional?"
- "como aplicar psicologia positiva no consultório?"
- "métodos de terapia cognitivo-comportamental"

Args:
- query: A pergunta ou tema a buscar
- top_k: Número de resultados (padrão 5)
- category: Opcional, filtrar por categoria (psicologia, marketing, etc)
""",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Pergunta ou texto de busca"
            },
            "top_k": {
                "type": "integer",
                "description": "Número de resultados a retornar",
                "default": 5
            },
            "category": {
                "type": "string",
                "description": "Filtrar por categoria (opcional)",
                "enum": ["psicologia", "marketing", "desenvolvimento_pessoal", "matematica", "default"]
            }
        },
        "required": ["query"]
    }
}


KNOWLEDGE_STATS_SCHEMA = {
    "name": "knowledge_stats",
    "description": """Retorna estatísticas do Cérebro Vetorial.

Mostra:
- Total de chunks vetorizados
- Distribuição por categoria
- Número de livros processados
""",
    "parameters": {
        "type": "object",
        "properties": {}
    }
}


KNOWLEDGE_PROCESS_SCHEMA = {
    "name": "knowledge_process",
    "description": """Processa livros de uma categoria e os vetoriza para busca.

Use para:
- Processar livros recém-baixados
- Re-processar uma categoria inteira

Os livros devem estar em ~/KnowledgeBase/{categoria}/livros/
""",
    "parameters": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "Categoria a processar",
                "enum": ["psicologia", "marketing", "desenvolvimento_pessoal", "matematica", "default"]
            }
        },
        "required": ["category"]
    }
}


# --- Registry ---
registry.register(
    name="knowledge_query",
    toolset="knowledge",
    schema=KNOWLEDGE_QUERY_SCHEMA,
    handler=lambda args, **kw: query_knowledge(
        query=args.get("query", ""),
        top_k=args.get("top_k", 5),
        category=args.get("category")
    ),
    check_fn=check_requirements,
    emoji="🧠",
    description="Busca em livros vetorizados via LanceDB"
)

registry.register(
    name="knowledge_stats",
    toolset="knowledge",
    schema=KNOWLEDGE_STATS_SCHEMA,
    handler=lambda args, **kw: get_knowledge_stats(),
    check_fn=check_requirements,
    emoji="📊",
    description="Estatísticas do banco de conhecimento"
)

registry.register(
    name="knowledge_process",
    toolset="knowledge",
    schema=KNOWLEDGE_PROCESS_SCHEMA,
    handler=lambda args, **kw: process_category(
        category=args.get("category", "default")
    ),
    check_fn=check_requirements,
    emoji="⚙️",
    description="Processa e vetoriza livros de uma categoria"
)
