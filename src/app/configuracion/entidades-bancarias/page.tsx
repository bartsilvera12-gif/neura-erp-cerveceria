import { redirect } from "next/navigation";

/** Las entidades bancarias se movieron al módulo Caja. */
export default function EntidadesBancariasMovidas() {
  redirect("/ventas/entidades-bancarias");
}
