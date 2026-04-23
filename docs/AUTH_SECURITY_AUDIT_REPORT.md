# Auditoría de autenticación y seguridad de sesión — Backend Perfomad (Fastify + Supabase)

**Fecha:** 2025-02-22  
**Alcance:** Solo lectura (FASE A). Sin cambios de código hasta aprobación del informe y plan.

---

## FASE A — AUDITORÍA

### A1) Mapa de rutas completo

Todas las rutas se registran bajo el prefijo `/v1` excepto `GET /`, que está en la raíz.

| Método | Ruta real (path completo) | Dónde se registra | Clasificación | ¿Auth? |
|--------|---------------------------|-------------------|---------------|--------|
| GET | `/` | `server.ts` (dentro de `app.after`) | Pública | No |
| POST | `/v1/auth/signup` | `authRoutes.ts` → prefix `/v1/auth` | Pública | No |
| POST | `/v1/auth/login` | `authRoutes.ts` → prefix `/v1/auth` | Pública | No |
| GET | `/v1/users/users` | `userRoutes.ts` (prefix `/users`) → `ProfileController` (prefix `/users`) | Privada | `verifyUser` |
| PATCH | `/v1/users/users` | Idem | Privada | `verifyUser` |
| PATCH | `/v1/users/users/onboarding` | Idem | Privada | `verifyUser` |
| GET | `/v1/profile` | `routes/index.ts` → `ProfileController` (prefix `/profile`) | Privada | `verifyUser` |
| PATCH | `/v1/profile` | Idem | Privada | `verifyUser` |
| PATCH | `/v1/profile/onboarding` | Idem | Privada | `verifyUser` |
| GET | `/v1/clients` | `ClientsController` (prefix `/clients`) | Privada | `verifyUser` |
| POST | `/v1/clients` | Idem | Privada | `verifyUser` |
| GET | `/v1/clients/:id` | Idem | Privada | `verifyUser` |
| GET | `/v1/campaigns` | `CampaignsController` (prefix ``) | Privada | `verifyUser` |
| GET | `/v1/campaigns/can-create` | Idem | Privada | `verifyUserAndSubscription` |
| POST | `/v1/campaigns` | Idem | Privada | `verifyUserAndSubscription` |
| GET | `/v1/campaigns/:id` | Idem | Privada | `verifyUser` |
| GET | `/v1/campaigns/:id/overview` | Idem | Privada | `verifyUser` |
| POST | `/v1/campaigns/:id/sync` | Idem | Privada | `verifyUserAndSubscription` |
| PATCH | `/v1/campaigns/:id` | Idem | Privada | `verifyUserAndSubscription` |
| DELETE | `/v1/campaigns/:id` | Idem | Privada | `verifyUserAndSubscription` |
| GET | `/v1/campaigns/:id/insights` | Idem | Privada | `verifyUser` |
| GET | `/v1/dashboard/metrics` | Idem | Privada | `verifyUser` |
| GET | `/v1/dashboard/platform-summary` | Idem | Privada | `verifyUser` |
| GET | `/v1/campaigns/:id/sales-history` | Idem | Privada | `verifyUser` |
| GET | `/v1/dashboard/sales-history` | Idem | Privada | `verifyUser` |
| POST | `/v1/images/upload-url` | `ImagesController` (prefix ``) | Privada | `verifyUser` |
| GET | `/v1/images` | Idem | Privada | `verifyUser` |
| DELETE | `/v1/images/:filename` | Idem | Privada | `verifyUser` |
| POST | `/v1/platforms/:platform/connect-link` | `PlatformsController` (prefix ``) | Privada | `verifyUser` |
| **GET** | **`/v1/platforms/:platform/callback`** | `PlatformsController` | **Pública (OAuth callback)** | No (protegida por `state`) |
| POST | `/v1/platforms/:platform/sync-accounts` | Idem | Privada | `verifyUser` |
| GET | `/v1/platforms/:platform/metrics` | Idem | Privada | `verifyUser` |
| GET | `/v1/platforms/:platform/insights` | Idem | Privada | `verifyUser` |
| GET | `/v1/platforms/summary` | Idem | Privada | `verifyUser` |
| POST | `/v1/platforms/:platform/sync-campaigns` | Idem | Privada | `verifyUser` |
| GET | `/v1/platforms/:platform/accounts` | Idem | Privada | `verifyUser` |

**Registro:** `src/interfaces/http/server.ts` (authRoutes con prefix `/v1/auth`, routes con prefix `/v1`); `src/interfaces/http/routes/index.ts` (userRoutes, ProfileController, ClientsController, CampaignsController, ImagesController, PlatformsController).

**Confirmación:** No existe ninguna ruta que deba ser privada y que hoy no ejecute `verifyUser` o `verifyUserAndSubscription` en el handler. Todas las rutas privadas listadas llaman a una de estas dos funciones al inicio del handler. El riesgo es de **omisión futura**: una ruta nueva bajo `/v1` podría olvidar la verificación (no hay “default deny”).

**Nota:** El perfil está duplicado: mismo `ProfileController` registrado en `/v1/profile` (desde `routes/index.ts`) y en `/v1/users/users` (desde `userRoutes`). Conviene dejar una sola superficie (p. ej. solo `/v1/profile`) para evitar confusión y doble mantenimiento.

---

### A2) Mecanismos de auth existentes

#### 2.1) `verifyUser(req, reply)`

- **Ubicación:** `src/infrastructure/auth/verifyUser.ts`
- **Qué hace:**  
  - Lee `req.headers.authorization`.  
  - Si no hay header, responde 401 `"Token no provisto"` y retorna `null`.  
  - Extrae token con `authHeader.replace("Bearer ", "")`.  
  - Valida con `supabaseAdmin.auth.getUser(token)`.  
  - Si `error` o no `data?.user`, responde 401 `"Token inválido o expirado"` y retorna `null`.  
  - Retorna `data.user` (no asigna nada a `req.user`).
- **Errores:** Siempre 401; no 403.
- **Side effects:** Ninguno (no logs de token, no métricas).

#### 2.2) `verifyUserAndSubscription(req, reply)`

- **Ubicación:** `src/infrastructure/auth/verifySubscription.ts`
- **Qué hace:**  
  - Misma extracción de token que arriba.  
  - Valida con `supabaseAdmin.auth.getUser(token)`.  
  - Luego llama a `verifySubscription(req, reply, data.user.id)`, que consulta `profiles` (has_active_subscription, subscription_expires) con `supabaseAdmin`.  
  - Si no hay suscripción activa o está expirada, responde 403 y retorna `null`.  
  - Retorna `data.user`.
- **Errores:** 401 (token), 403 (suscripción), 404 (perfil no encontrado), 500 (error BD).
- **Side effects:** `req.log.error` en errores de verificación de suscripción (sin loguear token).

#### 2.3) `authPlugin` / `app.authenticate` / `request.user`

- **Ubicación:** `src/interfaces/http/plugins/authPlugin.ts`
- **Registro:** `app.register(authPlugin)` en `server.ts` (sin prefix).
- **Comportamiento:**  
  - **onRequest:** asigna `request.user = null`.  
  - **Decorator `authenticate`:** lee `Authorization`, extrae Bearer token, valida con **`supabaseClient.auth.getUser(token)`** (cliente anon, no admin), asigna `request.user = data.user` en caso de éxito; en error responde 401 y no asigna.  
  - **Tipado:** `FastifyRequest.user: User | null` (declare module "fastify").
- **Uso real:** Ningún handler usa `preHandler: [app.authenticate]` ni lee `req.user`. Todo el proyecto depende de `verifyUser` / `verifyUserAndSubscription` llamados manualmente dentro del handler.
- **Inconsistencia:** El plugin valida con `supabaseClient` (anon), mientras que `verifyUser` usa `supabaseAdmin`; para un mismo token el resultado debería ser equivalente, pero la validación “oficial” del proyecto es la de `verifyUser` (admin).

No hay otros middlewares/hooks de auth (solo `securityHeadersPlugin` y CORS, que no afectan identidad).

---

### A3) Flujo de credenciales desde el frontend y CORS

- **Evidencia en código:**  
  - `verifyUser.ts` y `verifySubscription.ts` leen solo `req.headers.authorization` y esperan formato `Bearer <token>`.  
  - No hay lectura de cookies (`sb-access-token`, `sb-refresh-token`, etc.) en el backend para autenticar requests.
- **Conclusión:** El backend espera **solo** `Authorization: Bearer <token>`.

**CORS** (`server.ts`):

- `origin`: `allowedOrigins` = `FRONTEND_URL` (si existe) + `"http://localhost:5173"`, o solo `["http://localhost:5173"]` si no hay `FRONTEND_URL`.
- `credentials: true` (correcto si en el futuro se usan cookies).
- `methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]` — **falta `PATCH`**; la API usa PATCH en `/v1/profile`, `/v1/profile/onboarding`, `/v1/campaigns/:id`. Desde un cliente browser, las peticiones PATCH pueden fallar en preflight si el servidor no incluye `PATCH` en `Access-Control-Allow-Methods`.
- `allowedHeaders: ["Content-Type", "Authorization"]` — suficiente para Bearer.

**Riesgos:**  
- Si el front envía solo Bearer y no cookies, no hay mismatch por cookie.  
- Riesgo concreto: **PATCH no permitido en CORS** puede bloquear esas rutas desde el front.  
- La función `configureCORS` en `src/interfaces/http/middlewares/securityHeaders.ts` (que incluye comprobación de origen para callbacks OAuth) **no se usa** en `server.ts`; el servidor solo usa `@fastify/cors`. Por tanto, la lógica extra de validación de origen para callbacks no está aplicada.

---

### A4) Tipado y uso de `req.user`

- **Ampliación de tipos:** Una sola: en `src/interfaces/http/plugins/authPlugin.ts`, `declare module "fastify"` con `FastifyRequest { user: User | null }` y `FastifyInstance { authenticate: ... }`.
- **Dónde se usa `req.user`:** En ningún handler. El plugin pone `request.user` en `authenticate`, pero ningún route usa `app.authenticate` ni lee `req.user`.
- **Dónde se usa `verifyUser` / `verifyUserAndSubscription`:** En todos los handlers privados listados en A1; cada uno recibe el usuario como valor de retorno (`const user = await verifyUser(req, reply)`) y lo usa localmente (p. ej. `user.id`). No se reasigna a `req.user`.
- **Inconsistencia:** El tipo `req.user` existe pero no se utiliza; la autenticación real es “manual” por handler y no unificada con el decorator.

---

### A5) “Default deny” vs “allow by exception”

- **Situación actual:** “Cada handler decide”. No hay hook global que exija auth para `/v1`. Cualquier ruta nueva bajo `/v1` será **pública por defecto** hasta que alguien añada `verifyUser` o `verifyUserAndSubscription` en el handler.
- **Punto donde forzar un scope privado:** En `server.ts`, dentro de `app.after()`, después de registrar `routes` con prefix `/v1`, se podría añadir un `addHook('onRequest', ...)` o `preHandler` sobre el subárbol que encapsula las rutas bajo `/v1`, o bien registrar un plugin con prefix `/v1` que aplique el hook y luego registre las rutas actuales. La estructura más segura sería: “todo lo que cuelga de `/v1` es privado por defecto” y excepciones explícitas (p. ej. `/v1/auth/*`, `/v1/platforms/:platform/callback`) con una lista blanca o registro separado para rutas públicas.

---

### A6) OAuth callback (endpoint público) — auditoría de seguridad

- **Endpoint:** `GET /v1/platforms/:platform/callback` en `PlatformsController.ts` (líneas ~66–87). Handler: recibe `code`, `state`, `redirect_uri` por query; delega en `handleOAuthCallback.execute(...)`.
- **Validación de state:**  
  - En `HandleOAuthCallback.execute` se llama a `stateManager.validateStateForCallback(state)` (`StateManager.ts`).  
  - Comprueba: state existe en BD, `used === false`, y `expires_at` no expirado (`StateManager.ts` líneas 100–116).  
  - Luego se comprueba **platform match**: `stateData.platform !== platform` (URL) → se invalida el state, se audita y se retorna error (HandleOAuthCallback líneas 44–57).  
  - Orden: **mark used antes del exchange** — `invalidateState(state)` se llama en la línea 61, antes de `exchangeCodeForToken` (líneas 65–67), lo que previene replay.  
  - Si el exchange falla, el state ya está marcado como usado; no se reexpone.
- **Redirección al frontend:** Se redirige a `FRONTEND_URL` (o localhost:5173) con solo `connect=success&platform=...` o `connect=error&message=...` (mensaje genérico). No se filtran tokens ni errores crudos en la URL.
- **Riesgos / mejoras:**  
  - El callback es GET con `code` y `state` en query; los logs de acceso (URL) podrían contener el `code` (de un solo uso). Recomendación: no loguear query completo en este path.  
  - Rate limiting en este endpoint reduciría fuerza bruta sobre `state`; actualmente no hay rate limit aplicado (ver A8).

---

### A7) Manejo de tokens y secretos

- **Logs:**  
  - No se encontró log explícito de `Authorization`, `token`, o cookies.  
  - En `CampaignsController.ts` línea ~391: `req.log.error({ err, message: err.message, stack: err.stack }, ...)` — en producción, loguear `stack` puede ser aceptable en servidor, pero conviene no enviar stacks al cliente (el error handler global ya responde mensaje genérico).  
  - `verifySubscription` y otros hacen `req.log.error({ err })` o similar; no se observa fuga de token en esos logs.
- **Refresh tokens OAuth:** Se almacenan cifrados. `TokenManager` usa `CryptoService`; en `SupabaseAdAccountsRepository` se persisten `refresh_token_iv`, `refresh_token_tag` (y análogo para access). La clave es `TOKEN_ENCRYPTION_KEY` (env).
- **CryptoService** (`src/infrastructure/security/CryptoService.ts`): Exige `TOKEN_ENCRYPTION_KEY` en env; si no está, lanza en constructor. La key debe ser Base64 de 32 bytes (AES-256).
- **Producción:** Si `TOKEN_ENCRYPTION_KEY` falta en producción, cualquier uso de cifrado/descifrado (p. ej. guardar o refrescar tokens OAuth) fallará y la app puede lanzar; es un fallo seguro (no se opera sin clave). Recomendación: validar la presencia de esta variable en arranque en entorno production y documentar requisitos.

---

### A8) Rate limiting / hardening / headers

- **Rate limiting:** El paquete `@fastify/rate-limit` está en `package.json` pero **no se registra** en `server.ts`. La clase `RateLimiter` en `src/infrastructure/security/RateLimiter.ts` existe pero no se usa en ninguna ruta ni en el servidor. Por tanto, **no hay rate limit** aplicado a auth ni al callback OAuth.
- **Helmet:** Registrado en `server.ts` con `app.register(helmet)` (sin opciones). Headers de seguridad los añade también `securityHeadersPlugin` (HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, CSP, Permissions-Policy). Orden: CORS → helmet → securityHeadersPlugin; puede haber solapamiento con helmet (p. ej. X-Frame-Options), no necesariamente problemático.
- **Errores:** El error handler global no diferencia entorno; siempre responde `"Error interno del servidor."` y hace `req.log.error(error)`. En producción, evitar loguear cuerpos de request que puedan contener datos sensibles y considerar no loguear stack en ciertos canales si los logs se exponen.

---

### A9) RLS y claves Supabase

- **Uso de claves:**  
  - `supabaseClient`: usa `SUPABASE_PUBLISHABLE_KEY` (alias `SUPABASE_ANON_KEY` en env). Definido en `src/infrastructure/db/supabaseClient.ts`. Solo se usa en **authPlugin** para `getUser(token)` y en **SupabaseUserRepository** para `signUp` y `signInWithPassword` (flujos de registro/login).  
  - `supabaseAdmin`: usa `SUPABASE_SECRET_KEY` (alias `SUPABASE_SERVICE_ROLE_KEY`). Usado en el resto del backend: verifyUser, verifySubscription, repositorios (campaigns, clients, ad_accounts, images, metrics, oauth_states, audit_logs), TokenManager, StateManager, ActivateSubscription, etc.
- **Service role no al cliente:** La clave de servicio no se expone en rutas ni se envía al front; solo existe en servidor. Correcto.
- **RLS:** Las operaciones con `supabaseAdmin` bypasean RLS. La autorización (qué user_id/client_id puede ver qué) se delega en la lógica de la aplicación (controllers + repositorios que filtran por `user_id` o `client_id` derivado del token). Riesgo: si en algún punto se deja de filtrar por usuario/cliente, se podría exponer datos de otros. Conviene revisar que todos los accesos a datos sensibles pasen por `user.id` o `clientId` obtenido del token y no de parámetros no validados.

---

### A10) Amenazas y escenarios

| Escenario | ¿Protegido hoy? | Notas |
|-----------|------------------|--------|
| Usuario sin token llama a `/v1/campaigns` | Sí | El handler llama a `verifyUser` y responde 401 si no hay token válido. |
| Usuario con token válido intenta acceder a recursos de otro user_id/client_id | Depende de la ruta | La protección es a nivel de lógica de negocio (repositorios/controllers que filtran por `user.id` o por client asociado al usuario). No hay una capa única que lo garantice; hay que auditar cada endpoint que recibe IDs. |
| Atacante reutiliza un state de OAuth | Sí | State se marca usado antes del exchange; `validateStateForCallback` exige `used === false`. |
| Atacante cambia platform en callback usando state de otra platform | Sí | Se valida `stateData.platform === platform` (param de URL); si no coincide, se invalida y se devuelve error. |
| Atacante intenta obtener tokens vía redirect o logs | Parcial | Redirect no envía tokens. Logs no muestran tokens en el código revisado; riesgo menor si se loguea la URL del callback (contiene `code` de un solo uso). |
| CORS permite un origen no deseado | Depende de env | Si `FRONTEND_URL` está bien configurado y no se añaden orígenes arbitrarios, está acotado. No hay lista blanca estricta en código más allá de `allowedOrigins`. |

---

## Lista priorizada de problemas

### P0 (crítico)

- **P0.1** — **No hay “default deny” en `/v1`.** Cualquier ruta nueva bajo `/v1` es pública hasta que se añada manualmente `verifyUser`/`verifyUserAndSubscription`.  
  - Impacto: Riesgo alto de exponer endpoints privados por olvido.  
  - Cómo reproducir: Añadir una ruta GET `/v1/private-test` sin llamar a `verifyUser`; llamar sin token → 200 si el handler no comprueba auth.

### P1 (importante)

- **P1.1** — **CORS no incluye `PATCH`.** La API usa PATCH en profile y campaigns.  
  - Impacto: Peticiones PATCH desde el navegador pueden fallar por preflight.  
  - Reproducir: Desde el front, enviar PATCH con credenciales a `/v1/profile`; comprobar respuesta CORS.

- **P1.2** — **Rate limiting ausente** en login, signup y callback OAuth.  
  - Impacto: Fuerza bruta, abuso de callbacks, DoS.  
  - Reproducir: Lanzar muchas peticiones a POST `/v1/auth/login` o GET `/v1/platforms/meta/callback`.

- **P1.3** — **Dos mecanismos de auth (plugin vs verifyUser)** y `req.user` no utilizado.  
  - Impacto: Confusión, posible uso futuro del plugin sin alineación con verifyUser (p. ej. diferencias anon vs admin).  
  - Reproducir: Revisar código; ningún handler usa `app.authenticate` ni `req.user`.

- **P1.4** — **Perfil duplicado** (`/v1/profile` y `/v1/users/users`).  
  - Impacto: Superficie de ataque y mantenimiento duplicado.  
  - Reproducir: Comparar rutas de ProfileController en routes/index y userRoutes.

### P2 (recomendado)

- **P2.1** — **`configureCORS` en securityHeaders no se usa**; la validación extra de origen para callbacks OAuth no está activa.  
  - Impacto: Menor si `@fastify/cors` ya restringe orígenes; refuerzo deseable para callbacks.

- **P2.2** — **Evitar loguear query completo en el path del callback** (contiene `code`).  
  - Impacto: Bajo (code es de un solo uso), pero buena práctica.

- **P2.3** — **Validar `TOKEN_ENCRYPTION_KEY` en arranque en production** y documentar requisitos.  
  - Impacto: Fallo rápido y claro si falta la key en producción.

---

## Propuesta de estrategia (sin implementar)

### Strategy S1: “/v1 private scope” con preHandler global + excepciones

- **Descripción:** Un único scope “privado” para todo lo que cuelga de `/v1`, con un hook/preHandler que exige usuario autenticado; las rutas públicas (`/v1/auth/*`, `/v1/platforms/:platform/callback`) se registran fuera de ese scope o se marcan como excepción en el hook (p. ej. por path).
- **Pros:** Default deny, una sola política, difícil olvidar proteger una ruta nueva.  
- **Contras:** Requiere estructura de registro clara (p. ej. registrar primero públicas, luego un plugin “private” que registra el resto) o lista de excepciones mantenida en un solo sitio.

### Strategy S2: “Per-route preHandler” con helper builder

- **Descripción:** Sin hook global; cada ruta o grupo de rutas declara explícitamente `preHandler: [requireAuth]` o `preHandler: [requireAuthAndSubscription]`, usando un helper que encapsula la lógica de verifyUser/verifySubscription y asigna `req.user`.
- **Pros:** Explícito por ruta, flexible (algunas rutas solo auth, otras auth+suscripción).  
- **Contras:** Sigue siendo “allow by exception” a nivel conceptual; una ruta nueva puede olvidar el preHandler.

### Strategy S3: Mantener verifyUser manual + enforcement por linter/rule

- **Descripción:** No cambiar la arquitectura; seguir llamando `verifyUser`/`verifyUserAndSubscription` en cada handler y añadir una regla de Cursor/ESLint o documento que obligue a que toda ruta bajo `/v1` (salvo lista blanca) contenga esa llamada.
- **Pros:** Cambios mínimos.  
- **Contras:** No hay garantía técnica de “default deny”; depende de disciplina y de que la regla cubra todos los casos. **No recomendado** como estrategia principal.

**Recomendación:** Adoptar **S1** como estrategia objetivo, con un preHandler global para el scope privado de `/v1` y excepciones explícitas para auth y callback; opcionalmente unificar con un helper tipo S2 para rutas que requieran suscripción (preHandler que compruebe `req.user` + suscripción).

---

## FASE B — Plan de implementación incremental

### Paso 1: Introducir “private scope” para `/v1`

- **Objetivo:** Que todo request a `/v1/*` exija autenticación por defecto, salvo excepciones definidas en un solo lugar.
- **Archivos:**  
  - `src/interfaces/http/server.ts`: dejar de registrar `routes` directamente bajo `/v1`; crear (o registrar) un plugin “v1-private” que aplica un `onRequest` o `preHandler` que verifica Bearer con Supabase y asigna `req.user`, y que no aplica auth a paths en una lista de excepciones (`/v1/auth`, `/v1/platforms/:platform/callback`).  
  - Alternativa: registrar `authRoutes` y la ruta de callback fuera del scope privado, y registrar el resto de `routes` bajo un plugin que lleve el preHandler.  
- **Detalle:** Definir la lista de prefijos/paths públicos (ej. `/v1/auth`, `/v1/platforms/:platform/callback`) y en el hook, si la URL coincide, no exigir auth; en caso contrario, ejecutar la misma lógica que hoy tiene `verifyUser` y, si falla, responder 401 y cortar.

### Paso 2: Migrar rutas para usar preHandler y `req.user`

- **Objetivo:** Que los handlers lean `req.user` (ya seteado por el hook global o por un preHandler) en lugar de llamar a `verifyUser`/`verifyUserAndSubscription` dentro del handler.
- **Archivos:**  
  - `src/infrastructure/auth/verifyUser.ts` y `verifySubscription.ts`: exponer (o reutilizar) una función que pueda usarse como preHandler y que asigne `req.user` y, si aplica, verifique suscripción y responda 403.  
  - Controllers: eliminar la primera línea `const user = await verifyUser(req, reply)` (y análoga con verifyUserAndSubscription) y usar `req.user`; para rutas que requieran suscripción, añadir un preHandler `requireSubscription` que verifique contra `req.user` y responda 403 si no hay suscripción.  
- **Tipado:** Mantener `FastifyRequest.user` (ya declarado en authPlugin); asegurar que el hook/preHandler que reemplaza a verifyUser asigne siempre `request.user` cuando el token es válido.

### Paso 3: Asegurar callback OAuth público y seguro

- **Objetivo:** Callback siga siendo público, sin auth, pero con buenas prácticas.
- **Archivos:**  
  - Mantener el callback fuera del scope que exige auth (ya contemplado en Paso 1).  
  - Opcional: no loguear `req.url` o `req.query` completos en el handler del callback; opcional: aplicar rate limit solo a este path (Paso 4).  
  - No cambiar la lógica de state (validación, mark used antes del exchange, platform match) ni los redirects.

### Paso 4: CORS alineado con el método de sesión

- **Objetivo:** Soporte correcto para Bearer (y en el futuro cookies si se usan).
- **Archivos:**  
  - `src/interfaces/http/server.ts`: añadir `PATCH` a `methods` en la configuración de `@fastify/cors`.  
  - Opcional: si se quiere usar la lógica de `configureCORS` para callbacks, integrarla (p. ej. como hook adicional) sin duplicar conflictos con `@fastify/cors`.

### Paso 5: Verificación y checklist

- **Typecheck:** `npm run typecheck`.  
- **Build:** `npm run build`.  
- **Start:** `npm run start` (o `npm run dev`) y comprobar que el servidor arranca.  
- **Checklist manual (recomendado):**  
  - GET `/v1/campaigns` sin Authorization → 401.  
  - GET `/v1/campaigns` con Bearer válido → 200 (o el comportamiento actual).  
  - POST `/v1/auth/login` sin auth → 200/401 según payload (público).  
  - GET `/v1/platforms/meta/callback?...` sin auth → redirect (público).  
  - PATCH `/v1/profile` con Bearer desde el front → comprobar que CORS permite PATCH.  
- Opcional: si existe Vitest, añadir tests mínimos que llamen a una ruta privada sin token (esperado 401) y con token (esperado no 401); y una ruta pública sin token (esperado no 401).

---

## FASE C — Implementación

**No se implementará hasta que confirmes “OK”** tras revisar este informe y el plan (FASE A + B).  
Cuando des el OK, se seguirá el plan incremental sin cambiar contratos de endpoints/payloads, sin añadir dependencias nuevas salvo necesidad real, manteniendo logs sin secretos y añadiendo tests mínimos o comandos de verificación manual si aplica.

---

## Hardening aplicado (Fase 5 — integraciones)

- **CORS PATCH:** Añadido `PATCH` a `methods` en `src/interfaces/http/server.ts` (la API usa PATCH en `/v1/profile`, `/v1/profile/onboarding`, `/v1/campaigns/:id`).
- **Rate limit (no aplicado):** El paquete `@fastify/rate-limit` está instalado pero no registrado. Para aplicarlo solo a rutas sensibles: (1) Registrar el plugin con `max` y `timeWindow` por defecto suaves; (2) Para rutas más estrictas, registrar un plugin encapsulado con prefix `/v1/auth` y otro para la ruta del callback OAuth, con límites más bajos (ej. 10 req/min login, 30/min callback); (3) Archivo: `src/interfaces/http/server.ts`.
- **Callback OAuth:** No se loguea `req.query` ni `req.url` en el handler; solo `req.log.error(err)` en catch. No se requirió cambio.
