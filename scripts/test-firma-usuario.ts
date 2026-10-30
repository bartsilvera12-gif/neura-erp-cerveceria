/**
 * Tests de la firma de los registros.
 *
 * Lo que importa: que SIEMPRE salga lo mismo. La columna "Usuario" mostraba el
 * nombre en las compras, el correo en las ventas y un guión en producción
 * porque cada ruta elegía por su cuenta; acá se prueba la única regla.
 *
 * Correr con: npm run test:firma-usuario
 */
import { firmaDeUsuario, nombreParaRegistro } from "../src/lib/auth/nombre-para-registro";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

console.log("\nLa regla");
{
  ok("el nombre gana", nombreParaRegistro({ nombre: "Karen Ayala", email: "k@coven.py" }) === "Karen Ayala");
  // El correo cambia de dueño cuando alguien se va y entra otro con la misma
  // casilla; el histórico no tiene que reescribirse por eso.
  ok("sin nombre, el correo", nombreParaRegistro({ nombre: null, email: "k@coven.py" }) === "k@coven.py");
  ok("sin nada, Usuario", nombreParaRegistro({ nombre: "", email: "" }) === "Usuario");
  ok("null entero", nombreParaRegistro(null) === "Usuario");
  ok("espacios de más", nombreParaRegistro({ nombre: "  Karen   Ayala " }) === "Karen Ayala");
  ok("nombre en blanco cae al correo", nombreParaRegistro({ nombre: "   ", email: "a@b.c" }) === "a@b.c");
}

console.log("\nDesde el contexto de una ruta");
{
  const auth = { nombre: "Administrador", user: { email: "admin@cerveceria.com" } };
  ok("usa el nombre, no el correo", firmaDeUsuario(auth) === "Administrador");
  ok("sin nombre, el correo", firmaDeUsuario({ user: { email: "admin@cerveceria.com" } }) === "admin@cerveceria.com");
  // El contexto de compras y transferencias trae el nombre con otra etiqueta.
  ok("acepta usuarioNombre", firmaDeUsuario({ usuarioNombre: "Merlis" }) === "Merlis");
  ok("usuarioNombre vacío cae al correo",
     firmaDeUsuario({ usuarioNombre: null, user: { email: "m@coven.py" } }) === "m@coven.py");
  ok("sin sesión", firmaDeUsuario(null) === "Usuario");
  ok("sin usuario cargado", firmaDeUsuario({ user: null }) === "Usuario");
  // Lo mismo entra por dos caminos distintos y tiene que salir igual.
  ok("dos contextos, una firma",
     firmaDeUsuario({ nombre: "Karen" }) === firmaDeUsuario({ usuarioNombre: "Karen" }));
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
