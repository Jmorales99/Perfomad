# Plai API Data Documentation

## 📊 Datos Reales vs. Simulados

### ✅ Datos REALES que Plai API Proporciona

Según la documentación de Plai (https://docs.plai.io/introduction), Plai API actualmente soporta **Meta Ads (Facebook/Instagram)** y puede proporcionar:

#### Endpoints Disponibles:
- `POST /meta/campaign/create` - Crear campañas en Meta
- `GET /meta/campaign/:id/overview` - Obtener métricas de campaña
- `POST /meta/get_campaign_insights` - Obtener insights y recomendaciones
- `POST /meta/update_campaign_status` - Actualizar estado de campaña
- `POST /meta/update_campaign_budget` - Actualizar presupuesto

#### Métricas que Plai API Proporciona (REALES):
Basado en las capacidades típicas de Meta Ads API que Plai integra:

1. **Métricas Básicas** (✅ REALES - vienen de Meta Ads):
   - `spend` - Gasto real en la campaña
   - `impressions` - Impresiones reales de los anuncios
   - `clicks` - Clics reales en los anuncios
   - `ctr` (Click-Through Rate) - Calculado desde clicks/impressions
   - `reach` - Alcance real de la campaña

2. **Métricas de Conversión** (✅ REALES si están configuradas en Meta):
   - `conversions` - Conversiones rastreadas por Meta Pixel/Events
   - `cost_per_conversion` - Costo por conversión
   - `cost_per_click` (CPC) - Costo por clic

3. **Métricas Calculadas** (✅ REALES - calculadas desde datos de Meta):
   - `cpm` (Cost Per 1000 Impressions) - Calculado desde spend/impressions
   - `cpa` (Cost Per Acquisition) - Calculado desde spend/conversions

4. **Revenue/Sales** (⚠️ PARCIALMENTE REAL):
   - Plai/Meta NO rastrea directamente `revenue` o `total_sales`
   - Esto requiere configuración adicional (Meta Pixel con eventos de valor)
   - **Solución actual**: Usamos `product_price` del usuario para calcular `revenue = conversions × product_price`
   - Esto es **real** porque usamos conversiones reales de Meta × precio real del producto

### 🎭 Datos SIMULADOS (Mock API en Desarrollo)

En el entorno de desarrollo, cuando usamos el **Mock API** (`MOCK_API_URL`), estos datos son simulados pero realistas:

1. **Generación Incremental**: 
   - Cuando sincronizas métricas, el mock API genera incrementos del 15% diario simulando crecimiento real
   - Los valores base aseguran que nunca tengas 0 en campañas activas
   - Los incrementos son consistentes y basados en datos históricos almacenados

2. **Datos Base Mínimos** (cuando no hay historial):
   - Impresiones: 5,000 - 55,000 (basado en seed de campaña)
   - Clics: 100 - 2,100 (basado en seed)
   - Spend: $50 - $1,050 (basado en seed)
   - Conversiones: 10 - 110 (basado en seed, ~5% conversion rate)

3. **Datos Incrementales** (cuando hay historial):
   - Crecimiento del 15% diario (simula 12 horas entre sincronizaciones)
   - Variación aleatoria del 8% para simular variación natural
   - Los valores crecen consistentemente pero con variación realista

### 🔄 Flujo de Datos

```
1. Usuario crea campaña → Backend llama Plai API → Plai crea campaña en Meta Ads
2. Usuario sincroniza métricas → Backend llama GET /meta/campaign/:id/overview
3. Plai API retorna métricas REALES de Meta Ads
4. Backend calcula métricas derivadas (CPA, ROA, etc.) usando MetricsCalculator
5. Backend guarda:
   - RAW data (datos originales de Plai/Meta) en `raw_data_plai`
   - Calculated metrics en `mock_stats`
   - Historical snapshot en `campaign_metrics_history`
```

### 📝 Notas Importantes

1. **Revenue Calculation**:
   - Si Meta/Plai no proporciona `revenue`, lo calculamos usando `product_price` del usuario
   - Esto es **real** porque usa conversiones reales × precio real del producto
   - NO inventamos revenue - siempre requiere `product_price` del usuario o datos de Plai

2. **ROA Calculation**:
   - Si tienes `product_cost`, calculamos ROA basado en **profit** (revenue - costos)
   - Si no tienes `product_cost`, calculamos ROAS (Return on Ad Spend) basado en revenue
   - Ambos son válidos - ROA basado en profit es más preciso para rentabilidad real

3. **Histórico de Métricas**:
   - Cada sincronización guarda un snapshot en `campaign_metrics_history`
   - Esto permite ver tendencias y generar gráficos históricos
   - El mock API usa estos snapshots para generar incrementos realistas

### 🚀 En Producción

Cuando uses la API real de Plai en producción:
- Todas las métricas básicas (spend, impressions, clicks, conversions) serán **100% reales** de Meta Ads
- El cálculo de revenue dependerá de si tienes Meta Pixel configurado con eventos de valor
- Si no, usaremos `product_price` del usuario (que sigue siendo real, solo calculado)
- Los insights y recomendaciones vendrán del sistema de optimización de Plai

