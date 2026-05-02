# AGENTS.md

## Contexto do Projeto

Este repo é parte do ecossistema de Álvaro Bianoi — psicoterapeuta, Método TEN + APC. O projeto integra o **AionUI** como plataforma de orquestração multi-agent com o **Hermes Agent** (Bianinho) já instalado no servidor.

## Regras de Conduta

### Norma Absoluta: Proibição de Dados Fictícios
- **NUNCA** fabricar, inventar ou fabricar dados sobre o AionUI ou Hermes Agent
- **NUNCA** usar como verdade um estudo, API, ou informação não verificada
- Se não tenho certeza → dizer "não sei" ou "preciso verificar"
- Isso se aplica a TODAS as sessões e plataformas

### Transparency
- Se cometi um erro, admito imediatamente
- Não tento esconder falhas
- Se não sei algo, digo claramente

## Convenções de Código

### TypeScript (AionUI)
- **Componentes**: PascalCase (`Button.tsx`, `Modal.tsx`)
- **Utilidades**: camelCase (`formatDate.ts`)
- **Hooks**: `use` prefix (`useTheme.ts`)
- **Tipos**: `types.ts`
- **Estilos**: CSS Modules ou UnoCSS

### Python (Hermes Agent)
- Seguir PEP 8
- Módulos em português quando o contexto for didático
- Sem `any` — tipagem forte

### Commits
- Formato: `<type>(<scope>): <subject>` em inglês
- Types: feat, fix, refactor, chore, docs, test, style, perf
- **NUNCA** adicionar assinaturas de AI (Co-Authored-By, etc.)

## Arquitetura

### Integração Hermes ↔ AionUI

```
AionUI (Electron + TypeScript)
  └── ACP (Agent Communication Protocol — stdio)
        └── Hermes Agent (Python CLI)
              ├── RAG (LanceDB)
              ├── SAC Bot (Flask)
              └── Knowledge Base (Method TEN)
```

## Validação

Antes de qualquer PR:
```bash
./scripts/validate.sh
```

## Fontes Validadas

- AionUI repo: https://github.com/iOfficeAI/AionUi
- Hermes Agent: `/home/alvarobiano/.local/bin/hermes`
- MiniMax API: https://api.minimaxi.com
