#!/usr/bin/env python3
"""
gateway_session_bridge_integration.py — SessionBridge integration for Hermes Gateway

Integra o SessionBridge no gateway para permitir cross-platform persistence.

Uso no gateway/run.py:

    # 1. Import lazy
    def _get_session_bridge():
        from gateway_session_bridge_integration import get_session_bridge
        return get_session_bridge()
    
    # 2. Após get_or_create_session
    bridge = _get_session_bridge()
    register_gateway_session(bridge, source, session_entry)
    
    # 3. Antes de context_prompt
    bridge_context = get_bridge_context(bridge, source, session_entry)
    if bridge_context:
        context_prompt = bridge_context + "\n\n" + context_prompt
    
    # 4. Após agent_result
    update_bridge_pending_work(
        bridge, source, session_entry, message_text, response
    )
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# ─── SessionBridge lazy import ───────────────────────────────────────────────

_SESSION_BRIDGE_INSTANCE = None


def get_session_bridge():
    """Lazy import and instantiate SessionBridge."""
    global _SESSION_BRIDGE_INSTANCE
    if _SESSION_BRIDGE_INSTANCE is not None:
        return _SESSION_BRIDGE_INSTANCE
    
    try:
        # Import from KnowledgeBase where we installed it
        import sys
        sys.path.insert(0, os.path.expanduser("~/KnowledgeBase"))
        from session_bridge import SessionBridge
        
        _SESSION_BRIDGE_INSTANCE = SessionBridge()
        logger.info("[SessionBridge] SessionBridge loaded for gateway")
        
        # Register Álvaro as primary user if not already
        _register_primary_user(_SESSION_BRIDGE_INSTANCE)
        
        return _SESSION_BRIDGE_INSTANCE
    except ImportError as e:
        logger.warning("[SessionBridge] Failed to import SessionBridge: %s", e)
        return None
    except Exception as e:
        logger.error("[SessionBridge] Failed to initialize SessionBridge: %s", e)
        return None


def _register_primary_user(bridge):
    """Regista Álvaro como utilizador primário."""
    try:
        # Load channel_directory to get Álvaro's Telegram user ID
        import json
        from pathlib import Path
        
        channel_dir = Path(os.path.expanduser("~/.hermes/channel_directory.json"))
        if not channel_dir.exists():
            return
        
        data = json.loads(channel_dir.read_text())
        telegram_users = data.get("platforms", {}).get("telegram", [])
        
        for user in telegram_users:
            if user.get("name") == "Álvaro Biano" or user.get("id") == "435025823":
                canonical_id = user["id"]
                display_name = user.get("name", "Álvaro Biano")
                
                # Check if already registered
                existing = bridge.get_identity(canonical_id)
                if existing and existing.is_primary_user:
                    return
                
                bridge.register_primary_user(canonical_id, display_name)
                logger.info(
                    "[SessionBridge] Registered primary user: %s (%s)",
                    display_name, canonical_id
                )
                return
    except Exception as e:
        logger.warning("[SessionBridge] Failed to register primary user: %s", e)


# ─── Integration functions ───────────────────────────────────────────────────

def register_gateway_session(bridge, source, session_entry) -> None:
    """
    Regista uma sessão do gateway no SessionBridge.
    
    Chamado após get_or_create_session em run.py.
    """
    if not bridge:
        return
    
    try:
        # Determine canonical user ID
        canonical_id = _resolve_canonical_user_id(source)
        if not canonical_id:
            return
        
        # Build session_key (same as gateway's session_key)
        session_key = session_entry.session_key
        
        # Register platform session
        bridge.register_platform_session(
            canonical_user_id=canonical_id,
            platform=source.platform.value if source.platform else "unknown",
            session_key=session_key,
            session_id=session_entry.session_id,
            topic=_get_topic_from_source(source),
            message_count=0,
        )
        
        logger.debug(
            "[SessionBridge] Registered gateway session: %s on %s",
            canonical_id, source.platform.value if source.platform else "unknown"
        )
    except Exception as e:
        logger.warning("[SessionBridge] Failed to register gateway session: %s", e)


def get_bridge_context(bridge, source, session_entry) -> str:
    """
    Obtém contexto do bridge para injectar no system prompt.
    
    Chamado antes de build_session_context_prompt em run.py.
    """
    if not bridge:
        return ""
    
    try:
        canonical_id = _resolve_canonical_user_id(source)
        if not canonical_id:
            return ""
        
        platform = source.platform.value if source.platform else "unknown"
        
        # Get bridge context for this platform switch
        context = bridge.build_bridge_context(canonical_id, platform)
        
        if context:
            logger.debug(
                "[SessionBridge] Injected bridge context for %s switching to %s",
                canonical_id, platform
            )
        
        return context
    except Exception as e:
        logger.warning("[SessionBridge] Failed to get bridge context: %s", e)
        return ""


def update_bridge_pending_work(
    bridge,
    source,
    session_entry,
    message_text: str,
    response: str,
    conversation_snippet: str = "",
) -> None:
    """
    Actualiza pending work no bridge após uma mensagem.
    
    Chamado após o agente responder em run.py.
    """
    if not bridge:
        return
    
    try:
        canonical_id = _resolve_canonical_user_id(source)
        if not canonical_id:
            return
        
        # Determine if there's active work
        # For now, we'll mark as active if the conversation has more than 2 messages
        # or if the message contains task-related keywords
        is_task_active = _detect_active_task(message_text, response)
        
        # Build conversation snippet (last 2 messages)
        if not conversation_snippet and message_text and response:
            conversation_snippet = f"User: {message_text[:200]}\nBianinho: {response[:200]}"
        
        # Update pending work
        bridge.update_pending_work(
            user_id=canonical_id,
            task=_extract_task_from_conversation(message_text, response),
            active=is_task_active,
            last_platform=source.platform.value if source.platform else "unknown",
            context_summary=_summarize_context(message_text, response),
            conversation_snippet=conversation_snippet,
            parent_session_id=session_entry.session_id,
        )
        
        logger.debug(
            "[SessionBridge] Updated pending work for %s on %s (active=%s)",
            canonical_id, source.platform.value if source.platform else "unknown", is_task_active
        )
    except Exception as e:
        logger.warning("[SessionBridge] Failed to update pending work: %s", e)


def clear_bridge_pending_work(bridge, source) -> None:
    """Limpa pending work para um utilizador."""
    if not bridge:
        return
    
    try:
        canonical_id = _resolve_canonical_user_id(source)
        if canonical_id:
            bridge.clear_pending_work(canonical_id)
            logger.debug("[SessionBridge] Cleared pending work for %s", canonical_id)
    except Exception as e:
        logger.warning("[SessionBridge] Failed to clear pending work: %s", e)


# ─── Helper functions ────────────────────────────────────────────────────────

def _resolve_canonical_user_id(source) -> Optional[str]:
    """
    Resolve canonical user ID a partir de uma SessionSource.
    
    Para Álvaro: usa o Telegram user_id (435025823) como canónico.
    Para outros utilizadores: usa platform:user_id como canónico.
    """
    if not source or not source.user_id:
        return None
    
    # Check if this is Álvaro
    try:
        import json
        from pathlib import Path
        
        channel_dir = Path(os.path.expanduser("~/.hermes/channel_directory.json"))
        if channel_dir.exists():
            data = json.loads(channel_dir.read_text())
            telegram_users = data.get("platforms", {}).get("telegram", [])
            
            for user in telegram_users:
                if user.get("id") == source.user_id and user.get("name") == "Álvaro Biano":
                    return source.user_id  # Álvaro's Telegram ID is canonical
    except Exception:
        pass
    
    # For non-Álvaro users or CLI sessions, create a platform-specific canonical ID
    platform = source.platform.value if source.platform else "unknown"
    return f"{platform}:{source.user_id}"


def _get_topic_from_source(source) -> str:
    """Extrai tópico da SessionSource."""
    if not source:
        return ""
    
    # Telegram topics
    if hasattr(source, "thread_id") and source.thread_id:
        return f"topic_{source.thread_id}"
    
    # Discord threads
    if hasattr(source, "thread_name") and source.thread_name:
        return source.thread_name
    
    return ""


def _detect_active_task(message_text: str, response: str) -> bool:
    """Detecta se há uma tarefa activa na conversa."""
    if not message_text and not response:
        return False
    
    # Check for task-related keywords
    task_keywords = [
        "task", "tarefa", "faça", "crie", "implemente", "build", "desenvolva",
        "project", "projeto", "trabalho", "work", "help", "ajuda", "preciso",
        "quero", "need", "want", "por favor", "please"
    ]
    
    text = (message_text + " " + response).lower()
    return any(keyword in text for keyword in task_keywords)


def _extract_task_from_conversation(message_text: str, response: str) -> str:
    """Extrai descrição da tarefa da conversa."""
    if not message_text:
        return ""
    
    # Take first 100 chars of user message as task description
    task = message_text[:100].strip()
    if len(task) < 100 and response:
        # Add first 50 chars of response for context
        task += " → " + response[:50].strip()
    
    return task


def _summarize_context(message_text: str, response: str) -> str:
    """Cria um resumo do contexto actual."""
    if not message_text and not response:
        return ""
    
    summary = ""
    if message_text:
        summary += f"User: {message_text[:150]}"
    if response:
        if summary:
            summary += " → "
        summary += f"Agent: {response[:100]}"
    
    return summary


# ─── Debug/Admin functions ───────────────────────────────────────────────────

def get_bridge_status() -> dict:
    """Retorna estado do bridge para debugging."""
    bridge = get_session_bridge()
    if not bridge:
        return {"status": "not_initialized"}
    
    try:
        return bridge.get_status()
    except Exception as e:
        return {"status": "error", "error": str(e)}


def list_active_sessions() -> list:
    """Lista sessões activas no bridge."""
    bridge = get_session_bridge()
    if not bridge:
        return []
    
    try:
        return bridge.get_active_sessions()
    except Exception as e:
        logger.warning("[SessionBridge] Failed to list active sessions: %s", e)
        return []


def get_auto_bridge_context_for_cli() -> tuple[str, str]:
    """
    Auto-detecta contexto de bridge para CLI.
    
    Procura trabalho pendente ou sessões linked para Álvaro.
    Se encontrar, devolve (source_platform, context).
    Se não encontrar, devolve (None, "").
    
    Returns:
        (source_platform, context) — source_platform é "telegram", "whatsapp", etc.
    """
    bridge = get_session_bridge()
    if not bridge:
        return None, ""
    
    try:
        # Get Álvaro's canonical ID (from channel_directory or primary user)
        import json
        from pathlib import Path
        
        canonical_id = None
        
        # Try channel_directory first
        channel_dir = Path(os.path.expanduser("~/.hermes/channel_directory.json"))
        if channel_dir.exists():
            data = json.loads(channel_dir.read_text())
            telegram_users = data.get("platforms", {}).get("telegram", [])
            for user in telegram_users:
                if user.get("name") == "Álvaro Biano":
                    canonical_id = user.get("id")
                    break
        
        # Fallback to primary user
        if not canonical_id:
            primary = bridge.get_primary_user()
            if primary:
                canonical_id = primary.canonical_user_id
        
        if not canonical_id:
            return None, ""
        
        # Check for pending work or linked sessions
        pending = bridge.get_pending_work(canonical_id)
        linked = bridge.get_linked_sessions(canonical_id)
        
        # If there's no pending work and no linked sessions, nothing to do
        if not pending and not linked:
            return None, ""
        
        # Build context for CLI
        context = bridge.build_bridge_context(canonical_id, "cli")
        
        if not context:
            return None, ""
        
        # Find which platform had the latest activity
        source_platform = "telegram"  # default
        if pending and pending.last_platform:
            source_platform = pending.last_platform
        elif linked:
            latest = max(linked, key=lambda s: s.last_active)
            source_platform = latest.platform
        
        return source_platform, context
        
    except Exception as e:
        logger.warning("[SessionBridge] Auto-detection failed: %s", e)
        return None, ""
