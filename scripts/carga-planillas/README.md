# Generador de la carga de planillas

Los scripts 12, 13 y 15 de `supabase/cerveceria/` se generan, no se escriben a
mano:

```bash
python3 scripts/carga-planillas/generar.py             # 12
python3 scripts/carga-planillas/generar_inventario.py  # 13
python3 scripts/carga-planillas/generar_compras.py     # 15
```

- `catalogo.py` — la correspondencia entre lo que dice la planilla y lo que
  entra al ERP: SKU, unidad base y costo por unidad de cada insumo, y las
  recetas. Lo decide una persona y queda escrito, porque las planillas tienen
  el mismo insumo con varios nombres, unidades mezcladas dentro de una celda de
  texto y precios que a veces son por unidad y a veces por línea.
- `lotes.py` — lee los 15 lotes de las dos planillas de cocción.
- `inventario.py` — los 57 artículos de planta, con sus nombres corregidos.
- `compras.py` — las compras de cada lote, pasadas a la unidad base del ERP
  (un "CASCADE 200G" con cantidad 2 son 400 g, no 2).
- `probar.sh` — levanta un PostgreSQL 16 descartable y corre los scripts 12, 13
  y 15 dos veces, para verificar que son idempotentes, que el stock de los
  insumos queda en cero y que los totales por lote dan igual que la planilla.
- `probar-sin-12.sh` — el caso de correr el 15 sin haber corrido el 12: tiene
  que listar todos los insumos que faltan de una vez y no escribir nada.

Las planillas de origen no están en el repo. `lotes.py` apunta a donde se
dejaron; hay que ajustar `DIR` si se vuelven a generar desde otra copia.

Los supuestos y lo que quedó pendiente están en `docs/CARGA-PLANILLAS-COVEN.md`.
