# QA del otro proyecto, revisado contra el ERP de la cervecería

El listado de QA viene de otra instancia del ERP. Este documento dice, punto por
punto, qué pasa en **este** sistema: qué estaba roto y ya se arregló, qué nunca
existió acá, qué ya estaba resuelto, y qué queda pendiente con su motivo.

Las imágenes del QA no se adjuntaron, así que los puntos que dependen de ver el
error exacto están marcados.

---

## 1. Arreglado

| # | Punto del QA | Qué pasaba de verdad |
|---|---|---|
| 1 | El cursor salta al escribir un correo (`p@gmail.comrueba`) | Los formularios pasaban el valor a minúsculas en **cada tecla**, y un `input type="email"` no expone `selectionStart`: React no puede restaurar la posición del cursor y el caret salta al final. Encima el autocompletado del navegador ofrecía el correo del operador. Ahora el correo no se transforma mientras se tipea (se normaliza al salir del campo y al guardar) y los campos llevan `autoComplete="off"`. Afecta clientes, proveedores, proveedor rápido de compras, CRM y empresas. |
| 2 | Se guarda "MARIA" en RUC y "123456" en NOMBRE | No había validación de formato. Se agregó `src/lib/validacion/documentos.ts` (RUC, cédula, nombre, correo, teléfono) y se valida antes de guardar en clientes (nuevo y editar), proveedores (nuevo y editar) y el proveedor rápido de compras. El criterio es rechazar lo que claramente no es el dato sin trabar la carga real: el RUC entra con y sin dígito verificador, y "AGRO 3 S.A." sigue siendo un nombre válido. |
| 3 | La columna ACCIONES de Inventario, pegada a MARGEN/VENTA | Tiene aire a los dos lados y un separador que la despega de los números. |
| 4 | En Movimientos, una ENTRADA de +2 sumaba 4 | El botón no daba ninguna señal de estar trabajando y el guardado tarda lo suficiente para que el usuario vuelva a apretar: quedaban dos movimientos. Ahora pasa a "Guardando…", queda bloqueado, y un ref corta el segundo envío en el mismo tick. Además el update de stock ahora es condicional sobre el valor leído, con reintento: antes dos movimientos simultáneos se pisaban y uno se perdía sin dejar rastro. |
| 5 | Depósito/ubicaciones no muestra el stock | Ubicaciones ahora muestra productos, unidades y valorizado por ubicación, con totales al pie. La suma sale de la ubicación principal de cada producto, acotada a la sucursal activa (las ubicaciones son de la empresa, los productos son de una sucursal; sin el filtro Cervecería y Bar se sumaban juntos). Ver también el punto en *Pendiente* sobre stock parcial por depósito. |
| 6 | La lista de Gestión de Clientes no se desplaza con más de 3 clientes | El desplegable del buscador es `absolute` y la tarjeta que lo contiene tenía `overflow-hidden`: la lista quedaba recortada por el borde y era imposible llegar al scroll de adentro. Se saca el recorte y el desplegable crece hasta 60vh en vez de 256px. |
| 7 | El 0 queda por delante en Nivel / Rendimiento / Datos de la receta | Un `<input type="number" value={n}>` controlado contra un número no se puede vaciar: al borrar el último dígito el `\|\| 0` lo devuelve y React lo reescribe, así que lo tipeado se suma detrás. Se agregó `NumeroInput`, aplicado en rendimiento y merma de receta, capacidad de formato, cantidad a fabricar, cantidad usada del insumo, volumen y capacidad en Producción, cantidad y costo en Órdenes de compra, y cuotas. |
| 8 | ¿Es correcto que la HARINA a 20.000/KG dé 20 millones de subcosto? | **No, y el cartel era el culpable.** La tabla mostraba el costo y el stock del insumo —que están en la unidad del producto, por ejemplo KG— rotulados con la unidad de consumo de la receta, por ejemplo G: una harina de 20.000/KG se leía "Gs. 20.000/G". Con ese rótulo es imposible ver si el costo se cargó por kilo o por gramo, que es justo lo que hace que el subcosto salga mil veces más grande. Ahora cada número lleva su unidad real, hay una columna de consumo efectivo en la unidad del insumo, y una nota que dice que eso se corrige en Inventario. La fórmula del costeo estaba bien. |
| 9 | No deja agregar más de un insumo | En esta instancia el botón se quedaba **mudo** cuando la cantidad era 0: no agregaba ni avisaba. Ahora dice qué falta. |
| 10 | Al crear una categoría de proveedor falta borrar, y Activo Sí/NO parece texto | Se agregó borrar (el backend se niega si algún proveedor la tiene asignada, y dice cuántos son) y el Sí/No ahora tiene borde, punto de color y tooltip. |
| 11 | Anular compra da un error | La cuenta por pagar se leía con `maybeSingle()`: una compra con dos filas de CxP hacía fallar la anulación con el error crudo de PostgREST. Ahora se leen todas, se anulan todas las vivas, y los errores de base van al log con mensajes legibles. **Sin la imagen del error no puedo confirmar que sea la misma causa** — si sigue fallando, mandame la captura o el log y lo cierro. |
| 12 | No deja anular un gasto/servicio | Acá no existe "anular" gasto (la tabla no tiene estado), solo **eliminar** — y eliminar fallaba en silencio: el `catch` estaba vacío y el delete no verificaba haber borrado nada, así que el gasto desaparecía de la lista y volvía al recargar. Pasa con los gastos cargados antes de multi-sucursal, que quedaron con `sucursal_id` nulo. Ahora se avisa y se dice qué hacer. |
| 13 | El panel post-venta no tiene X para salir | Tiene X y "Cargar otra venta", y los dos reinician la pantalla. Eso último importa: el carrito **no se vaciaba** al registrar la venta, así que quedarse en la página con los mismos ítems habilitaba vender dos veces lo mismo. |
| 14 | La "Nota" del cliente es un cuadro grande sin interacciones | Se agregó editar y eliminar, con la lista en tarjetas y los errores a la vista. De paso el id de la nota era `Date.now()` a secas: dos notas en el mismo milisegundo compartían id, y editar una habría tocado las dos. |
| 15 | La nota de crédito no tiene botón para crear una nueva | Es a propósito: SIFEN exige el documento asociado, así que la NC se emite **desde la factura que corrige**. Lo que faltaba era decirlo: ahora la pantalla lo explica y tiene un botón a Facturas. |
| 16 | En Nueva Venta no hay pago mixto | Hecho. Nueva venta tiene un cuarto método, **Mixto**, que reparte el total entre efectivo, transferencia y tarjeta, con el resto a la vista y un botón para cerrar la diferencia. El reparto se guarda en la propia venta (`pagos_desglose`) y **el arqueo de caja lo suma**: cada método cuenta lo propio más la porción que le toca de las ventas mixtas, así que el efectivo esperado coincide con el cajón. Requiere correr `supabase/cerveceria/10_pago_mixto.sql`. |
| 17 | El pago mixto figura en el recibo pero no en la factura | El recibo de una venta mixta antes decía el método de la **última** fila de detalle: una venta mitad efectivo mitad transferencia salía como "transferencia" entera. Ahora el recibo marca cada método con su monto, el ticket imprime el desglose, y la pantalla de la factura lo muestra en el resumen comercial. Lo que **no** cambió es el XML fiscal: ver el pendiente de SIFEN. |

---

## 2. No aplica: ese módulo no existe en la cervecería

Esta instancia tiene estos módulos: dashboard, omnicanal (conversaciones,
historial, monitoreo), ventas, presupuestos, **recetas**, **producción**,
reposición, inventario, clientes, compras, gastos, reportes, pagos, comisiones,
notas de crédito, usuarios, configuración, planes, gestión de clientes, CRM,
marketing, sorteos, campañas y proyectos.

No hay contabilidad, ni RRHH, ni logística. Por eso quedan afuera:

- **Plan de cuentas / Nueva cuenta / Nivel 02 / Cuenta contable / Cuenta de pago.** No hay módulo de contabilidad. Lo que el QA llama "cuenta de pago" acá es **Configuración → Entidades bancarias**, que es lo que se elige al cobrar por transferencia o tarjeta.
- **Camiones.** No hay módulo de logística ni flota.
- **Equipos y supervisión.** No es un módulo de esta instancia; el "Módulo no habilitado" es correcto.
- **RRHH: cargar empleados, bajar planilla de ejemplo, marcar asistencia con cédula, historial del empleado, comisión con porcentaje, dar de baja/borrar empleados.** No hay módulo de RRHH. Lo más cercano es **Comisiones**, que calcula sobre el vendedor asignado a la venta, y **Usuarios**, que son los accesos al sistema, no legajos.
- **Conteo físico (seguir contando, signo del faltante).** No existe acá.
- **Mermas y devoluciones.** No existe como módulo. Ventas sí tiene **Devoluciones** (`/ventas/devoluciones`), que es otra cosa.
- **Recepciones: "solo edita la fecha".** Hay `/inventario/reposicion/recepciones`, pero con otro flujo que el del QA. Hace falta revisarlo contra el manual de esta instancia, no contra el del otro proyecto.
- **Lotes con vencimiento.** Producción tiene **lotes de fabricación** (fermentador, etapas, envasado), que no son lotes de vencimiento de mercadería.

---

## 3. Ya estaba resuelto en esta instancia

- **Transferencias entre sucursales.** Es el módulo **Reposición** (`Inventario → Reposición`), activo en esta instancia. Tiene el circuito completo: solicitar, aprobar o rechazar, despachar (descuenta el stock del origen), recibir (lo suma en el destino), cancelar, nota de remisión y sugerencia de faltantes. Los productos se emparejan **por SKU** entre las dos sucursales — por eso el script 09 le da al granel del Bar el mismo SKU que el de la Cervecería: es lo que permite remitir de una a la otra.
- **Producción.** Módulo **Producción**, activo. Cubre lo que pide el checklist: fermentadores con su capacidad y su ocupación, lotes con código y fechas, las etapas (cocimiento → fermentación → maduración → carbonatación → envasado → cerrado) con quién y cuándo registró cada una, el consumo de insumos vía receta, el volumen obtenido, el envasado por formato y la merma real (lo obtenido menos lo envasado).

- **Producto tipo "Menú".** Inventario → nuevo producto arranca eligiendo el tipo: *Reventa*, *Producto del menú* o *Materia prima*. El menú es el que habilita la receta, así que el mensaje "primero creá un producto de tipo Menú sin receta" tiene con qué cumplirse.
- **"Se vende" en reventa y terminados.** Reventa dice "Se compra y se vende tal cual"; Menú dice "Se vende en Ventas y genera pedido"; y hay una marca explícita "Vendible (se vende al cliente final)".
- **Categoría de proveedor.** Existe en **Proveedores → Rubros de proveedor**, y los rubros se importan solos como categorías de Inventario. (Le faltaba el borrar, ver punto 10.)
- **Tarjeta en Nueva venta.** Están Efectivo, Transferencia y Tarjeta/Débito, con su modal de entidad, titular y referencia.
- **Compras de insumo.** El buscador de productos de compras usa `contexto=compra`, que incluye materia prima **y** insumos además de los vendibles.
- **IVA en Órdenes de compra.** Cada línea tiene su IVA (exenta / 5 % / 10 %). Queda por revisar si se muestra bien en la orden **ya guardada** (ver *Pendiente*).
- **Configuración visible al admin.** Está en el menú lateral como módulo propio, no se llega por Bancos.

---

## 4. Pendiente, con el motivo

| Punto | Por qué no lo cerré todavía |
|---|---|
| **El tipo de pago que se declara a SIFEN** | Pago mixto ya está hecho (ver más abajo), pero el XML fiscal sigue declarando **todo cobro al contado como "Efectivo" por el total**, que es como venía de antes: una venta con tarjeta también se declara así. Corregirlo significa emitir un `gPaConEIni` por método con su `iTiPago`, y para tarjeta el manual de la SET pide además el grupo de datos de tarjeta. Eso hay que validarlo contra el manual y el ambiente de pruebas de la SET: si el código o el grupo van mal, la SET **rechaza la factura**, que es mucho peor que un tipo de pago impreciso. No lo toqué a ciegas. |
| **Stock parcial por depósito** | Ya se ve el stock por ubicación (punto 5), pero sale de la ubicación **principal** de cada producto: un producto está entero en un depósito. La tabla `inventario_stock_ubicacion` existe en la base pero nadie la escribe ni la lee, y los movimientos de inventario no registran ubicación, así que repartir un mismo producto entre dos depósitos todavía no es real. Es un desarrollo aparte. **Ojo**: esto es sobre *ubicaciones dentro de una sucursal*. Mover stock **entre sucursales** (Cervecería ↔ Bar) sí está hecho: es el módulo **Reposición**, ver abajo. |
| **Stock consolidado para el admin** | Del checklist de la cervecería, no de este QA. Choca con la decisión de dejar el stock fuera de la vista consolidada, porque el mismo SKU existe en Cervecería y en Bar. Sigue pendiente de definición. |
| **Carta del bar con combos** | Del checklist de la cervecería. Pendiente. |
| **"Cobrar" en Factura Venta no guarda** / **Historial del cliente dice `duplicate_blocked`** / **PDF de comprobante da error** / **Recepciones solo edita la fecha** / **IVA no visible en la orden guardada** | Son cinco bugs concretos que hay que reproducir uno por uno en esta instancia. No los toqué todavía: adivinar la causa sin verlos es como terminé con el de anular compra, arreglando algo plausible sin poder confirmarlo. Decime si sigo por acá y los cierro con el detalle de cada uno. |
| **Usuario con permisos limitados ve todo, y después el admin no puede entrar** | Es el más delicado de la lista: si es real, es un agujero de permisos. Necesita revisarse aparte y con cuidado, no de pasada entre arreglos visuales. |
| **Las credenciales no se guardan al entrar** | Es sesión/cookies, no formulario. Hay que ver si es el `maxAge` de la cookie de Supabase o el refresh del token. Aparte. |
| **Caja entra directo a una venta con 2 productos cargados** | No pude reproducirlo sin ver la pantalla. Suena a que Caja abre un pedido pendiente precargado (`/ventas/nueva?pedido_id=`). Mandame la captura y lo sigo. |
| **Compras: editar y eliminar** | Anular ya existe (y ahora anula también la cuenta por pagar). Editar una compra ya registrada es otra cosa: habría que revertir stock y costo promedio y volver a aplicarlos, y el costo promedio pudo haber cambiado con compras posteriores. Es un desarrollo con reglas que hay que definir, no un botón. |
| **Nota de crédito: panel más simple** | Ahora se explica de dónde se emite (punto 15). Simplificar el panel de corrección fiscal es un rediseño: ese panel maneja el ciclo SIFEN completo (borrador, XML, firma, envío, KUDE) y sacarle pasos puede dejar notas sin emitir. Prefiero hacerlo con un criterio tuyo de qué se usa y qué no. |
| **Tipificación del cliente: botones y cuadro** | Mismo tratamiento que las notas (punto 14). Lo dejé para la tanda siguiente. |
| **Estado de cuenta asimétrico** / **Recepciones y Órdenes de compra con los campos disparejos** / **Historial de producción encimado** | Son alineaciones. Sin las imágenes y contra **esta** maqueta, que no es la del QA, corro el riesgo de "arreglar" algo que acá se ve bien. Con una captura de cada una las cierro rápido. |

---

## 5. Respuestas a las preguntas del QA

- **"Fabricar una cantidad que el stock cubre".** Es probar el camino feliz de producción: en una receta, tocar **Fabricar** y pedir una cantidad para la que **sí** hay materia prima. El sistema descuenta los insumos y da de alta el producto terminado. Si pedís más de lo que el stock aguanta, muestra los faltantes y no fabrica (o te deja forzarlo dejando esos insumos en 0). El punto del QA es confirmar que con stock suficiente la fabricación pasa sin avisos.
- **PDV.** Punto de venta: la pantalla donde el cajero cobra. Acá es **Nueva venta** más **Caja**.
- **Punto 5.3 ("iniciar y finalizar el relleno", "En Curso").** Es del flujo de conteo físico del otro proyecto: una planilla de conteo que pasa de *En curso* a *En proceso* y se cierra. En esta instancia no hay conteo físico, así que ese punto no tiene dónde probarse.
- **Punto 10.1 ("cargar empleados"), 10.12 ("bajar planilla de ejemplo"), 12.1 ("asistencia con cédula").** Son del módulo de RRHH del otro proyecto. Acá no existe: **Usuarios** son accesos al sistema, no legajos, y no hay asistencia ni planilla.
- **Gestión del cliente: filtrar por vencimiento.** Se filtra por **rango de fechas de vencimiento de facturas** (desde / hasta) en el panel de filtros, no con un campo "cambio fecha vencimiento". Ese campo cerrado es otra cosa y hay que revisarlo aparte.
- **¿Dónde se cargan "cuenta contable" y "cuenta de pago"?** La contable, en ningún lado: no hay contabilidad acá. La de pago es **Configuración → Entidades bancarias**.
- **Vendedor en la venta y comisiones.** Hoy el vendedor **no se elige en cada venta**: sale del `vendedor_asignado` del cliente, y Comisiones calcula sobre eso. Si la cervecería necesita elegir vendedor venta por venta, es un cambio chico en Nueva venta más el ajuste del cálculo — decime y lo hago.
