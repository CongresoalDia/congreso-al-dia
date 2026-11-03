<p align="center"><img src="marca/logo.svg" width="96" alt=""></p>

# Congreso al día

Asistencia, votaciones y costo del Congreso de Chile, sesión a sesión y con datos oficiales: cada diputada,
diputado, senadora y senador, y cuánto cuesta el funcionamiento del Congreso.

Es un sitio ciudadano e independiente, sin afiliación al Congreso ni a partidos políticos. El código y los
cálculos están aquí para que cualquiera pueda revisarlos.

## De dónde vienen los datos

| Qué | Fuente |
|---|---|
| Cámara: sesiones, asistencia, votaciones y proyectos | [Datos abiertos de la Cámara](https://opendata.camara.cl) |
| Senado: sesiones, asistencia, votaciones y fichas | [API pública del Senado](https://www.senado.cl) y su servicio de tramitación |
| Presupuesto y gasto del Congreso | [Datos abiertos de la DIPRES](https://datos.gob.cl/organization/direccion_de_presupuestos) (Partida 02) |
| Fotos de diputadas y diputados | [Biblioteca del Congreso Nacional](https://datos.bcn.cl) |
| Logos y colores de partidos | [Wikidata](https://www.wikidata.org) y Wikimedia Commons |
| Población (monto por habitante) | Censo 2024, INE |

## Cómo se calcula

**Asistencia.** Solo sesiones de sala. **Toda inasistencia cuenta**, sea cual sea el motivo; el motivo oficial
de cada falta se muestra para dar contexto:

| Estado | Motivos |
|---|---|
| Licencia | Licencia médica, permiso prenatal, postnatal y parental |
| Trabajo parlamentario | Misiones oficiales, labor parlamentaria, actividad con el Presidente, gestión encomendada por la Cámara |
| Otra justificación | Impedimento grave, permisos particulares, permisos de Comités Parlamentarios y otros |
| Sin justificar | Falta sin justificación registrada |

Junto a cada porcentaje hay una cifra secundaria ("sin justif.") que **no cuenta las inasistencias justificadas
por ley**: licencias, trabajo parlamentario y todas las del Art. 42 del Reglamento de la Cámara (licencia médica,
impedimento grave, permiso particular, labor parlamentaria y gestión encomendada). Los permisos de Comités
Parlamentarios sí cuentan: los Comités son las bancadas de cada partido (no las comisiones) y esos permisos los
otorgan los propios jefes de bancada, sin un motivo público. En el Senado se descuenta toda inasistencia
justificada. La cifra secundaria no se muestra si queda una base menor a 10 sesiones o 50 votaciones.

**Votaciones.** Porcentaje de votaciones de sala en que votó (a favor, en contra o abstención), sin contar las
dispensas ni los pareos. "No votó estando presente" son votaciones de sesiones a las que asistió; puede incluir
inhabilitaciones por conflicto de interés, que la fuente no distingue. Las votaciones de un día cuya lista de
asistencia aún no se publica se muestran, pero no cuentan por persona hasta que aparece la lista.

**Unanimidad.** Una votación es unánime si todos votaron lo mismo (a favor o en contra) y nadie se abstuvo. El
contador mide días de calendario desde la última votación unánime.

**Costo del Congreso.** Gastos (no ingresos) de la Partida 02 "Congreso Nacional" de la Ley de Presupuestos:
ley vigente y ejecución mes a mes por capítulo (Senado, Cámara, Biblioteca del Congreso y Consejo Resolutivo de
Asignaciones Parlamentarias). El monto por parlamentario divide el presupuesto de cada cámara por sus integrantes
e incluye funcionarios, asesores, edificios y funcionamiento, no solo la dieta. La dieta es igual para todos
(art. 62 de la Constitución) y las asignaciones parlamentarias no son sueldo, por eso no hay ranking de "sueldos".

Los casos raros de las fuentes (votaciones con detalle inconsistente, fechas corridas en la API del Senado,
sesiones sin lista de asistencia) están documentados en el código de `pipeline/`.

## Cómo correrlo

Requiere Python 3.11+ (y [Pillow](https://pypi.org/project/pillow/) para las fotos).

```
python pipeline/descargar.py     # Cámara: baja sesiones, asistencia y votaciones a data/raw/
python pipeline/calcular.py      # Cámara: calcula y genera web/datos.json y web/votaciones.json
python pipeline/medios.py        # fotos (BCN) y logos/colores de partidos (Wikidata)
python pipeline/senado.py        # Senado: asistencia, votaciones y fotos -> web/senado/
python pipeline/presupuesto.py   # costo del Congreso (DIPRES) -> web/presupuesto.json
python -m http.server 8931 --directory web   # ver el sitio en http://localhost:8931
```

La primera descarga tarda unos minutos; las siguientes solo bajan lo nuevo (y lo de la última semana, por si
hubo correcciones). Los datos crudos (`data/raw/`) no se versionan; los JSON que usa el sitio sí.

El sitio (`web/`) es HTML, CSS y JavaScript sin dependencias ni compilación: se publica tal cual en cualquier
hosting estático.

## Errores y sugerencias

Si encuentras una cifra que no cuadra con la fuente oficial, abre un
[issue](https://github.com/CongresoalDia/congreso-al-dia/issues) con el enlace a la fuente.

## Licencia

El código está bajo licencia [MIT](LICENSE). Los datos pertenecen a sus fuentes oficiales (Cámara de Diputadas y
Diputados, Senado, DIPRES, BCN, INE); las fotos y los logos de partidos tienen sus propios créditos y licencias,
detallados en el sitio.
