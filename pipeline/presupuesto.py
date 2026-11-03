"""Presupuesto del Congreso Nacional (Partida 02 de la Ley de Presupuestos), con los datos abiertos que la
Dirección de Presupuestos (DIPRES) publica cada mes en datos.gob.cl: ley inicial y vigente, y ejecución
(lo efectivamente gastado) por capítulo (Senado, Cámara, Biblioteca y Consejo de Asignaciones) y subtítulo.

Genera web/presupuesto.json. Los CSV ya descargados quedan en data/raw/dipres/ y no se vuelven a pedir.

Uso: python pipeline/presupuesto.py
"""
import csv
import io
import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

CKAN = "https://datos.gob.cl/api/3/action/package_show?id="
UA = {"User-Agent": "CongresoAlDia/0.1 (proyecto ciudadano de datos abiertos)"}
RAIZ = Path(__file__).resolve().parent.parent
RAW = RAIZ / "data" / "raw" / "dipres"
MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
         "Noviembre", "Diciembre"]
PARTIDA = "02"  # Congreso Nacional
CAPITULOS = {  # código -> (nombre para el sitio, parlamentarios)
    "01": ("Senado", 50),
    "02": ("Cámara de Diputadas y Diputados", 155),
    "03": ("Biblioteca del Congreso Nacional", None),
    "04": ("Consejo Resolutivo de Asignaciones Parlamentarias", None),
}
# Subtítulos de gasto con nombres legibles; el resto se agrupa en "Otros"
SUBTITULOS = {
    "21": "Personal (dietas y funcionarios)",
    "24": "Asignaciones parlamentarias y otras transferencias",
    "22": "Bienes y servicios de consumo",
    "29": "Equipos, computadores y mobiliario",
}
POBLACION = 18_480_432  # personas censadas en el Censo 2024 (INE)


def pedir(url, intentos=5):
    req = urllib.request.Request(url, headers=UA)
    for i in range(intentos):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                datos = r.read()
            time.sleep(.3)
            return datos
        except urllib.error.HTTPError as e:
            if e.code == 404 or i == intentos - 1:
                raise
            time.sleep(3 + 3 * i)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == intentos - 1:
                raise
            time.sleep(3 + 3 * i)
    raise AssertionError


def csv_capitulo(tipo, mes, anio):
    """Filas de la Partida 02 del CSV "A nivel Capítulo" del conjunto de datos `tipo` del mes, o None si no existe."""
    slug = {"ley": f"ley-de-presupuestos-inicial-y-vigente-a-{mes.lower()}-de-{anio}-del-gobierno-central-ley-regular",
            "ejecucion": f"ejecucion-presupuestaria-a-{mes.lower()}-de-{anio}-del-gobierno-central-ley-regular"}[tipo]
    archivo = RAW / f"{slug}.csv"
    if not archivo.exists():
        try:
            paquete = json.loads(pedir(CKAN + slug))["result"]
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise
        recurso = next(r for r in paquete["resources"] if "Capítulo" in r["name"])
        RAW.mkdir(parents=True, exist_ok=True)
        archivo.write_bytes(pedir(recurso["url"]))
    filas = csv.DictReader(io.StringIO(archivo.read_text(encoding="utf-8-sig")), delimiter=";")
    return [f for f in filas if f["Partida"].strip().zfill(2) == PARTIDA]


miles = lambda s: int((s or "0").replace(".", "").strip() or 0) * 1000  # "1.234" (miles de pesos) -> pesos
es_gasto = lambda f: int(f["Subtítulo"]) >= 21  # 05-15 son ingresos


def main():
    hoy = date.today()
    anio = hoy.year
    # Último mes publicado (la DIPRES publica con un mes o más de desfase)
    ley, n_mes = None, 0
    for m in range(hoy.month, 0, -1):
        ley = csv_capitulo("ley", MESES[m - 1], anio)
        if ley and csv_capitulo("ejecucion", MESES[m - 1], anio):
            n_mes = m
            break
    if not n_mes:
        raise SystemExit(f"No hay datos de la DIPRES para {anio}")
    mes = MESES[n_mes - 1]
    print(f"Presupuesto {anio}, datos a {mes}")

    capitulos = {c: {"codigo": c, "nombre": n, "parlamentarios": p, "inicial": 0, "vigente": 0, "ejecutado": 0,
                     "subtitulos": {}} for c, (n, p) in CAPITULOS.items()}
    for f in filter(es_gasto, ley):
        c = capitulos[f["Capítulo"].zfill(2)]
        c["inicial"] += miles(f["Monto Ley Inicial"])
        c["vigente"] += miles(f[f"Monto Ley Vigente a {mes}"])
        s = c["subtitulos"].setdefault(f["Subtítulo"], {"vigente": 0, "ejecutado": 0})
        s["vigente"] += miles(f[f"Monto Ley Vigente a {mes}"])

    # Ejecución de cada mes (para la curva mensual) y acumulada al último mes
    mensual = []
    for m in range(1, n_mes + 1):
        filas = csv_capitulo("ejecucion", MESES[m - 1], anio)
        if filas is None:
            print("Aviso: falta la ejecución de", MESES[m - 1])
            continue
        gasto = [f for f in filas if es_gasto(f)]
        mensual.append({"mes": m, "ejecutado": sum(miles(f[f"Ejecución de {MESES[m - 1]}"]) for f in gasto)})
        if m == n_mes:
            for f in gasto:
                c = capitulos[f["Capítulo"].zfill(2)]
                c["ejecutado"] += miles(f[f"Ejecución a {mes}"])
                c["subtitulos"].setdefault(f["Subtítulo"], {"vigente": 0, "ejecutado": 0})["ejecutado"] += miles(f[f"Ejecución a {mes}"])

    def agrupar(subs):
        grupos = {nombre: {"nombre": nombre, "vigente": 0, "ejecutado": 0} for nombre in [*SUBTITULOS.values(), "Otros"]}
        for codigo, s in subs.items():
            g = grupos[SUBTITULOS.get(codigo, "Otros")]
            g["vigente"] += s["vigente"]
            g["ejecutado"] += s["ejecutado"]
        return [g for g in grupos.values() if g["vigente"] or g["ejecutado"]]

    lista = list(capitulos.values())
    todos = {}
    for c in lista:
        for codigo, s in c["subtitulos"].items():
            t = todos.setdefault(codigo, {"vigente": 0, "ejecutado": 0})
            t["vigente"] += s["vigente"]
            t["ejecutado"] += s["ejecutado"]
        c["subtitulos"] = agrupar(c["subtitulos"])
    total = {k: sum(c[k] for c in lista) for k in ("inicial", "vigente", "ejecutado")}

    salida = {
        "anio": anio, "mes": n_mes, "mes_nombre": mes.lower(),
        "actualizado": datetime.now().strftime("%Y-%m-%dT%H:%M"),
        "poblacion": POBLACION, "poblacion_fuente": "Censo 2024 (INE)",
        "total": total, "subtitulos": agrupar(todos), "capitulos": lista, "mensual": mensual,
        "fuente": "https://datos.gob.cl/organization/direccion_de_presupuestos",
    }
    (RAIZ / "web" / "presupuesto.json").write_text(json.dumps(salida, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"total": total, "por_habitante": round(total["vigente"] / POBLACION),
                      "por_dia": round(total["vigente"] / 365)}, ensure_ascii=False))
    for c in lista:
        print(f"  {c['nombre']}: vigente {c['vigente']:,} · ejecutado {c['ejecutado']:,}")
    print("  mensual:", [(x["mes"], x["ejecutado"]) for x in mensual])


if __name__ == "__main__":
    main()
