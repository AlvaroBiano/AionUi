#!/usr/bin/env python3
"""
BianinhoBridge Latency Benchmark
Mede latência real do bridge TCP via nc (netcat)
"""
import subprocess
import json
import time
import statistics
import os

BRIDGE_HOST = '127.0.0.1'
BRIDGE_PORT = 18743

def send_cmd(cmd, timeout=5):
    """Envia comando via nc e retorna resposta JSON + latência em ms"""
    start = time.perf_counter()
    try:
        payload = json.dumps(cmd)
        # Enviar length prefix (4 bytes big-endian) + JSON
        length_bytes = len(payload).to_bytes(4, 'big')
        full_cmd = f'echo -n "{length_bytes.decode("latin-1")}{payload}" | timeout {timeout} nc -N {BRIDGE_HOST} {BRIDGE_PORT}'
        result = subprocess.run(
            full_cmd, shell=True, capture_output=True, text=True, timeout=timeout + 1
        )
        latency_ms = (time.perf_counter() - start) * 1000
        if result.stdout:
            return result.stdout.strip(), latency_ms, None
        elif result.stderr:
            return None, latency_ms, result.stderr.strip()
        return None, latency_ms, "empty response"
    except subprocess.TimeoutExpired:
        latency_ms = (time.perf_counter() - start) * 1000
        return None, latency_ms, "timeout"
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        return None, latency_ms, str(e)

def benchmark(name, cmd, iterations):
    latencies = []
    errors = 0
    for i in range(iterations):
        resp, lat, err = send_cmd(cmd)
        latencies.append(lat)
        if err or not resp:
            errors += 1
            print(f"  {i+1}/{iterations}: {lat:.2f}ms ERR: {err}")
        else:
            print(f"  {i+1}/{iterations}: {lat:.2f}ms OK")
        time.sleep(0.05)  # small delay between requests
    
    latencies.sort()
    n = len(latencies)
    valid = [l for l in latencies if l < 5000]
    return {
        "name": name,
        "iterations": iterations,
        "errors": errors,
        "min_ms": min(latencies) if latencies else 0,
        "max_ms": max(latencies) if latencies else 0,
        "mean_ms": statistics.mean(latencies) if latencies else 0,
        "median_ms": latencies[n//2] if n > 0 else 0,
        "p95_ms": latencies[int(n*0.95)] if n > 0 else 0,
        "p99_ms": latencies[int(n*0.99)] if n > 0 else 0,
    }

def main():
    print("=" * 60)
    print("BIANINHO BRIDGE — BENCHMARK DE LATÊNCIA")
    print("=" * 60)
    print(f"Bridge: {BRIDGE_HOST}:{BRIDGE_PORT}")
    print()
    
    results = []
    
    # Teste 1: ping (100 iterações)
    print("[1] Ping — 100 iterações")
    r = benchmark("ping", {"cmd": "ping", "args": {"echo": "benchmark"}}, 100)
    results.append(r)
    print(f"  Min: {r['min_ms']:.2f}ms | Mediana: {r['median_ms']:.2f}ms | P95: {r['p95_ms']:.2f}ms")
    print(f"  Erros: {r['errors']} | Target: < 50ms p95")
    status = "✅ OK" if r['p95_ms'] < 50 else f"❌ ({r['p95_ms']:.0f}ms)"
    print(f"  Status: {status}")
    print()
    
    # Teste 2: status (50 iterações)
    print("[2] Status — 50 iterações")
    r = benchmark("status", {"cmd": "status", "args": {}}, 50)
    results.append(r)
    print(f"  Min: {r['min_ms']:.2f}ms | Mediana: {r['median_ms']:.2f}ms | P95: {r['p95_ms']:.2f}ms")
    print(f"  Erros: {r['errors']}")
    print()
    
    # Teste 3: check_hermes (20 iterações)
    print("[3] Check Hermes — 20 iterações")
    r = benchmark("check_hermes", {"cmd": "check_hermes", "args": {}}, 20)
    results.append(r)
    print(f"  Min: {r['min_ms']:.2f}ms | Mediana: {r['median_ms']:.2f}ms | P95: {r['p95_ms']:.2f}ms")
    print(f"  Erros: {r['errors']}")
    print()
    
    # Resumo
    print("=" * 60)
    print("RESUMO")
    print("=" * 60)
    print(f"{'Comando':<20} {'Min':>8} {'Mediana':>10} {'P95':>10} {'Target':>10} {'Status':>8}")
    print("-" * 68)
    targets = {"ping": 50, "status": 100, "check_hermes": 200}
    for res in results:
        target = targets.get(res["name"], 999)
        status = "✅ OK" if res["p95_ms"] < target else f"❌ ({res['p95_ms']:.0f}ms)"
        print(f"{res['name']:<20} {res['min_ms']:>7.2f}ms {res['median_ms']:>9.2f}ms {res['p95_ms']:>9.2f}ms {target:>9}ms {status:>8}")
    
    # Guardar JSON
    output_file = "/home/alvarobiano/repos/aionui-custom/scripts/benchmark_results_bridge.json"
    with open(output_file, 'w') as f:
        json.dump({"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "results": results}, f, indent=2)
    print(f"\nResultados guardados em: {output_file}")

if __name__ == "__main__":
    main()
