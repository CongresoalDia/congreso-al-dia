"""Busca en Wikimedia Commons archivos de imagen por texto, para encontrar el nombre exacto de un logo.

Uso: python pipeline/buscar_logo.py "Regionalista Verde Social"
Luego se pone el nombre en LOGOS_FIJOS de medios.py.
"""
import json
import sys
import urllib.parse
import urllib.request

texto = " ".join(sys.argv[1:]) or "Regionalista Verde Social"
url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
    {"action": "query", "list": "search", "srsearch": texto, "srnamespace": 6, "srlimit": 20, "format": "json"})
req = urllib.request.Request(url, headers={"User-Agent": "congreso-abierto/1.0"})
for r in json.loads(urllib.request.urlopen(req, timeout=60).read())["query"]["search"]:
    print(r["title"].removeprefix("File:"))
