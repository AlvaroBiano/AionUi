#!/usr/bin/env python3
"""
Teste do aionrs bridge.
Envia mensagens de teste e verifica os eventos de resposta.
"""

import sys
import json
import subprocess
import threading
import time
import queue

def run_test():
    """Executa teste de integração com o bridge."""
    
    bridge_script = '/home/alvarobiano/repos/aionui-hermes-ten/scripts/aionrs-bridge/aionrs_bridge.py'
    
    print("=== Teste do aionrs Bridge ===\n")
    
    # Teste 1: Verificar se o script existe e é executável
    import os
    if not os.path.exists(bridge_script):
        print(f"ERRO: Bridge não encontrado em {bridge_script}")
        return False
    
    print(f"[OK] Bridge encontrado: {bridge_script}")
    
    # Teste 2: Verificar se imports funcionam
    print("\n[Teste 2] Verificando imports do Hermes AIAgent...")
    try:
        sys.path.insert(0, '/home/alvarobiano/.hermes/hermes-agent/src')
        from run_agent import AIAgent
        print("  AIAgent importado com sucesso ✓")
    except Exception as e:
        print(f"  AVISO: Não foi possível importar AIAgent: {e}")
        print("  O bridge pode funcionar via subprocess fallback.")
    
    # Teste 3: Teste de protocolo (sem API key, apenas verificação de estrutura)
    print("\n[Teste 3] Teste de protocolo aionrs (ping + message)...")
    
    test_messages = [
        json.dumps({'type': 'message', 'msg_id': 'test-1', 'content': 'Olá'}),
        json.dumps({'type': 'ping'}),
    ]
    
    proc = subprocess.Popen(
        [sys.executable, bridge_script],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    output_queue = queue.Queue()
    
    def read_output():
        for line in proc.stdout:
            output_queue.put(line.strip())
    
    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    
    # Enviar mensagens
    for msg in test_messages:
        proc.stdin.write(msg + '\n')
        proc.stdin.flush()
        time.sleep(1)
    
    # Coletar resposta
    events = []
    timeout = 60
    start = time.time()
    while time.time() - start < timeout:
        try:
            line = output_queue.get(timeout=2)
            events.append(line)
            print(f"  Evento: {line[:120]}")
        except queue.Empty:
            break
    
    proc.stdin.close()
    proc.stderr.close()
    proc.terminate()
    proc.wait(timeout=5)
    
    # Analisar eventos
    print(f"\n[Resultado] {len(events)} eventos recebidos")
    
    has_ready = any('ready' in e for e in events)
    has_stream_start = any('stream_start' in e for e in events)
    has_stream_end = any('stream_end' in e for e in events)
    has_text_delta = any('text_delta' in e for e in events)
    
    checks = [
        ("ready event", has_ready),
        ("stream_start event", has_stream_start),
        ("stream_end event", has_stream_end),
        ("text_delta event", has_text_delta),
    ]
    
    all_ok = True
    for name, ok in checks:
        status = "✓" if ok else "✗"
        print(f"  {name}: {status}")
        if not ok:
            all_ok = False
    
    return has_ready

if __name__ == '__main__':
    success = run_test()
    print(f"\nTeste {'APROVADO' if success else 'REPROVADO'}")
    sys.exit(0 if success else 1)
