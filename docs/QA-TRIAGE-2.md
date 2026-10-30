# Segundo QA (proyecto WEGO) — qué aplica a la cervecería

Triage del QA que vino de otro fork. Varios puntos no aplican porque este ERP
no tiene esos módulos o ya están resueltos acá.

## Arreglado

| | Qué era | Qué se hizo |
|---|---|---|
| **CJ-01** | El ticket mostraba la hora +3 h | Era peor que el ticket, ver abajo |
| **IN-05** | Una salida podía superar el stock | Se rechaza, y ya no se pierde stock en silencio |
| **IN-06** | El ajuste manual se guardaba sin motivo | Motivo obligatorio |
| **IN-02a** | El buscador de productos no dejaba escribir | Pasa a `SearchableSelect` |
| **IN-02c** | La columna "Usuario" mostraba tres cosas distintas | Una sola regla: nombre, si no el email |
| **CP-01** | Dos proveedores con el mismo RUC | Comparación sin guiones + índice único en la base |
| **PP-03** | "Convertir" presupuesto daba error | Ya resuelto antes (ver `destino-pedido.ts`) |
| **PP-05** | Pedidos aparecía vacío | Ya resuelto antes (script 11) |

### CJ-01 era más grave que la hora del ticket

El servidor corre en UTC y los documentos usaban `getHours()`, o sea la hora
del contenedor. El QA lo vio en el ticket (16:44 → 19:44), pero el mismo
patrón estaba en el PDF de caja, la remisión de transferencia y el PDF de
orden de compra.

Y en un lugar que el QA no podía ver: **la firma de un evento de cancelación
SIFEN**. `rde-xml.ts` ya convertía a hora de Paraguay para las facturas —
hasta documenta que el SET devuelve el error 1004 "La fecha y hora de la firma
digital es adelantada" — pero `evento-cancelacion.ts` no. O sea que las
facturas se firmaban bien y las cancelaciones salían 3 horas adelantadas.

Ahora hay un solo lugar que decide: `src/lib/fecha/paraguay.ts`, con tests
(`npm run test:fecha-py`). Usa la zona IANA y no un `-3` fijo: si Paraguay
vuelve a mover la hora, lo arregla una actualización de tzdata.

### IN-05: no era sólo que faltara el aviso

El guardado hacía `Math.max(0, stock + delta)`. Una salida de 50 sobre 35
dejaba el producto en 0 **y registraba igual el movimiento de 50**: el kardex
decía una cosa y el stock otra, y las 15 unidades de diferencia desaparecían
sin que nada avisara. Ahora se rechaza antes de escribir, con el stock
disponible en el mensaje, y se valida en el guardado y no sólo en la pantalla
(la pantalla se puede saltear).

### CP-01: la validación existía y no alcanzaba

Había un chequeo de RUC duplicado, con tres agujeros:

1. Comparaba el texto exacto: `80012345-7` y `800123457` pasaban como
   distintos.
2. Si la consulta fallaba, el `catch` se lo tragaba y el insert corría igual.
   Justo cuando no se puede verificar es cuando más caro sale crear el
   duplicado.
3. Dos pedidos simultáneos pasaban los dos la comprobación.

Lo 1 y 2 se arreglaron en la app; lo 3 sólo lo puede cerrar la base, y para eso
está el script `16_proveedor_ruc_unico.sql`. Si ya hay duplicados cargados, el
script los lista y dice qué unificar en vez de fallar con un error críptico.

## No aplica a esta instancia

- **PP-01, FN-01 (logo de WEGO)**: esto es Zentra / Coven, no WEGO.
- **CJ-04, FN-02 a FN-05, RD-01 (facturación electrónica)**: es configuración
  del cliente ante el SET (certificado, timbrado, ambiente de prueba), no
  código. Sigue pendiente de su lado.
- **CJ-02, FN-08, RD-04 (entidades bancarias)**: hay que confirmar si en esta
  instancia hacen falta. El cobro por transferencia ya funciona sin entidad;
  la entidad es para conciliar.

## Segunda tanda

| | Qué era | Qué se hizo |
|---|---|---|
| **CP-02** | Anular compras | **Ya existía acá**: botón, modal, API y reversa de stock |
| **CP-02** | Eliminar compras | Se agregó, sólo sobre compras ya anuladas y sólo admin |
| **CP-03** | El N° de factura aceptaba cualquier cantidad de dígitos | Formato `001-001-0000001`, con máscara al tipear |
| **CP-03** | El timbrado no se validaba | 8 dígitos. El placeholder además mostraba el formato de la factura |
| **FN-06** | Gastos sin filtro por mes | Selector de mes + "Este mes" |
| **CP-02** | El desplegable de IVA tapaba la tabla | **No aplica**: acá el IVA es un control segmentado, no un desplegable |

### Eliminar compras: sólo las anuladas

Una compra registrada no es un papel. Sumó stock, pudo dejar una cuenta por
pagar y movió el costo promedio del producto. Borrar la fila no deshace nada de
eso: deja el stock inflado y el kardex con una entrada sin origen, y nadie se
entera hasta el próximo conteo.

Anular sí deshace todo eso. Por eso el camino es anular primero y, si además no
se la quiere ver más en la lista, borrarla después: para entonces ya no queda
nada colgando. La condición se comprueba en el servidor y no sólo en la
pantalla, porque el botón se puede saltear llamando a la URL.

## Pendiente, falta el detalle para reproducir

- **CP-02 / CP-05**: el error de Cuentas por pagar. Hace falta el mensaje
  exacto.
- **RD-06**: el error en Reportes → Proveedor. Ídem.
- **IN-02b**: el historial de entradas no se refresca al crear productos.
- **CP-03**: que los datos de facturación de la orden de compra pasen a la
  compra en vez de volver a pedirse.
