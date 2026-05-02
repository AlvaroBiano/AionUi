# CLAUDE.md — AionUI × Hermes Agent

## Contexto do Projeto

Este repositório integra o **AionUI** (plataforma multi-agent cowork) com o **Hermes Agent (Bianinho)** do Álvaro Bianoi.

## AionUI — O que é

- **AionUI**: https://github.com/iOfficeAI/AionUi (23k+ stars)
- **Versão instalada**: v1.9.23 (build de produção)
- **Electron**: 37.10.3, Chromium 138.0.7204.251
- **Build location**: `/home/alvarobiano/repos/aionui/`
- **Locale**: pt-BR

## Como Arrancar o AionUI

```bash
/home/alvarobiano/repos/aionui/aionui-start.sh
```

O AionUI corre com Xvfb (display virtual) para headless operation.

## Bridge de Integração

O **aionrs_bridge.py** traduz entre:
- **AionUI** (aionrs JSON Stream Protocol) ↔ **Hermes** (Python AIAgent API)

## Regras para AI agents

1. **Nunca fabricar dados** — se não sabes, diz que não sabes
2. **Testar antes de dizer "OK Aprovado"** — 8 camadas
3. **Português do Brasil** — única língua de comunicação
4. **Verificar antes de agir** — não presumir

## Estrutura

```
repos/
├── aionui/                    # AionUI v1.9.23 (build de produção)
│   ├── AionUi                # Executável Electron
│   ├── aionui-start.sh      # Arranque com Xvfb
│   └── aionui-stop.sh       # Paragem
└── aionui-hermes-ten/       # ESTE REPOSITÓRIO
    ├── scripts/aionrs-bridge/
    │   └── aionrs_bridge.py  # Bridge principal
    ├── config/
    │   ├── team-ten-full.yaml  # Team Mode config
    │   └── custom-agent-hermes.json
    └── docs/
        ├── QUICK_START.md
        ├── SETUP.md
        ├── INTEGRATION.md
        └── TEAM_MODE.md
```
