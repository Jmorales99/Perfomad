# Auditoría de Seguridad — Perfomad API

> Generado: 2026-04-23 | Rama: main | Endpoints analizados: ~60

---

## 1. Mapa completo de endpoints

### Leyenda de auth
- ✅ `verifyUser` — requiere JWT válido de Supabase
- ✅✅ `verifyUser+Sub` — requiere JWT + suscripción activa
- ❌ Público — sin autenticación (correcto por diseño)

---

### Auth (`/v1/auth`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| POST | `/v1/auth/signup` | ❌ Público | ✅ OK |
| POST | `/v1/auth/login` | ❌ Público | ✅ OK |

> Rate limiting aplicado por Supabase Auth. Sin problemas detectados.

---

### Raíz / Docs

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| GET | `/` | ❌ Público | ✅ OK |
| GET | `/docs` | ❌ Público | 🟡 Swagger expuesto en producción |

> **Acción**: Restringir `/docs` en `NODE_ENV=production` con un preHandler que devuelva 404.

---

### Perfil (`/v1/profile` y `/v1/users`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| GET | `/v1/profile/` | ✅ verifyUser | ✅ OK |
| PATCH | `/v1/profile/` | ✅ verifyUser | ✅ OK |
| PATCH | `/v1/profile/onboarding` | ✅ verifyUser | ✅ OK |
| GET | `/v1/users/` | ✅ verifyUser | 🟡 Duplica `/profile` |
| PATCH | `/v1/users/` | ✅ verifyUser | 🟡 Duplica `/profile` |
| PATCH | `/v1/users/onboarding` | ✅ verifyUser | 🟡 Duplica `/profile` |

> **Acción**: Eliminar `userRoutes.ts` o redirigir a `/profile`. Superficie de ataque doble innecesaria.

---

### Clientes (`/v1/clients`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| GET | `/v1/clients/` | ✅ verifyUser | ✅ OK |
| POST | `/v1/clients/` | ✅ verifyUser | ✅ OK |
| GET | `/v1/clients/:id` | ✅ verifyUser | ✅ OK |
| DELETE | `/v1/clients/:id` | ✅ verifyUser | ✅ OK |
| POST | `/v1/clients/:id/sync` | ✅✅ verifyUser+Sub | 🟠 Sin rate limit |

> **Acción**: Agregar rate limit a `POST /clients/:id/sync` (llama APIs externas múltiples veces).

---

### Campañas (`/v1/campaigns`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| GET | `/v1/campaigns` | ✅ verifyUser | 🟡 `client_id` sin validar ownership explícito |
| GET | `/v1/campaigns/can-create` | ✅✅ verifyUser+Sub | ✅ OK |
| POST | `/v1/campaigns` | ✅✅ verifyUser+Sub | ✅ OK (rate limit: 5/min) |
| GET | `/v1/campaigns/by-platform-id` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id/overview` | ✅ verifyUser | ✅ OK |
| POST | `/v1/campaigns/:id/sync` | ✅✅ verifyUser+Sub | ✅ OK |
| PATCH | `/v1/campaigns/:id` | ✅✅ verifyUser+Sub | ✅ OK |
| DELETE | `/v1/campaigns/:id` | ✅✅ verifyUser+Sub | ✅ OK |
| GET | `/v1/campaigns/:id/insights` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id/sales-history` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id/adsets` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id/adsets/:id/ads` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id/optimize/runs` | ✅ verifyUser | ✅ OK |
| GET | `/v1/campaigns/:id/optimize/recommendations/latest` | ✅ verifyUser | ✅ OK |
| POST | `/v1/campaigns/:id/optimize/analyze` | ✅✅ verifyUser+Sub | ✅ OK |
| POST | `/v1/campaigns/:id/optimize/apply` | ✅✅ verifyUser+Sub | ✅ OK |
| POST | `/v1/campaigns/:id/budget/sync-from-platform` | ✅✅ verifyUser+Sub | ✅ OK |

---

### Dashboard (`/v1/dashboard`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| GET | `/v1/dashboard/metrics` | ✅ verifyUser | 🟡 `client_id` sin validar ownership explícito |
| GET | `/v1/dashboard/platform-summary` | ✅ verifyUser | ✅ OK |
| GET | `/v1/dashboard/sales-history` | ✅ verifyUser | 🟡 `client_id` sin validar ownership explícito |
| GET | `/v1/dashboard/consolidated` | ✅ verifyUser | ✅ OK |
| POST | `/v1/dashboard/sync` | ✅ verifyUser | 🟠 Sin rate limit, llama APIs externas |

---

### Imágenes (`/v1/images`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| POST | `/v1/images/upload-url` | ✅ verifyUser | ✅ OK |
| GET | `/v1/images` | ✅ verifyUser | ✅ OK |
| DELETE | `/v1/images/:filename` | ✅ verifyUser | ✅ OK |

---

### Plataformas (`/v1/platforms`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| POST | `/v1/platforms/:platform/connect-link` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/:platform/callback` | ❌ Público | ✅ OK (valida state en DB) |
| POST | `/v1/platforms/:platform/sync-accounts` | ✅ verifyUser | 🟠 Sin rate limit |
| POST | `/v1/platforms/:platform/sync-campaigns` | ✅ verifyUser | 🟠 Sin rate limit |
| POST | `/v1/platforms/:platform/campaigns/:id/import` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/:platform/metrics` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/:platform/insights` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/:platform/accounts` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/:platform/campaigns` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/:platform/campaigns/:id/ads` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/summary` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/meta/pages` | ✅ verifyUser | ✅ OK |
| GET | `/v1/platforms/tiktok/advertisers` | ✅ verifyUser | ✅ OK |
| POST | `/v1/platforms/tiktok/select-advertiser` | ✅ verifyUser | ✅ OK |
| POST | `/v1/platforms/tiktok/disconnect` | ✅ verifyUser | ✅ OK |

---

### Campañas multicanal (`/v1/multichannel-campaigns`)

| Método | Path | Auth | Riesgo |
|--------|------|------|--------|
| POST | `/v1/multichannel-campaigns/` | ✅✅ verifyUser+Sub | ✅ OK |
| GET | `/v1/multichannel-campaigns/` | ✅ verifyUser | ✅ OK |
| GET | `/v1/multichannel-campaigns/:id` | ✅ verifyUser | ✅ OK |
| PATCH | `/v1/multichannel-campaigns/:id/status` | ✅✅ verifyUser+Sub | ✅ OK |
| PATCH | `/v1/multichannel-campaigns/:id/platforms/:p/status` | ✅✅ verifyUser+Sub | ✅ OK |
| GET | `/v1/multichannel-campaigns/:id/metrics` | ✅ verifyUser | ✅ OK |
| GET | `/v1/multichannel-campaigns/:id/optimize/runs` | ✅ verifyUser | ✅ OK |
| GET | `/v1/multichannel-campaigns/:id/optimize/recommendations/latest` | ✅ verifyUser | ✅ OK |
| POST | `/v1/multichannel-campaigns/:id/optimize/analyze` | ✅✅ verifyUser+Sub | ✅ OK |
| POST | `/v1/multichannel-campaigns/:id/optimize/apply` | ✅✅ verifyUser+Sub | ✅ OK |

---

## 2. Análisis de mecanismos de seguridad

### 2.1 Autenticación JWT
- **Implementación**: `src/infrastructure/auth/verifyUser.ts`
- **Mecanismo**: `supabaseAdmin.auth.getUser(token)` — Supabase Admin SDK verifica el token server-side
- **Flujo**: Frontend envía `Authorization: Bearer <supabase_access_token>` → backend lo valida contra Supabase → obtiene `user.id` confiable
- **Fortaleza**: No se confía en claims del JWT sin verificar; Supabase maneja la firma y expiración
- **Limitación**: No hay mecanismo de revocación anticipada (el token es válido hasta que expire)

### 2.2 Control de suscripción
- **Implementación**: `src/infrastructure/auth/verifySubscription.ts`
- **Mecanismo**: Comprueba `profiles.has_active_subscription` + `subscription_expires` en DB
- **Auto-actualización**: Si la fecha expiró, actualiza `has_active_subscription = false` automáticamente
- **Endpoints protegidos**: todas las operaciones de escritura costosas (create/update/delete campaña, optimize, sync)

### 2.3 Tokens OAuth cifrados en reposo
- **Implementación**: `src/infrastructure/security/CryptoService.ts` + `src/infrastructure/integrations/TokenManager.ts`
- **Algoritmo**: AES-256-GCM (cifrado autenticado)
- **IV**: 16 bytes aleatorios generados por cifrado (nunca se reutiliza)
- **AAD**: `account_id` vincula el token a la cuenta específica (evita mover tokens entre cuentas)
- **Auth tag**: 16 bytes GCM detectan cualquier manipulación del ciphertext
- **Columnas DB**: `access_token`, `access_token_iv`, `access_token_tag`, `refresh_token`, `refresh_token_iv`, `refresh_token_tag`
- **Clave maestra**: `TOKEN_ENCRYPTION_KEY` (env, base64, 32 bytes)
- **Limitación**: clave única sin rotación ni versionado

### 2.4 Protección CSRF en OAuth (state)
- **Implementación**: `src/infrastructure/security/StateManager.ts`
- **State**: 32 bytes aleatorios (CSPRNG), base64url
- **TTL**: 10 minutos
- **Validaciones en callback**: state existe en DB + no expirado + `used=false` + `platform` coincide con la ruta
- **Anti-replay**: `used=true` se marca **antes** de intercambiar el code OAuth
- **Open redirect**: `sanitizeReturnTo()` en `PlatformsController` valida que la URL de retorno tenga el mismo origen que `FRONTEND_URL`

### 2.5 Ownership de datos
- **Por `user_id`**: todos los repos filtran por `user_id` en reads y writes (Supabase Admin omite RLS, la seguridad es en código)
- **Por `client_id`**: validado en CreateConnectionLink, CreateCampaign, ImportPlatformCampaign
- **Excepción encontrada y corregida**: `markConnectionStatus()` — ver sección 3.1

### 2.6 Rate limiting
- **Implementación**: `src/infrastructure/security/RateLimiter.ts` + `@fastify/rate-limit`
- **Aplicado en**: `POST /campaigns` (5 req/min por IP)
- **Definidos pero poco usados**: límites por user y por IP en `RateLimiter.ts`
- **Limitación crítica**: almacenamiento en memoria (Map) — se pierde en restart, no escala horizontalmente

### 2.7 Security headers
- **Helmet**: HSTS (1 año + subdomains), X-Frame-Options: DENY, X-Content-Type-Options, Referrer-Policy
- **CSP**: presente pero `unsafe-inline` y `unsafe-eval` habilitados (reduce efectividad anti-XSS)
- **CORS**: restringido a `FRONTEND_URL` + `localhost:5173`; `credentials: true`

### 2.8 Audit logging
- **Implementación**: `src/infrastructure/security/AuditLogger.ts`
- **Eventos**: OAuth callbacks, token refresh, token access, platform API calls
- **Sanitización**: elimina tokens, passwords, secrets, OAuth codes del log
- **Limitación**: solo `console.log` — no persiste en DB

---

## 3. Vulnerabilidades por severidad

### 🔴 CRÍTICA — `markConnectionStatus()` sin `user_id` (CORREGIDA)

**Archivo**: `src/infrastructure/repositories/SupabaseAdAccountsRepository.ts:123`

**Problema anterior**:
```typescript
.update({ connection_status: status })
.eq("id", adAccountId)  // cualquier UUID válido, sin verificar owner
```

**Fix aplicado**: firma actualizada a `markConnectionStatus(userId, adAccountId, status)` con `.eq("user_id", userId)` en la query.

**Archivos modificados**:
- `src/domain/repositories/AdAccountsRepository.ts` — interfaz
- `src/infrastructure/repositories/SupabaseAdAccountsRepository.ts` — implementación
- `src/application/usecases/adaccounts/SyncConnectedAccounts.ts` — caller
- `src/application/usecases/campaigns/SyncCampaignMetrics.ts` — caller
- `src/application/usecases/campaigns/ImportPlatformCampaign.ts` — caller

---

### 🟠 ALTA — Sin rate limit en endpoints de sync

**Endpoints afectados**:
- `POST /v1/clients/:id/sync`
- `POST /v1/platforms/:platform/sync-accounts`
- `POST /v1/platforms/:platform/sync-campaigns`
- `POST /v1/dashboard/sync`

**Riesgo**: cada llamada dispara múltiples requests a APIs de plataformas (Meta, Google, TikTok). Un usuario malicioso puede agotar la cuota de la plataforma en segundos.

**Fix recomendado**:
```typescript
// En la ruta de sync
{
  config: { rateLimit: { max: 3, timeWindow: '1 minute' } }
}
```

---

### 🟠 ALTA — Swagger (`/docs`) público en producción

**Riesgo**: expone paths, parámetros, esquemas de request/response a cualquier persona.

**Fix recomendado**:
```typescript
// En server.ts, al registrar swagger-ui
if (process.env.NODE_ENV === 'production') {
  app.get('/docs', async (_, reply) => reply.code(404).send())
  app.get('/docs/*', async (_, reply) => reply.code(404).send())
}
```

---

### 🟡 MEDIA — Rate limiting solo en memoria

**Archivo**: `src/infrastructure/security/RateLimiter.ts`

**Riesgo**: los límites se resetean en cada restart del servidor y no funcionan con múltiples instancias.

**Fix recomendado**: migrar a `@fastify/rate-limit` con store de Redis:
```typescript
import Redis from 'ioredis'
const redis = new Redis(process.env.REDIS_URL)
app.register(rateLimit, { redis, global: false })
```

---

### 🟡 MEDIA — `client_id` en queries de lista sin validación explícita

**Endpoints**: `GET /campaigns?client_id=`, `GET /dashboard/metrics?client_id=`, `GET /dashboard/sales-history?client_id=`

**Situación actual**: los repos filtran por `(user_id, client_id)` — si el `client_id` es ajeno, devuelven lista vacía. No hay fuga de datos, pero tampoco se registra el intento.

**Fix recomendado**:
```typescript
if (client_id) {
  const client = await clientsRepo.getById(user.id, client_id)
  if (!client) {
    auditLogger.logSecurityEvent('invalid_client_access', { userId: user.id, client_id })
    return reply.code(403).send({ error: 'Forbidden' })
  }
}
```

---

### 🟡 MEDIA — Rutas `/profile` y `/users` duplicadas

**Riesgo**: doble superficie de ataque. Si se parchea un bug de seguridad en `/profile` y se olvida `/users`, el bug sigue expuesto.

**Fix recomendado**: eliminar `userRoutes.ts` o hacer que redirija a `/v1/profile`.

---

### 🟡 MEDIA — Audit log sin persistencia en DB

**Archivo**: `src/infrastructure/security/AuditLogger.ts`

**Riesgo**: sin trazabilidad duradera. Si hay un incidente de seguridad, los logs se pierden con el proceso.

**Fix recomendado**: implementar el `TODO` de guardar en tabla `audit_logs` en Supabase.

---

### 🟡 MEDIA — CSP con `unsafe-inline` y `unsafe-eval`

**Archivo**: `src/interfaces/http/middlewares/securityHeaders.ts`

**Riesgo**: reduce efectividad del CSP contra XSS.

**Fix recomendado**: usar nonces en lugar de `unsafe-inline` si el frontend lo permite.

---

### 🟡 MEDIA — `TOKEN_ENCRYPTION_KEY` sin rotación

**Riesgo**: si la clave se compromete, todos los tokens históricos son descifrables.

**Fix recomendado**: implementar key versioning (`v1:<ciphertext>`) para poder rotar sin re-cifrar todo inmediatamente.

---

## 4. Lo que está bien implementado ✅

| Mecanismo | Estado | Detalle |
|-----------|--------|---------|
| JWT verification | ✅ Correcto | Supabase Admin SDK, server-side |
| AES-256-GCM para tokens | ✅ Correcto | IV aleatorio, AAD binding, auth tag |
| CSRF OAuth (state) | ✅ Correcto | 32 bytes CSPRNG, TTL 10min, anti-replay |
| Open redirect | ✅ Correcto | `sanitizeReturnTo()` valida origen |
| `user_id` en repos | ✅ Correcto | Todos los repos principales filtran por `user_id` |
| `client_id` en OAuth | ✅ Correcto | Validado en CreateConnectionLink, CreateCampaign |
| CORS restringido | ✅ Correcto | Solo FRONTEND_URL + localhost |
| Security headers | ✅ Correcto | Helmet con HSTS, X-Frame-Options |
| Token masking en logs | ✅ Correcto | Solo 4 chars inicio/fin visibles |
| Subscription check | ✅ Correcto | Separado en middleware reutilizable |
| Platform mismatch en OAuth | ✅ Correcto | Detecta state de Meta en callback de Google |

---

## 5. Checklist de hardening pendiente

- [ ] Agregar rate limit a todos los endpoints de sync (3/min)
- [ ] Restringir `/docs` en producción
- [ ] Eliminar rutas `/v1/users` duplicadas
- [ ] Persistir audit log en tabla Supabase
- [ ] Migrar rate limiter a Redis para producción multi-instancia
- [ ] Validar y logear accesos con `client_id` ajeno (403 + audit)
- [ ] Implementar key versioning en `TOKEN_ENCRYPTION_KEY`
- [ ] Revisar CSP para eliminar `unsafe-inline` si el frontend lo permite
