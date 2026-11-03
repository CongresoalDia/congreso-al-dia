"""Fotos de diputados (BCN) y logos de partidos (Wikidata / Wikimedia Commons).

Fotos: datos abiertos de la Biblioteca del Congreso Nacional (datos.bcn.cl), que enlaza cada
persona con su id de la Cámara. Se bajan a web/fotos/{id}.jpg en 192 px.
Logos: se busca cada partido por nombre en Wikidata (logo P154) y se baja a web/partidos/.
Todo queda registrado con su fuente en web/medios.json. Lo ya bajado no se vuelve a pedir.

Uso: python pipeline/medios.py   (después de calcular.py; requiere Pillow)
"""
import http.client
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"
CACHE = RAIZ / "data" / "wikidata_partidos.json"
UA = {"User-Agent": "CongresoAlDia/0.1 (proyecto ciudadano de datos abiertos)"}
BCN_SPARQL = "https://datos.bcn.cl/sparql?"
WIKIDATA = "https://www.wikidata.org/w/api.php?"
COMMONS = "https://commons.wikimedia.org/w/api.php?"
CREDITO_BCN = {"autor": "Biblioteca del Congreso Nacional de Chile", "licencia": "datos.bcn.cl",
               "fuente": "https://www.bcn.cl/historiapolitica/resenas_parlamentarias"}
LADO_FOTO, ANCHO_LOGO = 192, 96
CHILE, PARTIDO = "Q298", "Q7278"
# Ficha de Wikidata correcta cuando la búsqueda por nombre falla o elige otra
PARTIDOS_FIJOS = {
    "FA": "Q28469675",  # la ficha del partido (2024) no tiene logo; la de la coalición Frente Amplio sí
    "PL": "Q3885147",   # Partido Liberal de 2013 (la búsqueda elegía el disuelto en 1966)
}
# Logos que están en Commons pero no enlazados desde Wikidata
LOGOS_FIJOS = {
    "DEM": "Logo Demócratas Chile.png",
    "PAH": "Logo de Acción Humanista Chile.png",
}


# Sin ficha o sin color en Wikidata: color fijo (aproximado, el de su identidad visual) y, para
# independientes, un emblema propio dibujado (web/partidos/IND.svg) con gris azulado neutro
COLORES_FIJOS = {"FRVS": "#2E8B57", "PCCH": "#7B4FA3"}
# Logos entregados a mano (no están en Commons): ya guardados en web/partidos/{alias}.png
LOGOS_LOCALES = {"FRVS": {"color": "#78A818", "autor": "Federación Regionalista Verde Social", "licencia": "logo oficial del partido",
                          "fuente": "https://federacionregionalistaverdesocial.cl"}}
LOGOS_LOCALES["PCCH"] = {"color": "#004878", "autor": "Partido Cristiano de Chile", "licencia": "logo oficial del partido", "fuente": ""}
INDEPENDIENTES = {"logo": "partidos/IND.svg", "color": "#5B6B7F", "autor": "Congreso al día",
                  "licencia": "Dibujo propio (sin partido)", "fuente": ""}


def pedir(url, pausa=1.0, intentos=6):
    """GET con pausa entre consultas; reintenta si el servidor pide bajar el ritmo (429) o se corta la conexión."""
    req = urllib.request.Request(url, headers=UA)
    for i in range(intentos):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                datos = r.read()
            time.sleep(pausa)
            return datos
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == intentos - 1:
                raise
            time.sleep(int(e.headers.get("Retry-After") or 10) + 5 * i)
        except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError, ConnectionError):
            if i == intentos - 1:
                raise
            time.sleep(3 + 3 * i)
    raise AssertionError


def api(base, **params):
    return json.loads(pedir(base + urllib.parse.urlencode({**params, "format": "json", "maxlag": 5})))


# ---------- fotos (BCN) ----------
def fotos_bcn():
    """{id Cámara: url de la foto} desde el SPARQL de datos.bcn.cl."""
    consulta = """PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX bio: <http://datos.bcn.cl/ontologies/bcn-biographies#>
SELECT ?id ?img ?pagina WHERE { ?p bio:idCamaraDeDiputados ?id ; foaf:img ?img . OPTIONAL { ?p bio:bcnPage ?pagina } }"""
    url = BCN_SPARQL + urllib.parse.urlencode({"query": consulta, "format": "application/sparql-results+json"})
    filas = json.loads(pedir(url))["results"]["bindings"]
    return {f["id"]["value"]: (f["img"]["value"], f.get("pagina", {}).get("value")) for f in filas}


def guardar_foto(url, destino):
    im = Image.open(io.BytesIO(pedir(url, pausa=0.3))).convert("RGB")
    lado = min(im.size)  # recorte cuadrado centrado arriba (rostro)
    x = (im.width - lado) // 2
    im = im.crop((x, 0, x + lado, lado)).resize((LADO_FOTO, LADO_FOTO), Image.LANCZOS)
    destino.parent.mkdir(parents=True, exist_ok=True)
    im.save(destino, "JPEG", quality=82, optimize=True)


# ---------- logos (Wikidata) ----------
def ids(entidad, prop):
    return {c["mainsnak"].get("datavalue", {}).get("value", {}).get("id")
            for c in entidad.get("claims", {}).get(prop, [])} - {None}


def datos_partido(e):
    valor = lambda prop: next((c["mainsnak"].get("datavalue", {}).get("value")
                               for c in e.get("claims", {}).get(prop, []) if c["mainsnak"].get("datavalue")), None)
    return valor("P154"), valor("P465")  # logo, color (hex sin #)


def buscar_partido(nombre, qid_fijo=None):
    if qid_fijo:
        e = api(WIKIDATA, action="wbgetentities", ids=qid_fijo, props="claims")["entities"][qid_fijo]
        return (qid_fijo, *datos_partido(e))
    for q in (nombre, f"{nombre} Chile"):
        res = api(WIKIDATA, action="wbsearchentities", search=q, language="es", type="item", limit=7).get("search", [])
        if not res:
            continue
        ents = api(WIKIDATA, action="wbgetentities", ids="|".join(r["id"] for r in res), props="claims")["entities"]
        for r in res:
            e = ents[r["id"]]
            if CHILE in ids(e, "P17") and PARTIDO in ids(e, "P31"):
                return (r["id"], *datos_partido(e))
    return None, None, None


def color_de_logo(archivo):
    """Color principal del logo (el más frecuente entre los píxeles con color), como hex sin #."""
    im = Image.open(archivo).convert("RGBA").resize((64, 64))
    cuenta = {}
    for r, g, b, a in im.getdata():
        if a < 128 or max(r, g, b) - min(r, g, b) < 40:  # transparente o gris/blanco/negro
            continue
        clave = (r // 24 * 24, g // 24 * 24, b // 24 * 24)
        cuenta[clave] = cuenta.get(clave, 0) + 1
    if not cuenta:
        return None
    r, g, b = max(cuenta, key=cuenta.get)
    return f"{r:02X}{g:02X}{b:02X}"


def guardar_logo(nombre_archivo, destino):
    paginas = api(COMMONS, action="query", titles="File:" + nombre_archivo, prop="imageinfo",
                  iiprop="url|extmetadata", iiurlwidth=ANCHO_LOGO)["query"]["pages"]
    info = next(iter(paginas.values()))["imageinfo"][0]
    meta = info.get("extmetadata", {})
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(pedir(info["thumburl"]))
    autor = re.sub(r"<[^>]+>", "", unescape(meta.get("Artist", {}).get("value", ""))).strip()
    return {"autor": autor[:120], "licencia": meta.get("LicenseShortName", {}).get("value", ""), "fuente": info["descriptionurl"]}


def main():
    datos = json.loads((WEB / "datos.json").read_text(encoding="utf-8"))
    medios = {"diputados": {}, "partidos": {}}

    bcn = fotos_bcn()
    nuevas = 0
    for d in datos["diputados"]:
        clave = str(d["id"])
        if clave not in bcn:
            print("  sin foto en BCN:", d["nombre"])
            continue
        url, pagina = bcn[clave]
        destino = WEB / "fotos" / f"{clave}.jpg"
        if not destino.exists():
            try:
                guardar_foto(url, destino)
                nuevas += 1
            except Exception as e:  # noqa: BLE001 - una foto fallida no debe detener el resto
                print("  no se pudo bajar la foto de", d["nombre"], e)
                continue
        medios["diputados"][clave] = {"foto": f"fotos/{clave}.jpg", **CREDITO_BCN, "fuente": pagina or CREDITO_BCN["fuente"]}
    print(f"Fotos: {len(medios['diputados'])}/{len(datos['diputados'])} ({nuevas} nuevas)")

    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    for alias, nombre in sorted({(d["partido"], d["partido_nombre"]) for d in datos["diputados"] if d["partido"]}):
        if alias == "IND":
            medios["partidos"]["IND"] = dict(INDEPENDIENTES)
            continue
        if alias not in cache or cache[alias].get("wikidata") != PARTIDOS_FIJOS.get(alias, cache[alias].get("wikidata")):
            qid, logo, color = buscar_partido(nombre, PARTIDOS_FIJOS.get(alias))
            cache[alias] = {"nombre": nombre, "wikidata": qid, "logo": logo, "color": color}
            (WEB / "partidos" / f"{alias}.png").unlink(missing_ok=True)
            print(f"  {alias}: {qid or 'no encontrado'} logo={'sí' if logo else 'no'} color={color}")
        c = cache[alias]
        if alias in LOGOS_LOCALES and (WEB / "partidos" / f"{alias}.png").exists():
            medios["partidos"][alias] = {"logo": f"partidos/{alias}.png", **LOGOS_LOCALES[alias]}
            continue
        if alias in LOGOS_FIJOS and c.get("logo") != LOGOS_FIJOS[alias]:
            c["logo"] = LOGOS_FIJOS[alias]
            c.pop("creditos", None)
            c.pop("color_del_logo", None)
            (WEB / "partidos" / f"{alias}.png").unlink(missing_ok=True)
        if c.get("logo"):
            destino = WEB / "partidos" / f"{alias}.png"
            if "creditos" not in c or not destino.exists():
                try:
                    c["creditos"] = guardar_logo(c["logo"], destino)
                except Exception as e:  # noqa: BLE001
                    print("  no se pudo bajar el logo de", alias, e)
                    continue
            medios["partidos"].setdefault(alias, {}).update({"logo": f"partidos/{alias}.png", **c["creditos"]})
            if not c.get("color"):
                c["color_del_logo"] = color_de_logo(destino)
        color = c.get("color") or c.get("color_del_logo") or COLORES_FIJOS.get(alias)
        if color:
            medios["partidos"].setdefault(alias, {})["color"] = "#" + color.lstrip("#")
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Logos: {len(medios['partidos'])}/{len(cache)}")

    # Orden fijo (la BCN entrega los resultados en distinto orden cada vez) para que el archivo solo cambie si cambian los datos
    medios["diputados"] = dict(sorted(medios["diputados"].items(), key=lambda kv: int(kv[0])))
    medios["partidos"] = dict(sorted(medios["partidos"].items()))
    (WEB / "medios.json").write_text(json.dumps(medios, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
