"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronDown, Loader2, LogOut, Menu, Store } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { signOut } from "@/lib/auth";
import { useBoot } from "@/components/BootContext";

type SucursalOpcion = { id: string; nombre: string };

type HeaderUsuario = {
  nombre: string | null;
  rol: string | null;
  email: string | null;
  /** Sucursal en la que opera el usuario. Null si no tiene una asignada. */
  sucursal?: string | null;
  /** Sucursal activa, para marcar la opción elegida en el selector. */
  sucursal_id?: string | null;
  /**
   * Sucursales a las que el usuario puede entrar. Con una sola (el caso
   * normal) el header muestra la etiqueta fija de siempre; con más de una,
   * un selector para cambiar de administración.
   */
  sucursales?: SucursalOpcion[] | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function roleLabel(rol: string | null | undefined): string {
  const r = clean(rol).toLowerCase();
  const labels: Record<string, string> = {
    admin: "Admin",
    administrador: "Admin",
    super_admin: "Super admin",
    supervisor: "Supervisor",
    vendedor: "Vendedor",
    asesor: "Asesor",
    comercial: "Comercial",
    "asesor comercial": "Asesor comercial",
    usuario: "Usuario",
  };
  if (labels[r]) return labels[r];
  if (!r) return "Usuario";
  return r
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Header() {
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [usuario, setUsuario] = useState<HeaderUsuario | null>(null);
  const [sucMenuOpen, setSucMenuOpen] = useState(false);
  const [cambiandoSuc, setCambiandoSuc] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sucRef = useRef<HTMLDivElement>(null);
  const { mobileSidebarOpen, setMobileSidebarOpen } = useBoot();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (sucRef.current && !sucRef.current.contains(e.target as Node)) {
        setSucMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadUsuario() {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as { usuario?: HeaderUsuario };
        if (alive) setUsuario(json.usuario ?? null);
      } catch {
        if (alive) setUsuario(null);
      }
    }
    void loadUsuario();
    return () => {
      alive = false;
    };
  }, []);

  const nombreReal = clean(usuario?.nombre);
  const fallbackEmail = clean(usuario?.email);
  const displayName = nombreReal || fallbackEmail || "Usuario";
  const dropdownName = nombreReal || "Usuario";
  const displayRole = roleLabel(usuario?.rol);
  const sucursal = clean(usuario?.sucursal);
  const sucursales = usuario?.sucursales ?? [];
  /** El selector sólo tiene sentido con más de una sucursal a la que entrar. */
  const puedeCambiarSucursal = sucursales.length > 1;

  /**
   * Cambiar de sucursal cambia el contexto de TODA la aplicación (catálogo,
   * stock, ventas, caja). Por eso se recarga entera en vez de refrescar sólo
   * el header: cualquier pantalla abierta quedaría mostrando datos de la
   * sucursal anterior.
   */
  async function cambiarSucursal(id: string) {
    if (cambiandoSuc) return;
    setCambiandoSuc(id);
    try {
      const res = await fetchWithSupabaseSession("/api/sucursales/activa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursal_id: id }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      window.location.reload();
    } catch {
      setCambiandoSuc(null);
      setSucMenuOpen(false);
    }
  }

  return (
    <header
      id="neura-header"
      className="z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-3 sm:px-6 shadow-[inset_0_-1px_0_0_rgba(10,37,64,0.05)] backdrop-blur-sm"
    >
      {/* Boton hamburger (solo mobile) */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#3F8E91] lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer en desktop para empujar el resto a la derecha */}
      <div className="hidden lg:block lg:flex-1" />

      <div className="flex items-center gap-2">
        {/* Sucursal activa. Con mas de un local, saber donde esta parado el
            usuario evita cargar stock o facturar en la sucursal equivocada.
            Solo se muestra cuando el dato existe: si el usuario no tiene
            sucursal asignada, no se inventa una etiqueta. */}
        {sucursal && !puedeCambiarSucursal && (
          <span
            className="flex items-center gap-1.5 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1.5 text-xs font-semibold text-[#2F6F72]"
            title={`Estás operando en ${sucursal}`}
          >
            <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="max-w-[9rem] truncate">{sucursal}</span>
          </span>
        )}

        {puedeCambiarSucursal && (
          <div className="relative" ref={sucRef}>
            <button
              type="button"
              onClick={() => setSucMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1.5 text-xs font-semibold text-[#2F6F72] transition-colors hover:bg-[#4FAEB2]/20"
              title={`Estás operando en ${sucursal}. Tocá para cambiar.`}
              aria-haspopup="menu"
              aria-expanded={sucMenuOpen}
            >
              <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[9rem] truncate">{sucursal}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${sucMenuOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>

            {sucMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
              >
                <p className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Cambiar de sucursal
                </p>
                {sucursales.map((s) => {
                  const activa = s.id === usuario?.sucursal_id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitem"
                      disabled={cambiandoSuc !== null}
                      onClick={() => (activa ? setSucMenuOpen(false) : void cambiarSucursal(s.id))}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                        activa ? "font-semibold text-[#2F6F72]" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{s.nombre}</span>
                      {cambiandoSuc === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                      ) : activa ? (
                        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Notificaciones */}
        <button
          type="button"
          className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#4FAEB2] text-[10px] font-bold text-white">
            0
          </span>
        </button>

        {/* Avatar + menú usuario */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition-all hover:border-[#4FAEB2]/60"
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.25)" }}
            >
              <Image
                src="/brand/cerveceria-logo.png"
                alt="Cervecería"
                width={72}
                height={72}
                sizes="36px"
                className="h-full w-full object-contain p-0.5"
                priority
              />
            </div>
            <div className="hidden text-left sm:block">
              <p className="max-w-[180px] truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3F8E91]">{displayRole}</p>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {userMenuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-[#4FAEB2]/15">
              {/* franja superior turquesa */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40"
              />
              <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
                  style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Sesión</p>
              </div>
              <div className="border-b border-slate-100 px-4 pb-3">
                <p className="truncate text-sm font-semibold text-slate-900">{dropdownName}</p>
                {fallbackEmail ? (
                  <p className="truncate text-xs text-slate-500">{fallbackEmail}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
