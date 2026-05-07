# Perfomad — Features Futuras (Post-Migración Go)

## Propósito de este documento

Este documento captura todas las features que se decidió **no tocar durante la migración a Go** para no bloquearse, pero que son parte del producto objetivo. Deben tenerse en cuenta al diseñar la BD, el contrato de API y la arquitectura del microservicio Python (`perfomad-agents`) para que la incorporación futura no requiera refactors mayores.

**Regla de compatibilidad**: la migración Go debe dejar espacio para estas features. Ninguna tabla, endpoint ni contrato debe cerrarse de forma que estas features sean imposibles de añadir después.

---

## 1. Sistema de Aprendizaje de Recomendaciones

### Objetivo

Que el sistema aprenda del comportamiento real del cliente y de los resultados históricos para que cada recomendación de Claude sea más precisa, contextualizada y útil con el tiempo. El sistema debe poder decirle al cliente cosas como:

> "La última vez que pausaste esta campaña cuando el ROAS cayó por debajo de 1.2, el CPA mejoró un 18% en 7 días. Esto ya ocurrió tres veces en tu cuenta."

### Por qué

- Las recomendaciones genéricas tienen valor limitado. Un cliente con historial de 6 meses tiene patrones propios que Claude debe conocer.
- El cliente toma mejores decisiones cuando ve el contexto histórico de sus propias acciones.
- El sistema se diferencia de la competencia cuando las recomendaciones son causalmente fundadas, no solo algorítmicas.

### Flujo técnico

```
1. Usuario hace click "Aplicar" o "Descartar"
   → Go guarda la decisión + snapshot de métricas actuales (baseline_metrics)
   → Go encola tarea Python: measure_outcome(decision_id, scheduled_for = now + 7 days)

2. Celery task corre 7 días después
   → Fetchea métricas reales desde plataforma
   → Calcula deltas: roas_delta, cpa_delta, ctr_delta, spend_delta
   → Determina outcome: 'positive' | 'negative' | 'neutral'
   → Claude genera narrative (párrafo explicativo)
   → Guarda en recommendation_outcomes

3. En el próximo ciclo de optimización
   → Nodo LangGraph retrieve_patterns: busca por pgvector situaciones similares
   → Trae top-5 outcomes históricos relevantes
   → Claude recibe este contexto antes de generar recomendaciones nuevas
```

### Tabla requerida: `recommendation_outcomes`

```sql
CREATE TABLE recommendation_outcomes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id       UUID NOT NULL REFERENCES optimization_decisions(id),
    recommendation_id UUID NOT NULL REFERENCES optimization_recommendations(id),
    campaign_id       UUID NOT NULL REFERENCES campaigns(id),
    user_id           UUID NOT NULL,
    client_id         UUID NOT NULL REFERENCES clients(id),
    decision          TEXT NOT NULL,         -- 'accept' | 'reject'
    baseline_metrics  JSONB NOT NULL,        -- snapshot métricas al momento de la decisión
    outcome_metrics   JSONB,                 -- métricas 7 días después (null hasta medición)
    metric_deltas     JSONB,                 -- {roas_delta: 0.3, cpa_delta: -12, ctr_delta: 0.05}
    outcome           TEXT,                  -- 'positive' | 'negative' | 'neutral' | null
    measured_at       TIMESTAMPTZ,           -- cuándo se hizo la medición
    scheduled_for     TIMESTAMPTZ NOT NULL,  -- created_at + 7 días
    narrative         TEXT,                  -- párrafo generado por Claude
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Nota de compatibilidad**: la tabla `optimization_decisions` ya existe en el TS actual. En Go, al procesar el endpoint `POST /optimize/apply`, se debe guardar `baseline_metrics` (snapshot JSONB de las métricas actuales de la campaña) al mismo tiempo que se registra la decisión. Esto no requiere cambio de schema actual, solo agregar el campo.

### Archivos Python que implementan esto

```
app/tasks/measure_outcome.py          -- Celery task programada 7 días después
app/agents/nodes/enrich_with_outcomes.py  -- Nodo LangGraph que recupera patrones históricos
app/services/outcome_service.py       -- Calcula deltas y outcome final
```

---

## 2. Onboarding Declarativo de Clientes

### Objetivo

Cuando se crea un cliente nuevo, un wizard captura sus preferencias y objetivos. Esto permite que:
- Las alarmas tengan thresholds sensatos desde el primer día (no genéricos globales)
- Las recomendaciones de Claude estén calibradas al tipo de negocio y tolerancia al riesgo
- El cliente elija cuánta autonomía delegar al sistema

### Por qué

Un cliente de ecommerce y uno de generación de leads tienen métricas objetivo completamente distintas. Sin este contexto, Claude no puede saber si un CPA de $25 es bueno o malo para ese cliente específico. El onboarding declarativo es el punto de partida de toda personalización.

### Tabla requerida: `client_preferences`

```sql
CREATE TABLE client_preferences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL,
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    business_type       TEXT NOT NULL,   -- 'ecommerce' | 'lead_gen' | 'brand_awareness' | 'app_installs'
    priority_kpis       TEXT[] NOT NULL, -- ['roas', 'cpa'] ordenado por importancia
    target_roas         NUMERIC,         -- ROAS objetivo (ej: 3.5)
    max_cpa             NUMERIC,         -- CPA máximo aceptable
    max_cpl             NUMERIC,         -- CPL máximo (lead gen)
    monthly_budget_usd  NUMERIC,         -- presupuesto mensual de referencia
    risk_tolerance      TEXT NOT NULL DEFAULT 'moderate', -- 'conservative' | 'moderate' | 'aggressive'
    operation_mode      TEXT NOT NULL DEFAULT 'manual',   -- ver sección 3
    auto_apply_types    TEXT[],          -- tipos de recomendación para auto-aplicar
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, client_id)
);
```

### Cómo afecta a la API

- `POST /v1/clients` — opcionalmente acepta `preferences` en el body y las guarda
- `PATCH /v1/clients/:id/preferences` — endpoint nuevo para actualizar preferencias
- `GET /v1/clients/:id/preferences` — lectura de preferencias
- Al leer `client_preferences`, se auto-generan `alert_configs` con defaults según `business_type`

### Defaults de alertas por tipo de negocio

| business_type | métrica | operador | threshold | nivel |
|---|---|---|---|---|
| ecommerce | roas | lt | 1.0 | critical |
| ecommerce | roas | lt | target_roas * 0.7 | warning |
| ecommerce | cpa | gt | max_cpa * 1.5 | warning |
| ecommerce | spend_pct_daily | gt | 90 | info |
| lead_gen | cpl | gt | max_cpl * 1.5 | critical |
| lead_gen | ctr | lt | 1.0 | warning |
| lead_gen | conversion_rate | lt | 2.0 | warning |
| brand_awareness | cpm | gt | 15.0 | warning |
| brand_awareness | frequency | gt | 8.0 | info |
| app_installs | cpi | gt | max_cpa * 1.5 | critical |
| app_installs | install_rate | lt | 1.0 | warning |

El cliente puede editar o eliminar estos defaults desde la UI.

---

## 3. Modos de Operación (Autonomía del Sistema)

### Objetivo

Permitir que diferentes clientes elijan cuánto delegan al sistema de IA. Algunos quieren control total, otros quieren que el sistema actúe solo.

### Modos disponibles

| Modo | `operation_mode` | Comportamiento |
|---|---|---|
| Manual | `manual` | Solo recomendaciones. El cliente decide siempre. |
| Semi-automático | `semi_auto` | Auto-aplica recomendaciones con confidence ≥ 0.85 **y** tipo en `auto_apply_types`. El cliente puede revertir. |
| Delegado | `full_auto` | Go aplica todas las recomendaciones que superen el threshold. Cliente recibe notificación post-ejecución. |

### Por qué es valioso

Hay clientes que no quieren gestionar campañas — solo ver resultados. Para ellos, el valor es "delega y confía". Para otros, el valor es "recomendaciones precisas que yo ejecuto". El producto debe soportar ambos extremos.

### Implicación técnica en Go

En `usecases/optimization/apply_optimization_recommendation.go`, agregar lógica:
```go
// Si operation_mode == "full_auto" o (semi_auto + high confidence + tipo permitido):
//   → aplicar automáticamente y notificar
// Si manual:
//   → solo registrar la decisión del usuario
```

La verificación de `client_preferences` se hace en el use case, no en el handler.

---

## 4. Sistema de Alarmas con Defaults Inteligentes

### Objetivo

Las alarmas deben estar activas desde el primer día del cliente, con thresholds que tengan sentido para su tipo de negocio. El cliente las ajusta a medida que conoce sus métricas reales.

### Por qué

Un cliente nuevo no sabe qué thresholds configurar. Si el sistema no tiene defaults razonables, la feature de alarmas tiene zero adoption. Los defaults calibrados por tipo de negocio son el punto de entrada.

### Flujo

1. Cliente completa onboarding declarativo → `client_preferences` se guarda
2. Go llama a Python: `POST /internal/v1/alerts/generate-defaults` con `{ client_id, business_type, target_roas, max_cpa, ... }`
3. Python calcula thresholds y los inserta en `alert_configs`
4. Celery task `check_all_alert_thresholds` evalúa estos configs cada hora
5. Si se dispara una alarma: `alert_events` registra el evento, se notifica al cliente (email/in-app)

### Tablas requeridas (ya en el plan principal)

`alert_configs` y `alert_events` ya están definidas en el plan de migración. Solo necesitan el campo `severity` (`critical` | `warning` | `info`) y `notification_channels` (`TEXT[]`).

---

## 5. Contexto Histórico por Temporada y Producto

### Objetivo

Que Claude pueda decirle al cliente:
> "En Navidad del año pasado esta campaña gastó $12k y tuvo ROAS 4.2. Estás en noviembre — ¿quieres repetir la estrategia?"

> "El producto X ha drenado presupuesto 3 meses seguidos sin conversiones. Recomiendo pausarlo."

### Por qué

El conocimiento de temporalidad y de rendimiento por producto es información que el cliente tiene implícita pero no sistematizada. El sistema puede cuantificarlo y usarlo para recomendaciones proactivas.

### Cómo se implementa

- `campaign_event_embeddings` (ya en el plan): embebe eventos de campaña como texto y los almacena en pgvector
- Cuando un cliente tiene historial de 3+ meses, el nodo `retrieve_patterns` puede detectar patrones estacionales
- La narrativa de Claude incluye comparaciones temporales cuando hay datos suficientes
- **Mínimo de datos necesarios**: 30 días de historial para patrones simples, 90 días para estacionalidad

### Qué no cambia en Go

Go solo guarda los eventos de campaña en la tabla existente. Python hace el embedding y la búsqueda por similitud. Go no necesita saber de embeddings ni de pgvector.

---

## 6. Narrativas Causales Mensuales

### Objetivo

Un resumen mensual generado por Claude que el cliente recibe (email o in-app) con:
- Cuántas recomendaciones se generaron, aplicaron, rechazaron
- Cuáles acciones tuvieron resultado positivo/negativo con datos concretos
- Patrones identificados en la cuenta
- Recomendaciones para el mes siguiente

### Por qué

El cliente necesita ver que el sistema aprende y mejora. Sin narrativa explícita, el aprendizaje es invisible y el cliente no percibe el valor acumulado.

### Implementación

```
app/agents/summary_agent.py:
  - Corre el día 1 de cada mes a las 07:00 UTC (Celery Beat)
  - Input: todos los recommendation_outcomes del mes anterior
  - LangGraph: fetch_month_data → aggregate_stats → retrieve_patterns → call_claude → format_narrative
  - Output: documento guardado en tabla monthly_summaries (a crear)
  - Trigger: email o notificación in-app (a integrar con servicio de email externo)
```

---

## 7. Consideraciones de Compatibilidad para la Migración Go

Estas features futuras implican que en la migración Go se debe:

### 7.1 En `POST /optimize/apply`
Al guardar la decisión, **también guardar un snapshot de las métricas actuales** de la campaña como `baseline_metrics` (JSONB). Este campo se puede agregar a `optimization_decisions` o a una tabla nueva. Si no se guarda ahora, la feature de outcomes no puede funcionar retrospectivamente.

### 7.2 En el dominio `Client`
El struct `Client` en Go debe tener un campo `Preferences *ClientPreferences` que puede ser nil. No romperse si no existe todavía.

### 7.3 En el router
Reservar los prefijos de rutas:
- `PATCH /v1/clients/:id/preferences`
- `GET /v1/clients/:id/preferences`
- `GET /v1/clients/:id/outcomes` (historial de outcomes)
- `GET /v1/clients/:id/summaries` (resúmenes mensuales)

### 7.4 En `AgentsClient` (Go → Python)
El cliente HTTP interno debe estar diseñado para que agregar nuevos endpoints Python sea trivial. No hard-codear la lista de métodos — un método genérico `doRequest(method, path, body)` privado y métodos públicos tipados encima.

### 7.5 En las tablas existentes
`optimization_decisions` necesita campo `baseline_metrics JSONB` cuando se implemente outcomes. Planear la migración SQL en ese momento, no ahora.

---

## Estado de estas features

| Feature | Estado | Bloqueador |
|---|---|---|
| Sistema de aprendizaje (outcomes 7 días) | Diseñado, no implementado | Requiere `recommendation_outcomes` table + Celery task |
| Onboarding declarativo | Diseñado, no implementado | Requiere `client_preferences` table + wizard en front |
| Modos de operación (auto-apply) | Diseñado, no implementado | Requiere `client_preferences.operation_mode` + lógica en use case |
| Alarmas con defaults inteligentes | Diseñado parcialmente | `alert_configs` ya en el plan; falta `severity` y lógica de defaults |
| Contexto histórico por temporada | Diseñado parcialmente | `campaign_event_embeddings` ya en el plan; falta nodo LangGraph |
| Narrativas causales mensuales | Diseñado, no implementado | Requiere outcomes + `monthly_summaries` table |

**Prioridad sugerida post-migración**: onboarding declarativo → alarmas con defaults → outcomes 7 días → narrativas mensuales → contexto estacional.

---

## Contexto del frontend (relevante para estas features)

El frontend fue revisado en mayo 2026. Hallazgos clave:

- Existe botón "Aplicar" que llama `POST /v1/campaigns/{id}/optimize/apply` con `{ recommendation_id, decision: "accept" | "reject", override_params?, notes? }`
- Ya existe `latest_decision: { id, decision, created_at }` en el modelo de recomendación
- El flujo de optimización completo está en `OptimizePanel.tsx`
- **No existe**: wizard de onboarding por cliente, página de configuración de alarmas, vista de outcomes históricos, selector de modo de operación

Todo lo anterior deberá añadirse al frontend en fases posteriores, idealmente en paralelo con la implementación backend.
