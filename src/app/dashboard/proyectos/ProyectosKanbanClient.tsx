"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { readSaasBriefData } from "@/lib/proyectos/brief-data";
import ProyectoDetalleModal from "./components/ProyectoDetalleModal";

import { LayoutGrid, List, MapPin, Phone, User } from "lucide-react";

import Link from "next/link";
type EstadoRow = {
  id: string;
  nombre: string;
  codigo: string;
  color: string;
  sort_order: number;
  cuenta_sla?: boolean;
  sla_horas_objetivo?: number | null;
  es_estado_final?: boolean;
  inactiveFallback?: boolean;
};

type ProyectoCard = Record<string, unknown> & {
  id: string;
  titulo: string;
  prioridad: string;
  estado_id: string;
  last_activity_at?: string;
  fecha_ingreso?: string;
  fecha_prometida?: string | null;
  brief_data?: Record<string, unknown> | null;
  bloqueado?: boolean;
  archivado?: boolean;
  proyecto_tipo?: { nombre?: string; codigo?: string } | null;
  proyecto_estado?: {
    nombre?: string;
    codigo?: string;
    color?: string;
    cuenta_sla?: boolean;
    sla_horas_objetivo?: number | null;
    es_estado_final?: boolean;
  } | null;
  cliente?: { empresa?: string | null; nombre_contacto?: string | null } | null;
  responsable_comercial?: { nombre?: string | null } | null;
  responsable_tecnico?: { nombre?: string | null } | null;
  tiempo_en_estado_segundos?: number | null;
  sla_estado_actual?: {
    cuenta_sla: boolean;
    objetivo_horas: number | null;
    vencido: boolean;
    restante_segundos: number | null;
    excedido_segundos: number | null;
  };
};

type PrioridadConfig = {
  codigo: string;
  nombre: string;
  color: string | null;
  bg_color: string | null;
  text_color: string | null;
  border_color: string | null;
  sort_order: number;
  activo: boolean;
};

type ProjectCardViewProps = {
  p: ProyectoCard;
  estados: EstadoRow[];
  estadoActivoIds: Set<string>;
  prioridadConfig?: PrioridadConfig;
  onOpen: (id: string) => void;
  onMove: (proyectoId: string, estadoId: string) => void;
  moving?: boolean;
  dragOverlay?: boolean;
};

type KanbanColumnViewProps = {
  col: EstadoRow;
  children: ReactNode;
};

const PROJECT_DRAG_PREFIX = "project:";
const COLUMN_DROP_PREFIX = "estado:";

function projectDragId(projectId: string): string {
  return `${PROJECT_DRAG_PREFIX}${projectId}`;
}

function estadoDropId(estadoId: string): string {
  return `${COLUMN_DROP_PREFIX}${estadoId}`;
}

function readProjectIdFromDragId(id: unknown): string | null {
  const raw = String(id ?? "");
  return raw.startsWith(PROJECT_DRAG_PREFIX) ? raw.slice(PROJECT_DRAG_PREFIX.length) : null;
}

function readEstadoIdFromDropId(id: unknown): string | null {
  const raw = String(id ?? "");
  return raw.startsWith(COLUMN_DROP_PREFIX) ? raw.slice(COLUMN_DROP_PREFIX.length) : null;
}

type PriorityCardStyles = {
  cardAccentClass: string;
  badgeClass: string;
  iconDotClass: string;
};

function getPriorityCardStyles(prioridad: string | null | undefined): PriorityCardStyles {
  if (prioridad === "baja") {
    return {
      cardAccentClass: "border-l-emerald-500 hover:border-emerald-200",
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      iconDotClass: "bg-emerald-500",
    };
  }
  if (prioridad === "alta") {
    return {
      cardAccentClass: "border-l-orange-500 hover:border-orange-200",
      badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
      iconDotClass: "bg-orange-500",
    };
  }
  if (prioridad === "urgente") {
    return {
      cardAccentClass: "border-l-rose-600 hover:border-rose-200",
      badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
      iconDotClass: "bg-rose-600",
    };
  }
  if (prioridad === "normal" || prioridad === "media") {
    return {
      cardAccentClass: "border-l-sky-500 hover:border-sky-200",
      badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
      iconDotClass: "bg-sky-500",
    };
  }
  return {
    cardAccentClass: "border-l-slate-300 hover:border-slate-300",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-600",
    iconDotClass: "bg-slate-400",
  };
}

function prioridadFallbackLabel(p: string): string {
  if (p === "normal") return "Media";
  if (p === "alta") return "Alta";
  if (p === "urgente") return "Urgente";
  if (p === "baja") return "Baja";
  return p;
}

function formatSlaDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const totalHours = Math.max(0, Math.floor(seconds / 3600));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  return `${hours}h`;
}

function formatSlaTarget(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  return formatSlaDuration(hours * 3600);
}

function slaEstadoLabel(p: ProyectoCard): string {
  const sla = p.sla_estado_actual;
  if (!sla?.cuenta_sla) return "SLA —";
  if (sla.vencido) return `SLA vencido: +${formatSlaDuration(sla.excedido_segundos)}`;
  const elapsed = formatSlaDuration(p.tiempo_en_estado_segundos);
  const target = formatSlaTarget(sla.objetivo_horas);
  return target ? `SLA: ${elapsed} / ${target}` : `SLA: ${elapsed}`;
}

function saasModuleCountLabel(p: ProyectoCard): string | null {
  if (p.proyecto_tipo?.codigo !== "saas") return null;
  const count = readSaasBriefData(p.brief_data).modulos_necesarios.length;
  if (count <= 0) return null;
  return count === 1 ? "1 módulo" : `${count} módulos`;
}

// ── Pedidos (gastronomía) — helpers para renderizar cards con brief_data del pedido ─────
type PedidoBrief = {
  modalidad: "local" | "delivery" | "carry_out";
  mesa: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  direccion_entrega: string | null;
  observacion: string | null;
  numero_control: string | null;
  items: Array<{ producto_nombre: string; cantidad: number }>;
};

function readPedidoBrief(
  brief: Record<string, unknown> | null | undefined
): PedidoBrief | null {
  if (!brief || typeof brief !== "object") return null;
  const m = (brief as Record<string, unknown>).modalidad;
  if (m !== "local" && m !== "delivery" && m !== "carry_out") return null;
  const itemsRaw = Array.isArray(brief.items) ? (brief.items as Array<Record<string, unknown>>) : [];
  return {
    modalidad: m,
    mesa: typeof brief.mesa === "string" ? brief.mesa : null,
    cliente_nombre: typeof brief.cliente_nombre === "string" ? brief.cliente_nombre : null,
    cliente_telefono: typeof brief.cliente_telefono === "string" ? brief.cliente_telefono : null,
    direccion_entrega: typeof brief.direccion_entrega === "string" ? brief.direccion_entrega : null,
    observacion: typeof brief.observacion === "string" ? brief.observacion : null,
    numero_control: typeof brief.numero_control === "string" ? brief.numero_control : null,
    items: itemsRaw.map((it) => ({
      producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "—",
      cantidad: typeof it.cantidad === "number" ? it.cantidad : Number(it.cantidad) || 0,
    })),
  };
}

const PEDIDO_MODALIDAD_BADGE: Record<
  PedidoBrief["modalidad"],
  { label: string; cls: string }
> = {
  local:     { label: "En local",  cls: "border-amber-300 bg-amber-50 text-amber-800" },
  delivery:  { label: "Delivery",  cls: "border-purple-300 bg-purple-50 text-purple-800" },
  carry_out: { label: "Retiro",    cls: "border-sky-300 bg-sky-50 text-sky-800" },
};

/**
 * Una línea corta que dice a dónde va el pedido. Un pedido de mesa no tiene
 * cliente cargado, así que mostrar "Sin cliente" era ruido: lo que el mozo
 * necesita leer es la mesa, o a quién se le entrega.
 */
function pedidoDestinoCorto(pedido: PedidoBrief, contacto: string | null): string {
  if (pedido.modalidad === "local") return pedido.mesa ? `Mesa ${pedido.mesa}` : "En el local";
  const nombre = (pedido.cliente_nombre || contacto || "").trim();
  if (pedido.modalidad === "delivery") {
    return nombre || pedido.direccion_entrega || "Delivery";
  }
  return nombre || "Para retirar";
}

function fmtPedidoTotal(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  return "Gs. " + Math.round(v || 0).toLocaleString("es-PY");
}

function fmtPedidoHora(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export default function ProyectosKanbanClient() {
  const [estados, setEstados] = useState<EstadoRow[]>([]);
  const [proyectos, setProyectos] = useState<ProyectoCard[]>([]);
  const [prioridadesConfig, setPrioridadesConfig] = useState<PrioridadConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [movingProjectId, setMovingProjectId] = useState<string | null>(null);
  const [activeDragProjectId, setActiveDragProjectId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  /** Kanban para trabajar el turno; lista para revisar lo del día de un vistazo. */
  const [vista, setVista] = useState<"kanban" | "lista">("kanban");
  /**
   * La modalidad vive en `brief_data`, no es una columna, así que se filtra
   * acá y no en la consulta.
   */
  const [filtroModalidad, setFiltroModalidad] = useState<"" | PedidoBrief["modalidad"]>("");
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // La config de prioridades es estática: no depende de los filtros y solo
  // alimenta los estilos de los badges. Se carga UNA sola vez y nunca bloquea
  // el render del tablero, para que un endpoint lento no congele el kanban en
  // "Cargando…".
  const opcionesCargadasRef = useRef(false);

  const cargarOpcionesNoCriticas = useCallback(async () => {
    if (opcionesCargadasRef.current) return;
    opcionesCargadasRef.current = true;
    try {
      const rPrioridades = await fetchWithSupabaseSession(
        "/api/configuracion/proyectos/prioridades",
        { cache: "no-store" }
      );
      const jPrioridades = (await rPrioridades.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { prioridades?: PrioridadConfig[] };
      };
      if (rPrioridades.ok && jPrioridades.success && jPrioridades.data?.prioridades) {
        setPrioridadesConfig(jPrioridades.data.prioridades);
      } else {
        // Sin config válida usamos los estilos de prioridad por defecto (fallback del componente).
        setPrioridadesConfig([]);
      }
    } catch {
      // No-crítico: el tablero ya está visible; los selects quedan con sus defaults.
      opcionesCargadasRef.current = false; // permitir reintento en el próximo load
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (filtroEstado) sp.set("estado_id", filtroEstado);

    // Camino crítico: el tablero solo necesita estados + proyectos para pintar.
    const [rEst, rPr] = await Promise.all([
      fetchWithSupabaseSession("/api/proyectos/estados", { cache: "no-store" }),
      fetchWithSupabaseSession(`/api/proyectos?${sp.toString()}`, { cache: "no-store" }),
    ]);

    const jEst = (await rEst.json().catch(() => ({}))) as { success?: boolean; data?: EstadoRow[]; error?: string };
    const jPr = (await rPr.json().catch(() => ({}))) as { success?: boolean; data?: ProyectoCard[]; error?: string };

    if (!rEst.ok || !jEst.success) {
      setErr(jEst.error ?? "No se pudieron cargar estados");
      setLoading(false);
      return;
    }
    if (!rPr.ok || !jPr.success) {
      setErr(jPr.error ?? "No se pudieron cargar proyectos");
      setLoading(false);
      return;
    }
    setEstados(jEst.data ?? []);
    setProyectos(jPr.data ?? []);
    setLoading(false);

    // No-críticas en segundo plano: no bloquean el render del tablero.
    void cargarOpcionesNoCriticas();
  }, [q, filtroEstado, cargarOpcionesNoCriticas]);

  useEffect(() => {
    void load();
  }, [load]);

  const estadoActivoIds = useMemo(() => new Set(estados.map((e) => e.id)), [estados]);

  /** Pedidos que se muestran: el filtro de modalidad aplica a kanban y a lista. */
  const proyectosVisibles = useMemo(() => {
    if (!filtroModalidad) return proyectos;
    return proyectos.filter((p) => readPedidoBrief(p.brief_data)?.modalidad === filtroModalidad);
  }, [proyectos, filtroModalidad]);

  const kanbanColumns = useMemo(() => {
    const columns = [...estados];
    const missing = new Map<string, EstadoRow>();
    for (const p of proyectosVisibles) {
      if (estadoActivoIds.has(p.estado_id) || missing.has(p.estado_id)) continue;
      missing.set(p.estado_id, {
        id: p.estado_id,
        nombre: `Oculto / no usado: ${p.proyecto_estado?.nombre ?? "Estado sin configurar"}`,
        codigo: p.proyecto_estado?.codigo ?? "estado_inactivo",
        color: p.proyecto_estado?.color ?? "#94a3b8",
        sort_order: 9999,
        inactiveFallback: true,
      });
    }
    return [...columns, ...missing.values()];
  }, [estadoActivoIds, estados, proyectosVisibles]);

  const byColumn = useMemo(() => {
    const m = new Map<string, ProyectoCard[]>();
    for (const e of kanbanColumns) m.set(e.id, []);
    for (const p of proyectosVisibles) {
      const col = m.get(p.estado_id);
      if (col) col.push(p);
    }
    return m;
  }, [kanbanColumns, proyectosVisibles]);

  const prioridadByCodigo = useMemo(() => {
    const m = new Map<string, PrioridadConfig>();
    for (const prioridad of prioridadesConfig) {
      if (prioridad.activo) m.set(prioridad.codigo, prioridad);
    }
    return m;
  }, [prioridadesConfig]);

  const activeDragProject = useMemo(
    () => proyectos.find((p) => p.id === activeDragProjectId) ?? null,
    [activeDragProjectId, proyectos]
  );

  const estadoById = useMemo(() => {
    const m = new Map<string, EstadoRow>();
    for (const e of kanbanColumns) m.set(e.id, e);
    return m;
  }, [kanbanColumns]);

  const hayFiltros = q.trim() !== "" || filtroEstado !== "" || filtroModalidad !== "";
  function limpiarFiltros() {
    setQ("");
    setFiltroEstado("");
    setFiltroModalidad("");
  }

  async function cambiarEstado(proyectoId: string, estadoId: string): Promise<boolean> {
    if (!estadoActivoIds.has(estadoId)) {
      setErr("No se puede mover a una columna inactiva.");
      return false;
    }

    const currentProject = proyectos.find((p) => p.id === proyectoId);
    if (!currentProject) {
      setErr("No se encontró el proyecto a mover.");
      return false;
    }
    if (currentProject.estado_id === estadoId) return true;

    const previousProjects = proyectos;
    const destino = estados.find((e) => e.id === estadoId);
    setErr(null);
    setMovingProjectId(proyectoId);
    setProyectos((prev) =>
      prev.map((p) =>
        p.id === proyectoId
          ? {
              ...p,
              estado_id: estadoId,
              proyecto_estado: destino
                ? {
                    ...(p.proyecto_estado ?? {}),
                    nombre: destino.nombre,
                    codigo: destino.codigo,
                    color: destino.color,
                    cuenta_sla: destino.cuenta_sla,
                    sla_horas_objetivo: destino.sla_horas_objetivo,
                    es_estado_final: destino.es_estado_final ?? p.proyecto_estado?.es_estado_final,
                  }
                : p.proyecto_estado,
            }
          : p
      )
    );

    try {
      const res = await fetchWithSupabaseSession(`/api/proyectos/${proyectoId}/cambiar-estado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado_id: estadoId }),
      });
      const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setProyectos(previousProjects);
        setErr(j.error ?? "No se pudo cambiar el estado. La tarjeta volvió a su columna anterior.");
        setMovingProjectId(null);
        return false;
      }
      setMovingProjectId(null);
      await load();
      return true;
    } catch (e) {
      setProyectos(previousProjects);
      setErr(
        e instanceof Error
          ? `${e.message}. La tarjeta volvió a su columna anterior.`
          : "No se pudo cambiar el estado. La tarjeta volvió a su columna anterior."
      );
      setMovingProjectId(null);
      return false;
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragProjectId(readProjectIdFromDragId(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const proyectoId = readProjectIdFromDragId(event.active.id);
    const estadoId = readEstadoIdFromDropId(event.over?.id);
    setActiveDragProjectId(null);

    if (!proyectoId || !estadoId) return;
    void cambiarEstado(proyectoId, estadoId);
  }

  if (loading && proyectos.length === 0 && estados.length === 0) {
    return <div className="p-6 text-sm text-slate-500">Cargando proyectos…</div>;
  }

  if (err && proyectos.length === 0) {
    return <div className="p-6 text-sm text-red-600">{err}</div>;
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-0 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Barra
            </p>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Pedidos</h1>
          <p className="mt-0.5 text-xs text-slate-500">Tablero de pedidos — por modalidad y estado.</p>
        </div>
        <div className="flex w-full items-center sm:w-auto">
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15 sm:w-72"
            placeholder="Buscar pedido o cliente…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
          />
        </div>
      </div>

      {/* Barra: vista + filtros. Sin botón de alta: los pedidos entran desde
          Caja, no se cargan a mano desde el tablero. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {([
            { id: "kanban", label: "Kanban", Icon: LayoutGrid },
            { id: "lista", label: "Lista", Icon: List },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setVista(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                vista === id
                  ? "bg-[#4FAEB2] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          aria-label="Filtrar por estado"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15"
        >
          <option value="">Todos los estados</option>
          {estados.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre}</option>
          ))}
        </select>

        <select
          value={filtroModalidad}
          onChange={(e) => setFiltroModalidad(e.target.value as typeof filtroModalidad)}
          aria-label="Filtrar por modalidad"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15"
        >
          <option value="">Todas las modalidades</option>
          <option value="local">En local</option>
          <option value="delivery">Delivery</option>
          <option value="carry_out">Retiro</option>
        </select>

        <span className="text-xs text-slate-400 tabular-nums">
          {proyectosVisibles.length === 1 ? "1 pedido" : `${proyectosVisibles.length} pedidos`}
        </span>

        {hayFiltros ? (
          <button
            type="button"
            onClick={limpiarFiltros}
            className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      {err ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div> : null}

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-full gap-2">
          {estados.map((estado) => (
            <EstadoMetric
              key={estado.id}
              label={estado.nombre}
              value={byColumn.get(estado.id)?.length ?? 0}
              color={estado.color}
              activo={filtroEstado === estado.id}
              onClick={() => setFiltroEstado(filtroEstado === estado.id ? "" : estado.id)}
            />
          ))}
        </div>
      </div>

      {vista === "lista" ? (
        <PedidosLista
          pedidos={proyectosVisibles}
          estados={estados}
          estadoById={estadoById}
          movingProjectId={movingProjectId}
          onOpen={setModalProjectId}
          onMove={(proyectoId, estadoId) => void cambiarEstado(proyectoId, estadoId)}
        />
      ) : null}

      {/* Sin columnas configuradas el tablero no dibujaba nada y la pantalla
          parecía rota. Las columnas se cargan una vez, desde Configuración. */}
      {!loading && kanbanColumns.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-700">El tablero todavía no tiene columnas</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
            Los pedidos se mueven entre columnas (por ejemplo: Pendiente → En preparación → Listo →
            Entregado). Creálas una sola vez y el tablero queda andando.
          </p>
          <Link
            href="/configuracion/proyectos"
            className="mt-4 inline-flex rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0284C7]"
          >
            Configurar columnas
          </Link>
        </div>
      ) : null}

      {vista === "kanban" ? (
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {/* Antes: "overflow-x-hidden" bloqueaba el scroll horizontal del kanban,
            las columnas se comprimian a flex-1 y en mobile quedaban ilegibles
            (texto de tarjetas cortado, no se ven todas las columnas).
            Ahora: "overflow-auto" cubre X+Y, cada KanbanColumnView tiene
            min-w-[260px] fijo (no flex-1), el contenedor crece con el contenido
            y el usuario puede deslizar de izquierda a derecha. */}
        <div className="max-h-[calc(100svh-300px)] min-h-[420px] overflow-auto rounded-xl pb-4 overscroll-x-contain sm:min-h-[520px] lg:max-h-[calc(100vh-260px)]">
          <div className="flex min-h-full gap-2">
            {kanbanColumns.map((col) => {
              const items = byColumn.get(col.id) ?? [];
              return (
                <KanbanColumnView key={col.id} col={col}>
                  <div className="sticky top-0 z-30 overflow-hidden rounded-t-lg bg-white shadow-sm">
                    <div className="h-1" style={{ backgroundColor: col.color || "#94a3b8" }} />
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                      <span className="truncate text-sm font-semibold text-slate-800" title={col.nombre}>
                        {col.nombre}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                          items.length > 0 ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"
                        }`}
                      >
                        {items.length}
                      </span>
                    </div>
                  </div>
                  {col.inactiveFallback ? (
                    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Esta columna está inactiva, pero contiene proyectos. Movelos a una columna activa.
                    </div>
                  ) : null}
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {items.map((p) => (
                      <ProjectCardView
                        key={p.id}
                        p={p}
                        estados={estados}
                        estadoActivoIds={estadoActivoIds}
                        prioridadConfig={prioridadByCodigo.get(p.prioridad)}
                        onOpen={setModalProjectId}
                        onMove={(proyectoId, estadoId) => void cambiarEstado(proyectoId, estadoId)}
                        moving={movingProjectId === p.id}
                      />
                    ))}
                    {items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">
                        Soltá tarjetas acá
                      </div>
                    ) : null}
                  </div>
                </KanbanColumnView>
              );
            })}
          </div>
        </div>
        <DragOverlay>
          {activeDragProject ? (
            <ProjectCardView
              p={activeDragProject}
              estados={estados}
              estadoActivoIds={estadoActivoIds}
              prioridadConfig={prioridadByCodigo.get(activeDragProject.prioridad)}
              onOpen={() => undefined}
              onMove={() => undefined}
              dragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      ) : null}

      {vista === "kanban" ? (
        <p className="text-center text-xs text-slate-400">
          Arrastrá tarjetas entre columnas activas o usá el selector “Mover a” como alternativa.
        </p>
      ) : null}

      <ProyectoDetalleModal
        projectId={modalProjectId}
        open={modalProjectId != null}
        onClose={() => setModalProjectId(null)}
        onUpdated={() => void load()}
      />
    </div>
  );
}

function KanbanColumnView({ col, children }: KanbanColumnViewProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: estadoDropId(col.id),
    disabled: col.inactiveFallback === true,
    data: { estadoId: col.id, active: col.inactiveFallback !== true },
  });

  return (
    <div
      ref={setNodeRef}
      // Antes: "min-w-[120px] flex-1" => columnas compartian el ancho disponible,
      // imposibles de leer en mobile. Ahora: ancho fijo de 260px (sin flex-1)
      // para que el contenedor scrollee horizontalmente con todas las columnas
      // legibles. shrink-0 evita que se compriman.
      className={`flex w-[82vw] max-w-[320px] shrink-0 flex-col rounded-xl border bg-slate-100/60 transition-colors sm:w-[300px] lg:w-[272px] ${
        isOver && !col.inactiveFallback
          ? "border-[#4FAEB2] bg-[#4FAEB2]/10 ring-2 ring-[#4FAEB2]/20"
          : "border-slate-200"
      }`}
    >
      {children}
    </div>
  );
}

function ProjectCardView({
  p,
  estados,
  estadoActivoIds,
  prioridadConfig,
  onOpen,
  onMove,
  moving,
  dragOverlay,
}: ProjectCardViewProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: projectDragId(p.id),
    disabled: dragOverlay === true,
    data: { projectId: p.id, estadoId: p.estado_id },
  });

  const cli =
    (p.cliente?.empresa || "").trim() ||
    (p.cliente?.nombre_contacto || "").trim() ||
    "Sin cliente";
  const saasModulesLabel = saasModuleCountLabel(p);
  const priorityStyles = getPriorityCardStyles(p.prioridad);
  const pedido = readPedidoBrief(p.brief_data);

  const style: CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const baseBadgeClass =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4";
  const neutralBadgeClass =
    "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium leading-4 text-slate-600";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`touch-none rounded-xl border border-l-4 bg-white p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        dragOverlay ? "rotate-1 cursor-grabbing shadow-2xl" : "cursor-grab active:cursor-grabbing"
      } ${priorityStyles.cardAccentClass} ${isDragging ? "opacity-40" : ""} ${moving ? "ring-2 ring-sky-100" : ""}`}
    >
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => {
          if (!dragOverlay) onOpen(p.id);
        }}
      >
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityStyles.iconDotClass}`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug text-slate-950 hover:underline">
              {p.titulo}
            </div>
            <div className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
              {pedido ? pedidoDestinoCorto(pedido, p.cliente?.nombre_contacto ?? null) : cli}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {pedido ? (
            <span className={`${baseBadgeClass} font-semibold ${PEDIDO_MODALIDAD_BADGE[pedido.modalidad].cls}`}>
              {PEDIDO_MODALIDAD_BADGE[pedido.modalidad].label}
            </span>
          ) : (
            <span className={neutralBadgeClass}>
              {p.proyecto_tipo?.nombre ?? "Tipo"}
            </span>
          )}
          {!pedido && saasModulesLabel ? (
            <span className={neutralBadgeClass}>
              {saasModulesLabel}
            </span>
          ) : null}
          {!pedido && (
            <span className={`${baseBadgeClass} font-semibold ${priorityStyles.badgeClass}`}>
              {prioridadConfig?.nombre ?? prioridadFallbackLabel(p.prioridad)}
            </span>
          )}
          {!pedido && (
            <span className={p.sla_estado_actual?.vencido ? `${baseBadgeClass} border-rose-200 bg-rose-50 text-rose-700` : neutralBadgeClass}>
              {slaEstadoLabel(p)}
            </span>
          )}
          {p.bloqueado ? (
            <span className={`${baseBadgeClass} border-rose-200 bg-rose-50 text-rose-800`}>
              Bloqueado
            </span>
          ) : null}
          {moving ? (
            <span className={`${baseBadgeClass} border-sky-200 bg-sky-50 text-sky-800`}>
              Guardando...
            </span>
          ) : null}
        </div>

        {pedido ? (
          <PedidoCardBody
            pedido={pedido}
            total={Number(p.monto_vendido ?? 0)}
            horaIso={p.fecha_ingreso ?? p.last_activity_at ?? null}
          />
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-slate-50/80 px-3 py-2 text-[11px] text-slate-700">
            <MetaItem label="Com." value={p.responsable_comercial?.nombre ?? "—"} />
            <MetaItem label="Téc." value={p.responsable_tecnico?.nombre ?? "—"} />
            <MetaItem label="Ingreso" value={fmtDate(p.fecha_ingreso)} />
            <MetaItem label="Prometido" value={fmtDate(p.fecha_prometida)} />
            <div className="col-span-2">
              <MetaItem label="Actividad" value={fmtDateTime(p.last_activity_at)} />
            </div>
          </div>
        )}
      </button>
      {!dragOverlay ? (
        <>
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mover a</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              value={p.estado_id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onMove(p.id, e.target.value)}
            >
              {!estadoActivoIds.has(p.estado_id) ? (
                <option value={p.estado_id}>Estado actual oculto / no usado</option>
              ) : null}
              {estados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="font-semibold text-slate-500">{label}</span>{" "}
      <span className="break-words text-slate-800">{value}</span>
    </div>
  );
}

function PedidoCardBody({
  pedido,
  total,
  horaIso,
}: {
  pedido: PedidoBrief;
  total: number;
  horaIso: string | null;
}) {
  const maxItems = 4;
  const visibleItems = pedido.items.slice(0, maxItems);
  const extra = Math.max(0, pedido.items.length - maxItems);

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-slate-50/80 px-3 py-2 text-[12px] text-slate-700">
      {/* Detalle modalidad */}
      {pedido.modalidad === "delivery" && (
        <div className="flex flex-col gap-0.5">
          {pedido.cliente_telefono ? (
            <div className="flex items-center gap-1 font-semibold text-slate-800"><Phone className="h-3 w-3 shrink-0" aria-hidden />{pedido.cliente_telefono}</div>
          ) : null}
          {pedido.direccion_entrega ? (
            <div className="flex items-center gap-1 text-slate-600"><MapPin className="h-3 w-3 shrink-0" aria-hidden />{pedido.direccion_entrega}</div>
          ) : null}
        </div>
      )}
      {pedido.modalidad === "carry_out" && (pedido.cliente_nombre || pedido.cliente_telefono) ? (
        <div className="flex flex-col gap-0.5">
          {pedido.cliente_nombre ? (
            <div className="flex items-center gap-1 font-semibold text-slate-800"><User className="h-3 w-3 shrink-0" aria-hidden />{pedido.cliente_nombre}</div>
          ) : null}
          {pedido.cliente_telefono ? (
            <div className="flex items-center gap-1 text-slate-600"><Phone className="h-3 w-3 shrink-0" aria-hidden />{pedido.cliente_telefono}</div>
          ) : null}
        </div>
      ) : null}

      {/* Productos */}
      {visibleItems.length > 0 ? (
        <ul className="space-y-0.5 border-t border-slate-200 pt-1.5 text-[12px]">
          {visibleItems.map((it, idx) => (
            <li key={idx} className="flex items-baseline gap-1.5 text-slate-800">
              <span className="font-semibold tabular-nums text-slate-900">{it.cantidad}×</span>
              <span className="truncate">{it.producto_nombre}</span>
            </li>
          ))}
          {extra > 0 ? (
            <li className="text-[11px] italic text-slate-500">+{extra} más</li>
          ) : null}
        </ul>
      ) : null}

      {/* Observación */}
      {pedido.observacion ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] italic text-amber-900">
          {pedido.observacion}
        </div>
      ) : null}

      {/* Footer total + hora */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
        <span className="text-[11px] text-slate-500">{fmtPedidoHora(horaIso)}</span>
        <span className="text-[13px] font-semibold tabular-nums text-slate-900">
          {fmtPedidoTotal(total)}
        </span>
      </div>
    </div>
  );
}

/**
 * Contador por estado. Tocarlo filtra el tablero por esa columna: en el
 * mostrador se mira "¿cuántos hay en preparación?" y se quiere ir ahí de una.
 */
function EstadoMetric({
  label,
  value,
  color,
  activo,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  activo: boolean;
  onClick: () => void;
}) {
  const c = color || "#94a3b8";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={activo ? `Quitar el filtro de ${label}` : `Ver solo ${label}`}
      className={`group min-w-[130px] flex-1 overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        activo ? "border-slate-300 ring-2 ring-slate-900/5" : "border-slate-200"
      }`}
    >
      <div className="h-1" style={{ backgroundColor: c }} />
      <div className="flex items-baseline justify-between gap-2 px-3 py-2">
        <span
          className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500"
          title={label}
        >
          {label}
        </span>
        <span
          className={`text-xl font-semibold tabular-nums ${value > 0 ? "text-slate-900" : "text-slate-300"}`}
        >
          {value}
        </span>
      </div>
    </button>
  );
}

/**
 * Vista de lista: el turno entero en una tabla, para revisar de un vistazo lo
 * que en el kanban obliga a recorrer columna por columna. El estado se cambia
 * desde el mismo selector, sin abrir el pedido.
 */
function PedidosLista({
  pedidos,
  estados,
  estadoById,
  movingProjectId,
  onOpen,
  onMove,
}: {
  pedidos: ProyectoCard[];
  estados: EstadoRow[];
  estadoById: Map<string, EstadoRow>;
  movingProjectId: string | null;
  onOpen: (id: string) => void;
  onMove: (proyectoId: string, estadoId: string) => void;
}) {
  if (pedidos.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white px-6 py-14 text-center">
        <p className="text-sm font-medium text-slate-500">No hay pedidos para mostrar.</p>
        <p className="mt-1 text-xs text-slate-400">Los pedidos entran desde Caja al confirmar una venta.</p>
      </div>
    );
  }

  const th = "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const td = "px-3 py-3 align-middle";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/80">
          <tr>
            <th className={th}>Pedido</th>
            <th className={th}>Modalidad</th>
            <th className={th}>Destino</th>
            <th className={`${th} w-full`}>Detalle</th>
            <th className={`${th} text-right`}>Total</th>
            <th className={th}>Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {pedidos.map((p) => {
            const pedido = readPedidoBrief(p.brief_data);
            const estado = estadoById.get(p.estado_id);
            const moviendo = movingProjectId === p.id;
            const cliente =
              (p.cliente?.empresa || "").trim() ||
              (p.cliente?.nombre_contacto || "").trim() ||
              pedido?.cliente_nombre ||
              "";
            const destino =
              pedido?.modalidad === "local"
                ? pedido.mesa
                  ? `Mesa ${pedido.mesa}`
                  : "En local"
                : pedido?.modalidad === "delivery"
                ? pedido.direccion_entrega || pedido.cliente_telefono || "Delivery"
                : cliente || "Retiro";
            const unidades = pedido?.items.reduce((a, it) => a + it.cantidad, 0) ?? 0;
            const primeros = (pedido?.items ?? []).slice(0, 2).map((it) => `${it.cantidad}× ${it.producto_nombre}`);
            const resto = Math.max(0, (pedido?.items.length ?? 0) - 2);

            return (
              <tr key={p.id} className={`transition-colors hover:bg-slate-50 ${moviendo ? "bg-sky-50/60" : ""}`}>
                <td className={td}>
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="whitespace-nowrap text-left font-semibold text-slate-900 hover:underline"
                  >
                    {p.titulo}
                  </button>
                  <div className="text-[11px] tabular-nums text-slate-400">
                    {fmtPedidoHora(p.fecha_ingreso ?? p.last_activity_at ?? null)}
                    {/* El número solo se repite si el título no lo trae ya. */}
                    {pedido?.numero_control && !p.titulo.includes(pedido.numero_control)
                      ? ` · ${pedido.numero_control}`
                      : ""}
                  </div>
                </td>
                <td className={td}>
                  {pedido ? (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PEDIDO_MODALIDAD_BADGE[pedido.modalidad].cls}`}
                    >
                      {PEDIDO_MODALIDAD_BADGE[pedido.modalidad].label}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className={`${td} max-w-[220px] truncate text-slate-700`} title={destino || undefined}>
                  {destino || <span className="text-slate-300">—</span>}
                </td>
                <td className={`${td} w-full text-[12px] text-slate-600`}>
                  {primeros.length > 0 ? (
                    <>
                      <span className="block max-w-[320px] truncate">{primeros.join(" · ")}</span>
                      <span className="text-[11px] text-slate-400">
                        {resto > 0 ? `+${resto} más · ` : ""}
                        {unidades === 1 ? "1 unidad" : `${unidades} unidades`}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-slate-900`}>
                  {fmtPedidoTotal(Number(p.monto_vendido ?? 0))}
                </td>
                <td className={td}>
                  {/* El borde toma el color de la columna: el estado se lee sin
                      tener que leerlo. */}
                  <select
                    value={p.estado_id}
                    onChange={(e) => onMove(p.id, e.target.value)}
                    disabled={moviendo}
                    aria-label={`Estado de ${p.titulo}`}
                    className="w-full min-w-[138px] rounded-lg border-2 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none transition-colors disabled:opacity-50"
                    style={{ borderColor: estado?.color || "#cbd5e1" }}
                  >
                    {!estadoById.has(p.estado_id) ? (
                      <option value={p.estado_id}>Estado sin configurar</option>
                    ) : null}
                    {estados.map((e) => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : "—";
}

function fmtDateTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}
