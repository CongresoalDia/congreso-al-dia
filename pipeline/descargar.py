"""Descarga los datos de asistencia y votaciones de la Cámara de Diputadas y Diputados.

Fuente: servicio oficial de datos abiertos (opendata.camara.cl).
Las sesiones y votaciones ya descargadas se guardan en data/raw/ y no se vuelven
a pedir; los listados (diputados, sesiones, votaciones del año) sí se refrescan.

Uso: python pipeline/descargar.py
"""
import concurrent.futures as cf
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

BASE = "https://opendata.camara.cl/camaradiputados/WServices"
NS = {"c": "http://opendata.camara.cl/camaradiputados/v1"}
RAIZ = Path(__file__).resolve().parent.parent
RAW = RAIZ / "data" / "raw"
HILOS = 4  # no saturar el servidor de la Cámara


def pedir(ruta: str, intentos: int = 4) -> bytes:
    url = f"{BASE}/{ruta}"
    for i in range(intentos):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - reintentar ante cualquier fallo de red
            if i == intentos - 1:
                raise RuntimeError(f"Falló {url}: {e}") from e
            time.sleep(2 ** i)
    raise AssertionError


def guardar(nombre: str, contenido: bytes) -> Path:
    destino = RAW / nombre
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(contenido)
    return destino


def descargar_si_falta(nombre: str, ruta: str) -> None:
    if not (RAW / nombre).exists():
        guardar(nombre, pedir(ruta))


def en_paralelo(tareas: list[tuple[str, str]], etiqueta: str) -> None:
    pendientes = [t for t in tareas if not (RAW / t[0]).exists()]
    print(f"{etiqueta}: {len(tareas)} en total, {len(pendientes)} por descargar")
    with cf.ThreadPoolExecutor(HILOS) as ex:
        futuros = [ex.submit(descargar_si_falta, n, r) for n, r in pendientes]
        for i, f in enumerate(cf.as_completed(futuros), 1):
            f.result()
            if i % 50 == 0 or i == len(futuros):
                print(f"  {i}/{len(futuros)}")


def olvidar_si_reciente(nombre: str, fecha: str) -> None:
    """Lo de la última semana se vuelve a bajar: la Cámara puede corregir asistencia o justificaciones."""
    if (date.today() - date.fromisoformat(fecha[:10])).days <= 7:
        (RAW / nombre).unlink(missing_ok=True)


def main() -> None:
    periodo = ET.parse(guardar("periodo.xml", pedir("WSLegislativo.asmx/retornarPeriodoLegislativoActual"))).getroot()
    inicio = periodo.findtext("c:FechaInicio", namespaces=NS)[:10]
    legislaturas = [l.findtext("c:Id", namespaces=NS) for l in periodo.iterfind(".//c:Legislatura", NS)]
    print(f"Período {periodo.findtext('c:Nombre', namespaces=NS)} (desde {inicio}), legislaturas {legislaturas}")

    guardar("diputados.xml", pedir("WSDiputado.asmx/retornarDiputadosPeriodoActual"))
    guardar("tipos_justificacion.xml", pedir("WSComun.asmx/retornarTiposJustificacionesInasistencia"))

    # Sesiones de sala celebradas en el período
    sesiones = []
    for leg in legislaturas:
        xml = guardar(f"sesiones_leg{leg}.xml", pedir(f"WSSala.asmx/retornarSesionesXLegislatura?prmLegislaturaId={leg}"))
        for s in ET.parse(xml).getroot().iterfind("c:Sesion", NS):
            if s.find("c:Estado", NS).get("Valor") == "1":
                sid = s.findtext("c:Id", namespaces=NS)
                olvidar_si_reciente(f"asistencia/{sid}.xml", s.findtext("c:FechaInicio", namespaces=NS))
                guardada = RAW / f"asistencia/{sid}.xml"
                if guardada.exists() and ET.parse(guardada).getroot().find(".//c:Asistencia", NS) is None:
                    guardada.unlink()  # se guardó antes de que la Cámara publicara la lista: se vuelve a pedir
                sesiones.append(sid)
    en_paralelo([(f"asistencia/{s}.xml", f"WSSala.asmx/retornarSesionAsistencia?prmSesionId={s}") for s in sesiones],
                "Asistencia a sesiones")

    # Votaciones del período (puede abarcar varios años)
    votaciones = []
    for anno in range(int(inicio[:4]), date.today().year + 1):
        xml = guardar(f"votaciones_{anno}.xml", pedir(f"WSLegislativo.asmx/retornarVotacionesXAnno?prmAnno={anno}"))
        for v in ET.parse(xml).getroot().iterfind("c:Votacion", NS):
            fecha = v.findtext("c:Fecha", namespaces=NS)
            if fecha[:10] >= inicio:
                vid = v.findtext("c:Id", namespaces=NS)
                olvidar_si_reciente(f"votos/{vid}.xml", fecha)
                votaciones.append(vid)
    en_paralelo([(f"votos/{v}.xml", f"WSLegislativo.asmx/retornarVotacionDetalle?prmVotacionId={v}") for v in votaciones],
                "Detalle de votaciones")

    # Proyectos de ley votados: título y qué se votó en cada votación (artículo, trámite)
    boletines = set()
    for v in votaciones:
        raiz = ET.parse(RAW / "votos" / f"{v}.xml").getroot()
        m = re.search(r"Bolet[ií]n N°\s*(\d+-\d+)", raiz.findtext("c:Descripcion", default="", namespaces=NS))
        if m:
            boletines.add(m.group(1))
            olvidar_si_reciente(f"proyectos/{m.group(1)}.xml", raiz.findtext("c:Fecha", namespaces=NS))
    en_paralelo([(f"proyectos/{b}.xml", f"WSLegislativo.asmx/retornarProyectoLey?prmNumeroBoletin={b}") for b in sorted(boletines)],
                "Proyectos de ley")

    # Proyectos de resolución y de acuerdo: su materia es el "título" de esas votaciones
    for anno in range(int(inicio[:4]), date.today().year + 1):
        guardar(f"resoluciones_{anno}.xml", pedir(f"WSProyectosResolucion.asmx/retornarProyectosResolucionXAnno?prmAnno={anno}"))
        guardar(f"acuerdos_{anno}.xml", pedir(f"WSProyectosAcuerdo.asmx/retornarProyectosAcuerdoXAnno?prmAnno={anno}"))
    print("Listo.")


if __name__ == "__main__":
    main()
