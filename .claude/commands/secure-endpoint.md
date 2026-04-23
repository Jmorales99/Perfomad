# /secure-endpoint — Guía para crear y asegurar un endpoint en Perfomad

Cuando el usuario pida crear un nuevo endpoint, sigue esta guía paso a paso. Haz preguntas cuando no tengas la información necesaria.

## Paso 1 — Determinar el tipo de endpoint

Pregunta al usuario:
1. ¿Cuál es el método HTTP? (GET / POST / PATCH / DELETE)
2. ¿Cuál es el path? (ej: `/v1/campaigns/:id/export`)
3. ¿Requiere suscripción activa para ejecutarse?
4. ¿Es costoso? (llama APIs externas, genera IA, hace sync) — si es sí, necesita rate limit
5. ¿Opera sobre datos de un `client_id` específico?

**Regla de auth**:
- Solo lectura liviana → `verifyUser`
- Escritura, borrado, sync, IA, llamadas a plataformas → `verifyUser + verifySubscription`

---

## Paso 2 — Elegir el controller correcto

Mira el dominio del recurso y agrega el endpoint al controller existente:

| Recurso | Controller | Archivo |
|---------|-----------|---------|
| Campañas | CampaignsController | `src/interfaces/http/controllers/CampaignsController.ts` |
| Clientes | ClientsController | `src/interfaces/http/controllers/ClientsController.ts` |
| Plataformas / OAuth | PlatformsController | `src/interfaces/http/controllers/PlatformsController.ts` |
| Dashboard | DashboardController | `src/interfaces/http/controllers/DashboardController.ts` |
| Imágenes | ImagesController | `src/interfaces/http/controllers/ImagesController.ts` |
| Perfil | ProfileController | `src/interfaces/http/controllers/ProfileController.ts` |
| Multichannel | MultichannelCampaignsController | `src/interfaces/http/controllers/MultichannelCampaignsController.ts` |

Si el recurso no encaja en ninguno, crea un controller nuevo con el patrón de los existentes.

---

## Paso 3 — Template base del endpoint

```typescript
// Dentro del método register(app) del controller correspondiente

app.post('/v1/recurso/:id/accion', async (req, reply) => {
  // 1. AUTENTICACIÓN — siempre primero
  const user = await verifyUser(req, reply)
  if (!user) return  // verifyUser ya envió 401

  // 2. SUSCRIPCIÓN — solo si el endpoint es de escritura o costoso
  const hasSub = await verifySubscription(req, reply, user.id)
  if (!hasSub) return  // verifySubscription ya envió 403

  // 3. PARÁMETROS — extraer y validar tipos
  const { id } = req.params as { id: string }
  const body = req.body as { clientId: string; /* otros campos */ }

  // 4. VALIDACIÓN DE OWNERSHIP — si hay client_id
  if (body.clientId) {
    const client = await clientsRepo.getById(user.id, body.clientId)
    if (!client) return reply.code(403).send({ error: 'Forbidden' })
  }

  // 5. LÓGICA — delegar al use case
  const useCase = new MiUseCase(repo1, repo2)
  const result = await useCase.execute(user.id, id, body)

  // 6. RESPUESTA — solo campos necesarios, nunca tokens/secrets
  return reply.code(200).send({
    data: result,
  })
})
```

---

## Paso 4 — Checklist de seguridad antes de hacer commit

### Autenticación y autorización
- [ ] `verifyUser` es la primera línea del handler
- [ ] Si el endpoint escribe, borra o llama APIs externas: también `verifySubscription`
- [ ] El `user.id` se pasa al use case / repo — nunca se confía en un `userId` del body/query
- [ ] Si hay `client_id` en el request, se valida que pertenezca al `user.id` antes de usarlo

### Ownership de datos
- [ ] El repo filtra por `user_id` en toda operación de lectura y escritura
- [ ] Si hay `:id` en el path (campaña, cliente, etc.), el repo valida que `user_id` coincida
- [ ] No se devuelve un 404 genérico que pueda ser usado para enumerar IDs ajenos: usa 403 si el recurso existe pero no es del usuario

### Respuestas seguras
- [ ] La respuesta NO incluye: `access_token`, `refresh_token`, `*_encrypted`, `*_iv`, `*_tag`, `SUPABASE_SERVICE_ROLE_KEY`, ni ningún secret de plataforma
- [ ] Si se devuelven cuentas publicitarias, excluir columnas de tokens: solo `platform`, `account_name`, `is_active`, `connection_status`
- [ ] Los errores son genéricos hacia el cliente (no exponer stack traces, mensajes internos de Supabase, ni detalles de la plataforma)

### Rate limiting (si aplica)
Agrega rate limit cuando el endpoint:
- Llama a APIs externas (Meta, Google, TikTok)
- Ejecuta análisis con Claude AI
- Hace operaciones de sync masivas
- Es un endpoint POST de creación sensible

```typescript
// En la definición de la ruta, agregar config:
app.post('/v1/ruta', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
}, async (req, reply) => { ... })
```

### Validación de input
- [ ] Los tipos de `req.body` y `req.params` están tipados explícitamente (no `any`)
- [ ] Si el body tiene campos opcionales, se validan antes de usarlos
- [ ] Los parámetros de plataforma (`platform`) se validan contra el enum `Platform` permitido
- [ ] Las fechas tienen el formato esperado (YYYY-MM-DD) si aplica

---

## Paso 5 — Crear el use case correspondiente

```typescript
// src/application/usecases/recurso/MiUseCase.ts

import type { RecursoRepository } from '@/domain/repositories/RecursoRepository.js'

export class MiUseCase {
  constructor(private readonly repo: RecursoRepository) {}

  async execute(userId: string, id: string, input: MiInput): Promise<MiOutput> {
    // Toda la lógica de negocio aquí
    // El repo siempre recibe userId como primer argumento
    const item = await this.repo.findById(userId, id)
    if (!item) throw new Error('Not found')

    // ... lógica ...

    return result
  }
}
```

**Reglas del use case**:
- Solo trabaja con interfaces (repositorios, integraciones) — nunca instancia clientes Supabase directamente
- `userId` es siempre el primer parámetro de `execute`
- Lanza errores de dominio descriptivos — el controller los mapea a códigos HTTP

---

## Paso 6 — Registrar la ruta

Las rutas se registran en `src/interfaces/http/routes/index.ts`. Si el controller ya está registrado allí, el endpoint queda disponible automáticamente al agregarlo al controller.

Si es un controller nuevo:
```typescript
// src/interfaces/http/routes/index.ts
import { MiNuevoController } from '../controllers/MiNuevoController.js'

// Dentro de registerRoutes(app):
await app.register(async (instance) => {
  const ctrl = new MiNuevoController()
  await ctrl.register(instance)
}, { prefix: '/v1' })
```

---

## Ejemplos de errores comunes a evitar

```typescript
// ❌ MAL — confiar en userId del body
const { userId, clientId } = req.body  // usuario puede pasar cualquier userId

// ✅ BIEN — siempre del JWT verificado
const user = await verifyUser(req, reply)
const { clientId } = req.body  // solo clientId del body, userId del JWT

// ❌ MAL — devolver tokens en respuesta
return reply.send({ account: adAccount })  // adAccount tiene access_token_encrypted

// ✅ BIEN — solo campos seguros
return reply.send({
  account: {
    id: adAccount.id,
    platform: adAccount.platform,
    account_name: adAccount.account_name,
    connection_status: adAccount.connection_status,
  }
})

// ❌ MAL — sin validar client_id
const { clientId } = req.query
const accounts = await repo.findByClientId(clientId)  // puede ser de otro usuario

// ✅ BIEN — validar ownership
const client = await clientsRepo.getById(user.id, clientId)
if (!client) return reply.code(403).send({ error: 'Forbidden' })
const accounts = await repo.findByUserAndClient(user.id, clientId)

// ❌ MAL — exponer error interno
} catch (err) {
  return reply.code(500).send({ error: err.message })  // puede revelar internals

// ✅ BIEN — error genérico al cliente, detalle en log
} catch (err) {
  console.error('[MiEndpoint] Error:', err)
  return reply.code(500).send({ error: 'Internal server error' })
}
```

---

## Middleware disponible

| Función | Importar desde | Uso |
|---------|---------------|-----|
| `verifyUser` | `@/infrastructure/auth/verifyUser.js` | JWT auth |
| `verifySubscription` | `@/infrastructure/auth/verifySubscription.js` | Check suscripción |
| `verifyUserAndSubscription` | `@/infrastructure/auth/verifySubscription.js` | Ambos en uno |
| `AuditLogger` | `@/infrastructure/security/AuditLogger.js` | Log de eventos de seguridad |

---

Cuando termines de implementar el endpoint, ejecuta:

```bash
npm run typecheck   # verificar tipos
npm run lint        # verificar estilo
npm run test        # correr tests
```
