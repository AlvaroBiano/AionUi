#!/usr/bin/env python3
"""
BianinhoBridge Memory Benchmark
Mede memory footprint do processo bridge via psutil
"""
import psutil
import time
import statistics
import subprocess
import signal
import os

PID_FILE = '/tmp/bridge_pid'

def get_bridge_pid():
    """Encontra o pid do bridge activo"""
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmdline = ' '.join(proc.info['cmdline'] or [])
            if 'bianinho_bridge' in cmdline and '18743' in cmdline:
                return proc.info['pid']
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return None

def measure_memory(pid, samples=10, interval=1.0):
    """Mede RSS/VMS de um processo ao longo do tempo"""
    rss_samples = []
    vms_samples = []
    for _ in range(samples):
        try:
            proc = psutil.Process(pid)
            mem = proc.memory_info()
            rss_samples.append(mem.rss / (1024 * 1024))  # MB
            vms_samples.append(mem.vms / (1024 * 1024))    # MB
            time.sleep(interval)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            break
    return rss_samples, vms_samples

def main():
    print("=" * 60)
    print("BIANINHO BRIDGE — BENCHMARK DE MEMÓRIA")
    print("=" * 60)
    
    pid = get_bridge_pid()
    if not pid:
        print("Bridge não encontrado. A iniciar novo processo...")
        # Iniciar bridge
        import socket
        try:
            s = socket.create_connection(('127.0.0.1', 18743), timeout=2)
            s.close()
            print("Bridge já está a correr (ligação aceite na porta 18743)")
        except:
            print("Bridge não está a correr na porta 18743. Inicia com:")
            print("  ~/repos/aionui-custom/bianinho-venv/bin/python3 scripts/bianinho_bridge.py 18743 &")
        return
    
    print(f"Bridge PID: {pid}")
    print(f"A medir {10} amostras com 1s de intervalo...")
    print()
    
    rss, vms = measure_memory(pid, samples=10, interval=1.0)
    
    if rss:
        print(f"RSS (memória real):")
        print(f"  Min:  {min(rss):.1f} MB")
        print(f"  Max:  {max(rss):.1f} MB")
        print(f"  Média: {statistics.mean(rss):.1f} MB")
        print(f"  Target: < 500 MB")
        print(f"  Status: {'✅ OK' if max(rss) < 500 else '❌ ACIMA DO TARGET'}")
        print()
        print(f"VMS (memória virtual):")
        print(f"  Min:  {min(vms):.1f} MB")
        print(f"  Max:  {max(vms):.1f} MB")
        print(f"  Média: {statistics.mean(vms):.1f} MB")
        
        # Guardar JSON
        import json
        output = f"/home/alvarobiano/repos/aionui-custom/scripts/benchmark_results_memory.json"
        with open(output, 'w') as f:
            json.dump({
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "pid": pid,
                "rss_mb": {"min": min(rss), "max": max(rss), "mean": statistics.mean(rss), "samples": rss},
                "vms_mb": {"min": min(vms), "max": max(vms), "mean": statistics.mean(vms), "samples": vms},
            }, f, indent=2)
        print(f"\nResultados guardados em: {output}")
    else:
        print("Não foi possível medir memória do processo.")

if __name__ == "__main__":
    main()
