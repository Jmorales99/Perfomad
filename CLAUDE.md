# Claude / agente — contexto del proyecto Perfomad (backend)

Este documento alinea al agente con el repositorio. Las reglas canónicas viven en `.cursor/rules/*.mdc`; si hay conflicto, prevalece el código y esas reglas.

## Qué es este repo

- **SaaS multi-empresa** para gestionar campañas publicitarias en Meta, Google Ads y TikTok.
- **Backend** Node.js + **TypeScript** + **Fastify 5** (ESM: `package.json` tiene `"type": "module"`).
- **Supabase** (Postgres + auth + storage) vía `@supabase/supabase-js`; claves sensibles solo en servidor.
- **Inyección de dependencias**: manual en controllers (tsyringe está instalado pero no se usa con decoradores automáticos; los use cases reciben dependencias vía constructor).
- **Validación de configuración**: `zod` en `src/config/env.ts`.
- Integraciones de anuncios: **Meta**, **Google Ads**, **TikTok** (OAuth y APIs) bajo `src/infrastructure/integrations/platforms/`.
- **IA**: Anthropic SDK (`@anthropic-ai/sdk`) en `src/infrastructure/integrations/llm/ClaudeClient.ts` para optimización de campañas.
- Variables de entorno de referencia: `.env.example`.

## Entrypoint y capa HTTP

- Arranque: `src/index.ts` → `buildServer()` desde `@/interfaces/http/server.js`.
- **Una sola capa HTTP**: `src/interfaces/http/` (`server.ts`, `routes/`, `controllers/`, `plugins/`, etc.).
- Rutas registradas en `src/interfaces/http/routes/index.ts` (usuarios, perfil, clientes, campañas, imágenes, plataformas, dashboard, …).

## Arquitectura por capas (obligatorio)

| Capa | Ruta | Rol |
|------|------|-----|
| Interfaces (HTTP) | `src/interfaces/http/` | Validar entrada, llamar use case, mapear respuestas HTTP / errores |
| Application | `src/application/usecases/` | Lógica de negocio; solo interfaces (repos, integraciones), **no** implementaciones Supabase directas |
| Domain | `src/domain/` | Contratos (repositorios, tipos de dominio, etc.) |
| Infrastructure | `src/infrastructure/` | Repos Supabase, seguridad (state, cifrado, rate limit), integraciones externas |

**Flujo**: Controller → Use case → Repository (interface) ← implementación en infra.

## Multi-empresa / segmentación

- Los datos de negocio se segmentan por **`(user_id, client_id)`**.
- Endpoints que crean o leen cuentas publicitarias y campañas deben **aceptar o resolver `client_id`** de forma consistente.
- **OAuth**: el `state` debe incluir `client_id`; el callback debe usar ese `client_id` al persistir tokens y `ad_accounts`.

## Seguridad (no negociable)

- **Nunca** devolver al cliente ni loguear: `access_token` / `refresh_token`, `Authorization`, cookies de sesión, `SUPABASE_SERVICE_ROLE_KEY` / secret keys.
- Refresh tokens: almacenar **cifrados** (p. ej. AES-256-GCM) con `TOKEN_ENCRYPTION_KEY` en env.
- **Callback OAuth** (público): validar `state` (existe, `used=false`, no expirado, `platform` coincide con la ruta); marcar `used=true` lo antes posible; si el exchange falla, **no** revertir `used`. Redirección al front solo con params genéricos (`connect=success` | `connect=error&message=...`), sin tokens ni errores crudos.
- **Storage**: sin policies abiertas; paths bajo `user_<uid>` o `client_<id>` según corresponda.

## TypeScript, estilo y módulos

- **ESM** en `src/`: solo `import`/`export`; no `require()`.
- Alias **`@/*`** → `./src/*`; el build usa `tsc` + `tsc-alias` (ver `package.json` scripts).
- Nombres sugeridos: `*.routes.ts`, `*.controller.ts`, `*.plugin.ts`, `*.middleware.ts`, `*.repository.ts`, casos de uso en carpetas claras bajo `usecases/`.
- Tipos explícitos en límites (HTTP, filas DB, integraciones). Evitar `any` salvo aislamiento y justificación breve.
- Errores de dominio mapeados a HTTP en controllers.

## Cambios y compatibilidad

- Cambios **pequeños e incrementales**; no romper endpoints existentes (paths, cuerpos, códigos de estado) sin acuerdo explícito.
- **Esquema DB**: asumir migraciones ya aplicadas en el entorno objetivo; no “reinventar” migraciones salvo tarea explícita. Nuevas migraciones en `database/migrations/` si el trabajo lo pide.
- No añadir dependencias sin necesidad; si se añade, justificar en el PR/commit.
- Antes de mover archivos grandes: buscar referencias y actualizar imports.

## Comandos útiles

```bash
npm run dev          # tsx watch src/index.ts
npm run build        # tsc + tsc-alias
npm run start        # node dist/index.js
npm run lint         # eslint src
npm run lint:fix
npm run format       # prettier
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
```

Si el agente no puede ejecutar lint/typecheck/tests en el entorno actual, debe **decirlo** y dejar estos comandos para verificación local.

## Inyección de dependencias (patrón real)

El patrón es **manual**: cada controller instancia los use cases y repos concretos directamente en el constructor o en el scope del handler. No hay decoradores `@injectable()` ni container de tsyringe en uso activo. Ejemplo:

```typescript
// Dentro del controller o handler
const repo = new SupabaseClientsRepository()
const useCase = new CreateClient(repo)
const result = await useCase.execute(userId, body)
```

No añadir tsyringe automático sin discutirlo.

## Flujo OAuth completo (con client_id)

1. **POST `/v1/platforms/:platform/connect-link`** (auth)  
   - Body: `{ clientId, redirectUri? }`  
   - `CreateConnectionLink` valida que `clientId` pertenezca al usuario, genera `state`, persiste en `oauth_states` (`user_id`, `client_id`, `platform`, `redirect_uri`, `expires_at`, `used=false`).  
   - Devuelve `{ url }` (URL de OAuth del proveedor).

2. **GET `/v1/platforms/:platform/callback`** (público)  
   - Query: `code`, `state`.  
   - `HandleOAuthCallback`: valida state → marca `used=true` → intercambia `code` → upsert `ad_accounts(user_id, client_id, platform, platform_account_id)` → redirige al front con `?connect=success` o `?connect=error&message=...`.  
   - `returnToUrl` viene de `oauth_states.redirect_uri` (guardado en el state).

3. **POST `/v1/platforms/:platform/sync-accounts`** (auth)  
   - Body: `{ clientId }` — sincroniza cuentas ya conectadas para ese client.

### TikTok: flujo especial (dos pasos)

TikTok requiere un paso extra de selección de advertiser después del callback inicial:

1. Callback TikTok → el `platform_account_id` se marca como `TIKTOK_PENDING_PLATFORM_ACCOUNT_ID` (constante en `src/domain/tiktok/TikTokConnection.ts`).
2. **GET `/v1/platforms/tiktok/advertisers`** — lista los advertisers disponibles para la cuenta.
3. **POST `/v1/platforms/tiktok/advertisers/select`** — el usuario elige un advertiser; se actualiza `platform_account_id` en `ad_accounts`.
4. **DELETE `/v1/platforms/tiktok/disconnect`** — desconecta la cuenta TikTok.

## Base de datos (tablas principales, Supabase/Postgres)

Todas las tablas clave tienen `user_id` (UUID, FK a auth.users). Las de negocio también tienen `client_id`.

| Tabla | Columnas clave | Notas |
|-------|---------------|-------|
| `profiles` | `id`, `user_id`, `email`, `subscription_status` | Perfil del usuario |
| `clients` | `id`, `user_id`, `name`, `description` | Empresas internas; unicidad `(user_id, name)` |
| `ad_accounts` | `id`, `user_id`, `client_id`, `platform`, `platform_account_id`, `access_token_encrypted`, `refresh_token_encrypted`, `status` | Unicidad `(user_id, client_id, platform, platform_account_id)` |
| `campaigns` | `id`, `user_id`, `client_id`, `name`, `platform`, `platform_campaign_id`, `status`, `budget`, `start_date`, `end_date` | |
| `oauth_states` | `id`, `state`, `user_id`, `client_id`, `platform`, `redirect_uri`, `expires_at`, `used` | One-time; expira |
| `campaign_metrics_history` | `id`, `campaign_id`, `date`, `impressions`, `clicks`, `spend`, `conversions` | Histórico de métricas |
| `dashboard_snapshots` | `id`, `user_id`, `client_id`, `snapshot_date`, `data` | Snapshots para dashboard |
| `optimization_runs` | `id`, `campaign_id`, `user_id`, `created_at`, `status` | Runs de análisis AI |
| `optimization_recommendations` | `id`, `run_id`, `type`, `description`, `impact_score` | Recomendaciones de Claude |
| `optimization_decisions` | `id`, `recommendation_id`, `decision`, `applied_at` | Aceptar/rechazar recomendaciones |
| `optimization_config` | `id`, `user_id`, `client_id`, `config` | Configuración por cliente |
| `benchmarks` | `id`, `platform`, `industry`, `metric`, `value` | Benchmarks para comparar campañas |

**Migraciones activas** en `database/migrations/001–009_*.sql`.

## Optimización AI (Claude/Anthropic)

El flujo de optimización usa Claude AI vía Anthropic SDK:

- **`BuildOptimizationInput`** — recopila datos de la campaña, métricas históricas y benchmarks del sector.
- **`AnalyzeCampaignOptimization`** — llama a `ClaudeClient` con el input estructurado y el system prompt (`src/application/usecases/optimization/schemas/systemPrompt.ts`). Retorna recomendaciones tipadas por `OptimizationOutput`.
- **`ApplyOptimizationRecommendation`** — persiste la decisión (accept/reject) y aplica cambios si es accept.
- **`GetLatestRecommendations`** / **`ListOptimizationRuns`** — consulta historial.
- Config: `ANTHROPIC_API_KEY` y `ANTHROPIC_MODEL` en env (ver `src/config/env.ts`).

Endpoints:
- `POST /campaigns/:id/optimize/analyze`
- `POST /campaigns/:id/optimize/apply`
- `GET  /campaigns/:id/optimize/runs`
- `GET  /campaigns/:id/optimize/recommendations/latest`

## Sistema de suscripciones

- `ActivateSubscription` use case activa la suscripción del usuario (actualiza `profiles.subscription_status`).
- El middleware `verifySubscription` (`src/infrastructure/auth/verifySubscription.ts`) comprueba que el usuario tenga suscripción activa antes de acceder a rutas protegidas.

## Clientes (empresas internas)

Un usuario puede tener varias empresas internas (`clients`). Si el usuario no tiene ningún client, `ListClientsWithDefault` crea uno con nombre "Default" automáticamente vía `upsertDefault`.

Regla de negocio: no se puede eliminar el último client (`DeleteClient` lanza error si `countByUser === 1`).

## Dashboard y métricas

- `GetConsolidatedDashboard` — agrega métricas de todas las campañas del usuario/client.
- `SyncDashboardData` — crea o actualiza snapshots en `dashboard_snapshots`.
- `GetDashboardMetrics` / `GetCampaignInsights` — calculados vía `MetricsCalculator` service.
- `SyncCampaignBudgetFromPlatform` — actualiza el presupuesto de una campaña tomando la plataforma como fuente de verdad.

## Plan de refactor (estado actual)

Ver `.cursor/rules/40-refactor-plan.mdc`. Estado a fecha de última revisión:

| Paso | Estado | Detalle |
|------|--------|---------|
| 1. Auditoría entrypoint | ✅ Hecho | |
| 2. `client_id` en OAuth/repos | ✅ Hecho | |
| 3. Endpoints clients | ✅ Hecho | |
| 4. Consolidar HTTP (`src/interfaces/http`) | ✅ Hecho | `src/app/` aún existe con restos (`plugins/`, `routes/profileRoutes.ts`) — **pendiente eliminar** |
| 5. Mover integrations → `infrastructure/integrations` | ✅ Hecho | Algunos imports en use cases aún apuntan al path antiguo `infrastructure/services` — **pendiente corregir** |
| 6. Limpieza debug/test files fuera de `src/` | ⏳ Pendiente | Verificar que no quedan `*_DEBUG.ts` / `*_TEST*.ts` en `src/` |
| 7. `npm run lint` + `npm run typecheck` | ⏳ Pendiente | Ejecutar y corregir errores antes de merging |

### Cambios en curso (unstaged al momento de esta revisión)

- `src/config/env.ts` — vars de plataforma completas (Meta, Google Ads, TikTok), `ANTHROPIC_API_KEY`, fix de `dotenv.config({ path: rootDir })`.
- `src/application/usecases/adaccounts/*.ts` — corrección de import paths (`infrastructure/services` → `infrastructure/integrations`).
- `src/application/usecases/campaigns/*.ts` — idem.
- `src/domain/repositories/ClientsRepository.ts` — añadir `upsertDefault`, `countByUser`, `deleteById`.
- `src/infrastructure/repositories/SupabaseClientsRepository.ts` — implementar métodos nuevos.
- `src/infrastructure/repositories/SupabaseAdAccountsRepository.ts`, `SupabaseCampaignsRepository.ts` — cambios relacionados.
- `src/application/usecases/adaccounts/HandleOAuthCallback.ts` — `returnToUrl` en respuesta; validación mejorada de platform mismatch; TikTok special handling.

## Cómo mantener alineación Cursor ↔ Claude

- Al cambiar convenciones del proyecto, actualizar **este archivo** y los **`.mdc`** en `.cursor/rules/` en el mismo PR cuando aplique.
- El agente debe **leer** el código cercano antes de editar y respetar patrones existentes (imports, DI, nombres).
- El archivo `docs/ARCHITECTURE.md` tiene detalle adicional del flujo OAuth con `client_id`.
