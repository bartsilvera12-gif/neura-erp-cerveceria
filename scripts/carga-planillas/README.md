# Generador de la carga de planillas

El script `supabase/cerveceria/12_carga_coven_planillas.sql` se genera, no se
escribe a mano:

```bash
python3 scripts/carga-planillas/generar.py
```

- `catalogo.py` — la correspondencia entre lo que dice la planilla y lo que
  entra al ERP: SKU, unidad base y costo por unidad de cada insumo, y las
  recetas. Lo decide una persona y queda escrito, porque las planillas tienen
  el mismo insumo con varios nombres, unidades mezcladas dentro de una celda de
  texto y precios que a veces son por unidad y a veces por línea.
- `lotes.py` — lee los 15 lotes de las dos planillas de cocción.
- `probar.sh` — levanta un PostgreSQL 16 descartable y corre el script dos
  veces para verificar que es idempotente y que no toca stock.

Las planillas de origen no están en el repo. `lotes.py` apunta a donde se
dejaron; hay que ajustar `DIR` si se vuelven a generar desde otra copia.

Los supuestos y lo que quedó pendiente están en `docs/CARGA-PLANILLAS-COVEN.md`.
