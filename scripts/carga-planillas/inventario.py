"""
Inventario de planta (`inventario-fabrica.xlsx`): 57 articulos de ferreteria y
repuestos, con la ubicacion fisica donde estan guardados.

La planilla esta escrita a mano y con erratas ("abrasadera", "acoplerapido",
"conetor", "valbula", "mangura", "limpiesa"). Los nombres corregidos se
escriben aca, uno por uno, en vez de arreglarlos con reglas automaticas: una
regla que convierta "abrasadera" en "abrazadera" tambien puede romper un nombre
que estaba bien.
"""

# nombre tal cual en la planilla -> (nombre corregido, categoria)
#   CONEX = conexiones y accesorios · REP = repuestos y consumibles · VAR = varios
NOMBRES = {
  "abrasaderan 3/4":                        ("Abrazadera 3/4", "CONEX"),
  "abrasadera 1":                           ("Abrazadera 1", "CONEX"),
  "abrasadera n 1/2":                       ("Abrazadera 1/2", "CONEX"),
  "abrasadera n 2":                         ("Abrazadera 2", "CONEX"),
  "abrasadera omega3/4":                    ("Abrazadera omega 3/4", "CONEX"),
  "abrasadera omega grande 1-1/2":          ("Abrazadera omega grande 1-1/2", "CONEX"),
  "abrasadera omega 2":                     ("Abrazadera omega 2", "CONEX"),
  "kit analicis de agua":                   ("Kit de analisis de agua", "REP"),
  "acoplerapido jg gris 10 rosca 5/8":      ("Acople rapido JG gris 10 rosca 5/8", "CONEX"),
  "acoplerapido cmb rojo":                  ("Acople rapido CMB rojo", "CONEX"),
  "acoplerapido cmb negro":                 ("Acople rapido CMB negro", "CONEX"),
  "acoplerapido cmb blanco":                ("Acople rapido CMB blanco", "CONEX"),
  "conetor rapido en T blanco":             ("Conector rapido en T blanco", "CONEX"),
  "conetor rapido recto gris":              ("Conector rapido recto gris", "CONEX"),
  "grifo de picnig beer negro":             ("Grifo picnic beer negro", "CONEX"),
  "grifo p/ cubo enbotellado plastico":     ("Grifo plastico para cubo de embotellado", "CONEX"),
  "union t plastico blanco p/ mangura":     ("Union T plastica blanca para manguera", "CONEX"),
  "racor t n 4/4/4":                        ("Racor T 4/4/4", "CONEX"),
  "racor t n 6/6/6":                        ("Racor T 6/6/6", "CONEX"),
  "racor t n 8/8/8":                        ("Racor T 8/8/8", "CONEX"),
  "racor t n 10/10/10":                     ("Racor T 10/10/10", "CONEX"),
  "racor y n 12/12/12":                     ("Racor Y 12/12/12", "CONEX"),
  "racor acople n 12/12":                   ("Racor acople 12/12", "CONEX"),
  "racor codo n 10/10":                     ("Racor codo 10/10", "CONEX"),
  "racor codo n 10 / rosca 1/4":            ("Racor codo 10 rosca 1/4", "CONEX"),
  "racor t n 6/6/ rosca 1/4":               ("Racor T 6/6 rosca 1/4", "CONEX"),
  "racor acople n 6/6":                     ("Racor acople 6/6", "CONEX"),
  "racord acople n  8/8":                   ("Racor acople 8/8", "CONEX"),
  "racor recto n 6 rosca 1/8":              ("Racor recto 6 rosca 1/8", "CONEX"),
  "racor recto n 4 rosca 1/8":              ("Racor recto 4 rosca 1/8", "CONEX"),
  "racor recto n 6 rosca 1/4":              ("Racor recto 6 rosca 1/4", "CONEX"),
  "racor recto n 4 rosca 1/4":              ("Racor recto 4 rosca 1/4", "CONEX"),
  "racor recto n 4 rosca 3/16":             ("Racor recto 4 rosca 3/16", "CONEX"),
  "racor curbo n 4 rosca 3/16 c/regulador": ("Racor curvo 4 rosca 3/16 con regulador", "CONEX"),
  "racor curbo n 10 rosca 1/4 c/regulador": ("Racor curvo 10 rosca 1/4 con regulador", "CONEX"),
  "lave plastico fermentaor":               ("Llave plastica de fermentador", "CONEX"),
  "valbula pequeña azul plastico":          ("Valvula pequeña azul de plastico", "CONEX"),
  "cola de chanco cobre":                   ("Cola de chancho de cobre", "CONEX"),
  "snaplok 1/2  50B embra":                 ("Snap-lock 1/2 50B hembra", "CONEX"),
  "snaplok 1/250B macho":                   ("Snap-lock 1/2 50B macho", "CONEX"),
  "snaplok curbo de 1/2 rosca 1/2":         ("Snap-lock curvo 1/2 rosca 1/2", "CONEX"),
  "llave de paso cf8m 1/2 inox":            ("Llave de paso CF8M 1/2 inox", "CONEX"),
  "acople de barril C":                     ("Acople de barril tipo C", "CONEX"),
  "acople de barril G":                     ("Acople de barril tipo G", "CONEX"),
  "goma carga enlatadora silicona":         ("Goma de carga de enlatadora, silicona", "REP"),
  "junta clamp 1/5´´ silicona":             ("Junta clamp 1,5'' silicona", "REP"),
  "junta clamp 4´´":                        ("Junta clamp 4''", "REP"),
  "junta clamp 2´´":                        ("Junta clamp 2''", "REP"),
  "orin / barios":                          ("O-rings varios", "REP"),
  "acople manguera":                        ("Acoples de manguera varios", "CONEX"),
  "mangueras varias":                       ("Mangueras varias", "REP"),
  "electricidad vaias":                     ("Material electrico vario", "REP"),
  "repuesto chopera":                       ("Repuestos de chopera", "REP"),
  "molino repuesto":                        ("Repuestos de molino", "REP"),
  "manometros /codo inox":                  ("Manometros y codos inox", "REP"),
  "documentos":                             ("Documentos", "VAR"),
  "quimicos limpiesa":                      ("Quimicos de limpieza", "REP"),
}

CATEGORIAS = {
  "CONEX": "Conexiones y accesorios",
  "REP":   "Repuestos y consumibles de planta",
  "VAR":   "Varios",
}
