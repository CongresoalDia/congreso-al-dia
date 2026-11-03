"""Busca en Wikimedia Commons el nombre exacto de un archivo de imagen (por ejemplo, un logo).

Uso:
  python pipeline/buscar_logo.py "texto"               busca archivos por texto
  python pipeline/buscar_logo.py --categoria "Logos of political parties in Chile" [filtro]
Luego se pone el nombre en LOGOS_FIJOS de medios.py.
"""
import json
import sys
import urllib.parse
import urllib.request


def api(**p):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**p, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "congreso-abierto/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


args = sys.argv[1:]
if args and args[0] == "--categoria":
    filtro = (args[2] if len(args) > 2 else "").lower()
    cont = {}
    while True:
        r = api(action="query", list="categorymembers", cmtitle="Category:" + args[1], cmtype="file", cmlimit=500, **cont)
        for m in r["query"]["categorymembers"]:
            nombre = m["title"].removeprefix("File:")
            if filtro in nombre.lower():
                print(nombre)
        if "continue" not in r:
            break
        cont = r["continue"]
else:
    texto = " ".join(args) or "Regionalista Verde Social"
    for r in api(action="query", list="search", srsearch=texto, srnamespace=6, srlimit=20)["query"]["search"]:
        print(r["title"].removeprefix("File:"))
