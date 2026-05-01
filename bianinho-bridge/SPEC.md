openapi: 3.0.3
info:
  title: BianinhoBridge API
  description: |
    Electron ↔ Hermes IPC bridge. 
    
    Comunicação via TCP (porta 18743) com o Python bridge subprocess.
    
    ## Autenticação
    - Opcional: HMAC token `{timestamp}.{sig}` no campo `token`
    - Gerado automaticamente pelo bridge: `POST /auth/token`
    
    ## Rate Limiting
    - 100 pedidos / minuto por client_id
    - Headers `X-RateLimit-*` na resposta
    
    ## Access Control (RAG)
    - `full`: Bianinho admin — tudo
    - `read_sac`: SAC Bot — só `sac_leads`  
    - `read_personal`: Álvaro — metodoten, livros, memoria, default, api, prd_collection
  version: 1.0.0
  contact:
    name: Álvaro
    email: alvaro@example.com

servers:
  - url: tcp://127.0.0.1:18743
    description: Local bridge server

paths:
  # ── System ───────────────────────────────────────────────────────────────

  /ping:
    post:
      operationId: ping
      summary: Health check
      description: Verifica se o bridge está ativo. Retorna pong.
      tags: [System]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: ping
                args:
                  type: object
                  properties:
                    echo:
                      type: string
                      description: Valor a ecoar (default: "pong")
                      default: "pong"
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PingResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /status:
    post:
      operationId: status
      summary: Bridge status
      description: Retorna estado do bridge (uptime, errors, rate limit hits, etc.)
      tags: [System]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: status
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StatusResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /platform_info:
    post:
      operationId: platformInfo
      summary: Platform info
      description: Retorna info do sistema operativo e Python
      tags: [System]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: platform_info
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PlatformInfoResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /check_hermes:
    post:
      operationId: checkHermes
      summary: Check Hermes installation
      description: Verifica se o Hermes está instalado e quais componentes existem
      tags: [System]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: check_hermes
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CheckHermesResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /list_skills:
    post:
      operationId: listSkills
      summary: List available skills
      description: Lista skills disponíveis no diretório do Hermes
      tags: [System]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: list_skills
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListSkillsResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── RAG ─────────────────────────────────────────────────────────────────

  /rag_search:
    post:
      operationId: ragSearch
      summary: Search RAG knowledge base
      description: |
        Pesquisa no RAG com access control.
        
        Access levels:
        - `full`: Bianinho admin (tudo)
        - `read_sac`: SAC Bot (só sac_leads)
        - `read_personal`: Álvaro (metodoten, livros, memoria, default, api, prd_collection)
        
        Usa LanceDB se disponível, senão fallback text search.
      tags: [RAG]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: rag_search
                args:
                  type: object
                  required: [query]
                  properties:
                    query:
                      type: string
                      minLength: 1
                      maxLength: 1000
                      description: Query de pesquisa
                    category:
                      type: string
                      description: Filtrar por categoria (opcional)
                    topK:
                      type: integer
                      minimum: 1
                      maximum: 100
                      default: 5
                      description: Número de resultados
                    score_threshold:
                      type: number
                      minimum: 0.0
                      maximum: 1.0
                      default: 0.3
                      description: Threshold de similaridade
                    access_level:
                      type: string
                      enum: [full, read_sac, read_personal]
                      default: full
                      description: Nível de acesso RAG
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RAGSearchResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /rag_stats:
    post:
      operationId: ragStats
      summary: RAG statistics
      description: Retorna estatísticas do RAG (categorias, total chunks)
      tags: [RAG]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: rag_stats
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RAGStatsResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /rag_backup:
    post:
      operationId: ragBackup
      summary: Create RAG backup
      description: Cria backup pre-write do RAG antes de modificações
      tags: [RAG]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: rag_backup
                args:
                  type: object
                  properties:
                    label:
                      type: string
                      default: manual
                      description: Label para identificar o backup
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RAGBackupResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /rag_restore:
    post:
      operationId: ragRestore
      summary: Restore RAG from backup
      description: Restaura RAG de um backup específico
      tags: [RAG]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: rag_restore
                args:
                  type: object
                  required: [backup_name]
                  properties:
                    backup_name:
                      type: string
                      description: Nome do backup a restaurar
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RAGRestoreResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /rag_list_backups:
    post:
      operationId: ragListBackups
      summary: List RAG backups
      description: Lista todos os backups disponíveis
      tags: [RAG]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: rag_list_backups
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RAGListBackupsResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── Inbox ─────────────────────────────────────────────────────────────────

  /inbox_list:
    post:
      operationId: inboxList
      summary: List inbox items
      description: Lista todos os items do inbox
      tags: [Inbox]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: inbox_list
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InboxListResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /inbox_add:
    post:
      operationId: inboxAdd
      summary: Add inbox item
      description: Adiciona novo item ao inbox
      tags: [Inbox]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: inbox_add
                args:
                  type: object
                  required: [content]
                  properties:
                    content:
                      type: string
                      minLength: 1
                      maxLength: 5000
                      description: Conteúdo do item
                    priority:
                      type: string
                      default: "3"
                      description: Prioridade (1=alta, 3=normal)
                    tags:
                      type: array
                      items:
                        type: string
                      default: []
                      description: Tags associadas
                    source:
                      type: string
                      default: "alvaro"
                      description: Fonte do item
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InboxAddResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /inbox_done:
    post:
      operationId: inboxDone
      summary: Mark inbox item as done
      description: Marca item do inbox como concluído
      tags: [Inbox]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: inbox_done
                args:
                  type: object
                  required: [id]
                  properties:
                    id:
                      type: string
                      description: ID do item
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InboxDoneResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /inbox_delete:
    post:
      operationId: inboxDelete
      summary: Delete inbox item
      description: Remove item do inbox
      tags: [Inbox]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: inbox_delete
                args:
                  type: object
                  required: [id]
                  properties:
                    id:
                      type: string
                      description: ID do item
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InboxDeleteResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── Skills ───────────────────────────────────────────────────────────────

  /skill_execute:
    post:
      operationId: skillExecute
      summary: Execute skill
      description: |
        Executa skill em subprocess isolado com resource limits.
        
        Permissões:
        - `safe`: execução livre
        - `sensitive`: terminal, file_write, github, cron_create
        - `dangerous`: file_delete, system_exec, kill_process, db_delete (requer confirmação UI)
        
        Resource limits:
        - CPU: 60s hard cap
        - RAM: 500MB max
        - Ficheiros abertos: 100 max
      tags: [Skills]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: skill_execute
                args:
                  type: object
                  required: [skill_name]
                  properties:
                    skill_name:
                      type: string
                      minLength: 1
                      description: Nome da skill
                    params:
                      type: object
                      default: {}
                      description: Parâmetros para a skill
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SkillExecuteResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /skill_validate:
    post:
      operationId: skillValidate
      summary: Validate skill
      description: Verifica se skill existe e retorna permissão e path
      tags: [Skills]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: skill_validate
                args:
                  type: object
                  required: [skill_name]
                  properties:
                    skill_name:
                      type: string
                      description: Nome da skill
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SkillValidateResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── Cycle ────────────────────────────────────────────────────────────────

  /cycle_status:
    post:
      operationId: cycleStatus
      summary: Get autonomous cycle status
      description: Retorna estado do ciclo autónomo do Hermes
      tags: [Cycle]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: cycle_status
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CycleStatusResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /cycle_trigger:
    post:
      operationId: cycleTrigger
      summary: Trigger autonomous cycle
      description: Força um ciclo autónomo manual
      tags: [Cycle]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: cycle_trigger
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CycleTriggerResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── Memory ───────────────────────────────────────────────────────────────

  /memory_get:
    post:
      operationId: memoryGet
      summary: Get memory value
      description: Lê valor de uma chave na memória do Hermes
      tags: [Memory]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: memory_get
                args:
                  type: object
                  properties:
                    key:
                      type: string
                      description: Chave a ler
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MemoryGetResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /memory_set:
    post:
      operationId: memorySet
      summary: Set memory value
      description: Escreve par key/value na memória do Hermes (com backup automático)
      tags: [Memory]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: memory_set
                args:
                  type: object
                  required: [key, value]
                  properties:
                    key:
                      type: string
                      description: Chave
                    value:
                      type: string
                      description: Valor
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MemorySetResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── Config ───────────────────────────────────────────────────────────────

  /config_get:
    post:
      operationId: configGet
      summary: Get config value
      description: Lê valor de config do Hermes
      tags: [Config]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: config_get
                args:
                  type: object
                  properties:
                    key:
                      type: string
                      description: Chave de config
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConfigGetResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /config_set:
    post:
      operationId: configSet
      summary: Set config value
      description: Escreve config do Hermes
      tags: [Config]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: config_set
                args:
                  type: object
                  required: [key, value]
                  properties:
                    key:
                      type: string
                      description: Chave
                    value:
                      type: string
                      description: Valor
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConfigSetResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  # ── Snapshot ─────────────────────────────────────────────────────────────

  /snapshot_export:
    post:
      operationId: snapshotExport
      summary: Export state snapshot
      description: Export encriptado do estado (inbox, memory, config)
      tags: [Snapshot]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: snapshot_export
                args:
                  type: object
                  properties:
                    path:
                      type: string
                      description: Path de destino (default: snapshot_export.json)
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SnapshotExportResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

  /snapshot_import:
    post:
      operationId: snapshotImport
      summary: Import state snapshot
      description: Import de snapshot (com backup automático antes de importar)
      tags: [Snapshot]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                cmd:
                  type: string
                  const: snapshot_import
                args:
                  type: object
                  required: [path]
                  properties:
                    path:
                      type: string
                      description: Path do ficheiro de snapshot
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SnapshotImportResponse'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'

components:
  schemas:
    # ── Base ──────────────────────────────────────────────────────────────

    Error:
      type: object
      properties:
        ok:
          type: boolean
          const: false
        error:
          type: string
          description: Mensagem de erro
        details:
          type: object
          description: Detalhes adicionais (ex: validation errors)

    # ── System ───────────────────────────────────────────────────────────

    PingResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        pong:
          type: string
          description: Valor ecoado
        platform:
          type: string
          description: Sistema operativo

    StatusResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        uptime:
          type: integer
          description: Tempo em segundos desde o início
        messages_processed:
          type: integer
        errors:
          type: integer
        last_error:
          type: [string, null]
        rate_limit_hits:
          type: integer
        auth_failures:
          type: integer
        platform:
          type: string
        hermes_path:
          type: string
        rag_path:
          type: [string, null]
        backup_dir:
          type: string

    PlatformInfoResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        system:
          type: string
          description: Sistema operativo (Linux, Darwin, Windows)
        release:
          type: string
          description: Versão do kernel
        machine:
          type: string
          description: Arquitetura (x86_64, arm64, etc)
        python:
          type: string
          description: Versão do Python

    CheckHermesResponse:
      type: object
      properties:
        ok:
          type: boolean
          description: true se todos os checks passarem
        checks:
          type: object
          properties:
            hermes_path:
              type: string
            exists:
              type: boolean
            config_yaml:
              type: boolean
            skills_dir:
              type: boolean
            sessions_db:
              type: boolean
            autonomous_dir:
              type: boolean

    ListSkillsResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        count:
          type: integer
        skills:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              size:
                type: integer
              type:
                type: string
                enum: [directory]

    # ── RAG ───────────────────────────────────────────────────────────────

    RAGSearchResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        query:
          type: string
        count:
          type: integer
        results:
          type: array
          items:
            type: object
            properties:
              text:
                type: string
              category:
                type: string
              score:
                type: number
        access_level:
          type: string
          enum: [full, read_sac, read_personal]
        fallback:
          type: boolean
          description: true se usou fallback (sem LanceDB)

    RAGStatsResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        stats:
          type: object
          properties:
            path:
              type: string
            exists:
              type: boolean
            categories:
              type: array
              items:
                type: object
                properties:
                  name:
                    type: string
                  count:
                    type: integer
            total_chunks:
              type: integer

    RAGBackupResponse:
      type: object
      properties:
        ok:
          type: boolean
        backup:
          type: string
          description: Nome do backup criado

    RAGRestoreResponse:
      type: object
      properties:
        ok:
          type: boolean
        backup:
          type: string
          description: Nome do backup restaurado

    RAGListBackupsResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        backups:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              size:
                type: integer
              modified:
                type: string
                format: date-time
              type:
                type: string

    # ── Inbox ─────────────────────────────────────────────────────────────

    InboxItem:
      type: object
      properties:
        id:
          type: string
        content:
          type: string
        priority:
          type: string
        tags:
          type: array
          items:
            type: string
        source:
          type: string
        done:
          type: boolean
        created_at:
          type: string
          format: date-time
        done_at:
          type: [string, null]
          format: date-time

    InboxListResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        count:
          type: integer
        items:
          type: array
          items:
            $ref: '#/components/schemas/InboxItem'

    InboxAddResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        item:
          $ref: '#/components/schemas/InboxItem'

    InboxDoneResponse:
      type: object
      properties:
        ok:
          type: boolean
        id:
          type: string

    InboxDeleteResponse:
      type: object
      properties:
        ok:
          type: boolean
        id:
          type: string

    # ── Skills ────────────────────────────────────────────────────────────

    SkillExecuteResponse:
      type: object
      properties:
        ok:
          type: boolean
        stdout:
          type: string
        stderr:
          type: string
        exit_code:
          type: integer
        skill:
          type: string
        permission:
          type: string
          enum: [safe, sensitive, dangerous]
        error:
          type: string
          description: Presente se houve erro

    SkillValidateResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        skill:
          type: string
        permission:
          type: string
          enum: [safe, sensitive, dangerous]
        path:
          type: string
        exists:
          type: boolean

    # ── Cycle ─────────────────────────────────────────────────────────────

    CycleStatusResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        cycle_file:
          type: string
        exists:
          type: boolean
        state:
          type: object
          description: Conteúdo do state.json do ciclo

    CycleTriggerResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        triggered_at:
          type: string
          format: date-time

    # ── Memory ────────────────────────────────────────────────────────────

    MemoryGetResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        key:
          type: string
        value:
          type: [string, null]

    MemorySetResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        key:
          type: string

    # ── Config ────────────────────────────────────────────────────────────

    ConfigGetResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        key:
          type: string
        value:
          type: [string, null]

    ConfigSetResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        key:
          type: string

    # ── Snapshot ──────────────────────────────────────────────────────────

    SnapshotExportResponse:
      type: object
      properties:
        ok:
          type: boolean
        path:
          type: string
        size:
          type: integer

    SnapshotImportResponse:
      type: object
      properties:
        ok:
          type: boolean
        imported:
          type: array
          items:
            type: string
          description: Lista de chaves importadas

  securitySchemes:
    BearerToken:
      type: apiKey
      in: header
      name: Authorization
      description: HMAC token opcional (formato: {timestamp}.{sig})

tags:
  - name: System
    description: Comandos de sistema
  - name: RAG
    description: Knowledge base RAG
  - name: Inbox
    description: Gestor de inbox
  - name: Skills
    description: Skills sandbox
  - name: Cycle
    description: Ciclo autónomo
  - name: Memory
    description: Memória persistente
  - name: Config
    description: Configuração
  - name: Snapshot
    description: Backup/Restore de estado
