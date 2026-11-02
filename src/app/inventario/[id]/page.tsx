import { redirect } from "next/navigation";

/** No hay vista de detalle propia: la ficha del producto es la de edición. */
export default async function ProductoDetalleRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/inventario/${encodeURIComponent(id)}/editar`);
}
