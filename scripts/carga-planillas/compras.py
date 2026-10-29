"""
Compras historicas de las dos planillas de coccion.

Cada fila de las planillas es lo que se COMPRO para ese lote, asi que compra y
consumo coinciden: lo que entra por la compra sale por el cocimiento y el stock
no queda inflado con malta que ya se uso.

El trabajo fino es pasar la cantidad de la planilla a la unidad base del ERP:
un "CASCADE 200G" con cantidad 2 son 2 packs, o sea 400 g, no 2 gramos.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from lotes import leer_grande, leer_pequena, ESTILO

# --- GRANDE: la cantidad cuenta UNIDADES DE COMPRA; el pack trae su peso en
#     el nombre. (sku, gramos o kilos que trae cada unidad de compra)
GRANDE = {
    "PILSEN UMA":            ("MP-PILSEN",     1),      # ya viene en kg
    "VIENNA UMA":            ("MP-VIENNA",     1),
    "CARACLAIR":             ("MP-CARACLAIR",  1),
    "CLARA CLAIR":           ("MP-CARACLAIR",  1),      # misma malta, otra grafia
    "MALTA MLANOIDINA UMA":  ("MP-MELANOID",   1),
    "MALTA CARA 30 UMA":     ("MP-CARA30",     1),
    "CASCADE 200G":          ("LU-CASCADE",    200),
    "CASCADE 50G":           ("LU-CASCADE",    50),
    "TRADITION 500GR":       ("LU-HALLER",     500),
    "MAGNUM 200GR":          ("LU-MAGNUM",     200),
    "MAGNUM 50GR":           ("LU-MAGNUM",     50),
    "CENTENIAL 200GR":       ("LU-CENTENNIAL", 200),
    "CENTENIAL 50GR":        ("LU-CENTENNIAL", 50),
    "AMARILLO 200GR":        ("LU-AMARILLO",   200),
    "CITRA CRYO 1 LITRO":    ("LU-CITRACRYO",  1000),   # 1 "litro" = 1 kg (ver doc)
    "US-05 500G":            ("LV-US05",       500),
    "SAFALE USA 05 500G":    ("LV-US05",       500),
    "NEW E 11GR":            ("LV-NEWE",       11),     # el precio llama la atencion (ver doc)
    "CLARIFICANTE":          ("CL-IRISH",      1),      # ya viene en gramos
}

# --- PEQUEÑA: la cantidad trae la unidad pegada y el precio es el TOTAL de la
#     linea. (sku, unidad base del ERP)
PEQUENA = {
    "PILSEN":              ("MP-PILSEN",    "KG"),
    "PALE ALE":            ("MP-PALEALE",   "KG"),
    "MUNICH":              ("MP-MUNICH",    "KG"),
    "VIENNA":              ("MP-VIENNA",    "KG"),
    "CARAPILS":            ("MP-CARAPILS",  "KG"),
    "CARAPLIS":            ("MP-CARAPILS",  "KG"),      # errata de la planilla
    "CARAMELO 20":         ("MP-CARAMEL20", "KG"),
    "CARAMELO 60":         ("MP-CARAMEL60", "KG"),
    "CASCADE":             ("LU-CASCADE",   "G"),
    "CASCADE 7,1%":        ("LU-CASCADE",   "G"),       # el % es el alfa acido
    "MAGNUM":              ("LU-MAGNUM",    "G"),
    "AMARILLO":            ("LU-AMARILLO",  "G"),
    "E.K. GOLDING":        ("LU-EKG",       "G"),
    "EKG 5,7%":            ("LU-EKG",       "G"),
    "US-05":               ("LV-US05",      "SACHET"),
    "us-05 1,5":           ("LV-US05",      "SACHET"),
    "WHIRLFLOC":           ("CL-WHIRLFLOC", "UNIDAD"),
    "CASCARA DE NARANJA":  ("ES-NARANJA",   "G"),
    "CEDRON KAPII":        ("ES-CEDRON",    "G"),
}

# Gramos por sachet de levadura seca. La planilla sólo dice "2".
GRAMOS_POR_SACHET = 11.5

# Una fila con DOS lúpulos metidos en una sola línea. Se parte en dos, mitad y
# mitad del importe, porque el nombre dice 20 g de cada uno.
PARTIDOS = {
    "CASCAD20G+AMARI20G": [("LU-CASCADE", 20), ("LU-AMARILLO", 20)],
}


def _lineas_grande():
    for (_, n), l in sorted(leer_grande().items(), key=lambda x: x[0][1]):
        lineas = []
        for nombre, cant, precio, total in l["items"]:
            sku, por_unidad = GRANDE[nombre]
            cantidad = cant * por_unidad
            lineas.append(dict(sku=sku, cantidad=cantidad,
                               costo_unitario=total / cantidad, total=total,
                               origen=f"{nombre} x{cant:g}"))
        yield dict(codigo=f"COC-G-{n:02d}", numero=f"HIST-G-{n:02d}", fecha=l["fecha"],
                   proveedor="Mercado Craft", lineas=lineas)


def _lineas_pequena():
    for (_, n), l in sorted(leer_pequena().items(), key=lambda x: x[0][1]):
        lineas = []
        for nombre, cant, unidad, total in l["items"]:
            if nombre in PARTIDOS:
                partes = PARTIDOS[nombre]
                for sku, gramos in partes:
                    parte = total / len(partes)
                    lineas.append(dict(sku=sku, cantidad=gramos,
                                       costo_unitario=parte / gramos, total=parte,
                                       origen=f"{nombre} (partido)"))
                continue
            sku, base = PEQUENA[nombre]
            if base == "KG":
                cantidad = cant / 1000 if unidad == "g" else cant
            elif base == "G":
                cantidad = cant * 1000 if unidad == "kg" else cant
            elif base == "SACHET":
                cantidad = cant * GRAMOS_POR_SACHET
            else:
                cantidad = cant
            lineas.append(dict(sku=sku, cantidad=cantidad,
                               costo_unitario=total / cantidad, total=total,
                               origen=f"{nombre} {cant:g}{unidad}"))
        yield dict(codigo=f"COC-P-{n:02d}", numero=f"HIST-P-{n:02d}", fecha=l["fecha"],
                   proveedor="Cerveshopp", lineas=lineas)


def todas():
    return list(_lineas_grande()) + list(_lineas_pequena())


if __name__ == "__main__":
    import collections
    compras = todas()
    print(f"{len(compras)} compras, {sum(len(c['lineas']) for c in compras)} lineas\n")
    ult = {}
    for c in sorted(compras, key=lambda x: x["fecha"]):
        for l in c["lineas"]:
            ult[l["sku"]] = (c["fecha"], l["costo_unitario"])
    print("Costo que queda en cada insumo (el de la ULTIMA compra, como hace el ERP):")
    for sku, (fe, cu) in sorted(ult.items()):
        print(f"  {sku:14} {cu:>12,.2f}   ({fe})")
    for c in compras[:2]:
        print(f"\n{c['numero']}  {c['fecha']}  {c['proveedor']}")
        for l in c["lineas"]:
            print(f"   {l['sku']:14} {l['cantidad']:>9,.2f} x {l['costo_unitario']:>10,.2f} = {l['total']:>11,.0f}   <- {l['origen']}")
