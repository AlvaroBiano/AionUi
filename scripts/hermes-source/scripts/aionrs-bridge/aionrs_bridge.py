#!/usr/bin/env python3
"""
AionRS Bridge — Hermes Agent Integration for AionUI

Bridge de protocolo: AionUI (aionrs JSON Stream) ↔ Hermes Agent (Python API)

AionUI se comunica via stdin/stdout com linhas JSON (aionrs protocol).
Este bridge traduz para a API Python do Hermes Agent (AIAgent.chat()).

Dependências:
  - Python 3.10+
  - hermes-agent (instalado em ~/.hermes/hermes-agent/)

Uso direto (teste):
  echo '{"type":"message","msg_id":"test-1","content":"Olá"}' | python3 aionrs_bridge.py

Uso com AionUI (custom agent config):
  Adicionar em ~/.aionui/config.json a entrada customAgents
"""

import sys
import json
import logging
import uuid
import os
import threading
from typing import Optional

# Configurar logging para stderr (stdout é reservado para o protocolo)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] bridge: %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger('aionrs_bridge')

# =============================================================================
# Hermes Agent API
# =============================================================================

def get_hermes_agent():
    """Importa e retorna uma instância de AIAgent do Hermes."""
    import subprocess
    import os

    # ============================================================
    # ABORDAGEM CORRETA: Executar via subprocess com o Python do
    # hermes-agent venv, que tem todas as dependências.
    # O bridge vai rodar como subprocess separado para garantir
    # que o venv correto é usado.
    # ============================================================

    venv_python = '/home/alvarobiano/.hermes/hermes-agent/venv/bin/python'
    hermes_root = '/home/alvarobiano/.hermes/hermes-agent'
    run_agent_path = os.path.join(hermes_root, 'run_agent.py')

    # Verificar se existe
    if not os.path.exists(venv_python):
        raise RuntimeError(f"Hermes venv Python não encontrado: {venv_python}")
    if not os.path.exists(run_agent_path):
        raise RuntimeError(f"run_agent.py não encontrado: {run_agent_path}")

    logger.info(f"Hermes Agent: usando venv Python em {venv_python}")

    # O agente é criado como subprocess para cada mensagem
    # porque AIAgent é stateful e thread-unsafe
    class SubprocessHermes:
        """Wrapper que usa subprocess para comunicar com Hermes AIAgent."""

        def __init__(self):
            self.venv_python = venv_python
            self.run_agent_path = run_agent_path
            self.session_id = str(uuid.uuid4())
            self.initialized = True
            logger.info("SubprocessHermesAgent criado")

        def chat(self, message: str) -> str:
            """Envia mensagem via subprocess Hermes AIAgent."""
            import tempfile

            # Script que importa AIAgent, envia mensagem e imprime resposta
            script = f'''
import sys
sys.path.insert(0, '{hermes_root}')

import os
os.environ['MINIMAX_API_KEY'] = os.environ.get('MINIMAX_API_KEY', '')

# Carrega .env do Hermes
try:
    from hermes_cli.env_loader import load_hermes_dotenv
    load_hermes_dotenv()
except:
    pass

from run_agent import AIAgent

agent = AIAgent(
    provider='minimax',
    model='MiniMax-M2.7',
    api_key=os.environ.get('MINIMAX_API_KEY', ''),
    platform='cli',
    max_iterations=30,
    quiet_mode=True,
)

response = agent.chat({repr(message)})
print(response, end='')
'''

            try:
                result = subprocess.run(
                    [self.venv_python, '-c', script],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    env=os.environ.copy()
                )

                if result.returncode == 0:
                    return result.stdout
                else:
                    error_msg = result.stderr[:500] if result.stderr else 'Unknown error'
                    logger.error(f"SubprocessHermes error: {error_msg}")
                    return f"Erro: {error_msg}"

            except subprocess.TimeoutExpired:
                return "Erro:_TIMEOUT — Hermes demorou demais para responder."
            except Exception as e:
                return f"Erro de subprocesso: {e}"

    return SubprocessHermes()


class HermesBridge:
    """Traduz entre aionrs protocol e Hermes AIAgent API."""

    def __init__(self):
        self.agent = None
        self.session_id = str(uuid.uuid4())
        self.initialized = False
        self._init_agent()

    def _init_agent(self):
        """Inicializa o agente Hermes."""
        try:
            self.agent = get_hermes_agent()
            self.initialized = True
            logger.info("Hermes Agent inicializado")
        except Exception as e:
            logger.error(f"Falha na inicialização: {e}")
            self.initialized = False

    def process_message(self, content: str) -> str:
        """Envia mensagem ao Hermes e retorna a resposta."""
        if not self.initialized or not self.agent:
            return "Hermes Agent não está disponível."

        try:
            response = self.agent.chat(content)
            return response
        except Exception as e:
            logger.error(f"Erro ao processar mensagem: {e}")
            return f"Erro: {e}"


# =============================================================================
# aionrs Protocol Handler
# Reference: src/process/agent/aionrs/protocol.ts
# =============================================================================

class AionrsProtocol:
    """
    Handler do aionrs JSON Stream Protocol.

    Eventos (stdout → AionUI):
      ready, stream_start, text_delta, thinking, tool_request,
      tool_running, tool_result, tool_cancelled, stream_end, error, info, pong

    Comandos (stdin ← AionUI):
      message, stop, ping, tool_approve, tool_deny, set_config, set_mode
    """

    def __init__(self, hermes: HermesBridge):
        self.hermes = hermes
        self.running = True
        self.pending_tools = {}

    # -------------------------------------------------------------------------
    # Envio de eventos
    # -------------------------------------------------------------------------

    def send(self, event: dict):
        """Envia evento JSON para AionUI (stdout)."""
        line = json.dumps(event, ensure_ascii=False)
        print(line, flush=True)

    def send_ready(self):
        """Evento inicial — AionUI espera isso primeiro."""
        self.send({
            'type': 'ready',
            'version': '1.0.0',
            'session_id': self.hermes.session_id,
            'capabilities': {
                'tool_approval': True,
                'thinking': True,
                'effort': True,
                'effort_levels': ['low', 'medium', 'high'],
                'modes': ['default', 'auto_edit', 'yolo'],
                'mcp': True
            }
        })
        logger.info("ready event enviado")

    def send_error(self, msg_id: str, code: str, message: str, retryable: bool = True):
        self.send({
            'type': 'error',
            'msg_id': msg_id,
            'error': {'code': code, 'message': message, 'retryable': retryable}
        })

    def send_stream_start(self, msg_id: str):
        self.send({'type': 'stream_start', 'msg_id': msg_id})

    def send_text_delta(self, msg_id: str, text: str, is_finish: bool = False):
        event = {'type': 'text_delta', 'text': text, 'msg_id': msg_id}
        if is_finish:
            event['is_finish'] = True
        self.send(event)

    def send_thinking(self, msg_id: str, text: str):
        self.send({'type': 'thinking', 'text': text, 'msg_id': msg_id})

    def send_stream_end(self, msg_id: str):
        self.send({'type': 'stream_end', 'msg_id': msg_id})

    def send_tool_result(self, msg_id: str, call_id: str, result: str, is_error: bool = False):
        self.send({
            'type': 'tool_result',
            'msg_id': msg_id,
            'call_id': call_id,
            'result': result,
            'is_error': is_error
        })

    def send_info(self, msg_id: str, text: str):
        self.send({'type': 'info', 'text': text, 'msg_id': msg_id})

    # -------------------------------------------------------------------------
    # Processamento de comandos
    # -------------------------------------------------------------------------

    def handle(self, raw: str):
        """Processa uma linha JSON do stdin (comando do AionUI)."""
        try:
            cmd = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"JSON inválido ignorado: {raw[:80]}")
            return

        cmd_type = cmd.get('type', '')
        handlers = {
            'message':      self._on_message,
            'stop':         self._on_stop,
            'ping':         self._on_ping,
            'tool_approve': self._on_tool_approve,
            'tool_deny':    self._on_tool_deny,
            'set_config':   self._on_set_config,
            'set_mode':     self._on_set_mode,
        }

        handler = handlers.get(cmd_type)
        if handler:
            handler(cmd)
        else:
            logger.debug(f"Comando ignorado: {cmd_type}")

    def _on_message(self, cmd: dict):
        """Processa mensagem do usuário."""
        msg_id = cmd.get('msg_id', str(uuid.uuid4()))
        content = cmd.get('content', '')
        files = cmd.get('files', [])

        if not content and not files:
            self.send_error(msg_id, 'EMPTY_MESSAGE', 'Mensagem vazia')
            self.send_stream_end(msg_id)
            return

        self.send_stream_start(msg_id)

        try:
            response = self.hermes.process_message(content)
            self._stream_text(msg_id, response)
        except Exception as e:
            logger.error(f"Erro no process_message: {e}")
            self.send_error(msg_id, 'PROCESS_ERROR', str(e), retryable=True)

        self.send_stream_end(msg_id)

    def _stream_text(self, msg_id: str, text: str):
        """Envia texto em chunks para simular streaming."""
        chunk_size = 40
        for i in range(0, len(text), chunk_size):
            chunk = text[i:i + chunk_size]
            is_last = (i + chunk_size >= len(text))
            self.send_text_delta(msg_id, chunk, is_finish=is_last)

    def _on_stop(self, cmd: dict):
        """Para o bridge."""
        logger.info("Comando stop recebido")
        self.running = False

    def _on_ping(self, cmd: dict):
        self.send({'type': 'pong'})

    def _on_tool_approve(self, cmd: dict):
        call_id = cmd.get('call_id')
        logger.info(f"Tool approve: {call_id}")

    def _on_tool_deny(self, cmd: dict):
        call_id = cmd.get('call_id')
        reason = cmd.get('reason', '')
        logger.info(f"Tool deny: {call_id} — {reason}")
        self.pending_tools.pop(call_id, None)

    def _on_set_config(self, cmd: dict):
        logger.info(f"Config update: {cmd}")

    def _on_set_mode(self, cmd: dict):
        logger.info(f"Mode change: {cmd.get('mode')}")


# =============================================================================
# Main
# =============================================================================

def main():
    logger.info("AionRS Bridge iniciando...")

    hermes = HermesBridge()
    protocol = AionrsProtocol(hermes)

    # Pronto para o AionUI
    protocol.send_ready()
    logger.info("Aguardando comandos do AionUI...")

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            protocol.handle(line)
            if not protocol.running:
                break
    except KeyboardInterrupt:
        logger.info("Interrompido")
    except Exception as e:
        logger.error(f"Erro fatal: {e}")
    finally:
        logger.info("Bridge encerrado")


if __name__ == '__main__':
    main()
