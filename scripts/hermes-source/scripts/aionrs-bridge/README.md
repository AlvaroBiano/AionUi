# aionrs Bridge

## O que é

O `aionrs_bridge.py` é um bridge de protocolo que permite ao **AionUI** usar o **Hermes Agent (Bianinho)** como agent nativo.

O AionUI se comunica via **aionrs JSON Stream Protocol** (JSON linhas no stdout/stdin). O Hermes Agent tem sua própria API Python interna. O bridge faz a tradução entre os dois.

## Como funciona

```
AionUI (stdio)
    ↓ linha JSON (cmd)
aionrs_bridge.py  ← este bridge
    ↓ Python API
Hermes Agent (Python internals)
    ↓ resposta
aionrs_bridge.py
    ↓ linha JSON (event)
AionUI (stdio)
```

## Eventos (Bridge → AionUI)

- `ready` — handshake inicial
- `stream_start` — início de resposta
- `text_delta` — pedaço de texto
- `thinking` — output de raciocínio
- `tool_request` — requisição de ferramenta
- `tool_result` — resultado de ferramenta
- `stream_end` — fim da resposta
- `error` — erro
- `pong` — resposta a ping

## Comandos (AionUI → Bridge)

- `message` — mensagem do usuário
- `stop` — parar operação
- `tool_approve` — aprovar ferramenta
- `tool_deny` — negar ferramenta
- `ping` — keepalive
- `set_config` — mudar configuração

## Status

Este bridge está em desenvolvimento. A interface básica está implementada mas
a comunicação real com Hermes Agent via Python API precisa ser validada.

## Instalação no AionUI (custom agent)

```json
{
  "id": "hermes-bianinho",
  "name": "Bianinho (Hermes)",
  "cliCommand": "hermes",
  "defaultCliPath": "/home/alvarobiano/.local/bin/hermes",
  "env": {
    "MINIMAX_API_KEY": "${MINIMAX_API_KEY}"
  }
}
```

Alternativamente, use o wrapper:
```json
{
  "id": "hermes-bianinho",
  "name": "Bianinho Bridge",
  "cliCommand": "python3",
  "defaultCliPath": "/home/alvarobiano/repos/aionui-hermes-ten/scripts/aionrs-bridge/aionrs_bridge.py"
}
```
