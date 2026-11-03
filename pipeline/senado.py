"""Senado: asistencia, votaciones y fotos de senadoras y senadores, con la API pública del Senado
(web-back.senado.cl/api) y su servicio de tramitación (tramitacion.senado.cl/wspublico).

Genera en web/senado/ los mismos archivos que la Cámara (datos.json, votaciones.json, medios.json y
fotos/), para que la página muestre ambas cámaras con el mismo código. Lo ya descargado queda en
data/raw/senado/ y no se vuelve a pedir, salvo lo de la última semana.

Uso: python pipeline/senado.py   (después de calcular.py y medios.py; requiere Pillow)
"""
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from PIL import Image

from calcular import periodos, resumen_unanimidad

API = "https://web-back.senado.cl/api/"
TRAMITACION = "https://tramitacion.senado.cl/wspublico/tramitacion.php?boletin="
UA = {"User-Agent": "CongresoAbierto/0.1 (proyecto ciudadano de datos abiertos)"}
RAIZ = Path(__file__).resolve().parent.parent
RAW = RAIZ / "data" / "raw" / "senado"
WEB = RAIZ / "web" / "senado"
INICIO_PERIODO = "2026-03-11"
LADO_FOTO = 192
MIN_SESIONES, MIN_VOTACIONES = 10, 50

# Partidos como los escribe el Senado -> siglas usadas en el sitio (para reutilizar logos y colores)
PARTIDOS = {
    "R.N.": "RN", "P.S.": "PS", "U.D.I.": "UDI", "P.P.D.": "PPD", "P.D.C.": "DC", "P.C": "PC", "P.C.": "PC",
    "Republicano": "PREP", "Evópoli": "EVOP", "Frente Amplio": "FA", "F.R.E.V.S.": "FRVS", "Demócratas": "DEM",
    "Nacional Libertario": "PNL", "Liberal": "PL", "Independiente": "IND", "P.R.": "PR",
}
CODIGO_ESTADO = {"asiste": "a", "licencia": "l", "trabajo": "t", "justificada": "j", "sin_justificar": "x"}
OPCION = {"SI": "a", "NO": "c", "ABS": "b", "ABSTENCION": "b", "PAREO": "p"}  # p = pareo (acuerdo de no votar)


def pedir(url, intentos=5):
    req = urllib.request.Request(url, headers=UA)
    for i in range(intentos):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                datos = r.read()
            time.sleep(.3)
            return datos
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == intentos - 1:
                raise
            time.sleep(3 + 3 * i)
    raise AssertionError


def api(ruta, **params):
    return json.loads(pedir(API + ruta + ("?" + urllib.parse.urlencode(params) if params else "")))["data"]


def en_cache(nombre, obtener, refrescar=False):
    archivo = RAW / nombre
    if archivo.exists() and not refrescar:
        return json.loads(archivo.read_text(encoding="utf-8"))
    datos = obtener()
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    return datos


iso = lambda f: f"{f[6:10]}-{f[3:5]}-{f[0:2]}"  # "28/10/2026" o "28-10-2026 19:39:05" -> "2026-10-28"


def categoria(justificacion):
    """Clasifica la justificación del Senado en las mismas categorías que la Cámara."""
    if not justificacion:
        return "sin_justificar"
    j = justificacion.lower()
    if any(p in j for p in ("licencia", "natal", "parental", "nacimiento", "enfermedad", "médic", "salud")):
        return "licencia"
    if any(p in j for p in ("misión", "mision", "oficial", "comisión", "representación", "cometido")):
        return "trabajo"
    return "justificada"


def guardar_foto(url, destino):
    im = Image.open(io.BytesIO(pedir(url))).convert("RGB")
    lado = min(im.size)
    x = (im.width - lado) // 2
    y = min(int(im.height * .04), im.height - lado)  # retrato vertical: recorte cuadrado arriba (rostro)
    im = im.crop((x, y, x + lado, y + lado)).resize((LADO_FOTO, LADO_FOTO), Image.LANCZOS)
    destino.parent.mkdir(parents=True, exist_ok=True)
    im.save(destino, "JPEG", quality=82, optimize=True)


def titulo_boletin(boletin):
    numero = boletin.split("-")[0]
    try:
        raiz = ET.fromstring(pedir(TRAMITACION + numero))
        return (raiz.findtext(".//titulo") or "").strip() or None
    except (ET.ParseError, urllib.error.URLError):
        return None


def main():
    hoy = date.today().isoformat()
    legislaturas = [l for l in api("legislatures") if INICIO_PERIODO <= iso(l["INICIO"]) <= hoy]
    print("Legislaturas:", [l["NUMERO"] for l in legislaturas])

    senadores, sesiones, votos = {}, {}, {}
    for l in legislaturas:
        lid = l["ID_LEGISLATURA"]
        reciente = iso(l["TERMINO"]) >= hoy  # la legislatura en curso se refresca siempre
        for p in en_cache(f"parlamentarios_{lid}.json", lambda: api("parliamentarians", id_legislatura=lid, limit=100), reciente)["data"]:
            senadores[p["ID_PARLAMENTARIO"]] = p
        for s in en_cache(f"sesiones_{lid}.json", lambda: api("sessions", id_legislatura=lid, limit=500), reciente)["data"]:
            sesiones[s["ID_SESION"]] = s

        def todas_las_votaciones():
            lista, offset = [], 0
            while True:
                pagina = api("votes", id_legislatura=lid, limit=100, offset=offset)
                lista += pagina["data"]
                offset += 100
                if not pagina["data"] or offset >= pagina["total"]:
                    return lista
        for v in en_cache(f"votaciones_{lid}.json", todas_las_votaciones, reciente):
            votos[v["ID_VOTACION"]] = v
    print(f"Senadores: {len(senadores)} · sesiones: {len(sesiones)} · votaciones: {len(votos)}")

    # Asistencia por sesión (solo sesiones ya realizadas; la API también lista las programadas)
    asistencia = {}
    for sid, s in sorted(sesiones.items(), key=lambda kv: iso(kv[1]["FECHA"])):
        f = iso(s["FECHA"])
        if f > hoy:
            continue
        reciente = (date.today() - date.fromisoformat(f)).days <= 7
        datos = en_cache(f"asistencia/{sid}.json", lambda: api("sessions/attendance", id_sesion=sid), reciente)
        filas = datos.get("DATA", []) if isinstance(datos, dict) else []
        if any(x["ASISTENCIA"] == "Asiste" for x in filas):  # sin nadie presente = aún no publicada
            asistencia[sid] = filas
    print("Sesiones con asistencia:", len(asistencia))

    # --- Métricas por senador (mismos campos que la Cámara) ---
    reg = defaultdict(lambda: {
        "sesiones": 0, "asiste": 0, "inasistencias": 0, "falta_licencia": 0, "falta_trabajo": 0, "falta_justificada": 0,
        "falta_sin_justificar": 0, "falta_excusada": 0, "votaciones": 0, "vota": 0, "dispensado": 0, "no_vota": 0,
        "no_vota_presente": 0, "no_vota_licencia": 0, "no_vota_trabajo": 0, "no_vota_excusado": 0, "historial": [],
        "motivos": defaultdict(int),
    })
    estado_en = {}  # (sesión, senador) -> estado
    for sid, filas in asistencia.items():
        fecha = iso(sesiones[sid]["FECHA"])
        for x in filas:
            pid, r = x["ID_PARLAMENTARIO"], reg[x["ID_PARLAMENTARIO"]]
            r["sesiones"] += 1
            estado = "asiste" if x["ASISTENCIA"] == "Asiste" else categoria(x["JUSTIFICACION"])
            entrada = {"fecha": fecha, "sesion": sid, "estado": estado, "motivo": x["JUSTIFICACION"] if estado != "asiste" else None}
            r["historial"].append(entrada)
            if estado == "asiste":
                r["asiste"] += 1
            else:
                r["inasistencias"] += 1
                r[f"falta_{estado}"] += 1
                if x["JUSTIFICACION"]:
                    r["motivos"][x["JUSTIFICACION"]] += 1
                    r["falta_excusada"] += 1  # en el Senado se descuenta toda inasistencia justificada
            estado_en[(sid, pid)] = estado

    ids = [pid for pid in senadores if reg[pid]["sesiones"]]
    posicion = {pid: k for k, pid in enumerate(ids)}
    votaciones = []
    desfase = []  # votaciones cuya fecha no coincide con la de su sesión (para revisar a mano)
    for vid, v in votos.items():
        letras = ["-"] * len(ids)
        for clave, lista in (v.get("VOTACIONES") or {}).items():
            for p in lista or []:
                if p["PARLID"] in posicion:
                    letras[posicion[p["PARLID"]]] = OPCION.get(clave.upper(), "n")
        sid = v["ID_SESION"]
        if sid in sesiones and abs((date.fromisoformat(iso(v["FECHA_VOTACION"])) - date.fromisoformat(iso(sesiones[sid]["FECHA"]))).days) > 1:
            desfase.append((vid, iso(v["FECHA_VOTACION"]), iso(sesiones[sid]["FECHA"])))
        for pid in ids:  # quienes no aparecen en ninguna lista y estaban en la sesión: no votaron
            k = posicion[pid]
            if letras[k] == "-" and (sid, pid) in estado_en:
                letras[k] = "n"
            if letras[k] == "-" or sid not in asistencia:
                continue  # sin lista de asistencia de esa sesión no cuenta por persona (igual que la Cámara)
            r = reg[pid]
            r["votaciones"] += 1
            if letras[k] in "acb":
                r["vota"] += 1
            elif letras[k] == "p":
                r["dispensado"] += 1  # el pareo es un acuerdo formal de no votar: no se exige
            else:
                r["no_vota"] += 1
                estado = estado_en.get((sid, pid))
                if estado == "asiste":
                    r["no_vota_presente"] += 1
                elif estado in ("licencia", "trabajo"):
                    r[f"no_vota_{estado}"] += 1
                if estado in ("licencia", "trabajo", "justificada"):
                    r["no_vota_excusado"] += 1
        tema = re.sub(r"^\s*-\s*", "", v.get("TEMA") or "").strip()
        codigo = (v.get("BOLETIN") or "").strip()
        boletin = codigo if re.fullmatch(r"\d+-\d+", codigo) else None  # "S 2.716" y similares son asuntos del Senado
        votaciones.append({
            "id": vid, "fecha": f"{iso(v['FECHA_VOTACION'])}T{v['FECHA_VOTACION'][11:16]}",
            "tipo": "Proyecto de Ley" if boletin else "Otros",
            "asunto": f"Asunto del Senado {codigo}" if codigo and not boletin else "Votación en Sala", "boletin": boletin,
            "materia": None, "articulo": tema or None, "tramite": None, "etapa": None, "quorum": v.get("QUORUM"),
            "resultado": None, "si": v["SI"], "no": v["NO"], "abst": v["ABS"], "disp": v.get("PAREO", 0),
            "votos": "".join(letras),
        })
    votaciones.sort(key=lambda x: (x["fecha"], x["id"]), reverse=True)

    # Títulos de los proyectos votados
    titulos = en_cache("titulos.json", lambda: {})
    for b in sorted({v["boletin"] for v in votaciones if v["boletin"]} - set(titulos)):
        titulos[b] = titulo_boletin(b)
    (RAW / "titulos.json").write_text(json.dumps(titulos, ensure_ascii=False), encoding="utf-8")
    proyectos = {b: {"titulo": t} for b, t in titulos.items() if t}

    # --- Archivos para la web ---
    nombres_partido = {d["partido"]: d["partido_nombre"] for d in json.loads((RAIZ / "web" / "datos.json").read_text(encoding="utf-8"))["diputados"]}
    pct = lambda a, b, minimo=1: round(100 * a / b, 1) if b >= minimo else None
    fechas_sesion = sorted({iso(sesiones[s]["FECHA"]) + f"#{s}" for s in asistencia})
    orden_sesiones = [int(x.split("#")[1]) for x in fechas_sesion]
    motivos_lista = sorted({h["motivo"] for pid in ids for h in reg[pid]["historial"] if h["motivo"]})
    filas = []
    for pid in ids:
        p, r = senadores[pid], reg[pid]
        r["historial"].sort(key=lambda h: (h["fecha"], h["sesion"]))
        por_sesion = {h["sesion"]: h for h in r["historial"]}
        alias = PARTIDOS.get((p.get("PARTIDO") or "").strip(), (p.get("PARTIDO") or "").strip())
        filas.append({
            "id": pid, "slug": p.get("SLUG"),
            "nombre": re.sub(r"\s+", " ", p.get("NOMBRE_COMPLETO") or "").strip(),
            "partido": alias, "partido_nombre": nombres_partido.get(alias) or p.get("PARTIDO") or "",
            "region": p.get("REGION"),
            **{k: v for k, v in r.items() if k not in ("historial", "motivos")},
            "pct_asistencia": pct(r["asiste"], r["sesiones"]),
            "pct_votaciones": pct(r["vota"], r["votaciones"] - r["dispensado"]),
            "pct_asistencia_ajustada": pct(r["asiste"], r["sesiones"] - r["falta_excusada"], MIN_SESIONES),
            "pct_votaciones_ajustado": pct(r["vota"], r["votaciones"] - r["dispensado"] - r["no_vota_excusado"], MIN_VOTACIONES),
            "periodos": periodos(r["historial"]),
            "historial": "".join(CODIGO_ESTADO[por_sesion[s]["estado"]] if s in por_sesion else "-" for s in orden_sesiones),
            "motivo_sesion": {str(n): motivos_lista.index(por_sesion[s]["motivo"])
                              for n, s in enumerate(orden_sesiones) if s in por_sesion and por_sesion[s]["motivo"]},
        })
    filas.sort(key=lambda f: (f["pct_asistencia"] or 0, f["pct_votaciones"] or 0))
    promedio = lambda k: round(sum(f[k] for f in filas if f[k] is not None) / len([f for f in filas if f[k] is not None]), 1)
    resumen = {
        "actualizado": datetime.now().isoformat(timespec="minutes"), "periodo": "2026-2030",
        "sesiones": len(asistencia), "votaciones": len(votaciones),
        "promedio_asistencia": promedio("pct_asistencia"), "promedio_votaciones": promedio("pct_votaciones"),
        "promedio_asistencia_ajustada": promedio("pct_asistencia_ajustada"), "promedio_votaciones_ajustado": promedio("pct_votaciones_ajustado"),
        "fuente": "https://www.senado.cl", "unanimidad": resumen_unanimidad(votaciones, proyectos),
    }
    WEB.mkdir(parents=True, exist_ok=True)
    escribir = lambda nombre, obj: (WEB / nombre).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    escribir("datos.json", {"resumen": resumen, "sesiones": [x.split("#")[0] for x in fechas_sesion], "motivos": motivos_lista, "diputados": filas})
    escribir("votaciones.json", {"diputados": ids, "proyectos": proyectos, "votaciones": votaciones})

    # Fotos oficiales del Senado + logos y colores de partidos ya descargados para la Cámara
    medios_camara = json.loads((RAIZ / "web" / "medios.json").read_text(encoding="utf-8"))
    medios = {"diputados": {}, "partidos": medios_camara["partidos"]}  # rutas relativas a web/, igual que la Cámara
    for f in filas:
        url = senadores[f["id"]].get("IMAGEN_450") or senadores[f["id"]].get("IMAGEN")
        destino = WEB / "fotos" / f"{f['id']}.jpg"
        if url and not destino.exists():
            try:
                guardar_foto(url, destino)
            except Exception as e:  # noqa: BLE001 - una foto fallida no debe detener el resto
                print("  sin foto:", f["nombre"], e)
        if destino.exists():
            medios["diputados"][str(f["id"])] = {"foto": f"senado/fotos/{f['id']}.jpg", "autor": "Senado de Chile", "licencia": "senado.cl",
                                                 "fuente": "https://www.senado.cl"}
    escribir("medios.json", medios)
    print(json.dumps({k: v for k, v in resumen.items() if k != "unanimidad"}, ensure_ascii=False, indent=1))
    if desfase:
        print(f"Aviso: {len(desfase)} votaciones con fecha distinta a la de su sesión (votación, fecha, sesión):", desfase[:10])
    print("Fotos:", len(medios["diputados"]), "| proyectos con título:", len(proyectos), "| motivos:", motivos_lista)


if __name__ == "__main__":
    main()
