---
name: siteten-admin-v2-state
description: Estado completo do SiteTen Admin V2 — módulos aprovados, bugs, workflow, Playwright
category: productivity
---

# SiteTen Admin V2 — Estado da Implementação

## Repositório
- **Path:** `~/repos/SiteTen/`
- **Branch principal:** `preview` (main recebe only versões aprovadas)
- **GitHub:** `AlvaroBiano/SiteTen`
- **Stack:** PHP + JSON (db.json) + Vanilla JS + Tailwind CSS CDN
- **Login admin:** Ficheiro `.pem` (chave privada RSA) + password `AeSm1979@#`
- **PHP server dev:** `cd ~/repos/SiteTen && php -S 0.0.0.0:8450`

## Módulos Aprovados

### Módulo 1 — Dashboard ✅
- **Commit:** `a20b52d`
- **Ficheiros:** `api/admin/dashboard.php`, `admin/index.html`, `admin/js/admin.js`
- **Funcionalidades:** Agregação de stats do db.json + LMS files, Charts via Chart.js (bar + doughnut)

### Módulo 2 — E-books ✅
- **Commit:** `a20b52d`
- **Funcionalidades:** CRUD completo, capa upload (base64 → `/api/data/covers/`), reorder drag&drop, destaque star, star rating
- **Img 404 approach:** `onerror` que substitui src por placeholder — **não usar modal**. Álvaro rejeitou modal ("ficou uma bosta").

### Módulo 3 — Planos ✅
- **Commits:** `c09ac6e` (parcial) → `5c72902` (is_popular+status) → `962ec03` (fix)
- **Ficheiros:** `admin/js/admin.js`, `api/crud.php`
- **Config Plans em admin.js (linha ~349):**
  - `headers`: ["Ordem", "Plano", "Preço", "Status", "Ações"]
  - `renderRow`: drag handle + nome + badge destaque⭐ + badge tipo selo + preço + badge status (Ativo/Inativo)
  - `fields`: name, price, price_period, original_price, per_student_info, button_text, button_link, **is_popular** (select), **status** (select), **badge_type** (select), popular_badge_text, **features** (features_list), valid_until
- **features_list:** Campo dinámico com `addFeatureItem()` + remoção via `onclick="this.closest('.group').remove()"`
- **Drag & Drop:** `handleDragStart/Over/Drop/End` para `ebooks` E `plans`. `savePlansOrder()` → POST `action=reorder`
- **API reorder (crud.php):** POST com `$_POST['action'] === 'reorder'` + `ordered_ids` JSON. Bug: `String()` → `(string)`
- **Teste:** 23/26 OK. 3 falhas não-críticas.

## Bugs Conhecidos
- **cloudflared:** `pkill -f cloudflared` para parar
- **ebooks 404 images:** `onerror` placeholder — **não modal**
- **addFeatureItem:** `insertBefore` pode falhar. Corrigido com `appendChild` fallback.
- **gh CLI:** Não funciona (TypeError). Usar **Python urllib** com token em `~/.netrc`

## Playwright — Como Testar
```javascript
const { chromium } = require('/home/alvarobiano/.hermes/hermes-agent/node_modules/playwright');
// Login
await page.goto('http://localhost:8450/admin/', { waitUntil: 'networkidle', timeout: 20000 });
await page.setInputFiles('input[type="file"]', '/home/alvarobiano/repos/SiteTen/api/security/private_key.pem');
await page.fill('input[type="password"]', 'AeSm1979@#');
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
// Tab Plans
await page.click('#tab-plans', { force: true });
await page.waitForTimeout(2000);
```

## Workflow de Desenvolvimento
1. Alterar em `admin/js/admin.js`, `api/crud.php`, etc.
2. `node --check` para validar sintaxe
3. Commit + `git push origin preview`
4. Testar com Playwright (php -S na porta 8450)
5. Se aprovado → merge para main (usuário controla)

## Próximo Módulo
- **Módulo 4:** Resultados (conforme `docs/PROJETO_ADMIN_V2.md`)

## Teste Plano (8 Camadas)
Só dizer **"OK Aprovado"** após passar:
1. **Funcional** — CRUD, toggle, drag
2. **Edge cases** — vazios, longos, especiais, duplicados, inválidos
3. **UI/UX** — desktop/tablet/mobile, modais, toasts, scroll
4. **API** — 200, 400, 401, 404, 500
5. **Persistência** — dado em db.json após reload
6. **E2E** — fluxo completo criar/editar/excluir
7. **Segurança** — CSRF, XSS, auth
8. **Performance** — < 2s para tabs, < 500ms para ações

## Ficheiros Chave
- `~/repos/SiteTen/admin/js/admin.js` — Controlador JS (1.553 linhas)
- `~/repos/SiteTen/api/crud.php` — API CRUD (274 linhas)
- `~/repos/SiteTen/api/admin/dashboard.php` — Stats aggregation
- `~/repos/SiteTen/api/ebooks.php` — Upload capa, reorder
- `~/repos/SiteTen/data/db.json` — Base de dados
- `~/repos/SiteTen/admin/index.html` — HTML admin panel
