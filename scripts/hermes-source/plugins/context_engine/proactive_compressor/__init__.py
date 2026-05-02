"""
ProactiveCompressor — context engine plugin for Hermes.

Extends ContextCompressor with PROACTIVE compression behaviour:
  - Triggers at a LOWER threshold (configurable) BEFORE hitting the wall
  - Uses multiple small summarization passes instead of one catastrophic pass
  - Protects more recent messages (protect_last_n increased)

Activation:
  1. Set in config.yaml: context.engine: proactive_compressor
  2. Restart gateway
  3. Or for CLI: run_agent.py picks it up automatically

Configuration in config.yaml:
  context:
    engine: proactive_compressor
    proactive:
      trigger_threshold: 0.50   # Fire at 50% instead of default 70%
      emergency_threshold: 0.70
      chunk_size: 60            # Messages per summarization pass
      overlap: 10               # Overlap between passes
      summary_target_ratio: 0.20
      protect_last_n: 40
"""

from __future__ import annotations

import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ─── Config Reader ──────────────────────────────────────────────────────────────

def _read_proactive_config() -> Dict[str, Any]:
    """Read proactive config from config.yaml."""
    config_path = Path(__file__).resolve().parents[3] / "config.yaml"
    defaults = {
        "trigger_threshold": 0.50,
        "emergency_threshold": 0.70,
        "chunk_size": 60,
        "overlap": 10,
        "summary_target_ratio": 0.20,
        "protect_last_n": 40,
    }
    if not config_path.exists():
        return defaults
    try:
        import yaml
        with open(config_path) as f:
            cfg = yaml.safe_load(f) or {}
        proactive = cfg.get("context", {}).get("proactive", {})
        return {**defaults, **proactive}
    except Exception as e:
        logger.debug("Could not read proactive config: %s", e)
        return defaults

# ─── Plugin Registration ───────────────────────────────────────────────────────

def register(ctx):
    """Plugin entry point — registers the ProactiveCompressor context engine."""
    cfg = _read_proactive_config()
    engine = ProactiveCompressor(
        trigger_threshold=cfg["trigger_threshold"],
        emergency_threshold=cfg["emergency_threshold"],
        chunk_size=cfg["chunk_size"],
        overlap=cfg["overlap"],
        summary_target_ratio=cfg["summary_target_ratio"],
        protect_last_n=cfg["protect_last_n"],
    )
    ctx.register_context_engine(engine)

# ─── ProactiveCompressor ───────────────────────────────────────────────────────

class ProactiveCompressor:
    """
    Context engine that compresses PROACTIVELY at a lower threshold.

    Unlike the standard ContextCompressor (reactive — fires at ~70%),
    this compressor fires earlier (configurable, default 50%) so that
    by the time the context window is 70% full, compression is already done.
    Result: effective context window appears ~30-40% larger without losing quality.
    """

    name = "proactive_compressor"
    is_available_priority = 10  # Higher than built-in compressor

    def __init__(
        self,
        trigger_threshold: float = 0.50,
        emergency_threshold: float = 0.70,
        chunk_size: int = 60,
        overlap: int = 10,
        summary_target_ratio: float = 0.20,
        protect_last_n: int = 40,
    ):
        self._trigger_threshold = trigger_threshold
        self._emergency_threshold = emergency_threshold
        self._chunk_size = chunk_size
        self._overlap = overlap
        self._summary_target_ratio = summary_target_ratio
        self._protect_last_n = protect_last_n

        # Will be set by update_model()
        self._context_length: int = 204_800
        self._model: str = ""
        self._base_url: str = ""
        self._api_key: str = ""
        self._provider: str = ""

        # Lazy import of the real compressor (avoids circular imports)
        self._delegate: Optional[Any] = None

    def _delegate_compressor(self):
        """Lazily create the underlying ContextCompressor."""
        if self._delegate is None:
            # Import here to avoid circular dependency at module load
            from agent.context_compressor import ContextCompressor
            self._delegate = ContextCompressor(
                model=self._model,
                threshold_percent=self._trigger_threshold,
                protect_first_n=3,
                protect_last_n=self._protect_last_n,
                summary_target_ratio=self._summary_target_ratio,
                summary_model_override=None,
                quiet_mode=True,
                base_url=self._base_url,
                api_key=self._api_key,
                config_context_length=self._context_length,
                provider=self._provider,
            )
        return self._delegate

    @property
    def threshold_tokens(self) -> int:
        """Tokens at which proactive compression triggers."""
        return int(self._context_length * self._trigger_threshold)

    @property
    def context_length(self) -> int:
        return self._context_length

    @property
    def threshold(self) -> float:
        return self._trigger_threshold

    def is_available(self) -> bool:
        """Check if dependencies are available."""
        try:
            from agent.context_compressor import ContextCompressor
            return True
        except ImportError:
            return False

    def update_model(
        self,
        model: str,
        context_length: int,
        base_url: str,
        api_key: str,
        provider: str = "",
    ):
        """Called by Hermes when the model changes — mirrors ContextCompressor interface."""
        self._model = model
        self._context_length = context_length
        self._base_url = base_url
        self._api_key = api_key
        self._provider = provider
        self._delegate = None  # Force re-creation with new settings

    def compress(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Compress messages using PROACTIVE strategy.

        If token count exceeds trigger_threshold, chunk old messages and
        summarize them in rolling passes (not one big summarization).
        This preserves more detail in recent messages.
        """
        if not messages:
            return messages

        # Check token count
        total_tokens = self._estimate_tokens(messages)
        trigger_tokens = int(self._context_length * self._trigger_threshold)

        logger.info(
            "[ProactiveCompressor] check: tokens=%d trigger=%d (%.0f%%) msgs=%d",
            total_tokens, trigger_tokens, total_tokens / self._context_length * 100, len(messages),
        )

        if total_tokens < trigger_tokens:
            return messages

        # ── PROACTIVE COMPRESSION PATH ────────────────────────────────────────
        logger.info(
            "[ProactiveCompressor] PROACTIVE compression starting: "
            "tokens=%d (%.0f%%) msgs=%d",
            total_tokens, total_tokens / self._context_length * 100, len(messages),
        )

        protected = messages[-self._protect_last_n:] if len(messages) > self._protect_last_n else messages
        to_summarize = messages[:-self._protect_last_n] if len(messages) > self._protect_last_n else []

        if not to_summarize:
            return messages

        # Summarize in rolling chunks
        summarized_parts = self._summarize_rolling(to_summarize)

        # Build new message list
        # Start with a system message noting the compression
        result: List[Dict[str, Any]] = [
            {
                "role": "system",
                "content": (
                    f"[CONTEXT COMPACTION — {len(to_summarize)} messages summarized "
                    f"into the following reference. This is background context only.]"
                ),
            }
        ]
        result.extend(summarized_parts)
        result.extend(protected)

        new_tokens = self._estimate_tokens(result)
        logger.info(
            "[ProactiveCompressor] compression done: original=%d msgs → %d msgs, "
            "tokens %d → %d (saved %.0f%%)",
            len(messages), len(result), total_tokens, new_tokens,
            (1 - new_tokens / max(1, total_tokens)) * 100,
        )

        return result

    def _summarize_rolling(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Summarize old messages in rolling chunks with overlap.

        Each chunk overlaps with the next to preserve continuity.
        Returns a list of summary messages (system role) to insert before recent messages.
        """
        if not messages:
            return []

        chunk_size = self._chunk_size
        overlap = self._overlap
        summaries: List[Dict[str, Any]] = []

        # Process in overlapping chunks
        start = 0
        chunk_num = 0
        while start < len(messages):
            end = min(start + chunk_size, len(messages))
            chunk = messages[start:end]

            # Generate summary for this chunk
            summary_text = self._summarize_chunk(chunk, chunk_num)

            summaries.append({
                "role": "system",
                "content": (
                    f"[Turns {start+1}–{end} summary]: {summary_text}"
                ),
            })

            start = end - overlap if overlap > 0 else end
            chunk_num += 1

            if start >= len(messages):
                break

        return summaries

    def _summarize_chunk(
        self, chunk: List[Dict[str, Any]], chunk_num: int
    ) -> str:
        """
        Summarize a single chunk using MiniMax.

        Falls back to naive extraction if the API call fails.
        """
        # Build a compact text representation
        lines = []
        for msg in chunk:
            role = msg.get("role", "?")
            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    b.get("text", "") if isinstance(b, dict) else str(b)
                    for b in content
                )
            else:
                text = str(content) if content else ""
            text = text.strip()
            if text:
                lines.append(f"[{role}] {text[:250]}")

        if not lines:
            return "[No content]"

        chunk_text = "\n".join(lines)
        summary_target = int(self._context_length * self._summary_target_ratio)

        prompt = (
            "Summarize this conversation segment concisely. "
            "Include: main topics, key facts, decisions, and any open questions.\n\n"
            f"{chunk_text[:4000]}\n\n"
            "Summary:"
        )

        # Call the summarization model
        try:
            import urllib.request
            payload = {
                "model": self._model or "MiniMax-M2.7",
                "messages": [
                    {"role": "system", "content": "You summarize conversations accurately and concisely."},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": min(summary_target // 10, 500),
                "temperature": 0.3,
            }
            req = urllib.request.Request(
                f"{self._base_url}/v1/text/chatcompletion_v2"
                if "/v2" not in self._base_url
                else f"{self._base_url}/text/chatcompletion_v2",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                choices = data.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "[Summary unavailable]")
        except Exception as e:
            logger.debug("Chunk summarization failed: %s", e)

        # Fallback: naive extraction
        return self._naive_summary(chunk_text)

    def _naive_summary(self, text: str) -> str:
        """Fallback summarization using simple extraction."""
        sentences = re.split(r"[.!?]", text)
        key_sentences = [s.strip() for s in sentences if len(s.strip()) > 20][:5]
        return " | ".join(key_sentences) if key_sentences else text[:300]

    # ─── Token Estimation ─────────────────────────────────────────────────────

    def _estimate_tokens(self, messages: List[Dict[str, Any]]) -> int:
        """Rough token estimate for a message list."""
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        total += self._estimate_tokens_single(block.get("text", ""))
                    elif isinstance(block, str):
                        total += self._estimate_tokens_single(block)
            elif isinstance(content, str):
                total += self._estimate_tokens_single(content)
            total += 10  # Role overhead
        return total

    def _estimate_tokens_single(self, text: str) -> int:
        """Estimate tokens for a single text string."""
        if not text:
            return 0
        return max(1, len(text) // 3)


# ─── JSON helper (used in _summarize_chunk) ───────────────────────────────────

import json
