/**
 * Tests de la devolución de una venta.
 *
 * Lo que importa: que nunca se pueda devolver más de lo que se llevó, ni de
 * una vez ni en tres veces, y que lo devuelto valga lo que se COBRÓ y no el
 * precio de hoy.
 *
 * Correr con: npm run test:devolucion
 */
import {
  esMovimientoDeDevolucion,
  devueltaEntera,
  lineasDevolvibles,
  totalDevuelto,
  validarDevolucion,
  type LineaVendida,
} from "../src/lib/ventas/devolucion-domain";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const venta: LineaVendida[] = [
  { producto_id: "chop", producto_nombre: "Chop rubia 500", sku: "BAR-001", cantidad: 4, precio_venta: 25000 },
  { producto_id: "ham", producto_nombre: "Hamburguesa", sku: "BAR-010", cantidad: 2, precio_venta: 45000 },
];

console.log("\nQué queda por devolver");
{
  const sinDevolver = lineasDevolvibles(venta, {});
  ok("sin devoluciones previas, todo vuelve", sinDevolver.every((l) => l.devolvible === l.cantidad));
  ok("y nada figura devuelto", sinDevolver.every((l) => l.devuelto === 0));

  const conUna = lineasDevolvibles(venta, { chop: 1 });
  ok("un chop ya devuelto deja 3", conUna[0].devolvible === 3 && conUna[0].devuelto === 1);
  ok("la otra línea no se toca", conUna[1].devolvible === 2);

  const todo = lineasDevolvibles(venta, { chop: 4, ham: 2 });
  ok("devuelta entera", devueltaEntera(todo));
  ok("parcial no es entera", !devueltaEntera(conUna));
  // Un dato viejo podría decir que volvieron más de los que se vendieron.
  const pasada = lineasDevolvibles(venta, { chop: 99 });
  ok("no devuelve negativo", pasada[0].devolvible === 0 && pasada[0].devuelto === 4);
}

console.log("\nEl mismo producto en dos líneas");
{
  const dos: LineaVendida[] = [
    { producto_id: "chop", producto_nombre: "Chop", sku: null, cantidad: 2, precio_venta: 25000 },
    { producto_id: "chop", producto_nombre: "Chop", sku: null, cantidad: 3, precio_venta: 20000 },
  ];
  const d = lineasDevolvibles(dos, { chop: 3 });
  // Lo ya devuelto se descuenta en orden: primero la línea de arriba.
  ok("se reparte en orden", d[0].devolvible === 0 && d[1].devolvible === 2, JSON.stringify(d.map((x) => x.devolvible)));
  ok("el total devolvible cierra", d[0].devolvible + d[1].devolvible === 2);
}

console.log("\nValidar un pedido de devolución");
{
  const d = lineasDevolvibles(venta, {});
  const r = validarDevolucion(d, [{ producto_id: "chop", cantidad: 2 }]);
  ok("acepta lo que hay", r.ok);
  // Lo devuelto vale lo que se cobró, no el precio de hoy.
  ok("calcula la plata", r.ok && r.monto === 50000, r.ok ? String(r.monto) : "");
  ok("una sola línea", r.ok && r.items.length === 1 && r.items[0].a_devolver === 2);

  const dosLineas = validarDevolucion(d, [
    { producto_id: "chop", cantidad: 1 },
    { producto_id: "ham", cantidad: 2 },
  ]);
  ok("varias líneas suman", dosLineas.ok && dosLineas.monto === 25000 + 90000);
}

console.log("\nLo que no se puede");
{
  const d = lineasDevolvibles(venta, {});
  const demas = validarDevolucion(d, [{ producto_id: "chop", cantidad: 5 }]);
  ok("más de lo vendido se rechaza", !demas.ok);
  ok("y dice cuántos quedan", !demas.ok && demas.error.includes("4"), !demas.ok ? demas.error : "");

  const yaDevuelto = lineasDevolvibles(venta, { ham: 2 });
  const otra = validarDevolucion(yaDevuelto, [{ producto_id: "ham", cantidad: 1 }]);
  ok("lo ya devuelto no vuelve dos veces", !otra.ok);
  ok("avisa que ya volvieron", !otra.ok && otra.error.includes("ya se devolvieron"), !otra.ok ? otra.error : "");

  ok("un producto ajeno a la venta", !validarDevolucion(d, [{ producto_id: "otro", cantidad: 1 }]).ok);
  ok("sin items", !validarDevolucion(d, []).ok);
  ok("cantidad cero", !validarDevolucion(d, [{ producto_id: "chop", cantidad: 0 }]).ok);
  ok("cantidad negativa", !validarDevolucion(d, [{ producto_id: "chop", cantidad: -2 }]).ok);
  // Dos renglones del mismo producto en el mismo pedido suman, no se pisan.
  ok("suma repetidos y pasa el tope",
     !validarDevolucion(d, [{ producto_id: "chop", cantidad: 3 }, { producto_id: "chop", cantidad: 3 }]).ok);
}

console.log("\nTotal devuelto");
{
  ok("suma lo devuelto", totalDevuelto(lineasDevolvibles(venta, { chop: 2, ham: 1 })) === 50000 + 45000);
  ok("sin devoluciones, cero", totalDevuelto(lineasDevolvibles(venta, {})) === 0);
}

console.log("\nReconocer una devolución en el kardex");
{
  // El origen nuevo es siempre una devolución.
  ok("origen devolucion_venta", esMovimientoDeDevolucion("devolucion_venta", "Devolución FAC-1"));
  ok("sin referencia tambien", esMovimientoDeDevolucion("devolucion_venta", null));
  // El plan B comparte origen con las anulaciones: las distingue la referencia.
  ok("plan B con referencia de devolucion", esMovimientoDeDevolucion("anulacion_venta", "Devolución FAC-1 · se picó"));
  ok("una anulacion de verdad NO entra", !esMovimientoDeDevolucion("anulacion_venta", "Anulación FAC-1"));
  ok("anulacion sin referencia tampoco", !esMovimientoDeDevolucion("anulacion_venta", null));
  ok("otro origen no entra", !esMovimientoDeDevolucion("venta", "Devolución FAC-1"));
  ok("acepta mayusculas distintas", esMovimientoDeDevolucion("anulacion_venta", "DEVOLUCIÓN FAC-1"));
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
