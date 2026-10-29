# Carga de las planillas de COVEN

Qué carga `supabase/cerveceria/12_carga_coven_planillas.sql`, de dónde sale cada
número y qué quedó pendiente de confirmar.

Las planillas de origen son `coccion-grande.xlsx` (3 lotes de 500 L),
`coccion-pequena.xlsx` (12 lotes piloto), `coven_costeo_500l_y_precios.xlsx` y
`inventario-fabrica.xlsx`. El script carga **las dos de cocción**. El inventario
de planta y el modelo de costeo todavía no.

El script no se escribió a mano: lo genera `scripts/carga-planillas/generar.py`
desde el catálogo de `catalogo.py` y el parseo de `lotes.py`, así que se puede
volver a generar si cambian las planillas.

## Lo que deja

| | |
|---|---|
| Proveedores | Mercado Craft, Cerveshopp |
| Insumos | 25 productos con `es_insumo`, con costo por unidad base |
| A granel | 4 productos en litros, uno por estilo |
| Recetas | Session IPA 500 L (activa) + 3 piloto (inactivas) |
| Lotes | 15, todos en estado `cerrado` |

## Decisiones que conviene conocer

**No mueve stock.** Los 15 lotes ya se produjeron y sus insumos ya se
consumieron. Si el script generara movimientos de inventario descontaría otra
vez una malta que no está en el depósito y dejaría el stock en negativo. Entran
como historia cerrada, con el consumo y el costo en `observaciones`.

**No pisa un costo que ya exista.** Si un insumo ya tiene `costo_promedio`
distinto de 0 (porque hubo compras), el script no lo toca: el CPP del ERP manda
sobre la planilla. El número de la planilla es sólo el arranque para los
insumos sin ninguna compra cargada.

**Las recetas piloto quedan inactivas.** Las planillas no dicen cuántos litros
rinde cada cocimiento chico, y una receta sin rendimiento real costea
cualquier cosa. Las cantidades de insumo sí son las reales. Al final del script
están los `UPDATE` para cargarles el volumen y activarlas.

**Los precios de pack se convirtieron a unidad base.** Un pack de Cascade de
200 g a 101.600 Gs queda como 508 Gs/g, que es la unidad con la que se escribe
la receta. El redondeo de esa división representa 0,1 % del costo de un lote.

## Pendientes de confirmar con el cliente

1. **Levadura New England.** La planilla dice 699.000 Gs por "NEW E 11GR". A
   63.545 Gs/g no parece el precio de un sachet de 11 g. Se cargó con **costo
   0** en vez de propagar un número que creemos equivocado: por eso el costeo
   de la receta Session IPA 500 L da 2.441.070 Gs y el lote real de la planilla
   3.143.320 Gs. La diferencia es exactamente esos 699.000 más el redondeo.

2. **Citra Cryo.** La planilla lo mide en "1 LITRO" y es un lúpulo, que se pesa.
   Se cargó asumiendo **1 litro = 1 kg** (445 Gs/g). Si el envase es de otro
   peso, hay que corregir el costo.

3. **Cara Clair contra Caradextrina.** El script 07 había creado
   `MP-CARADEX` ("Malta Caradextrina UMA") y las planillas compran "Cara Clair"
   / "Clara Clair". Quedaron como **dos insumos distintos** porque no nos consta
   que sean lo mismo. Si lo son, se unifican con:

   ```sql
   UPDATE cerveceriaerp.receta_items SET insumo_producto_id =
     (SELECT id FROM cerveceriaerp.productos WHERE sku = 'MP-CARACLAIR')
    WHERE insumo_producto_id =
     (SELECT id FROM cerveceriaerp.productos WHERE sku = 'MP-CARADEX');
   UPDATE cerveceriaerp.productos SET activo = false WHERE sku = 'MP-CARADEX';
   ```

4. **RUC de los proveedores.** Las planillas no lo traen y se cargó en NULL. Sin
   RUC no se les puede registrar una compra ni una factura.

5. **US-05 tiene dos precios muy distintos.** 1.422 Gs/g comprado en brick de
   500 g (Mercado Craft) contra ~3.043 Gs/g en sachet (Cerveshopp). Se cargó el
   de brick, que es el más reciente. Es un solo producto: el ERP promedia los
   dos con las compras reales.

6. **Lote 5 piloto.** Figura como "AM. AMBER ALE SUEVE" pero tiene exactamente
   la misma carga de granos que el lote 3, que es Blonde. Parece copiado. Se
   cargó el lote tal cual pero **no** se creó una receta de Amber con esa carga.

7. **Lote 8 piloto.** Tiene una línea "CASCAD20G+AMARI20G" con dos lúpulos en
   una sola fila y cantidad 20 g, que no cuadra con el nombre. En la receta
   piloto se interpretó como 20 g de cada uno.

8. **Numeración y fechas.** En `coccion-grande` el lote 3 es anterior a los
   lotes 1 y 2 (09/08 contra 23/08 y 27/08) y venía con la fecha sin formatear.
   En `coccion-pequena` el lote 7 es posterior al 8 y no hay lote 1. Los códigos
   del ERP (`COC-G-nn`, `COC-P-nn`) respetan la numeración de la planilla.

## Lo que todavía no se cargó

- **`inventario-fabrica.xlsx`**: 57 ítems de ferretería y repuestos con su
  ubicación física. Hay 8 con cantidad `0000`, que parece "sin contar" y no
  "cero"; hay que decidirlo antes de cargarlos.
- **El modelo de costeo**: mano de obra, energía, agua y overhead por lote, y el
  simulador de precio por formato. Hoy vive sólo en la planilla.

## Cómo se probó

`scripts/carga-planillas/probar.sh` levanta un PostgreSQL 16 descartable, aplica
el esquema base y los scripts 06, 07 y 08, y después corre el 12 **dos veces**.
Comprueba que los conteos no cambian entre corridas, que no se generó ningún
movimiento de inventario, que ningún producto quedó con stock distinto de 0, y
que el costeo de la Session IPA 500 L reconcilia con el lote 2 de la planilla.
