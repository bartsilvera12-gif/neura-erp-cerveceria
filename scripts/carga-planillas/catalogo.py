"""
Catalogo normalizado de insumos, recetas y lotes a partir de las planillas de
COVEN. Lo mantenemos como dato explicito y no como parsing automatico de los
Excel: las planillas tienen el mismo insumo escrito de varias formas, unidades
mezcladas en una celda de texto y precios que a veces son por unidad y a veces
por linea, asi que la correspondencia la decide una persona y queda escrita.

Cada entrada dice de donde sale el numero.
"""

EMPRESA  = "0cbefe95-4007-402c-97de-70147f9d39bb"
SUCURSAL = "37907a1a-5283-4b65-ae4e-4254924a1a82"  # Cerveceria

PROVEEDORES = [
    # (sku interno, nombre, nota)
    ("Mercado Craft", "Proveedor de los lotes de 500 L (planilla coccion-grande)."),
    ("Cerveshopp",    "Proveedor de los lotes piloto (planilla coccion-pequena)."),
]

# unidad: unidad base con la que el ERP controla el stock y con la que se
# escriben las recetas. costo: Gs por esa unidad base.
# origen: de donde sale el costo.
INSUMOS = [
    # sku, nombre, unidad, costo, origen
    ("MP-PILSEN",    "Malta Pilsen UMA",            "KG", 8600,   "grande: 8.600 Gs/kg (lotes 1-3)"),
    ("MP-VIENNA",    "Malta Vienna UMA",            "KG", 11000,  "grande: 11.000 Gs/kg (lote 2, el mas reciente)"),
    ("MP-CARACLAIR", "Malta Cara Clair",            "KG", 22300,  "grande: 22.300 Gs/kg (lotes 1 y 2)"),
    ("MP-MELANOID",  "Malta Melanoidina UMA",       "KG", 11000,  "grande: 11.000 Gs/kg (lote 3)"),
    ("MP-CARA30",    "Malta Cara 30 UMA",           "KG", 11000,  "grande: 11.000 Gs/kg (lote 3)"),
    ("MP-MUNICH",    "Malta Munich",                "KG", 16000,  "pequena: 4.000 Gs / 250 g"),
    ("MP-CARAPILS",  "Malta Carapils",              "KG", 16000,  "pequena: 4.000 Gs / 250 g"),
    ("MP-CARAMEL20", "Malta Caramelo 20",           "KG", 20000,  "pequena: 5.000 Gs / 250 g"),
    ("MP-CARAMEL60", "Malta Caramelo 60",           "KG", 20000,  "pequena: 15.000 Gs / 750 g (lote 4)"),
    ("MP-PALEALE",   "Malta Pale Ale",              "KG", 14000,  "pequena: 84.000 Gs / 6 kg (lote 4)"),

    ("LU-CASCADE",   "Lupulo Cascade",              "G",  508,    "grande: 101.600 Gs / pack 200 g"),
    # Mismo SKU que ya creo el script 07 para este lupulo: se reusa, no se duplica.
    ("LU-HALLER",    "Lupulo Hallertau Tradition",  "G",  484,    "grande: 242.000 Gs / pack 500 g"),
    ("LU-MAGNUM",    "Lupulo Magnum",               "G",  505,    "grande: 101.000 Gs / pack 200 g"),
    ("LU-CENTENNIAL","Lupulo Centennial",           "G",  508,    "grande: 101.600 Gs / pack 200 g"),
    ("LU-AMARILLO",  "Lupulo Amarillo",             "G",  608,    "grande: 121.600 Gs / pack 200 g"),
    ("LU-CITRACRYO", "Lupulo Citra Cryo",           "G",  445,    "grande: 445.000 Gs / 'pack 1 litro' -- REVISAR, ver notas"),
    ("LU-EKG",       "Lupulo East Kent Golding",    "G",  1000,   "pequena: 15.000 Gs / 15 g"),

    ("LV-US05",      "Levadura Safale US-05",       "G",  1422,   "grande: 711.000 Gs / pack 500 g"),
    ("LV-NEWE",      "Levadura New England",        "G",  0,      "grande: 699.000 Gs / '11 g' -- REVISAR, ver notas"),

    ("CL-IRISH",     "Irish Moss (clarificante)",   "G",  500,    "grande: 500 Gs/g (lotes 1-3)"),
    ("CL-WHIRLFLOC", "Whirlfloc",                   "UNIDAD", 4000, "pequena: 4.000 Gs la pastilla"),

    ("ES-NARANJA",   "Cascara de naranja",          "G",  200,    "pequena: 5.000 Gs / 25 g (lote 8)"),
    ("ES-CEDRON",    "Cedron Kapi'i",               "G",  400,    "pequena: 2.000 Gs / 5 g (lote 8, el mas reciente)"),
]

# Producto "a granel" que produce cada estilo: es el producto en proceso, en
# litros, que despues se envasa en barriles/latas/botellas.
# `recetas` tiene un unico por (empresa, producto): un producto a granel no
# puede tener dos recetas. El cocimiento piloto y el de 500 L son dos procesos
# distintos con rendimientos distintos, asi que cada uno produce su granel.
GRANELES = [
    ("CV-BL-GRANEL",    "Coven Blonde Ale (granel)"),          # ya lo crea el script 07
    ("CV-SE-GRANEL",    "Coven Session IPA (granel)"),
    ("CV-BLL-GRANEL",   "Coven Blonde Ale Ligera (granel)"),
    ("CV-AM-GRANEL",    "Coven Amber Ale Suave (granel)"),
    ("CV-BL-GRANEL-P",  "Coven Blonde Ale piloto (granel)"),
    ("CV-SE-GRANEL-P",  "Coven Session IPA piloto (granel)"),
]

# Recetas derivadas de los lotes que se repiten igual. Las de los lotes piloto
# quedan INACTIVAS a proposito: la planilla no dice cuantos litros rinde cada
# cocimiento chico, y una receta sin rendimiento costea cualquier cosa. Se
# activan desde Recetas una vez cargado el volumen real.
RECETAS = [
    {
        "id": "a1b0c3d4-0001-4a00-9000-000000000001",
        "sku_granel": "CV-SE-GRANEL",
        "nombre": "Coven Session IPA 500 L",
        "rendimiento": 500, "unidad": "L", "activa": True,
        "origen": "coccion-grande, lote 2 del 27/08/2026",
        "items": [
            ("MP-PILSEN", 82.5, "KG"), ("MP-VIENNA", 14.1, "KG"), ("MP-CARACLAIR", 7.4, "KG"),
            ("LU-MAGNUM", 250, "G"), ("LU-CENTENNIAL", 250, "G"), ("LU-AMARILLO", 400, "G"),
            ("LU-CITRACRYO", 2000, "G"), ("LV-NEWE", 11, "G"), ("CL-IRISH", 50, "G"),
        ],
    },
    {
        "id": "a1b0c3d4-0002-4a00-9000-000000000002",
        "sku_granel": "CV-BLL-GRANEL",
        "nombre": "Coven Blonde Ale Ligera (piloto)",
        "rendimiento": 1, "unidad": "L", "activa": False,
        "origen": "coccion-pequena, lotes 6, 7, 9, 10, 11, 12 y 13 (identicos entre si)",
        "items": [
            ("MP-PILSEN", 6.5, "KG"), ("MP-MUNICH", 0.25, "KG"), ("MP-CARAPILS", 0.25, "KG"),
            ("MP-CARAMEL20", 0.25, "KG"), ("LU-CASCADE", 25, "G"), ("LU-EKG", 15, "G"),
            ("LV-US05", 23, "G"), ("CL-WHIRLFLOC", 1, "UNIDAD"),
        ],
    },
    {
        "id": "a1b0c3d4-0003-4a00-9000-000000000003",
        "sku_granel": "CV-BL-GRANEL-P",
        "nombre": "Coven Blonde Ale (piloto)",
        "rendimiento": 1, "unidad": "L", "activa": False,
        "origen": "coccion-pequena, lote 3 del 03/12/2025 (el lote 5 repite la misma carga)",
        "items": [
            ("MP-PILSEN", 6.5, "KG"), ("MP-MUNICH", 0.25, "KG"), ("MP-VIENNA", 0.25, "KG"),
            ("MP-CARAPILS", 0.25, "KG"), ("MP-CARAMEL20", 0.25, "KG"),
            ("LU-CASCADE", 25, "G"), ("LU-EKG", 15, "G"),
            ("LV-US05", 23, "G"), ("CL-WHIRLFLOC", 1, "UNIDAD"),
        ],
    },
    {
        "id": "a1b0c3d4-0004-4a00-9000-000000000004",
        "sku_granel": "CV-SE-GRANEL-P",
        "nombre": "Coven Session IPA (piloto)",
        "rendimiento": 1, "unidad": "L", "activa": False,
        "origen": "coccion-pequena, lote 8 del 08/01/2026",
        "items": [
            ("MP-PILSEN", 5.4, "KG"), ("MP-VIENNA", 0.9, "KG"), ("MP-CARAPILS", 0.45, "KG"),
            ("LU-MAGNUM", 10, "G"), ("LU-CASCADE", 45, "G"), ("LU-AMARILLO", 50, "G"),
            ("ES-NARANJA", 25, "G"), ("ES-CEDRON", 20, "G"),
            ("LV-US05", 23, "G"), ("CL-WHIRLFLOC", 1, "UNIDAD"),
        ],
    },
]
