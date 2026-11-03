# Congreso Abierto

Asistencia y participación en votaciones de cada diputado, con datos oficiales de la
Cámara de Diputadas y Diputados ([opendata.camara.cl](https://opendata.camara.cl)).

## Uso

```
python pipeline/descargar.py   # baja sesiones y votaciones del período actual a data/raw/
python pipeline/calcular.py    # genera data/diputados.json, data/diputados.csv, web/datos.json y web/votaciones.json
python pipeline/medios.py      # fotos oficiales (BCN) y logos/colores de partidos (Wikidata); requiere Pillow
python pipeline/senado.py      # Senado: asistencia, votaciones y fotos (API pública del Senado) -> web/senado/
python -m http.server 8931 --directory web   # ver la página en http://127.0.0.1:8931
```

La página (`web/`) es HTML/CSS/JS sin dependencias ni compilación: se puede publicar tal cual
en cualquier hosting estático (GitHub Pages, Cloudflare Pages).

Solo usa la librería estándar de Python 3.11+. La primera descarga tarda unos minutos;
las siguientes solo bajan lo nuevo (y lo de la última semana, por si hubo correcciones).

## Metodología

**Toda inasistencia cuenta**, sea cual sea el motivo. El motivo oficial de cada falta se
guarda para dar contexto, y se clasifica en:

| Estado | Motivos |
|---|---|
| `licencia` | Licencia médica, permiso prenatal, postnatal y parental |
| `trabajo` | Misiones oficiales, actividad propia de la labor parlamentaria, actividad con el Presidente, gestión encomendada por la Cámara |
| `justificada` | Cualquier otra justificación (impedimento grave, permisos personales, permisos de Comités…) |
| `sin_justificar` | Falta sin justificación registrada |

- `pct_asistencia` = asistencias / sesiones — **dato principal**
- `pct_votaciones` = votos emitidos (a favor, en contra, abstención) / (votaciones − dispensas) — **dato principal**
- `pct_asistencia_ajustada`, `pct_votaciones_ajustado` = lo mismo, pero sin contar las inasistencias
  justificadas por ley: licencias, trabajo parlamentario y **todas las del Art. 42 del Reglamento**
  (licencia médica, impedimento grave, permiso particular, labor parlamentaria, gestión encomendada),
  que por reglamento no afectan la asistencia. Los permisos de Comités Parlamentarios sí cuentan.
  Dato secundario; queda en blanco si la base es menor a 10 sesiones o 50 votaciones.
- En la portada, "Los que menos asisten" muestra el **% de inasistencia** (100 − asistencia).
- Votación **unánime**: todos votaron lo mismo (a favor o en contra) y nadie se abstuvo. El contador y las rachas
  se miden en días de sesión con votaciones (no días de calendario), para que recesos y semanas distritales no sumen.
- `historial` = estado de cada sesión, para dibujar la línea de tiempo con licencias y trabajo parlamentario marcados
- `periodos` = sesiones consecutivas con licencia o trabajo parlamentario agrupadas (estado, desde, hasta, motivo)
- `no_vota_licencia`, `no_vota_trabajo` = votaciones en que no votó por estar con licencia / en trabajo parlamentario
- `no_vota_presente` = votaciones en que no votó, en una sesión a la que sí registró asistencia.
  Puede incluir inhabilitaciones por conflicto de interés, que la fuente no distingue.

**Votaciones** (`web/votaciones.json`): cada votación de sala con el título de su proyecto
(`retornarProyectoLey`), qué se votó exactamente (artículo), trámite, tipo (general/particular/única),
quórum, resultado y el voto de cada diputado. Los proyectos de resolución y "otros asuntos" no tienen
título en los datos abiertos; se enlazan a su página en camara.cl.

**Senado** (`pipeline/senado.py`): mismos cálculos con la API pública del Senado (`web-back.senado.cl/api`:
sesiones, asistencia por sesión, votaciones con el voto de cada senador, fichas con foto) y su servicio de
tramitación (títulos de proyectos). La cifra ajustada descuenta toda inasistencia justificada; el pareo no
se exige (como la dispensa); las sesiones programadas a futuro no se cuentan. La web lo muestra en `#/senado/...`.

Solo cubre la sala (no comisiones).
