# Perfomad backend — contexto para el agente

Reglas canónicas en `.cursor/rules/*.mdc`. Leerlas solo si la tarea lo requiere.

## Estilo de respuesta (obligatorio)

- Respuestas directas y cortas. Sin frases de relleno ("perfecto", "claro que sí", "gran pregunta").
- Si la tarea es simple: solución directamente.
- Si requiere varios pasos: plan breve antes de tocar código.
- No sobreexplicar salvo que se pida.
- No generar documentación adicional salvo que se solicite.
- No proponer refactors grandes si el usuario pidió un cambio puntual.
- Indicar archivos afectados y motivo concreto al proponer cambios.
- No repetir contexto del proyecto salvo que sea necesario para justificar una decisión técnica.
- Sin comentarios en el código salvo que el WHY sea no obvio.

## Stack

- Node.js + TypeScript + Fastify 5 (ESM, `"type": "module"`).
- Supabase (Postgres + auth + storage).
- Integraciones: Meta, Google Ads, TikTok bajo `src/infrastructure/integrations/platforms/`.
- IA: Anthropic SDK en `src/infrastructure/integrations/llm/ClaudeClient.ts`.
- Config/env: `zod` en `src/config/env.ts`. Referencia: `.env.example`.

## Arquitectura por capas

| Capa | Ruta | Rol |
|------|------|-----|
| Interfaces (HTTP) | `src/interfaces/http/` | Validar entrada, llamar use case, mapear errores HTTP |
| Application | `src/application/usecases/` | Lógica de negocio; solo interfaces, no Supabase directo |
| Domain | `src/domain/` | Contratos (repos, tipos) |
| Infrastructure | `src/infrastructure/` | Repos Supabase, integraciones externas, seguridad |

Flujo: Controller → Use case → Repository interface ← implementación infra.

Entrypoint: `src/index.ts` → `buildServer()` en `src/interfaces/http/server.ts`.  
Rutas: `src/interfaces/http/routes/index.ts`.

## DI (patrón real)

Manual. El controller instancia repos y use cases directamente:

```typescript
const repo = new SupabaseClientsRepository()
const useCase = new CreateClient(repo)
const result = await useCase.execute(userId, body)
```

No añadir tsyringe automático sin discutirlo.

## Multi-empresa

Datos segmentados por `(user_id, client_id)`. Endpoints de campañas y ad accounts deben aceptar/resolver `client_id`. El OAuth `state` debe incluir `client_id`.

## Seguridad (no negociable)

- Nunca exponer ni loguear: tokens, `Authorization`, cookies, `SUPABASE_SERVICE_ROLE_KEY`.
- Refresh tokens cifrados con AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
- Callback OAuth (público): validar state (existe, `used=false`, no expirado, platform coincide) → marcar `used=true` inmediatamente → si el exchange falla, no revertir `used`. Redirigir al front solo con `connect=success` o `connect=error&message=...`.
- Storage: paths bajo `user_<uid>` o `client_<id>`.

## TypeScript / módulos

- Solo `import`/`export` (ESM). Sin `require()`.
- Alias `@/*` → `./src/*`.
- Tipos explícitos en límites (HTTP, DB, integraciones). Evitar `any`.
- Errores de dominio mapeados a HTTP en controllers.

## DB (tablas principales)

Todas tienen `user_id`. Las de negocio también `client_id`.

| Tabla | Columnas clave |
|-------|---------------|
| `profiles` | `id`, `email`, `name`, `has_active_subscription`, `subscription_start`, `subscription_expires`, `has_completed_onboarding` |
| `clients` | `id`, `user_id`, `name`, `description` — unicidad `(user_id, name)` |
| `ad_accounts` | `id`, `user_id`, `client_id`, `platform`, `platform_account_id`, tokens cifrados (iv+tag), `connection_status` |
| `campaigns` | `id`, `user_id`, `client_id`, `name`, `platforms[]`, `platform_campaign_id` (JSONB), `status`, `budget_usd`, `start_date`, `end_date` |
| `oauth_states` | `state`, `user_id`, `client_id`, `platform`, `redirect_uri`, `expires_at`, `used` |
| `campaign_metrics_history` | `campaign_id`, `platform`, `recorded_at`, métricas |
| `campaign_insights` | `campaign_id`, `insights_data`, `recommendations`, `is_stale` |
| `dashboard_snapshots` | `user_id`, `client_id`, `platform`, `ad_account_id`, `account_metrics`, `synced_at` |
| `multichannel_campaigns` | `user_id`, `client_id`, `name`, `status`, `platforms[]`, `total_budget_usd` |
| `optimization_runs/recommendations/decisions/executions/config` | Flujo AI |

Migraciones en `database/migrations/`.

## OAuth

1. `POST /v1/platforms/:platform/connect-link` — genera state, devuelve `{ url }`.
2. `GET /v1/platforms/:platform/callback` — valida state → marca `used=true` → intercambia code → upsert `ad_accounts` → redirige al front.
3. `POST /v1/platforms/:platform/sync-accounts` — sincroniza cuentas conectadas.

**TikTok (flujo extra):** callback → `platform_account_id = TIKTOK_PENDING_PLATFORM_ACCOUNT_ID` → `GET /tiktok/advertisers` → `POST /tiktok/advertisers/select` → actualiza `platform_account_id`.

## Cambios y compatibilidad

- Cambios pequeños e incrementales. No romper endpoints sin acuerdo.
- Migraciones DB en `database/migrations/` si el trabajo lo requiere.
- No añadir dependencias sin necesidad.
- Antes de mover archivos: buscar referencias y actualizar imports.

## Comandos

```bash
npm run dev        # tsx watch src/index.ts
npm run build      # tsc + tsc-alias
npm run lint       # eslint src
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
```

Si no se puede ejecutar lint/typecheck/tests en el entorno, decirlo y dejar para verificación local.
