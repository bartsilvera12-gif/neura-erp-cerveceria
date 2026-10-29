# Carga de las planillas de COVEN

Qué cargan los scripts 12, 13 y 15, de dónde sale cada número y qué quedó
pendiente de confirmar.

Las planillas de origen son `coccion-grande.xlsx` (3 lotes de 500 L),
`coccion-pequena.xlsx` (12 lotes piloto), `coven_costeo_500l_y_precios.xlsx` y
`inventario-fabrica.xlsx`. Las cuatro ya están cargadas, con los scripts 12
(insumos, recetas y lotes), 13 (inventario de planta) y 15 (compras).

Los scripts no se escribieron a mano: los generan los `generar*.py` de
`scripts/carga-planillas/`, desde el catálogo de `catalogo.py` y el parseo de
`lotes.py`, `inventario.py` y `compras.py`. Se pueden volver a generar si
cambian las planillas.

## Lo que deja

| | |
|---|---|
| Proveedores | Mercado Craft, Cerveshopp |
| Insumos | 25 productos con `es_insumo`, con costo por unidad base |
| A granel | 4 productos en litros, uno por estilo |
| Recetas | Session IPA 500 L (activa) + 3 piloto (inactivas) |
| Lotes | 15, todos en estado `cerrado` |

## Decisiones que conviene conocer

**Los lotes no inflan el stock.** Los 15 ya se produjeron y sus insumos ya se
consumieron. El script 12 los carga como historia cerrada, con el consumo y el
costo en `observaciones`, sin tocar inventario. El 15 sí mueve stock, pero las
dos puntas: entra por la compra y sale por el cocimiento, la misma cantidad el
mismo día, así que el neto es cero.

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

1. **Levadura New England.** La planilla dice 699.000 Gs por "NEW E 11GR", o
   sea 63.545 Gs/g, que no parece el precio de un sachet de 11 g. Igual se
   cargó tal cual con el script 15: la receta usa los mismos 11 g que dice la
   planilla, así que el costo del lote sale bien aunque el peso del envase esté
   mal escrito. Si el envase resulta ser de otro tamaño, hay que corregir la
   cantidad en los dos lados a la vez (la compra y la receta); corregir uno
   solo rompe el total.

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

## Compras históricas (script 15)

El costeo de una receta multiplica cantidad por el `costo_promedio` del insumo,
y ese costo lo llena el ERP con las compras. Sin ninguna compra cargada todo el
costeo daba 0. El script 15 carga las 15 compras (129 líneas) que están en las
planillas de cocción, una por lote.

**El stock no queda inflado.** Cada fila de las planillas es lo que se compró
*para* ese lote, así que compra y consumo son la misma cantidad: el script
carga las dos puntas, la entrada por la compra y la salida por el cocimiento.
Cargando sólo las compras, el depósito quedaría con 1.400 kg de malta que se
usó hace meses.

**El IVA no se inventa.** Las planillas traen un importe y nada más. Las
compras entran como `exenta` con IVA 0, y se reconocen porque su
`numero_control` empieza con `HIST-`. **No sirven para el libro de IVA**: están
para costear.

**El proveedor se crea si falta.** `compras.proveedor_id` es NOT NULL, así que
el proveedor no es opcional: si el script 12 no lo dejó, el 15 lo crea y avisa
por `NOTICE`. La primera versión del 15 lo daba por hecho y fallaba con un
error de constraint que no decía qué hacer.

**El costo que queda es el de la última compra**, no un promedio. Es lo que
hace el ERP cuando se carga una compra desde la pantalla, pese al nombre de la
columna `costo_promedio`. Se replicó igual para que el número no dependa de por
dónde se cargó.

Por eso una receta puede costar algo distinto que el lote que la originó: el
lote pagó cada pack a su precio (el de 200 g sale más barato por gramo que el
de 50 g) y la receta usa un único costo por gramo, el último. En la Session IPA
500 L son 3.250 Gs sobre 3.143.320, o sea 0,1 %.

### Dos insumos quedan sin costo

`MP-CARADEX` y `LV-AY4`. Los usa la receta del script 07 pero ningún lote de
las planillas los compró nunca:

- **MP-CARADEX** es la "Caradextrina" del script 07, que probablemente sea la
  misma malta que las planillas compran como "Cara Clair" (ver el punto 3 de
  arriba). Las dos aparecen en la misma línea de la misma receta y en la misma
  cantidad, 4,17 kg.
- **LV-AY4** es la levadura Fermoale AY4 que dice la receta, pero los tres
  lotes de 500 L usaron Safale US-05.

Mientras sigan en 0, la receta Coven Blonde Ale 500 L costea 1.422.474 Gs
cuando el lote real costó 2.244.729. Un insumo sin costo no rompe nada: deja la
receta más barata de lo que es, que es peor, porque no se nota. La última
consulta del script 15 los lista.

## Lo que todavía no se cargó

- **El modelo de costeo operativo**: mano de obra, energía, agua y overhead por
  lote. El ERP ya tiene dónde ponerlos (script 14, pantalla *Costeo completo y
  precios*), pero los números de la planilla todavía no se cargaron.

## Cómo se probó

`scripts/carga-planillas/probar.sh` levanta un PostgreSQL 16 descartable, aplica
el esquema base y los scripts 06, 07 y 08, y después corre el 12 **dos veces**.
Comprueba que los conteos no cambian entre corridas, que no se generó ningún
movimiento de inventario, que ningún producto quedó con stock distinto de 0, y
que el costeo de la Session IPA 500 L reconcilia con el lote 2 de la planilla.
