/**
 * El nombre con el que queda firmado un registro (un movimiento de
 * inventario, una compra, un cobro).
 *
 * POR QUE HACE FALTA UNA SOLA REGLA
 * La columna "Usuario" de Movimientos de inventario mostraba tres cosas
 * distintas según de dónde viniera la fila: "Administrador" (el nombre),
 * "admin@…" (el email crudo, que escribe Compras) o "Sin registro" (los
 * movimientos manuales, que no guardaban nada). Para auditar quién tocó el
 * stock eso no sirve: no se puede ni agrupar ni comparar.
 *
 * El orden es el mismo que ya usaba `getCurrentUserDisplayNameServer` para la
 * pantalla: nombre, si no el email, si no "Usuario". Preferir el nombre sobre
 * el email no es estético — el email cambia cuando alguien se va y entra otro
 * con la misma casilla, y el histórico quedaría reescrito.
 */
export function nombreParaRegistro(
  u: { nombre?: string | null; email?: string | null } | null | undefined
): string {
  const nombre = String(u?.nombre ?? "").trim().replace(/\s+/g, " ");
  if (nombre) return nombre;
  const email = String(u?.email ?? "").trim();
  if (email) return email;
  return "Usuario";
}
