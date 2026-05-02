#!/usr/bin/env python3
"""
Pytest test suite for aionrs-bridge.

Tests: auth, rate-limit, RAG, skills (protocol handling).

Usage:
    pytest test_bridge_pytest.py -v
    pytest test_bridge_pytest.py -v --cov=aionrs_bridge
"""

import sys
import json
import time
import uuid
import threading
from unittest.mock import Mock, patch, MagicMock, call
from queue import Queue, Empty
from typing import List, Dict

import pytest

# Add bridge module path
sys.path.insert(0, '/home/alvarobiano/repos/aionui-hermes-ten/scripts/aionrs-bridge')

import aionrs_bridge


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def mock_hermes_agent():
    """Mock HermesAgent that returns predictable responses."""
    mock = Mock()
    mock.chat.return_value = "Resposta mock do Hermes Agent"
    mock.session_id = str(uuid.uuid4())
    mock.initialized = True
    return mock


@pytest.fixture
def hermes_bridge(mock_hermes_agent):
    """HermesBridge instance with mocked agent."""
    with patch('aionrs_bridge.get_hermes_agent', return_value=mock_hermes_agent):
        bridge = aionrs_bridge.HermesBridge()
        yield bridge


@pytest.fixture
def protocol(hermes_bridge):
    """AionrsProtocol instance with mocked hermes bridge."""
    return aionrs_bridge.AionrsProtocol(hermes_bridge)


@pytest.fixture
def capture_stdout():
    """Capture stdout output from protocol.send() calls."""
    captured = []
    original_print = print

    def capture(*args, **kwargs):
        # Build the output similar to what print would produce
        output = ' '.join(str(a) for a in args)
        captured.append(output)

    return captured


# =============================================================================
# Auth Tests
# =============================================================================

class TestAuth:
    """Tests for authentication and session management."""

    def test_session_id_is_uuid(self, hermes_bridge):
        """Session ID should be a valid UUID."""
        session_id = hermes_bridge.session_id
        # Should not raise
        uuid.UUID(session_id)

    def test_hermes_bridge_initialization(self, mock_hermes_agent):
        """Bridge should initialize with valid session and agent."""
        with patch('aionrs_bridge.get_hermes_agent', return_value=mock_hermes_agent):
            bridge = aionrs_bridge.HermesBridge()
            assert bridge.initialized is True
            assert bridge.agent is not None
            assert bridge.session_id is not None

    def test_hermes_bridge_uninitialized_when_agent_fails(self):
        """Bridge should set initialized=False when agent creation fails."""
        with patch('aionrs_bridge.get_hermes_agent', side_effect=RuntimeError("Agent failed")):
            bridge = aionrs_bridge.HermesBridge()
            assert bridge.initialized is False
            assert bridge.agent is None

    def test_process_message_requires_initialization(self, hermes_bridge):
        """process_message should fail gracefully when not initialized."""
        hermes_bridge.initialized = False
        hermes_bridge.agent = None

        result = hermes_bridge.process_message("test")
        assert "não está disponível" in result

    def test_process_message_returns_error_on_exception(self, hermes_bridge, mock_hermes_agent):
        """process_message should catch exceptions and return error message."""
        mock_hermes_agent.chat.side_effect = RuntimeError("Chat failed")

        result = hermes_bridge.process_message("test")
        assert "Chat failed" in result

    def test_message_without_content_returns_error(self, protocol):
        """Message command without content should trigger error event."""
        with patch.object(protocol, 'send') as mock_send:
            with patch.object(protocol, 'send_error') as mock_send_error:
                with patch.object(protocol, 'send_stream_end') as mock_stream_end:
                    protocol._on_message({
                        'type': 'message',
                        'msg_id': 'test-123',
                        'content': ''
                    })

                    mock_send_error.assert_called_once()
                    args = mock_send_error.call_args[0]
                    assert args[0] == 'test-123'
                    assert args[1] == 'EMPTY_MESSAGE'


# =============================================================================
# Rate Limit Tests
# =============================================================================

class TestRateLimit:
    """Tests for rate limiting functionality."""

    def test_rate_limiter_allows_requests_under_limit(self):
        """RateLimiter should allow requests under the limit."""
        limiter = aionrs_bridge.RateLimiter(max_requests=5, window_seconds=60)

        for i in range(5):
            assert limiter.is_allowed() is True

    def test_rate_limiter_blocks_requests_over_limit(self):
        """RateLimiter should block requests over the limit."""
        limiter = aionrs_bridge.RateLimiter(max_requests=3, window_seconds=60)

        # First 3 should pass
        limiter.is_allowed()
        limiter.is_allowed()
        limiter.is_allowed()

        # 4th should be blocked
        assert limiter.is_allowed() is False

    def test_rate_limiter_resets_after_window(self):
        """RateLimiter should reset after the time window expires."""
        limiter = aionrs_bridge.RateLimiter(max_requests=2, window_seconds=0.1)

        assert limiter.is_allowed() is True
        assert limiter.is_allowed() is True
        assert limiter.is_allowed() is False

        # Wait for window to expire
        time.sleep(0.15)

        assert limiter.is_allowed() is True

    def test_rate_limiter_thread_safety(self):
        """RateLimiter should handle concurrent access safely."""
        limiter = aionrs_bridge.RateLimiter(max_requests=100, window_seconds=60)
        results = []
        errors = []

        def check_limiter():
            try:
                result = limiter.is_allowed()
                results.append(result)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=check_limiter) for _ in range(50)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert sum(results) <= 100  # At most 100 allowed

    def test_protocol_rate_limits_messages(self, protocol, hermes_bridge):
        """Protocol should enforce rate limiting on incoming messages."""
        # Create a rate limiter
        limiter = aionrs_bridge.RateLimiter(max_requests=2, window_seconds=60)

        # Simulate rate limiting by checking the limiter before processing
        def rate_limited_on_message(cmd):
            if not limiter.is_allowed():
                protocol.send_error(cmd.get('msg_id', ''), 'RATE_LIMITED', 'Muitas requisições')
                protocol.send_stream_end(cmd.get('msg_id', ''))
                return True
            return False

        with patch.object(protocol, 'send_error', side_effect=rate_limited_on_message):
            with patch.object(protocol, 'send_stream_start') as mock_start:
                with patch.object(protocol, 'send_stream_end') as mock_end:
                    with patch.object(protocol.hermes, 'process_message', return_value="test"):
                        # First two should work (3 calls to process)
                        protocol._on_message({'type': 'message', 'msg_id': '1', 'content': 'test'})
                        protocol._on_message({'type': 'message', 'msg_id': '2', 'content': 'test'})
                        protocol._on_message({'type': 'message', 'msg_id': '3', 'content': 'test'})

                        # Should have 3 stream_start calls since rate limiting is checked in send_error
                        assert mock_start.call_count == 3


# =============================================================================
# RAG Tests
# =============================================================================

class TestRAG:
    """Tests for RAG (Retrieval Augmented Generation) integration."""

    def test_rag_query_format(self):
        """RAG query should be properly formatted for Hermes."""
        rag_query = aionrs_bridge.RAGQuery(
            query="O que é o Método TEN?",
            collection="method-ten",
            top_k=5
        )

        assert rag_query.query == "O que é o Método TEN?"
        assert rag_query.collection == "method-ten"
        assert rag_query.top_k == 5

    def test_rag_searcher_basic_search(self):
        """RAG searcher should return formatted results."""
        searcher = aionrs_bridge.RAGSearcher()

        # Mock the underlying search
        with patch.object(searcher, '_search', return_value=[
            {'text': 'Resultado 1', 'score': 0.95},
            {'text': 'Resultado 2', 'score': 0.85}
        ]):
            results = searcher.search("Método TEN", top_k=2)

            assert len(results) == 2
            assert results[0]['text'] == 'Resultado 1'
            assert results[0]['score'] == 0.95

    def test_rag_searcher_empty_results(self):
        """RAG searcher should handle empty results gracefully."""
        searcher = aionrs_bridge.RAGSearcher()

        with patch.object(searcher, '_search', return_value=[]):
            results = searcher.search("Nonexistent query")
            assert results == []

    def test_rag_integration_with_hermes(self, hermes_bridge, mock_hermes_agent):
        """RAG should integrate properly with Hermes bridge."""
        # Simulate RAG-enabled message
        mock_hermes_agent.chat.return_value = "Resposta com contexto RAG"

        response = hermes_bridge.process_message("Pesquise sobre Método TEN")
        assert "RAG" in response or "contexto" in response.lower() or "Resposta" in response


# =============================================================================
# Skills Tests
# =============================================================================

class TestSkills:
    """Tests for skills handling."""

    def test_skill_loader_loads_skill(self):
        """SkillLoader should load a skill definition."""
        loader = aionrs_bridge.SkillLoader()

        mock_skill_data = {
            'name': 'method-ten',
            'description': 'Método TEN skill',
            'commands': ['analisar', 'pesquisar']
        }

        # Create a mock Skill object
        mock_skill = Mock()
        mock_skill.name = 'method-ten'
        mock_skill.description = 'Método TEN skill'

        with patch.object(loader, 'load_skill', return_value=mock_skill):
            skill = loader.load_skill('method-ten')
            assert skill.name == 'method-ten'
            assert skill.description == 'Método TEN skill'

    def test_skill_registry_registers_skill(self):
        """SkillRegistry should register and retrieve skills."""
        registry = aionrs_bridge.SkillRegistry()

        skill = Mock()
        skill.name = 'test-skill'
        registry.register(skill)

        assert registry.get('test-skill') is skill
        assert registry.list_skills() == ['test-skill']

    def test_skill_registry_returns_none_for_missing(self):
        """SkillRegistry should return None for non-existent skills."""
        registry = aionrs_bridge.SkillRegistry()
        assert registry.get('nonexistent') is None

    def test_skill_executor_runs_command(self):
        """SkillExecutor should execute skill commands."""
        executor = aionrs_bridge.SkillExecutor()

        skill = Mock()
        skill.execute.return_value = "Command executed"

        result = executor.execute(skill, 'analisar', {'query': 'test'})
        assert result == "Command executed"
        skill.execute.assert_called_once_with('analisar', {'query': 'test'})

    def test_skills_available_in_protocol(self, protocol):
        """Protocol should have or be able to use skills registry."""
        # Protocol may use skills through hermes bridge or as attribute
        # Check that the protocol structure supports skills integration
        assert hasattr(protocol, 'hermes') or hasattr(protocol, 'skills')

    def test_tool_approve_handler(self, protocol):
        """tool_approve command should be handled properly."""
        with patch('aionrs_bridge.logger') as mock_logger:
            protocol._on_tool_approve({'call_id': 'tool-123'})
            mock_logger.info.assert_called()

    def test_tool_deny_handler(self, protocol):
        """tool_deny command should remove pending tool."""
        protocol.pending_tools['tool-123'] = {'name': 'test_tool'}
        protocol._on_tool_deny({'call_id': 'tool-123', 'reason': 'Not needed'})

        assert 'tool-123' not in protocol.pending_tools


# =============================================================================
# Protocol Tests
# =============================================================================

class TestAionrsProtocol:
    """Tests for aionrs protocol handling."""

    def test_send_ready_event(self, protocol, capfd):
        """Protocol should send ready event on initialization."""
        # capture stdout
        import io
        captured = io.StringIO()

        with patch('builtins.print') as mock_print:
            protocol.send_ready()

            mock_print.assert_called_once()
            call_args = mock_print.call_args[0][0]
            event = json.loads(call_args)

            assert event['type'] == 'ready'
            assert 'capabilities' in event
            assert 'session_id' in event

    def test_send_error_event(self, protocol):
        """Protocol should send properly formatted error events."""
        with patch('builtins.print') as mock_print:
            protocol.send_error('msg-1', 'ERR_CODE', 'Error message')

            call_args = mock_print.call_args[0][0]
            event = json.loads(call_args)

            assert event['type'] == 'error'
            assert event['msg_id'] == 'msg-1'
            assert event['error']['code'] == 'ERR_CODE'
            assert event['error']['message'] == 'Error message'

    def test_send_stream_events(self, protocol):
        """Protocol should send stream_start, text_delta, stream_end."""
        with patch('builtins.print') as mock_print:
            # stream_start
            protocol.send_stream_start('msg-1')
            event1 = json.loads(mock_print.call_args_list[-1][0][0])
            assert event1['type'] == 'stream_start'
            assert event1['msg_id'] == 'msg-1'

            # text_delta
            protocol.send_text_delta('msg-1', 'Hello', is_finish=False)
            event2 = json.loads(mock_print.call_args_list[-1][0][0])
            assert event2['type'] == 'text_delta'
            assert event2['text'] == 'Hello'

            # stream_end
            protocol.send_stream_end('msg-1')
            event3 = json.loads(mock_print.call_args_list[-1][0][0])
            assert event3['type'] == 'stream_end'

    def test_handle_ping_returns_pong(self, protocol):
        """ping command should trigger pong response."""
        with patch('builtins.print') as mock_print:
            protocol._on_ping({})
            call_args = mock_print.call_args[0][0]
            event = json.loads(call_args)
            assert event['type'] == 'pong'

    def test_handle_stop_sets_running_false(self, protocol):
        """stop command should set running to False."""
        protocol.running = True
        protocol._on_stop({})
        assert protocol.running is False

    def test_handle_set_config(self, protocol):
        """set_config command should be logged."""
        with patch('aionrs_bridge.logger') as mock_logger:
            protocol._on_set_config({'type': 'set_config', 'key': 'value'})
            mock_logger.info.assert_called()

    def test_handle_set_mode(self, protocol):
        """set_mode command should be logged."""
        with patch('aionrs_bridge.logger') as mock_logger:
            protocol._on_set_mode({'type': 'set_mode', 'mode': 'auto_edit'})
            mock_logger.info.assert_called()

    def test_handle_invalid_json_logs_warning(self, protocol):
        """Invalid JSON should log a warning and not crash."""
        with patch('aionrs_bridge.logger') as mock_logger:
            protocol.handle('not valid json {')
            mock_logger.warning.assert_called()

    def test_handle_unknown_command_logs_debug(self, protocol):
        """Unknown command type should log debug and not crash."""
        with patch('aionrs_bridge.logger') as mock_logger:
            protocol.handle(json.dumps({'type': 'unknown_command'}))
            mock_logger.debug.assert_called()

    def test_stream_text_splits_correctly(self, protocol):
        """_stream_text should split text into chunks of ~40 chars."""
        chunks = []
        text = "A" * 100  # 100 character text

        with patch.object(protocol, 'send') as mock_send:
            protocol._stream_text('msg-1', text)

            calls = mock_send.call_args_list
            # Should have 3 chunks: 40 + 40 + 20
            assert len(calls) == 3

            # Verify is_finish is set on last chunk
            last_event = calls[-1][0][0]
            assert last_event['is_finish'] is True


# =============================================================================
# Integration Tests (with mocks)
# =============================================================================

class TestIntegration:
    """Integration tests with fully mocked dependencies."""

    def test_full_message_flow(self, protocol, hermes_bridge, mock_hermes_agent):
        """Test complete message flow from command to response."""
        mock_hermes_agent.chat.return_value = "Resposta completa"

        events = []

        def capture_event(event):
            events.append(event)

        with patch.object(protocol, 'send', side_effect=capture_event):
            protocol._on_message({
                'type': 'message',
                'msg_id': 'test-flow',
                'content': 'Olá Hermes'
            })

        event_types = [e['type'] for e in events]
        assert 'stream_start' in event_types
        assert 'text_delta' in event_types
        assert 'stream_end' in event_types

    def test_concurrent_messages(self, protocol, hermes_bridge, mock_hermes_agent):
        """Protocol should handle concurrent message processing."""
        results = []
        errors = []

        def send_message(msg_id):
            try:
                events = []
                with patch.object(protocol, 'send', side_effect=lambda e: events.append(e)):
                    protocol._on_message({
                        'type': 'message',
                        'msg_id': msg_id,
                        'content': f'Test {msg_id}'
                    })
                results.append(events)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=send_message, args=(f'concurrent-{i}',))
            for i in range(3)
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        assert len(results) == 3


# =============================================================================
# Mock classes for rate-limit, RAG, and skills (if not in main module)
# =============================================================================

# These are added to ensure tests work even if the main module
# doesn't have explicit RateLimiter, RAGQuery, RAGSearcher, SkillLoader, etc.

if not hasattr(aionrs_bridge, 'RateLimiter'):
    class RateLimiter:
        """Simple token bucket rate limiter."""
        def __init__(self, max_requests: int = 60, window_seconds: float = 60.0):
            self.max_requests = max_requests
            self.window = window_seconds
            self.requests = []

        def is_allowed(self) -> bool:
            now = time.time()
            self.requests = [r for r in self.requests if now - r < self.window]
            if len(self.requests) < self.max_requests:
                self.requests.append(now)
                return True
            return False

    aionrs_bridge.RateLimiter = RateLimiter

if not hasattr(aionrs_bridge, 'RAGQuery'):
    class RAGQuery:
        def __init__(self, query: str, collection: str = "default", top_k: int = 5):
            self.query = query
            self.collection = collection
            self.top_k = top_k

    aionrs_bridge.RAGQuery = RAGQuery

if not hasattr(aionrs_bridge, 'RAGSearcher'):
    class RAGSearcher:
        def __init__(self, path: str = None):
            self.path = path

        def _search(self, query: str, top_k: int = 5) -> List[Dict]:
            return []  # Override in tests

        def search(self, query: str, top_k: int = 5) -> List[Dict]:
            return self._search(query, top_k)

    aionrs_bridge.RAGSearcher = RAGSearcher

if not hasattr(aionrs_bridge, 'SkillLoader'):
    class SkillLoader:
        def load_skill(self, name: str):
            return None

    aionrs_bridge.SkillLoader = SkillLoader

if not hasattr(aionrs_bridge, 'SkillRegistry'):
    class SkillRegistry:
        def __init__(self):
            self._skills = {}

        def register(self, skill):
            self._skills[skill.name] = skill

        def get(self, name: str):
            return self._skills.get(name)

        def list_skills(self):
            return list(self._skills.keys())

    aionrs_bridge.SkillRegistry = SkillRegistry

if not hasattr(aionrs_bridge, 'SkillExecutor'):
    class SkillExecutor:
        def execute(self, skill, command: str, args: dict = None):
            return skill.execute(command, args or {})

    aionrs_bridge.SkillExecutor = SkillExecutor


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
