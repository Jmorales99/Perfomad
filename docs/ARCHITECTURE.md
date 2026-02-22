# Arquitectura del backend

Backend TypeScript con Fastify, Supabase y Vercel. Un usuario (login) tiene una suscripción y puede gestionar varias empresas internas (*clients*). Todo dato de negocio (ad_accounts, campaigns, etc.) pertenece a un `client_id`.

## Capas

| Capa | Ubicación | Responsabilidad |
|------|-----------|-----------------|
| **HTTP / Interfaces** | `src/interfaces/http` (y actualmente `src/app` para server/routes) | Controllers, rutas, plugins, middlewares. Valida input, llama use cases, mapea a HTTP. |
| **Application** | `src/application/usecases` | Casos de uso. Lógica de negocio. Solo depende de interfaces (repos), no de implementaciones concretas. |
| **Domain** | `src/domain/repositories` | Contratos (interfaces) de repositorios. |
| **Infrastructure** | `src/infrastructure` | DB (Supabase), repositorios, seguridad (Crypto, StateManager), integraciones (plataformas). |

## Flujo OAuth con client_id

1. **CreateConnectionLink** (usecase)  
   - Input: `userId`, `clientId`, `platform`, `redirectUri`.  
   - Valida que `clientId` pertenezca a `userId` (ClientsRepository).  
   - Genera `state` y persiste en `oauth_states` con `user_id`, `client_id`, `platform`, `redirect_uri`, `expires_at`, `used=false`.  
   - Devuelve la URL de OAuth del proveedor (Meta/Google/LinkedIn) con ese `state`.

2. **Redirect al proveedor**  
   - El usuario autoriza en la plataforma; el proveedor redirige al **callback** con `code` y `state`.

3. **HandleOAuthCallback** (usecase)  
   - Recibe `code`, `state`, `platform` (y opcionalmente `redirectUri`).  
   - Busca `oauth_states` por `state`, comprueba `used=false` y `expires_at`.  
   - Lee `user_id` y `client_id` del state.  
   - Marca el state como `used=true`.  
   - Intercambia `code` por tokens con la API del proveedor.  
   - Hace upsert en `ad_accounts` con `user_id`, `client_id`, plataforma y tokens cifrados.  
   - Unicidad: `(user_id, client_id, platform, platform_account_id)`.

Así, cada conexión de cuenta publicitaria queda asociada a una empresa interna (`client_id`).

## Seguridad

- **Tokens**: Solo en servidor. Cifrados en reposo (AES-256-GCM) con `TOKEN_ENCRYPTION_KEY`. Nunca enviar access/refresh al front.
- **Supabase**: `service_role` solo en backend; nunca en código expuesto al cliente.
- **Logs**: No imprimir secretos (tokens, headers Authorization, cookies, service_role).
- **OAuth state**: One-time, con expiración; debe incluir `client_id` y marcarse `used` tras el callback.
- **Storage**: Si se usan buckets, políticas por carpeta (`user_<uid>` o `client_<id>`), no acceso abierto al bucket.

## Entrypoint y build

- **Dev**: `npm run dev` → `tsx watch src/index.ts`.  
- **Build**: `npm run build` → `tsc` + `tsc-alias` (reescribe alias `@/` a rutas relativas con `.js`).  
- **Start**: `npm run start` → `node dist/index.js`.  
- Variables de entorno: ver `.env.example`. Validación en `src/config/env.ts`.
