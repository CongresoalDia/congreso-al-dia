"""Calcula asistencia y participación en votaciones de cada diputado a partir de data/raw/.

Toda inasistencia cuenta, sea cual sea el motivo. Las licencias y el trabajo parlamentario se
marcan aparte (historial por sesión y períodos) para dar contexto, y se entrega además un
porcentaje "ajustado" que no los cuenta, como dato secundario.

Genera data/diputados.json (para la web) y data/diputados.csv (para revisar en Excel).

Uso: python pipeline/calcular.py
"""
import csv
import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

NS = {"c": "http://opendata.camara.cl/camaradiputados/v1"}
RAIZ = Path(__file__).resolve().parent.parent
RAW = RAIZ / "data" / "raw"
SALIDA = RAIZ / "data"

# Códigos de justificación (WSComun.retornarTiposJustificacionesInasistencia)
LICENCIA = {"19", "26", "27", "28", "29"}  # licencia médica, prenatal, postnatal, postnatal parental, parental
TRABAJO = {"10", "11", "12", "13", "14", "17"}  # misiones oficiales, labor parlamentaria, con el Presidente, encargo de la Cámara
# El resto (impedimento grave, permisos personales, permisos de Comités...) = "justificada"
# Art. 42 del Reglamento: licencia médica, impedimento grave, permiso particular, labor parlamentaria, encargo de la Cámara.
# Por reglamento no afectan la asistencia: la cifra ajustada las descuenta, junto con licencias y trabajo parlamentario.
ART_42 = {"13", "17", "18", "19", "21"}
EXCUSADAS = LICENCIA | TRABAJO | ART_42

VOTO_EMITIDO = {"0", "1", "2"}  # en contra, a favor, abstención
VOTO_DISPENSADO = "3"
MIN_SESIONES, MIN_VOTACIONES = 10, 50  # base mínima para que un porcentaje ajustado sea representativo


def txt(nodo, ruta):
    return nodo.findtext(ruta, namespaces=NS)


def nombre_completo(d):
    return " ".join(p for p in (txt(d, "c:Nombre"), txt(d, "c:ApellidoPaterno"), txt(d, "c:ApellidoMaterno")) if p)


def cargar_diputados():
    hoy = date.today().isoformat()
    diputados = {}
    for dp in ET.parse(RAW / "diputados.xml").getroot().iterfind("c:DiputadoPeriodo", NS):
        d = dp.find("c:Diputado", NS)
        militancias = sorted(d.iterfind(".//c:Militancia", NS), key=lambda m: txt(m, "c:FechaInicio"))
        vigente = next((m for m in militancias if txt(m, "c:FechaInicio")[:10] <= hoy <= txt(m, "c:FechaTermino")[:10]),
                       militancias[-1] if militancias else None)
        diputados[txt(d, "c:Id")] = {
            "id": int(txt(d, "c:Id")),
            "nombre": nombre_completo(d),
            "partido": txt(vigente, "c:Partido/c:Alias") if vigente is not None else "",
            "partido_nombre": txt(vigente, "c:Partido/c:Nombre") if vigente is not None else "",
            "sexo": txt(d, "c:Sexo"),
        }
    return diputados


def nuevo_registro():
    return {
        "sesiones": 0, "asiste": 0, "inasistencias": 0,
        "falta_licencia": 0, "falta_trabajo": 0, "falta_justificada": 0, "falta_sin_justificar": 0,
        "votaciones": 0, "vota": 0, "dispensado": 0, "no_vota": 0, "no_vota_presente": 0,
        "no_vota_licencia": 0, "no_vota_trabajo": 0, "falta_excusada": 0, "no_vota_excusado": 0,
        "motivos": defaultdict(int),
        "historial": [],
    }


def periodos(historial):
    """Agrupa sesiones consecutivas con licencia o trabajo parlamentario en {estado, desde, hasta, sesiones, motivo}."""
    periodos, actual = [], None
    for h in historial:
        if h["estado"] not in ("licencia", "trabajo"):
            actual = None
        elif actual and actual["estado"] == h["estado"] and actual["motivo"] == h["motivo"]:
            actual["hasta"] = h["fecha"]
            actual["sesiones"] += 1
        else:
            actual = {"estado": h["estado"], "desde": h["fecha"], "hasta": h["fecha"], "sesiones": 1, "motivo": h["motivo"]}
            periodos.append(actual)
    return periodos


CODIGO_ESTADO = {"asiste": "a", "licencia": "l", "trabajo": "t", "justificada": "j", "sin_justificar": "x"}


def exportar_web(resumen, filas, sesiones):
    """Versión compacta para web/datos.json: el historial va como un string con una letra por sesión
    (a asiste, l licencia, t trabajo, j otra justificada, x sin justificar, - no era diputado)."""
    fechas = [s[0][:10] for s in sesiones]
    ids = [s[3] for s in sesiones]
    motivos = sorted({h["motivo"] for f in filas for h in f["historial"] if h["motivo"]})
    diputados = []
    for f in filas:
        por_sesion = {h["sesion"]: h for h in f["historial"]}
        historial = "".join(CODIGO_ESTADO[por_sesion[i]["estado"]] if i in por_sesion else "-" for i in ids)
        diputados.append({
            **{k: v for k, v in f.items() if k not in ("historial", "motivos", "sexo")},
            "historial": historial,
            # índice de sesión -> índice de motivo, solo para inasistencias justificadas
            "motivo_sesion": {str(n): motivos.index(por_sesion[i]["motivo"])
                              for n, i in enumerate(ids) if i in por_sesion and por_sesion[i]["motivo"]},
        })
    web = RAIZ / "web"
    web.mkdir(exist_ok=True)
    (web / "datos.json").write_text(
        json.dumps({"resumen": resumen, "sesiones": fechas, "motivos": motivos, "diputados": diputados},
                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


OPCION_VOTO = {"0": "c", "1": "a", "2": "b", "3": "d", "4": "n"}  # en contra, a favor, abstención, dispensado, no vota
ASUNTOS = {  # descripciones codificadas de votaciones que no son proyectos de ley
    "1-Otros": "Otros asuntos de la Sala", "5-Cambio de Trámite": "Cambio de trámite",
    "2-Acusacion Constitucional": "Acusación constitucional", "3-Creacion Comision Investigadora": "Creación de comisión investigadora",
    "4-Informe Comision Investigadora": "Informe de comisión investigadora",
}


def exportar_votaciones(filas):
    """web/votaciones.json: cada votación con su proyecto, qué se votó y el voto de cada diputado
    (una letra por diputado, en el orden de la lista "diputados": a favor, c en contra, b abstención,
    d dispensado, n no vota, - no estaba en la lista)."""
    ids = [f["id"] for f in filas]
    posicion = {str(i): k for k, i in enumerate(ids)}
    proyectos, detalle = {}, {}
    for archivo in (RAW / "proyectos").glob("*.xml"):
        p = ET.parse(archivo).getroot()
        if txt(p, "c:NumeroBoletin") is None:
            continue
        proyectos[txt(p, "c:NumeroBoletin")] = {"titulo": (txt(p, "c:Nombre") or "").strip(), "id": int(txt(p, "c:Id"))}
        for v in p.iterfind(".//c:VotacionProyectoLey", NS):
            detalle[txt(v, "c:Id")] = {"articulo": (txt(v, "c:Articulo") or "").strip(),
                                       "tramite": txt(v, "c:TramiteConstitucional"), "etapa": txt(v, "c:TipoVotacionProyectoLey")}
    # Materia de los proyectos de resolución y de acuerdo del período, por número
    periodo = txt(ET.parse(RAW / "periodo.xml").getroot(), "c:Id")
    materias = {}
    for patron, etiqueta, nodo in (("resoluciones_*.xml", "Resolución", "c:ProyectoResolucion"),
                                   ("acuerdos_*.xml", "Acuerdo", "c:ProyectoAcuerdo")):
        for archivo in RAW.glob(patron):
            for it in ET.parse(archivo).getroot().iterfind(nodo, NS):
                if txt(it, "c:Periodo/c:Id") == periodo and txt(it, "c:Materia"):
                    materias[(etiqueta, txt(it, "c:Numero"))] = txt(it, "c:Materia").strip()

    votaciones = []
    for archivo in (RAW / "votos").glob("*.xml"):
        v = ET.parse(archivo).getroot()
        vid, desc = txt(v, "c:Id"), (txt(v, "c:Descripcion") or "").strip()
        boletin = re.search(r"Bolet[ií]n N°\s*(\d+-\d+)", desc)
        numero = re.match(r"Proyecto de (Resolución|Acuerdo) N°\s*(\d+)", desc)
        votos = ["-"] * len(ids)
        for voto in v.iterfind(".//c:Voto", NS):
            k = posicion.get(txt(voto, "c:Diputado/c:Id"))
            if k is not None:
                votos[k] = OPCION_VOTO.get(voto.find("c:OpcionVoto", NS).get("Valor"), "n")
        d = detalle.get(vid, {})
        votaciones.append({
            "id": int(vid), "fecha": txt(v, "c:Fecha")[:16], "tipo": txt(v, "c:Tipo"),
            "asunto": ASUNTOS.get(desc, desc), "boletin": boletin.group(1) if boletin else None,
            "materia": materias.get(numero.groups()) if numero else None,
            "articulo": d.get("articulo") or None, "tramite": d.get("tramite"), "etapa": d.get("etapa"),
            "quorum": txt(v, "c:Quorum"), "resultado": txt(v, "c:Resultado"),
            "si": int(txt(v, "c:TotalSi")), "no": int(txt(v, "c:TotalNo")),
            "abst": int(txt(v, "c:TotalAbstencion")), "disp": int(txt(v, "c:TotalDispensado")),
            "votos": "".join(votos),
        })
    votaciones.sort(key=lambda x: (x["fecha"], x["id"]), reverse=True)
    usados = {v["boletin"] for v in votaciones if v["boletin"]}
    (RAIZ / "web" / "votaciones.json").write_text(json.dumps(
        {"diputados": ids, "proyectos": {b: p for b, p in proyectos.items() if b in usados}, "votaciones": votaciones},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return resumen_unanimidad(votaciones, proyectos)


def racha_calendario(votaciones):
    """Mayor tiempo en días de calendario entre dos días con votación unánime: {dias, desde, hasta} o None."""
    unanime = lambda v: v["si"] + v["no"] > 0 and v["abst"] == 0 and (v["no"] == 0 or v["si"] == 0)
    fechas = sorted({v["fecha"][:10] for v in votaciones if unanime(v)})
    mejor = None
    for a, b in zip(fechas, fechas[1:]):
        dias = (date.fromisoformat(b) - date.fromisoformat(a)).days
        if not mejor or dias > mejor["dias"]:
            mejor = {"dias": dias, "desde": a, "hasta": b}
    return mejor


def resumen_unanimidad(votaciones, proyectos):
    """Votaciones unánimes (todos votan lo mismo y nadie se abstiene), la última, y las rachas sin ninguna.

    `sesiones_sin` y `racha_max` cuentan días de sesión con votaciones; el sitio muestra el tiempo en días de
    calendario (`ultima.fecha` hasta hoy y `racha_dias`), que sí incluye semanas distritales y recesos."""
    unanime = lambda v: v["si"] + v["no"] > 0 and v["abst"] == 0 and (v["no"] == 0 or v["si"] == 0)
    dias = sorted({v["fecha"][:10] for v in votaciones})
    con_unanime = {v["fecha"][:10] for v in votaciones if unanime(v)}
    if not con_unanime:
        return {"total": len(votaciones), "unanimes": 0, "ultima": None, "sesiones_sin": len(dias), "racha_max": None}
    ultima = next(v for v in votaciones if unanime(v))  # ya están ordenadas de la más reciente a la más antigua
    racha, actual = {"sesiones": 0}, []
    for d in dias:
        if d in con_unanime:
            actual = []
            continue
        actual.append(d)
        if len(actual) > racha["sesiones"]:
            racha = {"sesiones": len(actual), "desde": actual[0], "hasta": actual[-1]}
    titulo = (ultima["boletin"] and proyectos.get(ultima["boletin"], {}).get("titulo")) or ultima["materia"] or ultima["asunto"]
    return {
        "total": len(votaciones), "unanimes": sum(1 for v in votaciones if unanime(v)),
        "ultima": {"id": ultima["id"], "fecha": ultima["fecha"], "titulo": titulo, "si": ultima["si"], "no": ultima["no"],
                   "resultado": ultima["resultado"]},
        "sesiones_sin": len(actual),  # días de sesión con votaciones desde la última unánime
        "racha_max": racha if racha["sesiones"] else None,
        "racha_dias": racha_calendario(votaciones),
    }


def main():
    diputados = cargar_diputados()
    reg = defaultdict(nuevo_registro)

    # --- Asistencia a sala ---
    sesiones = []  # (inicio, fin, {diputado: estado}) para cruzar con votaciones
    for archivo in (RAW / "asistencia").glob("*.xml"):
        s = ET.parse(archivo).getroot()
        if s.find(".//c:Asistencia", NS) is None:
            continue  # sesión reciente cuya asistencia la Cámara aún no publica
        inicio = txt(s, "c:FechaInicio")
        estados, excusados = {}, set()
        for a in s.iterfind(".//c:Asistencia", NS):
            d = a.find("c:Diputado", NS)
            did = txt(d, "c:Id")
            diputados.setdefault(did, {"id": int(did), "nombre": nombre_completo(d), "partido": "", "partido_nombre": "", "sexo": ""})
            r = reg[did]
            r["sesiones"] += 1
            entrada = {"fecha": inicio[:10], "sesion": int(txt(s, "c:Id")), "estado": "asiste", "motivo": None}
            r["historial"].append(entrada)
            j = a.find("c:Justificacion", NS)
            if a.find("c:TipoAsistencia", NS).get("Valor") == "1":
                r["asiste"] += 1
            elif j is None:
                entrada["estado"] = "sin_justificar"
            else:
                entrada["motivo"] = txt(j, "c:Nombre")
                r["motivos"][entrada["motivo"]] += 1
                codigo = j.get("Valor")
                entrada["estado"] = "licencia" if codigo in LICENCIA else "trabajo" if codigo in TRABAJO else "justificada"
                if codigo in EXCUSADAS:
                    r["falta_excusada"] += 1
                    excusados.add(did)
            if entrada["estado"] != "asiste":
                r["inasistencias"] += 1
                r[f"falta_{entrada['estado']}"] += 1
            estados[did] = entrada["estado"]
        sesiones.append((inicio, txt(s, "c:FechaTermino"), estados, int(txt(s, "c:Id")), excusados))
    sesiones.sort()

    def sesion_de(fecha):
        """La sesión del mismo día que empezó más recientemente antes de la votación."""
        candidatas = [s for s in sesiones if s[0][:10] == fecha[:10] and s[0] <= fecha]
        return candidatas[-1] if candidatas else None

    # --- Votaciones ---
    sin_sesion = 0
    for archivo in (RAW / "votos").glob("*.xml"):
        v = ET.parse(archivo).getroot()
        sesion = sesion_de(txt(v, "c:Fecha"))
        sin_sesion += sesion is None
        for voto in v.iterfind(".//c:Voto", NS):
            did = txt(voto, "c:Diputado/c:Id")
            opcion = voto.find("c:OpcionVoto", NS).get("Valor")
            r = reg[did]
            r["votaciones"] += 1
            if opcion in VOTO_EMITIDO:
                r["vota"] += 1
            elif opcion == VOTO_DISPENSADO:
                r["dispensado"] += 1
            else:
                r["no_vota"] += 1
                estado = sesion[2].get(did) if sesion else None
                if estado == "asiste":
                    r["no_vota_presente"] += 1
                elif estado in ("licencia", "trabajo"):
                    r[f"no_vota_{estado}"] += 1
                if sesion and did in sesion[4]:
                    r["no_vota_excusado"] += 1

    def pct(a, b, minimo=1):
        return round(100 * a / b, 1) if b >= minimo else None

    filas = []
    for did, r in reg.items():
        if did not in diputados or not r["sesiones"]:
            continue
        r["historial"].sort(key=lambda h: (h["fecha"], h["sesion"]))
        filas.append({
            **diputados[did],
            **{k: v for k, v in r.items() if k not in ("motivos", "historial")},
            "pct_asistencia": pct(r["asiste"], r["sesiones"]),
            "pct_votaciones": pct(r["vota"], r["votaciones"] - r["dispensado"]),
            # Secundarios: sin contar inasistencias justificadas por ley (licencias, trabajo parlamentario, Art. 42);
            # en blanco si queda muy poca base
            "pct_asistencia_ajustada": pct(r["asiste"], r["sesiones"] - r["falta_excusada"], MIN_SESIONES),
            "pct_votaciones_ajustado": pct(r["vota"], r["votaciones"] - r["dispensado"] - r["no_vota_excusado"], MIN_VOTACIONES),
            "motivos": dict(sorted(r["motivos"].items(), key=lambda kv: -kv[1])),
            "periodos": periodos(r["historial"]),
            "historial": r["historial"],
        })
    filas.sort(key=lambda f: (f["pct_asistencia"] or 0, f["pct_votaciones"] or 0))

    promedio = lambda k: round(sum(f[k] for f in filas if f[k] is not None) / len(filas), 1)
    resumen = {
        "actualizado": datetime.now().isoformat(timespec="minutes"),
        "periodo": txt(ET.parse(RAW / "periodo.xml").getroot(), "c:Nombre"),
        "sesiones": len(sesiones),
        "votaciones": len(list((RAW / "votos").glob("*.xml"))),
        "promedio_asistencia": promedio("pct_asistencia"),
        "promedio_votaciones": promedio("pct_votaciones"),
        "promedio_asistencia_ajustada": promedio("pct_asistencia_ajustada"),
        "promedio_votaciones_ajustado": promedio("pct_votaciones_ajustado"),
        "fuente": "https://opendata.camara.cl",
    }
    (SALIDA / "diputados.json").write_text(json.dumps({"resumen": resumen, "diputados": filas}, ensure_ascii=False, indent=1),
                                           encoding="utf-8")
    columnas = [k for k in filas[0] if k not in ("motivos", "periodos", "historial")]
    with open(SALIDA / "diputados.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, columnas, extrasaction="ignore", delimiter=";")
        w.writeheader()
        w.writerows(filas)

    resumen["unanimidad"] = exportar_votaciones(filas)
    exportar_web(resumen, filas, sesiones)
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    print(f"Diputados con datos: {len(filas)} | votaciones sin sesión asociada: {sin_sesion}")


if __name__ == "__main__":
    main()
