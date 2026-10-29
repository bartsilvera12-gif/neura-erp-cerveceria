# Prueba del circuito de producción

Corre el circuito completo —planificar el lote, cocimiento, envasado y remisión
al Bar— contra un Postgres local, llamando a **las mismas funciones que usan las
rutas de la app**.

```bash
./scripts/circuito-produccion/preparar.sh
npm run test:circuito
```

## Qué verifica

| Paso | Qué se comprueba |
|---|---|
| Lote | Se crea en `planificado`, con el volumen envasado en 0. |
| Cocimiento | El consumo de insumos escala con el rendimiento (480 L de una receta de 500 L consumen 96 KG de malta y 960 G de lúpulo), la conversión KG↔G, el costo total y por litro, el alta del granel con su costo promedio, y los tres movimientos de inventario. |
| Etapas | El historial queda en orden. |
| Envasado | La conversión ML→L de la capacidad, los litros que consume, el costo del envase, el trigger que recalcula `volumen_envasado` y la merma del lote. |
| Guarda de envasado | Envasar más litros de los que quedan se rechaza y **no mueve stock**. |
| Remisión | La máquina de estados (despachar sin aprobar se rechaza), el emparejamiento por SKU entre sucursales, que el stock salga en el despacho y entre en la recepción, y que el destino herede el costo. |
| Cuadre | Los litros cierran: granel + chops×0,5 = lo que se produjo. |

## Cómo leer los resultados

**Las aserciones no miran lo que devuelven las funciones probadas: leen la base
con SQL crudo después de cada paso.** Lo que se verifica es el estado que quedó
guardado, no lo que la función dijo haber hecho.

## Lo que esta prueba NO es

`pgrest-shim.ts` intercepta `fetch` y traduce la petición que supabase-js ya
armó a SQL. **No es PostgREST**: si PostgREST se comporta distinto en algún
borde, esta prueba no lo va a ver. Por eso lo no implementado lanza en vez de
devolver algo plausible, y por eso las aserciones se hacen contra la base.

`01-schema.sql` es una reconstrucción a mano de las tablas que el circuito toca,
no un volcado del schema real: puede quedar desactualizado si la base cambia.
Los scripts `06` y `08` que aplica `preparar.sh` sí son los del repo.

La prueba cubre la lógica de servidor. No prueba las pantallas ni la
autenticación de las rutas.
