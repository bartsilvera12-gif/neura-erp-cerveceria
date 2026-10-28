/**
 * Validación de formato para los datos que se tipean a mano en los formularios
 * de clientes, proveedores y CRM.
 *
 * El criterio es rechazar lo que claramente no es el dato pedido (un RUC con
 * letras, un nombre que son solo dígitos) sin pelearse con la realidad: los
 * RUC paraguayos vienen escritos con y sin dígito verificador, los teléfonos
 * con prefijo internacional y paréntesis, y los nombres de empresa llevan
 * números legítimos ("AGRO 3 S.A."). Validar más que eso traba la carga de
 * datos reales, que es peor que guardar un dato prolijo pero inútil.
 *
 * Cada función devuelve `null` si el valor sirve, o el mensaje de error listo
 * para mostrar.
 */

/** Vacío = "no lo cargo ahora". Lo obligatorio lo decide cada formulario. */
function vacio(v: string): boolean {
  return v.trim() === "";
}

/**
 * RUC paraguayo: cuerpo numérico de 5 a 9 dígitos, con dígito verificador
 * opcional separado por guion. Se aceptan puntos y espacios como separadores
 * de miles porque así los copian de los comprobantes.
 */
export function errorRuc(raw: string, opts?: { obligatorio?: boolean }): string | null {
  const v = raw.trim();
  if (vacio(v)) return opts?.obligatorio ? "El RUC es obligatorio." : null;
  if (/[a-zA-Z]/.test(v)) return "El RUC lleva solo números (y el dígito verificador después del guion).";
  const limpio = v.replace(/[.\s]/g, "");
  if (!/^\d{5,9}(-\d)?$/.test(limpio)) {
    return "RUC inválido. Usá el formato 80012345-7 o 4123456.";
  }
  return null;
}

/** Cédula de identidad: solo dígitos, 5 a 9. */
export function errorDocumento(raw: string, opts?: { obligatorio?: boolean }): string | null {
  const v = raw.trim();
  if (vacio(v)) return opts?.obligatorio ? "El documento es obligatorio." : null;
  if (/[a-zA-Z]/.test(v)) return "La cédula lleva solo números.";
  const limpio = v.replace(/[.\s]/g, "");
  if (!/^\d{5,9}$/.test(limpio)) return "Cédula inválida: entre 5 y 9 dígitos.";
  return null;
}

/**
 * Nombre de persona o razón social. Tiene que tener al menos dos letras: así
 * entran "AGRO 3 S.A." y "Ñandutí" pero no "123456" ni "---".
 */
export function errorNombre(
  raw: string,
  etiqueta = "El nombre",
  opts?: { obligatorio?: boolean }
): string | null {
  const v = raw.trim();
  if (vacio(v)) return opts?.obligatorio ? `${etiqueta} es obligatorio.` : null;
  const letras = (v.match(/[\p{L}]/gu) ?? []).length;
  if (letras < 2) return `${etiqueta} tiene que ser un nombre, no solo números.`;
  return null;
}

/**
 * Correo. Una sola arroba, algo antes, y un dominio con punto y al menos dos
 * letras finales. No se usa el validador del navegador porque acepta
 * "a@b" (dominio sin punto), que nunca es un correo real del cliente.
 */
export function errorEmail(raw: string, opts?: { obligatorio?: boolean }): string | null {
  const v = raw.trim();
  if (vacio(v)) return opts?.obligatorio ? "El correo es obligatorio." : null;
  if (/\s/.test(v)) return "El correo no puede tener espacios.";
  if (!/^[^@]+@[^@]+\.[A-Za-z]{2,}$/.test(v)) {
    return "Correo inválido. Ejemplo: nombre@dominio.com";
  }
  return null;
}

/** Teléfono: dígitos con los separadores de siempre, al menos 6 dígitos. */
export function errorTelefono(raw: string, opts?: { obligatorio?: boolean }): string | null {
  const v = raw.trim();
  if (vacio(v)) return opts?.obligatorio ? "El teléfono es obligatorio." : null;
  if (/[a-zA-Z]/.test(v)) return "El teléfono lleva solo números.";
  if (!/^[+\d][\d\s().-]*$/.test(v)) return "Teléfono inválido. Ejemplo: +595 981 123456.";
  const digitos = (v.match(/\d/g) ?? []).length;
  if (digitos < 6) return "Teléfono demasiado corto.";
  return null;
}

/**
 * Primer error de una lista de validaciones, o `null` si pasan todas. Permite
 * escribir la validación de un formulario como una lista plana y mantener el
 * orden en que el usuario lee los campos.
 */
export function primerError(...errores: (string | null)[]): string | null {
  for (const e of errores) if (e) return e;
  return null;
}
