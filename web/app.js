"use strict";

// Estados del historial (una letra por sesión, ver pipeline/calcular.py)
const ESTADOS = {
  a: { nombre: "Asistió", color: "var(--c-asiste)" },
  l: { nombre: "Licencia", color: "var(--c-licencia)" },
  t: { nombre: "Trabajo parlamentario", color: "var(--c-trabajo)" },
  j: { nombre: "Otra justificación", color: "var(--c-justificada)" },
  x: { nombre: "Sin justificar", color: "var(--c-sinjust)" },
  "-": { nombre: "No era parlamentario/a", color: "var(--c-vacio)" },
};
const LEYENDA = ["a", "l", "t", "j", "x"];

const tasaPresenteSinVotar = (d) =>
  d.vota + d.no_vota_presente >= 100 ? (100 * d.no_vota_presente) / (d.vota + d.no_vota_presente) : -1;

const ORDENES = {
  cumplen: { nombre: "Más asistencia y votación", fn: (a, b) => b.pct_asistencia - a.pct_asistencia || b.pct_votaciones - a.pct_votaciones },
  asis_asc: { nombre: "Menor asistencia", fn: (a, b) => a.pct_asistencia - b.pct_asistencia },
  asis_aj_asc: { nombre: "Menor asistencia (sin justificadas por ley)",
    fn: (a, b) => (a.pct_asistencia_ajustada ?? 999) - (b.pct_asistencia_ajustada ?? 999) },
  presente_tasa: { nombre: "Más % presente sin votar", fn: (a, b) => tasaPresenteSinVotar(b) - tasaPresenteSinVotar(a) },
  asis_desc: { nombre: "Mayor asistencia", fn: (a, b) => b.pct_asistencia - a.pct_asistencia },
  vota_asc: { nombre: "Menos votaciones", fn: (a, b) => a.pct_votaciones - b.pct_votaciones },
  vota_desc: { nombre: "Más votaciones", fn: (a, b) => b.pct_votaciones - a.pct_votaciones },
  sinjust: { nombre: "Más faltas sin justificar", fn: (a, b) => b.falta_sin_justificar - a.falta_sin_justificar },
  presente_no_vota: { nombre: "Más veces presente sin votar", fn: (a, b) => b.no_vota_presente - a.no_vota_presente },
  nombre: { nombre: "Nombre (A–Z)", fn: (a, b) => a.nombre.localeCompare(b.nombre, "es") },
};

const estado = { busqueda: "", partido: "", orden: "asis_asc" };
let DATOS = null;
let MEDIOS = { diputados: {}, partidos: {} };  // fotos y logos (medios.json de cada cámara)

// Cámara de Diputadas y Diputados o Senado: mismos datos y vistas, distintos textos, archivos y enlaces
const CAMARAS = {
  diputados: {
    clave: "diputados", prefijo: "#", base: "", corto: "Cámara de Diputados", la: "la Cámara", de: "de la Cámara", titulo: "La Cámara",
    plural: "diputadas y diputados", pluralCorto: "diputados", singular: "diputada o diputado", persona: "diputado/a",
    columna: "Diputada / diputado", sitio: "camara.cl", fuente: "https://opendata.camara.cl",
    nombreFuente: "Cámara de Diputadas y Diputados",
    ficha: (d) => `https://www.camara.cl/diputados/detalle/biografia.aspx?prmId=${d.id}`,
    votacion: (v) => `https://www.camara.cl/legislacion/sala_sesiones/votacion_detalle.aspx?prmIdVotacion=${v.id}`,
    proyecto: (pr, b) => (pr.id ? `https://www.camara.cl/legislacion/ProyectosDeLey/tramitacion.aspx?prmID=${pr.id}&prmBOLETIN=${b}` : null),
  },
  senado: {
    clave: "senado", prefijo: "#/senado", base: "senado/", corto: "Senado", la: "el Senado", de: "del Senado", titulo: "El Senado",
    plural: "senadoras y senadores", pluralCorto: "senadores", singular: "senadora o senador", persona: "senador/a",
    columna: "Senadora / senador", sitio: "senado.cl", fuente: "https://www.senado.cl", nombreFuente: "Senado de Chile",
    ficha: (d) => `https://www.senado.cl/senadoras-y-senadores/listado-de-senadoras-y-senadores/${d.slug || ""}`,
    votacion: () => null,
    proyecto: (pr, b) => `https://tramitacion.senado.cl/appsenado/templates/tramitacion/index.php?boletin_ini=${b}`,
  },
};
let CAMARA = CAMARAS.diputados;
let P = "#";  // prefijo de las rutas de la cámara actual

// ---------- utilidades ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (n) => (n == null ? "—" : n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%");
const num = (n) => n.toLocaleString("es-CL");
const fecha = (iso, opciones = { day: "numeric", month: "short" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-CL", opciones).replace(".", "");
const rango = (desde, hasta) => (desde === hasta ? fecha(desde) : `${fecha(desde)} – ${fecha(hasta)}`);
const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const iniciales = (nombre) => {
  const p = nombre.split(" ");
  return (p[0][0] + (p.length > 2 ? p[p.length - 2][0] : p[p.length - 1][0])).toUpperCase();
};

function avatar(d) {
  const m = MEDIOS.diputados[d.id];
  return m && m.foto
    ? `<img class="avatar" src="${esc(m.foto)}" alt="" loading="lazy" width="96" height="96">`
    : `<span class="avatar" aria-hidden="true">${esc(iniciales(d.nombre))}</span>`;
}

function logoPartido(alias) {
  const m = MEDIOS.partidos[alias];
  return m && m.logo ? `<img class="logo-partido" src="${esc(m.logo)}" alt="" loading="lazy">` : "";
}

// Color oficial del partido (Wikidata P465); sin color queda neutro
const colorPartido = (alias) => {
  const c = MEDIOS.partidos[alias]?.color;
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
};
const estiloPartido = (alias) => (colorPartido(alias) ? ` style="--pc:${colorPartido(alias)}"` : "");

function chipPartido(d) {
  if (!d.partido) return "";
  const logo = logoPartido(d.partido);
  const color = colorPartido(d.partido) ? "con-color" : "";
  return `<span class="partido ${logo ? "" : "sin-logo"} ${color}"${estiloPartido(d.partido)} title="${esc(d.partido_nombre)}">${logo}${esc(d.partido)}</span>`;
}

// ---------- paisaje: cordillera de los Andes, cerros de Valparaíso, el Congreso y la bandera ----------
// Todo se dibuja con código; los colores vienen de CSS (en .paisaje): de día con el modo claro, de noche con el oscuro.
function azar(semilla) {  // mulberry32: aleatorio reproducible
  return () => {
    semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pt = (q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
const poligono = (pts) => "M" + pts.map(pt).join(" L") + " Z";
const MUESTRAS = 321;

// Perfil de un cordón: macizos con hombros (no agujas) + crestas irregulares, suavizado
function perfil(r, { base, alto, macizos, forma, detalle, suavizado, minX = -60, maxX = 1660 }) {
  const xs = Array.from({ length: MUESTRAS }, (_, i) => minX + (i * (maxX - minX)) / (MUESTRAS - 1));
  const masas = macizos.map(([c, a, w]) => ({ c: c + (r() - .5) * 40, a: alto * a, w }));
  let ruido = [0, 0], amp = 1;
  while (ruido.length < MUESTRAS) {
    const nuevo = [];
    for (let i = 0; i < ruido.length - 1; i++) nuevo.push(ruido[i], (ruido[i] + ruido[i + 1]) / 2 + (r() - .5) * amp);
    nuevo.push(ruido[ruido.length - 1]);
    ruido = nuevo;
    amp *= .56;
  }
  let ys = xs.map((x, i) => {
    let h = 0;
    for (const m of masas) {
      const d = Math.abs(x - m.c) / m.w;
      if (d < 1) h = Math.max(h, m.a * (1 - Math.pow(d, forma)));  // forma>1: hombros redondeados
    }
    h += ruido[Math.floor((i * (ruido.length - 1)) / (MUESTRAS - 1))] * detalle * alto;
    return base - Math.max(0, h);
  });
  for (let k = 0; k < suavizado; k++) ys = ys.map((y, i) => (i === 0 || i === MUESTRAS - 1 ? y : (ys[i - 1] + 2 * y + ys[i + 1]) / 4));
  return xs.map((x, i) => [x, ys[i]]);
}

const relleno = (pts, fondo = 900) => `M${pts[0][0]} ${fondo} L${pts.map(pt).join(" L")} L${pts[pts.length - 1][0]} ${fondo} Z`;

// Sombras: la ladera izquierda de cada cumbre (el sol está a la derecha)
function sombras(pts, base, ventana) {
  const caras = [];
  for (let i = ventana; i < pts.length - ventana; i++) {
    const y = pts[i][1];
    let esCumbre = true;
    for (let k = i - ventana; k <= i + ventana; k++) if (pts[k][1] < y) { esCumbre = false; break; }
    if (!esCumbre) continue;
    let v = i;  // hacia la izquierda hasta el fondo del valle
    while (v > 0 && pts[v - 1][1] >= pts[v][1] - .2) v--;
    if (i - v < 3) continue;
    // arista irregular desde la cumbre hacia el pie, para que la sombra no sea un corte recto
    const pie = [pts[i][0] - (pts[i][0] - pts[v][0]) * .3, base];
    const arista = Array.from({ length: 7 }, (_, k) => {
      const t = (k + 1) / 8, ancho = pts[i][0] - pts[v][0];
      return [pts[i][0] + (pie[0] - pts[i][0]) * t + Math.sin(k * 2.3 + i) * ancho * .06, pts[i][1] + (base - pts[i][1]) * t];
    });
    caras.push(poligono([...pts.slice(v, i + 1), ...arista, pie]));  // cierra en diagonal hacia el valle
    i += ventana;
  }
  return caras;
}

// Nieve: baja más en las cumbres y se mete por las quebradas
function nieve(pts, lineaNieve, r) {
  const f1 = r() * 6, f2 = r() * 6;
  const abajo = pts.map(([x, y]) => {
    if (y >= lineaNieve) return [x, y];
    const quebradas = 1 + .45 * Math.sin(x / 13 + f1) * Math.sin(x / 31 + f2) + .2 * Math.sin(x / 6.5 + f2);
    return [x, Math.min(y + (lineaNieve - y) * .7 * quebradas + 3, 900)];
  });
  return poligono([...pts, ...abajo.reverse()]);
}

function capaMontana(r, clase, opciones, conNieve, idSombra) {
  const pts = perfil(r, opciones);
  const caras = sombras(pts, opciones.base, 9);
  let svg = `<path d="${relleno(pts)}" class="${clase}-luz"/>`;
  svg += caras.map((d) => `<path d="${d}" class="${clase}-sombra"/>`).join("");
  let defs = "";
  if (conNieve) {
    const n = nieve(pts, opciones.base - opciones.alto * conNieve, r);
    defs = `<clipPath id="${idSombra}">${caras.map((d) => `<path d="${d}"/>`).join("")}</clipPath>`;
    svg += `<path d="${n}" class="nieve-luz"/><path d="${n}" class="nieve-sombra" clip-path="url(#${idSombra})"/>`;
  }
  return { svg, defs, pts };
}

// Casas de Valparaíso apiladas en la ladera: fachada, costado en sombra, techo y ventana
function barrio(r, pts, desde, hasta, profundidad, luces) {
  const colores = ["#e07a5f", "#f2cc8f", "#81b29a", "#3d5a80", "#e9c46a", "#f4a261", "#2a9d8f", "#f6f1e7", "#c96f53", "#8ecae6", "#b5838d", "#ffd166"];
  const alturaEn = (x) => {
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((x - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0])) * (pts.length - 1))));
    return pts[i][1];
  };
  const casas = [];
  for (let x = desde; x < hasta; x += 9 + r() * 6) {
    const cima = alturaEn(x);
    for (let fila = 0; fila * 10 < profundidad; fila++) {
      if (r() < .25) continue;
      const w = 10 + r() * 6, h = 8 + r() * 6;
      const y = cima + 6 + fila * (8 + r() * 4) + r() * 3;
      if (y > 808) break;
      casas.push({ x: x + (r() - .5) * 4, y, w, h, c: colores[Math.floor(r() * colores.length)], arbol: r() < .1 });
    }
  }
  casas.sort((a, b) => a.y - b.y);
  for (const { x, y, w, h, arbol } of casas) {  // ventanas encendidas de noche
    if (!arbol && r() < .5) luces.push(`<rect x="${(x + 2.5).toFixed(1)}" y="${(y - h + 3).toFixed(1)}" width="3" height="3"/>`);
  }
  return casas.map(({ x, y, w, h, c, arbol }) => arbol
    ? `<circle cx="${x.toFixed(1)}" cy="${(y - 4).toFixed(1)}" r="${(4 + w / 5).toFixed(1)}" class="arbol"/>`
    : `<g><rect x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}"/>`
      + `<rect x="${(x + w - 3).toFixed(1)}" y="${(y - h).toFixed(1)}" width="3" height="${h.toFixed(1)}" fill="#000" opacity=".16"/>`
      + `<rect x="${(x - .5).toFixed(1)}" y="${(y - h - 2).toFixed(1)}" width="${(w + 1).toFixed(1)}" height="2.4" class="techo"/>`
      + `<rect x="${(x + 2.5).toFixed(1)}" y="${(y - h + 3).toFixed(1)}" width="3" height="3" class="ventana"/></g>`).join("");
}

// Puerto de Valparaíso: muelle con grúas y contenedores, un carguero y lanchas
function puerto(r) {
  const colores = ["#c1121f", "#2a6f97", "#e9c46a", "#588157", "#f4a261", "#6d597a", "#e76f51", "#264653"];
  const grua = (x) => `<g transform="translate(${x} 0)">
    <rect x="0" y="-104" width="5" height="104" class="grua"/><rect x="44" y="-104" width="5" height="104" class="grua"/>
    <rect x="-2" y="-66" width="53" height="4" class="grua"/><rect x="-2" y="-110" width="53" height="7" class="grua"/>
    <rect x="22" y="-156" width="4" height="46" class="grua"/>
    <path d="M24 -154 L-78 -118 M24 -154 L92 -118" class="tirante"/>
    <rect x="-80" y="-120" width="176" height="6" class="grua"/>
    <rect x="12" y="-134" width="24" height="15" class="grua-cabina"/>
    <rect x="-52" y="-114" width="10" height="6" class="grua-cabina"/></g>`;
  let contenedores = "";
  for (let x = -10; x < 300; x += 18) {
    if ((x > 20 && x < 70) || (x > 130 && x < 180)) continue;  // espacio bajo las grúas
    const pisos = 1 + Math.floor(r() * 3);
    for (let k = 0; k < pisos; k++) contenedores += `<rect x="${x}" y="${-8 - k * 8}" width="16" height="7.4" fill="${colores[Math.floor(r() * colores.length)]}"/>`;
  }
  return `<rect x="-40" y="0" width="360" height="14" class="muelle"/><rect x="-40" y="12" width="360" height="3" class="muelle-borde"/>
    ${contenedores}${grua(30)}${grua(140)}`;
}

function barco(r) {
  const colores = ["#c1121f", "#2a6f97", "#e9c46a", "#588157", "#f4a261", "#e76f51"];
  let carga = "";
  for (let x = -66; x < 112; x += 17) for (let k = 0; k < 2; k++) carga += `<rect x="${x}" y="${-23 - k * 7}" width="16" height="6.6" fill="${colores[Math.floor(r() * colores.length)]}"/>`;
  return `<path d="M-122 -16 L134 -16 L120 6 L-112 6 Z" class="casco"/><rect x="-116" y="2" width="234" height="4" fill="#9b2c22"/>
    ${carga}
    <rect x="-112" y="-50" width="34" height="34" fill="#f1f1ee"/><rect x="-108" y="-44" width="26" height="4" fill="#2d3a4a"/>
    <rect x="-108" y="-34" width="26" height="3" fill="#2d3a4a" opacity=".6"/><rect x="-100" y="-62" width="10" height="12" fill="#c0392b"/>`;
}

const lancha = (color) => `<path d="M0 0 L30 0 L25 7 L4 7 Z" fill="${color}"/><rect x="8" y="-7" width="11" height="7" fill="#f1f1ee"/>`;

// Edificio del Congreso Nacional (Valparaíso): base ancha, dos torres y el gran puente superior que forma el arco
function edificioCongreso() {
  const tiras = (x0, ancho, y0, y1, n) => {  // vidrios verticales entre pilares
    const paso = ancho / n;
    let s = "";
    for (let i = 0; i < n; i++) s += `<rect x="${(x0 + i * paso + paso * .22).toFixed(1)}" y="${y0}" width="${(paso * .56).toFixed(1)}" height="${y1 - y0}" fill="url(#vidrio)"/>`;
    return s;
  };
  const bandas = (x0, x1, y, alto, n) => {  // franjas horizontales de ventanales con montantes
    let s = `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${alto}" fill="url(#vidrio)"/>`;
    for (let i = 1; i < n; i++) s += `<rect x="${(x0 + ((x1 - x0) * i) / n - 1.5).toFixed(1)}" y="${y}" width="3" height="${alto}" class="edif-luz"/>`;
    return s;
  };
  const pisos = (x0, x1, y0, y1) => {  // líneas de piso sobre los vidrios de las torres
    let s = "";
    for (let y = y0 + 14; y < y1; y += 14) s += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="1.6" class="edif-luz" opacity=".75"/>`;
    return s;
  };
  const asta = (x, alto) => `<rect x="${x - 1.2}" y="${-18 - alto}" width="2.4" height="${alto}" class="asta"/>
    <path d="M${x + 1.2} ${-18 - alto} q8 -2 15 0 t15 0 v9 q-8 2 -15 0 t-15 0 Z" fill="#fff"/>
    <path d="M${x + 1.2} ${-9 - alto} q8 -2 15 0 t15 0 v9 q-8 2 -15 0 t-15 0 Z" fill="#D52B1E"/>
    <rect x="${x + 1.2}" y="${-18.8 - alto}" width="10" height="9.6" fill="#0033A0"/>
    <path d="${estrella(x + 6.2, -14 - alto, 2.8)}" fill="#fff"/>`;
  return `
    <rect x="-250" y="-6" width="500" height="6" class="edif-escala"/>
    <rect x="-238" y="-12" width="476" height="6" class="edif-base"/>
    <rect x="-226" y="-18" width="452" height="6" class="edif-escala"/>
    <!-- base -->
    <rect x="-205" y="-84" width="410" height="66" class="edif-luz"/>
    <path d="M205 -84 L219 -76 L219 -18 L205 -18 Z" class="edif-sombra"/>
    ${bandas(-198, 198, -76, 13, 18)}${bandas(-198, 198, -52, 13, 18)}
    <rect x="-205" y="-30" width="410" height="12" class="edif-sombra" opacity=".55"/>
    <!-- torres -->
    <rect x="-190" y="-298" width="104" height="214" class="edif-luz"/>
    <rect x="86" y="-298" width="104" height="214" class="edif-luz"/>
    <path d="M-86 -298 L-72 -290 L-72 -84 L-86 -84 Z" class="edif-sombra"/>
    <path d="M190 -298 L204 -290 L204 -84 L190 -84 Z" class="edif-sombra"/>
    ${tiras(-186, 96, -290, -92, 6)}${tiras(90, 96, -290, -92, 6)}
    ${pisos(-186, -90, -290, -92)}${pisos(90, 186, -290, -92)}
    <!-- puente superior -->
    <rect x="-190" y="-350" width="380" height="76" class="edif-luz"/>
    <path d="M190 -350 L204 -342 L204 -266 L190 -274 Z" class="edif-sombra"/>
    <path d="M-86 -274 L86 -274 L100 -266 L-72 -266 Z" class="edif-bajo"/>
    ${bandas(-182, 182, -340, 18, 16)}${bandas(-182, 182, -312, 18, 16)}
    <rect x="-196" y="-358" width="392" height="9" class="edif-cornisa"/>
    <path d="M196 -358 L208 -350 L204 -342 L196 -349 Z" class="edif-sombra"/>
    <!-- plaza -->
    ${asta(-62, 118)}${asta(0, 132)}${asta(62, 118)}`;
}

function estrella(cx, cy, radio) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? radio * .382 : radio;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return poligono(pts);
}

// Bandera de Chile flameando (proporción 2:3; cuartel azul con estrella blanca)
const BANDERA = { L: 216, H: 144, N: 36 };
let animacionBandera = null;

function dibujarBandera(t) {
  const { L, H, N } = BANDERA;
  const ox = 4, oy = -366;  // punto de amarre en lo alto del asta (coordenadas del grupo)
  const ola = (x) => (x / L) * (10 * Math.sin(x / 34 - t * 3.1) + 3.5 * Math.sin(x / 15 - t * 5.3));
  const xs = Array.from({ length: N + 1 }, (_, i) => (i * L) / N);
  const franja = (i0, i1, y0, y1) => {
    const tramo = xs.slice(i0, i1 + 1);
    const arriba = tramo.map((x) => [ox + x, oy + y0 + ola(x)]);
    const abajo = tramo.slice().reverse().map((x) => [ox + x, oy + y1 + ola(x)]);
    return poligono([...arriba, ...abajo]);
  };
  $("#b-azul").setAttribute("d", franja(0, N / 3, 0, H / 2));
  $("#b-blanco").setAttribute("d", franja(N / 3, N, 0, H / 2));
  $("#b-rojo").setAttribute("d", franja(0, N, H / 2, H));
  $("#b-estrella").setAttribute("d", estrella(ox + L / 6, oy + H / 4 + ola(L / 6), H / 8));
  document.querySelectorAll("#b-pliegues path").forEach((p, i) => {  // luces y sombras de los pliegues
    const xm = (xs[i] + xs[i + 1]) / 2, pendiente = (ola(xm + 1) - ola(xm - 1)) / 2;
    p.setAttribute("d", franja(i, i + 1, 0, H));
    p.setAttribute("fill", pendiente > 0 ? "#000" : "#fff");
    p.setAttribute("fill-opacity", Math.min(.16, Math.abs(pendiente) * .28).toFixed(3));
  });
}

function animarBandera() {
  if (animacionBandera) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { dibujarBandera(0); return; }
  let ultimo = 0;
  const cuadro = (ms) => {
    if (ms - ultimo > 33) { dibujarBandera(ms / 1000); ultimo = ms; }  // ~30 cuadros por segundo
    animacionBandera = requestAnimationFrame(cuadro);
  };
  animacionBandera = requestAnimationFrame(cuadro);
}

function dibujarEscena() {
  const r = azar(11);
  const nube = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="120" ry="30"/><ellipse cx="-60" cy="8" rx="80" ry="22"/><ellipse cx="70" cy="6" rx="90" ry="24"/><ellipse cx="10" cy="-20" rx="70" ry="30"/></g>`;

  // Andes altos: macizos más altos hacia los costados para no competir con el titular
  const andes = capaMontana(r, "andes", {
    base: 690, alto: 330, forma: 1.35, detalle: .16, suavizado: 1,
    macizos: [[-40, .78, 230], [150, .9, 260], [360, .7, 230], [560, .6, 240], [760, .55, 230], [960, .62, 240],
      [1160, .74, 250], [1370, .95, 270], [1580, .8, 240]],
  }, .6, "sombra-andes");
  const media = capaMontana(r, "media", {
    base: 720, alto: 200, forma: 1.5, detalle: .09, suavizado: 3,
    macizos: [[60, .7, 220], [300, .85, 240], [540, .6, 220], [800, .72, 250], [1060, .62, 220], [1300, .8, 240], [1560, .7, 230]],
  }, 0);
  const pre = capaMontana(r, "pre", {
    base: 760, alto: 120, forma: 1.8, detalle: .1, suavizado: 3,
    macizos: [[0, .7, 220], [260, .9, 250], [520, .65, 220], [800, .8, 260], [1080, .7, 230], [1340, .95, 260], [1620, .75, 230]],
  }, 0);
  // Cerros del puerto: suben hacia los costados, dejando el plan al centro
  const cerros = perfil(r, {
    base: 812, alto: 150, forma: 2, detalle: .05, suavizado: 4,
    macizos: [[-60, 1, 420], [330, .62, 260], [1250, .7, 300], [1660, 1, 440]],
  });
  const luces = [];
  const casas = barrio(r, cerros, -40, 560, 120, luces) + barrio(r, cerros, 1020, 1660, 120, luces);
  const estrellas = Array.from({ length: 170 }, (_, i) => {  // cielo estrellado (solo se ve de noche)
    const y = Math.pow(r(), 1.5) * 470, g = 0.5 + Math.pow(r(), 3) * 1.7;
    return `<circle cx="${(r() * 1600).toFixed(0)}" cy="${y.toFixed(0)}" r="${g.toFixed(1)}"${i % 5 === 0 ? ` class="titila" style="animation-delay:${(r() * 6).toFixed(1)}s"` : ""}/>`;
  }).join("");

  $("#cordillera").innerHTML = `
    <defs>
      <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--cielo-1)"/><stop offset=".62" style="stop-color:var(--cielo-2)"/><stop offset="1" style="stop-color:var(--cielo-3)"/>
      </linearGradient>
      <radialGradient id="halo"><stop offset="0" style="stop-color:var(--astro-halo)"/><stop offset="1" stop-opacity="0" style="stop-color:var(--astro-halo)"/></radialGradient>
      <linearGradient id="bruma" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity="0" style="stop-color:var(--cielo-3)"/><stop offset="1" stop-opacity=".75" style="stop-color:var(--cielo-3)"/></linearGradient>
      <linearGradient id="mar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--mar-1)"/><stop offset="1" style="stop-color:var(--mar-2)"/></linearGradient>
      <linearGradient id="vidrio" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--vidrio-1)"/><stop offset=".5" style="stop-color:var(--vidrio-2)"/><stop offset="1" style="stop-color:var(--vidrio-3)"/></linearGradient>
      <filter id="difuso" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
      ${andes.defs}
    </defs>
    <rect width="1600" height="900" fill="url(#cielo)"/>
    <g class="capa-estrellas" fill="#fff">${estrellas}</g>
    <circle cx="1250" cy="170" r="210" fill="url(#halo)"/>
    <circle cx="1250" cy="170" r="32" class="astro"/>
    <g class="luna-detalle"><circle cx="1240" cy="161" r="6.5"/><circle cx="1262" cy="180" r="4.2"/><circle cx="1255" cy="150" r="3"/><circle cx="1236" cy="184" r="3.4"/></g>
    <g class="capa-nubes" fill="#fff" filter="url(#difuso)">${nube(230, 140, 1.1)}${nube(1440, 110, .8)}${nube(770, 230, .5)}</g>
    ${andes.svg}
    <rect x="0" y="520" width="1600" height="260" fill="url(#bruma)"/>
    ${media.svg}
    <rect x="0" y="640" width="1600" height="160" fill="url(#bruma)" opacity=".7"/>
    ${pre.svg}
    <path d="${relleno(cerros)}" class="cerro"/>
    <g class="casas">${casas}</g>
    <g class="luces">${luces.join("")}</g>
    <rect x="-60" y="804" width="1720" height="12" class="costanera"/>
    <rect x="-60" y="815" width="1720" height="85" fill="url(#mar)"/>
    <g class="olas">${Array.from({ length: 70 }, () => `<rect x="${(r() * 1700 - 50).toFixed(0)}" y="${(822 + r() * 76).toFixed(0)}" width="${(8 + r() * 34).toFixed(0)}" height="1.4"/>`).join("")}</g>
    <g id="puerto">${puerto(r)}</g>
    <g id="barco">${barco(r)}</g>
    <g id="lanchas"><g transform="translate(0 0)">${lancha("#2a6f97")}</g><g transform="translate(70 18)">${lancha("#e9c46a")}</g><g transform="translate(150 6)">${lancha("#c1121f")}</g></g>
    <g id="congreso">${edificioCongreso()}</g>
    <g id="asta">
      <rect x="-3" y="-372" width="7" height="380" class="asta"/>
      <circle cx="0.5" cy="-376" r="7" class="remate"/>
      <g class="bandera">
        <path id="b-rojo" fill="#D52B1E"/><path id="b-blanco" fill="#fff"/><path id="b-azul" fill="#0033A0"/>
        <path id="b-estrella" fill="#fff"/>
        <g id="b-pliegues">${Array.from({ length: BANDERA.N }, () => "<path/>").join("")}</g>
      </g>
    </g>`;
  ubicarEscena();
  dibujarBandera(0);
  animarBandera();
  let espera;
  addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(ubicarEscena, 120); });
}

// Pone el Congreso y la bandera dentro de la parte visible del paisaje, según el ancho de pantalla
function ubicarEscena() {
  const caja = $(".paisaje");
  const w = caja.clientWidth, h = caja.clientHeight;
  if (!w || !h) return;
  const s = Math.max(w / 1600, h / 900), visible = w / s;
  const xmin = 800 - visible / 2, xmax = 800 + visible / 2;
  const angosto = w < 700;
  const eEdif = angosto ? .4 : Math.min(.82, Math.max(.62, visible / 1800));
  const xEdif = angosto ? xmax - 100 : xmax - visible * .18;
  $("#congreso").setAttribute("transform", `translate(${xEdif.toFixed(0)} 806) scale(${eEdif.toFixed(2)})`);
  const eAsta = angosto ? .36 : 1;
  const xAsta = angosto ? xmin + 26 : xmin + visible * .05;
  $("#asta").setAttribute("transform", `translate(${xAsta.toFixed(0)} 812) scale(${eAsta})`);
  // puerto a la izquierda, el carguero y las lanchas en la bahía
  const ePuerto = angosto ? .42 : Math.min(1, Math.max(.75, visible / 1600));
  $("#puerto").setAttribute("transform", `translate(${(xmin + visible * (angosto ? .3 : .14)).toFixed(0)} 812) scale(${ePuerto.toFixed(2)})`);
  $("#barco").setAttribute("transform", `translate(${(xmin + visible * (angosto ? .5 : .44)).toFixed(0)} 868) scale(${(ePuerto * .95).toFixed(2)})`);
  $("#lanchas").setAttribute("transform", `translate(${(xmin + visible * (angosto ? .62 : .58)).toFixed(0)} 836) scale(${ePuerto.toFixed(2)})`);
}

function iniciarTema() {
  const raiz = document.documentElement;
  try { const t = localStorage.getItem("tema"); if (t) raiz.dataset.theme = t; } catch (e) { /* sin almacenamiento */ }
  $("#tema").addEventListener("click", () => {
    const oscuroAhora = raiz.dataset.theme
      ? raiz.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    raiz.dataset.theme = oscuroAhora ? "light" : "dark";
    try { localStorage.setItem("tema", raiz.dataset.theme); } catch (e) { /* sin almacenamiento */ }
  });
}

// Franja compacta: un degradado con cortes duros, una celda por sesión
function franja(historial) {
  const n = historial.length;
  const hueco = 0.25 * (100 / n);
  const partes = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 100) / n, b = ((i + 1) * 100) / n;
    partes.push(`${ESTADOS[historial[i]].color} ${a.toFixed(3)}% ${(b - hueco).toFixed(3)}%`);
    partes.push(`transparent ${(b - hueco).toFixed(3)}% ${b.toFixed(3)}%`);
  }
  return `linear-gradient(to right, ${partes.join(", ")})`;
}

function leyenda() {
  return `<ul class="leyenda" aria-label="Leyenda">${LEYENDA.map(
    (k) => `<li><span class="punto" style="background:${ESTADOS[k].color}"></span>${ESTADOS[k].nombre}</li>`
  ).join("")}</ul>`;
}

// Resumen de licencias / trabajo / sin justificar para la fila del ranking
function notas(d) {
  const out = [];
  const lic = d.periodos.filter((p) => p.estado === "licencia");
  if (lic.length) {
    out.push(`<span><span class="punto" style="background:var(--c-licencia)"></span>Licencia: ${plural(d.falta_licencia, "sesión", "sesiones")} (${rango(lic[0].desde, lic[lic.length - 1].hasta)})</span>`);
  }
  if (d.falta_trabajo) {
    out.push(`<span><span class="punto" style="background:var(--c-trabajo)"></span>Trabajo parlamentario: ${plural(d.falta_trabajo, "sesión", "sesiones")}</span>`);
  }
  if (d.falta_sin_justificar) {
    out.push(`<span><span class="punto" style="background:var(--c-sinjust)"></span>${plural(d.falta_sin_justificar, "falta sin justificar", "faltas sin justificar")}</span>`);
  }
  return out.length ? `<div class="notas">${out.join("")}</div>` : "";
}

function metrica(clase, rotulo, principal, ajustado) {
  return `<div class="metrica ${clase}">
    <span class="rotulo-movil">${rotulo}</span>
    <div class="grande">${pct(principal)}</div>
    <div class="chica" title="Sin contar inasistencias justificadas por ley: licencias, trabajo parlamentario y Art. 42">sin justif.: ${pct(ajustado)}</div>
  </div>`;
}

// ---------- vistas ----------
// ---------- portada ----------
const MIN_PARTIDO = 3;  // integrantes mínimos para comparar partidos
let menosSinLicencias = true;  // por defecto sin inasistencias justificadas por ley

function filaTop(d, i, valor, detalle) {
  return `<a class="top-fila" href="${P}/d/${d.id}">
    <span class="top-pos">${i + 1}</span>${avatar(d)}
    <span class="top-quien"><span class="nombre">${esc(d.nombre)}</span>${chipPartido(d)}<span class="top-detalle">${detalle}</span></span>
    <span class="top-valor">${valor}</span></a>`;
}

function itemPodio(d, i, valor, detalle) {
  return `<a class="podio-item" href="${P}/d/${d.id}">
    <span class="podio-pos">${i + 1}</span>${avatar(d)}
    <span class="nombre">${esc(d.nombre)}</span>${chipPartido(d)}
    <span class="podio-valor">${valor}</span>
    <span class="top-detalle">${detalle}</span></a>`;
}

// Los 3 primeros en podio con foto grande; del 4 al 10 en lista
function topConPodio(lista, valor, detalle, dosColumnas = false) {
  const resto = lista.slice(3);
  return `<div class="podio">${lista.slice(0, 3).map((d, i) => itemPodio(d, i, valor(d), detalle(d))).join("")}</div>
    <div class="top-lista ${dosColumnas ? "dos-columnas" : ""}" style="--filas:${Math.ceil(resto.length / 2)}">
      ${resto.map((d, i) => filaTop(d, i + 3, valor(d), detalle(d))).join("")}</div>`;
}

function promediosPartidos() {
  const grupos = {};
  DATOS.diputados.forEach((d) => {
    if (!d.partido) return;
    (grupos[d.partido] ??= { alias: d.partido, nombre: d.partido_nombre, ds: [] }).ds.push(d);
  });
  const prom = (ds, k) => {
    const v = ds.map((d) => d[k]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return Object.values(grupos).map((g) => ({
    ...g,
    asis: prom(g.ds, "pct_asistencia"), asisAj: prom(g.ds, "pct_asistencia_ajustada"),
    vota: prom(g.ds, "pct_votaciones"), votaAj: prom(g.ds, "pct_votaciones_ajustado"),
    sinjust: g.ds.reduce((a, d) => a + d.falta_sin_justificar, 0),
  }));
}

function cajaPartido(p, valor, ajustado, etiqueta) {
  const logo = logoPartido(p.alias) || `<span class="sin-logo">${esc(p.alias.slice(0, 4))}</span>`;
  return `<a class="partido-caja ${colorPartido(p.alias) ? "con-color" : ""}"${estiloPartido(p.alias)} href="${P}/ranking" data-partido="${esc(p.alias)}">
    <span class="pc-cabeza">${logo}<span><strong>${esc(p.alias)}</strong><span class="pc-nombre">${esc(p.nombre)}</span></span></span>
    <span class="pc-valor">${pct(valor)}</span>
    <span class="pc-ajustado">sin justif.: ${pct(ajustado)}</span>
    <span class="pc-pie">${etiqueta} · ${p.ds.length} ${CAMARA.pluralCorto}</span></a>`;
}

const verMas = (orden, texto = "Ver todos en este orden") => `<a class="enlace-mas" href="${P}/ranking?orden=${orden}">${texto} →</a>`;

function vistaInicio() {
  const r = DATOS.resumen;
  const D = DATOS.diputados;
  const cumplen = D.slice().sort(ORDENES.cumplen.fn);
  const conFoto = cumplen.filter((d) => MEDIOS.diputados[d.id]?.foto);
  const muestra = (conFoto.length >= 6 ? conFoto : cumplen).slice(0, 6);
  const cien = D.filter((d) => d.pct_asistencia === 100).length;
  const noVotan = D.filter((d) => tasaPresenteSinVotar(d) >= 0).sort(ORDENES.presente_tasa.fn).slice(0, 10);

  const partidos = promediosPartidos().filter((p) => p.alias !== "IND" && p.ds.length >= MIN_PARTIDO);
  const porAsis = partidos.slice().sort((a, b) => b.asis - a.asis);
  const porVota = partidos.slice().sort((a, b) => b.vota - a.vota);

  $("#app").innerHTML = `
    <section class="hero">
      <span class="etiqueta-hero"><span class="vivo"></span>Período ${esc(r.periodo)} · actualizado ${fecha(r.actualizado.slice(0, 10))}</span>
      ${selectorCamara()}
      <h1>${CAMARA.titulo}, <em>sesión a sesión</em></h1>
      <p class="bajada">Asistencia y votaciones de cada ${CAMARA.singular.replace(" o ", " y ")} de Chile, con los datos oficiales ${CAMARA.de}.</p>
      <form class="buscador" id="form-hero" role="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="busqueda-hero" type="search" placeholder="Busca a tu ${CAMARA.persona}…" aria-label="Buscar por nombre" autocomplete="off">
        <button type="submit">Buscar</button>
      </form>
      <div class="sugerencias" id="sugerencias"></div>
      <div class="hero-pie">
        <div class="avatares"><span class="pila">${muestra.map(avatar).join("")}</span>${D.length} ${CAMARA.plural}</div>
        <div class="chips"><span>Datos oficiales</span><span>${num(r.sesiones)} sesiones</span><span>${num(r.votaciones)} votaciones</span></div>
      </div>
    </section>

    <div class="panel">
      <div class="panel-vidrio cifras" aria-label="Promedios">
        <div class="cifra"><div class="etiqueta">Asistencia promedio</div><div class="valor">${pct(r.promedio_asistencia)}</div><div class="nota">sin justif.: ${pct(r.promedio_asistencia_ajustada)}</div></div>
        <div class="cifra"><div class="etiqueta">Votaciones promedio</div><div class="valor">${pct(r.promedio_votaciones)}</div><div class="nota">sin justif.: ${pct(r.promedio_votaciones_ajustado)}</div></div>
        <div class="cifra"><div class="etiqueta">Sesiones de sala</div><div class="valor">${num(r.sesiones)}</div><div class="nota">desde ${fecha(DATOS.sesiones[0], { day: "numeric", month: "short", year: "numeric" })}</div></div>
        <div class="cifra"><div class="etiqueta">Votaciones en sala</div><div class="valor">${num(r.votaciones)}</div><div class="nota">en el período</div></div>
      </div>
    </div>

    <div class="contenedor">
      ${contadorUnanimidad(r.unanimidad)}
      <a class="costo-mini" id="costo-mini" href="${P}/costo" hidden></a>
      <div class="grid-2">
        <section class="tarjeta-top bueno">
          <header><span class="sello">▲ Lo mejor</span><h2>Los que más <em>cumplen</em></h2>
            <p>Mayor asistencia y, entre ellos, los que más votan. ${cien} ${CAMARA.pluralCorto} tienen 100% de asistencia.</p></header>
          ${topConPodio(cumplen.slice(0, 10), (d) => pct(d.pct_votaciones),
            (d) => `Asistencia ${pct(d.pct_asistencia)} · votó en ${pct(d.pct_votaciones)}`)}
          <footer><span class="top-nota">El número grande es el % de votaciones en que votó.</span>${verMas("cumplen")}</footer>
        </section>

        <section class="tarjeta-top malo">
          <header><span class="sello">▼ Lo peor</span><h2>Los que menos <em>asisten</em></h2><p id="menos-sub"></p></header>
          <div class="segmentado" role="group" aria-label="Qué inasistencias contar">
            <button type="button" data-sin="1">${CAMARA.clave === "senado" ? "Sin justificadas" : "Sin justificadas por ley"}</button>
            <button type="button" data-sin="0">Todas las faltas</button>
          </div>
          <div id="menos-lista"></div>
          <footer><span class="top-nota" id="menos-nota"></span><span id="menos-mas"></span></footer>
        </section>
      </div>

      <section class="tarjeta-top ancha malo">
        <header><span class="sello">▼ Lo peor</span><h2>Van a la sala, pero <em>no votan</em></h2>
          <p>Votaciones en que no votó <strong>estando presente</strong> en la sesión. Aquí no cuentan las licencias ni las faltas
            justificadas: solo se consideran las sesiones a las que asistió.</p></header>
        ${topConPodio(noVotan, (d) => pct(tasaPresenteSinVotar(d)),
          (d) => `No votó en ${num(d.no_vota_presente)} de ${num(d.vota + d.no_vota_presente)} votaciones`, true)}
        <footer><span class="top-nota">Puede incluir votaciones en que no podía votar por conflicto de interés o en que estaba en una
          comisión que sesionaba al mismo tiempo; los datos oficiales no distinguen esos casos.</span>${verMas("presente_tasa")}</footer>
      </section>

      <section class="seccion-partidos">
        <header class="seccion-cabeza"><h2>Por <em>partido</em></h2>
          <p>Promedio de sus ${CAMARA.plural}. Solo partidos con ${MIN_PARTIDO} o más integrantes; los independientes no se agrupan.</p></header>
        <div class="grid-2">
          <div class="tarjeta-top"><h3 class="sub-titulo">Asistencia</h3>
            <p class="sub-rotulo bueno">▲ Más asisten</p><div class="partidos-grid grupo-bueno">${porAsis.slice(0, 3).map((p) => cajaPartido(p, p.asis, p.asisAj, "asistencia")).join("")}</div>
            <p class="sub-rotulo malo">▼ Menos asisten</p><div class="partidos-grid grupo-malo">${porAsis.slice(-3).reverse().map((p) => cajaPartido(p, p.asis, p.asisAj, "asistencia")).join("")}</div>
          </div>
          <div class="tarjeta-top"><h3 class="sub-titulo">Votaciones</h3>
            <p class="sub-rotulo bueno">▲ Más votan</p><div class="partidos-grid grupo-bueno">${porVota.slice(0, 3).map((p) => cajaPartido(p, p.vota, p.votaAj, "votaciones")).join("")}</div>
            <p class="sub-rotulo malo">▼ Menos votan</p><div class="partidos-grid grupo-malo">${porVota.slice(-3).reverse().map((p) => cajaPartido(p, p.vota, p.votaAj, "votaciones")).join("")}</div>
          </div>
        </div>
        <footer class="pie-seccion"><a class="enlace-mas" href="${P}/partidos">Ver todos los partidos →</a></footer>
      </section>

      <section class="cta-ranking">
        <div><h2>Revisa a <em>los ${D.length}</em></h2><p>Ranking completo con filtros por partido, búsqueda y la asistencia sesión a sesión de cada uno.</p></div>
        <a class="boton" href="${P}/ranking">Ver ranking completo</a>
      </section>
    </div>`;

  pintarMenos();
  pintarCostoMini();
  document.querySelectorAll(".segmentado button").forEach((b) =>
    b.addEventListener("click", () => { menosSinLicencias = b.dataset.sin === "1"; pintarMenos(); }));
  document.querySelectorAll("[data-partido]").forEach((a) =>
    a.addEventListener("click", () => { estado.partido = a.dataset.partido; estado.busqueda = ""; }));

  const sugerir = (texto) => {
    const q = sinTildes(texto.trim());
    $("#sugerencias").innerHTML = q.length < 2 ? "" : D
      .filter((d) => sinTildes(d.nombre).includes(q)).slice(0, 6)
      .map((d) => `<a href="${P}/d/${d.id}">${avatar(d)}<span><strong>${esc(d.nombre)}</strong> ${chipPartido(d)}</span>
        <span class="s-dato">${pct(d.pct_asistencia)} asistencia</span></a>`).join("");
  };
  $("#busqueda-hero").addEventListener("input", (e) => sugerir(e.target.value));
  $("#form-hero").addEventListener("submit", (e) => {
    e.preventDefault();
    estado.busqueda = $("#busqueda-hero").value;
    estado.partido = "";
    location.hash = P + "/ranking";
  });
}

// Contador: días de calendario desde la última votación unánime hasta hoy (incluye recesos y semanas distritales)
function contadorUnanimidad(u) {
  if (!u || !u.ultima) return "";
  const dia = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const hoy = new Date();
  const n = Math.max(0, Math.round((Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - dia(u.ultima.fecha.slice(0, 10))) / 864e5));
  const r = u.racha_dias;
  const esRecord = r && n > 0 && n >= r.dias;
  const digitos = String(n).padStart(2, "0").split("").map((c) => `<span class="digito">${c}</span>`).join("");
  const cuando = fecha(u.ultima.fecha.slice(0, 10), { weekday: "long", day: "numeric", month: "long" });
  return `<section class="contador" aria-label="Días sin una votación unánime">
    <div class="contador-tablero">${digitos}<span class="contador-unidad">${n === 1 ? "día" : "días"}</span></div>
    <div class="contador-texto">
      <p class="contador-titulo">sin una votación <em>unánime</em> en ${CAMARA.clave === "senado" ? "el Senado" : "la Sala"}</p>
      <p>${n === 0 ? `Hubo votación unánime hoy, el ${cuando}` : `La última fue el ${cuando}`}:
        <a href="${P}/v/${u.ultima.id}">«${esc(u.ultima.titulo)}»</a>, ${u.ultima.resultado ? esc(u.ultima.resultado.toLowerCase()) + " " : "votada "}${u.ultima.si} a ${u.ultima.no}.</p>
      <p class="contador-datos">
        <span><strong>${num(u.unanimes)}</strong> de ${num(u.total)} votaciones han sido unánimes (${pct((100 * u.unanimes) / u.total)})</span>
        ${r ? `<span>${esRecord ? "<strong>Es la racha más larga del período</strong>" : `Racha más larga: <strong>${plural(r.dias, "día", "días")}</strong> (${rango(r.desde, r.hasta)})`}</span>` : ""}
      </p>
      <p class="contador-nota">Días de calendario desde la última votación unánime, contando semanas distritales y recesos.
        Unánime: todos votaron lo mismo, a favor o en contra, y nadie se abstuvo.</p>
    </div>
  </section>`;
}

function pintarMenos() {
  const orden = menosSinLicencias ? "asis_aj_asc" : "asis_asc";
  const clave = menosSinLicencias ? "pct_asistencia_ajustada" : "pct_asistencia";
  const menos = DATOS.diputados.filter((d) => d[clave] != null).sort(ORDENES[orden].fn).slice(0, 10);
  document.querySelectorAll(".segmentado button").forEach((b) =>
    b.setAttribute("aria-pressed", String((b.dataset.sin === "1") === menosSinLicencias)));
  $("#menos-sub").textContent = menosSinLicencias
    ? (CAMARA.clave === "senado"
      ? "Porcentaje de inasistencia sin contar las justificadas: licencias, misiones oficiales y otras actividades justificadas ante el Senado."
      : "Porcentaje de inasistencia sin contar las justificadas por ley: licencias, trabajo parlamentario y las del Art. 42 del Reglamento (impedimento grave, permiso particular), que no afectan su asistencia.")
    : "Porcentaje de inasistencia contando toda falta, incluidas las justificadas. Las licencias se marcan para dar contexto.";
  $("#menos-nota").textContent = "El número grande es el % de sesiones de sala a las que faltó (inasistencia).";
  $("#menos-mas").innerHTML = verMas(orden);
  const inasistencia = (d) => `${pct(100 - d[clave])}<small>inasistencia</small>`;
  $("#menos-lista").innerHTML = topConPodio(menos, inasistencia, (d) => {
    const partes = [];
    if (!menosSinLicencias && d.falta_licencia) partes.push(`<span class="marca-lic">Licencia: ${plural(d.falta_licencia, "sesión", "sesiones")}</span>`);
    if (d.falta_sin_justificar) partes.push(`<span class="marca-sinj">${plural(d.falta_sin_justificar, "falta sin justificar", "faltas sin justificar")}</span>`);
    const base = menosSinLicencias ? d.sesiones - d.falta_excusada : d.sesiones;
    partes.push(`Faltó a ${d.inasistencias - (menosSinLicencias ? d.falta_excusada : 0)} de ${base} sesiones`);
    return partes.join(" · ");
  });
}

// ---------- ranking completo ----------
function vistaRanking() {
  const partidos = [...new Set(DATOS.diputados.map((d) => d.partido).filter(Boolean))].sort();
  $("#app").innerHTML = `
    <div class="contenedor">
      ${rutaAnterior ? `<a class="volver" href="${P}/" id="volver">← Volver</a>` : ""}
      <section class="interior-cabecera ${rutaAnterior ? "con-volver" : ""}">
        ${selectorCamara()}
        <h1>Ranking <em>completo</em></h1>
        <p>Las y los ${DATOS.diputados.length} ${CAMARA.pluralCorto}. Toca a cualquiera para ver su asistencia sesión a sesión.</p>
      </section>
      <div class="panel-vidrio">
        <div class="controles">
          <input id="busqueda" type="search" placeholder="Filtrar por nombre…" aria-label="Filtrar por nombre" value="${esc(estado.busqueda)}">
          <select id="partido" aria-label="Filtrar por partido">
            <option value="">Todos los partidos</option>
            ${partidos.map((p) => `<option value="${esc(p)}" ${p === estado.partido ? "selected" : ""}>${esc(p)}</option>`).join("")}
          </select>
          <select id="orden" aria-label="Ordenar">
            ${Object.entries(ORDENES).map(([k, o]) => `<option value="${k}" ${k === estado.orden ? "selected" : ""}>${o.nombre}</option>`).join("")}
          </select>
        </div>
        ${leyenda()}
        <div class="encabezado-lista" aria-hidden="true">
          <span>#</span><span>${CAMARA.columna}</span><span>Asistencia</span><span>Votaciones</span><span>Sesión a sesión</span>
        </div>
        <div class="lista" id="lista"></div>
      </div>
    </div>`;
  $("#volver")?.addEventListener("click", (e) => { e.preventDefault(); history.back(); });
  $("#busqueda").addEventListener("input", (e) => { estado.busqueda = e.target.value; pintarLista(); });
  $("#partido").addEventListener("change", (e) => { estado.partido = e.target.value; pintarLista(); });
  $("#orden").addEventListener("change", (e) => {
    estado.orden = e.target.value;
    history.replaceState(null, "", `${P}/ranking?orden=${estado.orden}`);
    pintarLista();
  });
  pintarLista();
}

function pintarLista() {
  const q = sinTildes(estado.busqueda.trim());
  const filas = DATOS.diputados
    .filter((d) => (!estado.partido || d.partido === estado.partido) && (!q || sinTildes(d.nombre).includes(q)))
    .sort(ORDENES[estado.orden].fn);
  $("#lista").innerHTML = filas.length
    ? filas.map((d, i) => `
      <a class="fila" href="${P}/d/${d.id}">
        <span class="pos">${i + 1}</span>
        ${avatar(d)}
        <div class="quien">
          <span class="nombre">${esc(d.nombre)}</span>${chipPartido(d)}
          ${notas(d)}
        </div>
        ${metrica("m-asis", "Asistencia", d.pct_asistencia, d.pct_asistencia_ajustada)}
        ${metrica("m-vota", "Votaciones", d.pct_votaciones, d.pct_votaciones_ajustado)}
        <div class="franja" style="background-image:${franja(d.historial)}" role="img"
          aria-label="Asistió a ${d.asiste} de ${d.sesiones} sesiones"></div>
      </a>`).join("")
    : `<p class="vacio">No hay resultados para esa búsqueda.</p>`;
}

function comparacion(valor, promedio) {
  const lado = promedio > 85 ? "derecha" : "";
  return `<div class="comparacion">
    <div class="pista"><div class="relleno" style="width:${valor}%"></div></div>
    <div class="marca-prom ${lado}" style="left:${promedio}%"><span>Promedio ${pct(promedio)}</span></div>
  </div>`;
}

function vistaDiputado(id) {
  const d = DATOS.diputados.find((x) => x.id === id);
  if (!d) {
    $("#app").innerHTML = `<p class="vacio">No encontramos a esa ${CAMARA.singular}. <a href="${P}/">Volver al listado</a></p>`;
    return;
  }
  const r = DATOS.resumen;
  const otrasAusencias = d.no_vota - d.no_vota_presente - d.no_vota_licencia - d.no_vota_trabajo;

  // Sesiones agrupadas por mes
  const meses = [];
  DATOS.sesiones.forEach((f, i) => {
    const clave = f.slice(0, 7);
    if (!meses.length || meses[meses.length - 1].clave !== clave) meses.push({ clave, sesiones: [] });
    meses[meses.length - 1].sesiones.push(i);
  });

  const motivoDe = (i) => {
    const m = d.motivo_sesion[i];
    return m == null ? "" : DATOS.motivos[m];
  };

  const desglose = [
    ["l", "Licencia", d.falta_licencia],
    ["t", "Trabajo parlamentario", d.falta_trabajo],
    ["j", "Otra justificación", d.falta_justificada],
    ["x", "Sin justificar", d.falta_sin_justificar],
  ];
  const maxFaltas = Math.max(1, ...desglose.map((x) => x[2]));

  const votos = [
    ["var(--c-asiste)", "Votó (a favor, en contra o abstención)", d.vota],
    ["var(--texto-suave)", "No votó estando presente en la sesión", d.no_vota_presente],
    ["var(--c-licencia)", "No votó: con licencia", d.no_vota_licencia],
    ["var(--c-trabajo)", "No votó: en trabajo parlamentario", d.no_vota_trabajo],
    ["var(--c-justificada)", "No votó: otras ausencias", otrasAusencias],
  ];
  if (d.dispensado) votos.push(["var(--c-vacio)", "Dispensado/a", d.dispensado]);

  $("#app").innerHTML = `
    <div class="contenedor">
    <a class="volver" href="${P}/ranking" id="volver">← Volver</a>
    <header class="ficha-cabecera">
      ${avatar(d)}
      <div>
        <h1>${esc(d.nombre)}</h1>
        <p>${d.partido ? `<span class="partido grande ${colorPartido(d.partido) ? "con-color" : ""}"${estiloPartido(d.partido)}>${logoPartido(d.partido)}${esc(d.partido_nombre)}</span>` : "<span>Sin partido</span>"}<span>· Período ${esc(r.periodo)} ·</span>
          <a href="${CAMARA.ficha(d)}" rel="noopener" target="_blank">Ficha en ${CAMARA.sitio}</a></p>
      </div>
    </header>

    <section class="tarjetas">
      <div class="tarjeta">
        <h2>Asistencia a sala</h2>
        <div class="grande">${pct(d.pct_asistencia)}</div>
        <div class="detalle">Asistió a ${d.asiste} de ${plural(d.sesiones, "sesión", "sesiones")}</div>
        ${comparacion(d.pct_asistencia, r.promedio_asistencia)}
        <div class="ajustado">Sin contar inasistencias justificadas por ley (licencias, trabajo parlamentario y Art. 42): <strong>${pct(d.pct_asistencia_ajustada)}</strong>
          ${d.pct_asistencia_ajustada == null ? "<br>(muy pocas sesiones fuera de licencia para calcularlo)" : ""}</div>
      </div>
      <div class="tarjeta">
        <h2>Participación en votaciones</h2>
        <div class="grande">${pct(d.pct_votaciones)}</div>
        <div class="detalle">Votó en ${num(d.vota)} de ${plural(d.votaciones - d.dispensado, "votación", "votaciones")}</div>
        ${comparacion(d.pct_votaciones, r.promedio_votaciones)}
        <div class="ajustado">Sin contar días con inasistencias justificadas por ley: <strong>${pct(d.pct_votaciones_ajustado)}</strong>
          ${d.pct_votaciones_ajustado == null ? "<br>(muy pocas votaciones fuera de licencia para calcularlo)" : ""}</div>
      </div>
    </section>

    <section class="bloque">
      <h2>Sesión a sesión</h2>
      <p class="sub">Cada cuadro es una sesión de sala. Toca o pasa el cursor para ver el detalle.</p>
      ${leyenda()}
      <div class="meses">
        ${meses.map((m) => `
          <div class="mes">
            <div class="nombre-mes">${fecha(m.clave + "-15", { month: "long" })}</div>
            <div class="celdas">${m.sesiones.map((i) => {
              const k = d.historial[i];
              const texto = `${fecha(DATOS.sesiones[i], { weekday: "short", day: "numeric", month: "short" })}: ${ESTADOS[k].nombre}${motivoDe(i) ? " — " + motivoDe(i) : ""}`;
              return `<button class="celda" data-i="${i}" style="background:${ESTADOS[k].color}" aria-label="${esc(texto)}" title="${esc(texto)}"></button>`;
            }).join("")}</div>
          </div>`).join("")}
      </div>
      <div class="info-sesion" id="info-sesion" aria-live="polite"></div>
      ${d.periodos.length ? `<ul class="periodos">${d.periodos.map((p) => `
        <li><span class="punto" style="background:${ESTADOS[p.estado === "licencia" ? "l" : "t"].color}"></span>
          <span><strong>${esc(p.motivo)}</strong> <span class="cuando">· ${rango(p.desde, p.hasta)} · ${plural(p.sesiones, "sesión", "sesiones")}</span></span></li>`).join("")}
      </ul>` : ""}
    </section>

    <section class="bloque">
      <h2>Inasistencias: ${num(d.inasistencias)}</h2>
      <p class="sub">Todas cuentan para el porcentaje de asistencia. El motivo es el registrado oficialmente por ${CAMARA.la}.</p>
      <div class="desglose">
        ${desglose.map(([k, nombre, n]) => `
          <div class="item"><span>${nombre}</span>
            <div class="barra"><div style="width:${(100 * n) / maxFaltas}%;background:${ESTADOS[k].color}"></div></div>
            <span class="num">${num(n)}</span></div>`).join("")}
      </div>
      ${Object.keys(d.motivo_sesion).length ? `<ul class="motivos">${motivosContados(d).map(([m, n]) => `<li><span>${esc(m)}</span><span>${n}</span></li>`).join("")}</ul>` : ""}
      ${motivosContados(d).some(([m]) => /Comités Parlamentarios/i.test(m)) ? `<p class="aclaracion">Los Comités Parlamentarios son las bancadas
        (los diputados de cada partido). Estos permisos los otorgan los jefes de bancada y no exigen un motivo público; no se refieren
        a trabajo en comisiones. Por eso cuentan como inasistencia, también en la cifra "sin justif.".</p>` : ""}
    </section>

    <section class="bloque">
      <h2>Votaciones: ${num(d.votaciones)}</h2>
      <p class="sub">Qué pasó en cada votación de sala del período.</p>
      <div class="desglose">
        ${votos.map(([color, nombre, n]) => `
          <div class="item"><span>${nombre}</span>
            <div class="barra"><div style="width:${(100 * n) / d.votaciones}%;background:${color}"></div></div>
            <span class="num">${num(n)}</span></div>`).join("")}
      </div>
      <p class="aclaracion">"No votó estando presente": registró asistencia a la sesión pero no votó. Puede incluir casos en que
        no podía votar por conflicto de interés, que los datos oficiales no distinguen.</p>
    </section>
    <section class="bloque" id="sus-votaciones"><h2>Cómo votó</h2><p class="sub">Cargando votaciones…</p></section>
    </div>`;
  pintarVotosDiputado(d);

  $("#volver").addEventListener("click", (e) => { if (rutaAnterior) { e.preventDefault(); history.back(); } });
  const info = $("#info-sesion");
  const mostrar = (b) => {
    document.querySelectorAll(".celda.activa").forEach((c) => c.classList.remove("activa"));
    b.classList.add("activa");
    const i = +b.dataset.i;
    const k = d.historial[i];
    info.innerHTML = `<span class="punto" style="background:${ESTADOS[k].color}"></span>
      <strong>${fecha(DATOS.sesiones[i], { weekday: "long", day: "numeric", month: "long" })}</strong> · ${ESTADOS[k].nombre}${motivoDe(i) ? " — " + esc(motivoDe(i)) : ""}`;
  };
  document.querySelectorAll(".celda").forEach((b) => {
    b.addEventListener("mouseenter", () => mostrar(b));
    b.addEventListener("focus", () => mostrar(b));
    b.addEventListener("click", () => mostrar(b));
  });
}

function motivosContados(d) {
  const c = {};
  Object.values(d.motivo_sesion).forEach((m) => { c[DATOS.motivos[m]] = (c[DATOS.motivos[m]] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}

// ---------- votaciones ----------
const VOTO = {
  a: { nombre: "A favor", color: "var(--v-favor)" },
  c: { nombre: "En contra", color: "var(--v-contra)" },
  b: { nombre: "Abstención", color: "var(--v-abst)" },
  n: { nombre: "No votó", color: "var(--v-novoto)" },
  d: { nombre: "Dispensado/a", color: "var(--v-disp)" },
  p: { nombre: "Pareo", color: "var(--v-disp)" },
};
const TIPOS_VOTACION = { "Proyecto de Ley": "Proyecto de ley", "Proyecto de Resolución": "Resolución", "Proyecto de Acuerdo": "Acuerdo", "Otros": "Otros asuntos" };
const enlaceVotacionCamara = (id) => CAMARA.votacion({ id });
const enlaceProyectoCamara = (pr, boletin) => CAMARA.proyecto(pr, boletin);

let VOTACIONES = null, cargaVotaciones = null;
function cargarVotaciones() {
  cargaVotaciones ??= fetch(CAMARA.base + "votaciones.json").then((r) => r.json()).then((v) => {
    v.indice = Object.fromEntries(v.diputados.map((id, k) => [id, k]));
    return (VOTACIONES = v);
  });
  return cargaVotaciones;
}

const tituloVotacion = (v) => (v.boletin && VOTACIONES.proyectos[v.boletin]?.titulo) || v.materia || v.asunto;
const etiquetaTipo = (v) => {
  const numero = v.asunto.match(/N°\s*(\d+)$/);
  return `${TIPOS_VOTACION[v.tipo] || v.tipo}${v.boletin ? ` · Boletín ${v.boletin}` : numero ? ` · N° ${numero[1]}` : ""}`;
};
const metaVotacion = (v) => [v.tramite, v.etapa && `votación ${v.etapa.toLowerCase()}`, v.quorum].filter(Boolean).map(esc).join(" · ");

function barraVotos(v) {
  const total = Math.max(1, v.si + v.no + v.abst);
  return `<div class="v-barra" role="img" aria-label="${v.si} a favor, ${v.no} en contra, ${v.abst} abstenciones">
    <span style="width:${(100 * v.si) / total}%;background:var(--v-favor)"></span>
    <span style="width:${(100 * v.no) / total}%;background:var(--v-contra)"></span>
    <span style="width:${(100 * v.abst) / total}%;background:var(--v-abst)"></span></div>
    <div class="v-numeros"><span><i style="background:var(--v-favor)"></i>${v.si} a favor</span><span><i style="background:var(--v-contra)"></i>${v.no} en contra</span>
      <span><i style="background:var(--v-abst)"></i>${v.abst} ${v.abst === 1 ? "abstención" : "abstenciones"}</span></div>`;
}

const chipResultado = (v) => (v.resultado ? `<span class="v-resultado ${v.resultado === "Aprobado" ? "aprobado" : "rechazado"}">${esc(v.resultado)}</span>` : "");

function tarjetaVotacion(v) {
  const proyecto = v.boletin && VOTACIONES.proyectos[v.boletin];
  return `<article class="votacion">
    <div class="v-cabeza"><span class="v-tipo">${esc(etiquetaTipo(v))}</span>${chipResultado(v)}</div>
    <h3><a href="${P}/v/${v.id}">${esc(tituloVotacion(v))}</a></h3>
    ${v.articulo ? `<p class="v-detalle">${esc(v.articulo)}</p>` : ""}
    <p class="v-meta">${fecha(v.fecha.slice(0, 10), { day: "numeric", month: "short" })} · ${v.fecha.slice(11)} h${metaVotacion(v) ? " · " + metaVotacion(v) : ""}</p>
    ${barraVotos(v)}
    <div class="v-enlaces"><a href="${P}/v/${v.id}">Cómo votó cada ${CAMARA.persona.replace("/a", "")} →</a>
      ${enlaceVotacionCamara(v.id) ? `<a href="${enlaceVotacionCamara(v.id)}" rel="noopener" target="_blank">Votación en ${CAMARA.sitio} ↗</a>` : ""}
      ${proyecto && enlaceProyectoCamara(proyecto, v.boletin) ? `<a href="${enlaceProyectoCamara(proyecto, v.boletin)}" rel="noopener" target="_blank">Tramitación del proyecto ↗</a>` : ""}</div>
  </article>`;
}

const estadoVot = { q: "", tipo: "", resultado: "", dias: 10 };

function vistaVotaciones() {
  $("#app").innerHTML = `
    <div class="contenedor">
      <section class="interior-cabecera">
        ${selectorCamara()}
        <h1>Votaciones <em>en sala</em></h1>
        <p>Cada votación del período, sesión por sesión: qué se votó, el resultado y cómo votó cada ${CAMARA.singular.replace(" o ", " y ")}.</p>
      </section>
      <div class="panel-vidrio" id="votaciones"><p class="vacio">Cargando votaciones…</p></div>
    </div>`;
  cargarVotaciones().then(() => {
    if (!$("#votaciones")) return;  // el usuario ya cambió de página
    $("#votaciones").innerHTML = `
      <div class="controles">
        <input id="v-busqueda" type="search" placeholder="Buscar proyecto o tema…" aria-label="Buscar votación" value="${esc(estadoVot.q)}">
        <select id="v-tipo" aria-label="Tipo">
          <option value="">Todos los tipos</option>
          ${Object.entries(TIPOS_VOTACION).map(([k, n]) => `<option value="${esc(k)}" ${k === estadoVot.tipo ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        <select id="v-resultado" aria-label="Resultado">
          <option value="">Aprobadas y rechazadas</option>
          <option value="Aprobado" ${estadoVot.resultado === "Aprobado" ? "selected" : ""}>Aprobadas</option>
          <option value="Rechazado" ${estadoVot.resultado === "Rechazado" ? "selected" : ""}>Rechazadas</option>
        </select>
      </div>
      <div id="v-lista"></div>`;
    const repintar = () => { estadoVot.dias = 10; pintarVotaciones(); };
    $("#v-busqueda").addEventListener("input", (e) => { estadoVot.q = e.target.value; repintar(); });
    $("#v-tipo").addEventListener("change", (e) => { estadoVot.tipo = e.target.value; repintar(); });
    $("#v-resultado").addEventListener("change", (e) => { estadoVot.resultado = e.target.value; repintar(); });
    pintarVotaciones();
  });
}

function pintarVotaciones() {
  const q = sinTildes(estadoVot.q.trim());
  const lista = VOTACIONES.votaciones.filter((v) =>
    (!estadoVot.tipo || v.tipo === estadoVot.tipo) && (!estadoVot.resultado || v.resultado === estadoVot.resultado) &&
    (!q || sinTildes(`${tituloVotacion(v)} ${v.articulo || ""} ${v.boletin || ""}`).includes(q)));
  const dias = [];
  lista.forEach((v) => {
    const dia = v.fecha.slice(0, 10);
    if (!dias.length || dias[dias.length - 1].dia !== dia) dias.push({ dia, votaciones: [] });
    dias[dias.length - 1].votaciones.push(v);
  });
  $("#v-lista").innerHTML = !dias.length ? `<p class="vacio">No hay votaciones con esos filtros.</p>` :
    dias.slice(0, estadoVot.dias).map((d) => `
      <section class="v-sesion">
        <h2>${fecha(d.dia, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          <span>${plural(d.votaciones.length, "votación", "votaciones")}</span></h2>
        <div class="v-grilla">${d.votaciones.map(tarjetaVotacion).join("")}</div>
      </section>`).join("") +
    (dias.length > estadoVot.dias ? `<div class="v-mas"><button class="boton" id="v-mas">Ver sesiones anteriores (${dias.length - estadoVot.dias} más)</button></div>` : "");
  $("#v-mas")?.addEventListener("click", () => { estadoVot.dias += 10; pintarVotaciones(); });
}

function vistaVotacion(id) {
  $("#app").innerHTML = `<div class="contenedor" id="votacion"><p class="vacio">Cargando votación…</p></div>`;
  cargarVotaciones().then(() => {
    if (!$("#votacion")) return;
    const v = VOTACIONES.votaciones.find((x) => x.id === id);
    if (!v) { $("#votacion").innerHTML = `<p class="vacio">No encontramos esa votación. <a href="${P}/votaciones">Ver todas</a></p>`; return; }
    const proyecto = v.boletin && VOTACIONES.proyectos[v.boletin];
    const porOpcion = { a: [], c: [], b: [], n: [], d: [], p: [] };
    const porPartido = {};
    DATOS.diputados.forEach((d) => {
      const op = v.votos[VOTACIONES.indice[d.id]];
      if (!op || op === "-") return;
      porOpcion[op].push(d);
      const p = (porPartido[d.partido || "—"] ??= { alias: d.partido || "—", a: 0, c: 0, b: 0, n: 0, d: 0, p: 0, total: 0 });
      p[op]++; p.total++;
    });
    const partidos = Object.values(porPartido).sort((x, y) => y.total - x.total);
    const persona = (d) => `<a class="v-persona" href="${P}/d/${d.id}">${avatar(d)}<span>${esc(d.nombre)}</span>${chipPartido(d)}</a>`;
    $("#votacion").innerHTML = `
      ${rutaAnterior ? `<a class="volver" href="${P}/votaciones" id="volver">← Volver</a>` : `<a class="volver" href="${P}/votaciones">← Todas las votaciones</a>`}
      <section class="interior-cabecera con-volver">
        <p class="v-tipo">${esc(etiquetaTipo(v))}</p>
        <h1 class="v-titulo">${esc(tituloVotacion(v))}</h1>
      </section>
      <section class="bloque v-resumen">
        <div class="v-cabeza">${chipResultado(v)}<span class="v-meta">${fecha(v.fecha.slice(0, 10), { weekday: "long", day: "numeric", month: "long" })} · ${v.fecha.slice(11)} h${metaVotacion(v) ? " · " + metaVotacion(v) : ""}</span></div>
        ${v.articulo ? `<p class="v-que"><strong>Qué se votó:</strong> ${esc(v.articulo)}</p>` : ""}
        ${barraVotos(v)}
        <div class="v-enlaces">
          ${enlaceVotacionCamara(v.id) ? `<a href="${enlaceVotacionCamara(v.id)}" rel="noopener" target="_blank">Ver la votación en ${CAMARA.sitio} ↗</a>` : ""}
          ${proyecto && enlaceProyectoCamara(proyecto, v.boletin) ? `<a href="${enlaceProyectoCamara(proyecto, v.boletin)}" rel="noopener" target="_blank">Tramitación del proyecto ↗</a>` : ""}
        </div>
      </section>
      ${!partidos.length ? `<section class="bloque"><p class="aclaracion">Los datos abiertos no traen el voto de cada parlamentario en esta votación
        (el detalle no coincide con el resultado oficial), así que solo se muestra el resultado. Esta votación no se cuenta
        en las cifras individuales.</p></section>` : `
      <section class="bloque">
        <h2>Por partido</h2>
        <div class="v-partidos">${partidos.map((p) => `
          <div class="v-partido">
            <span class="v-partido-nombre">${logoPartido(p.alias)}${esc(p.alias)}</span>
            <div class="v-barra chica">${["a", "c", "b", "n", "d", "p"].map((k) => p[k] ? `<span style="width:${(100 * p[k]) / p.total}%;background:${VOTO[k].color}" title="${VOTO[k].nombre}: ${p[k]}"></span>` : "").join("")}</div>
            <span class="v-partido-num">${p.a}·${p.c}·${p.b}</span>
          </div>`).join("")}</div>
        <p class="aclaracion">Cifras: a favor · en contra · abstención. En gris, quienes no votaron.</p>
      </section>
      <section class="bloque">
        <h2>Cómo votó cada uno</h2>
        <div class="v-opciones">${["a", "c", "b", "n", "d", "p"].filter((k) => porOpcion[k].length).map((k) => `
          <div class="v-opcion">
            <h3><i style="background:${VOTO[k].color}"></i>${VOTO[k].nombre} <span>${porOpcion[k].length}</span></h3>
            <div class="v-personas">${porOpcion[k].sort((x, y) => x.nombre.localeCompare(y.nombre, "es")).map(persona).join("")}</div>
          </div>`).join("")}</div>
        <p class="aclaracion">"No votó" incluye a quienes estaban ausentes, con licencia o presentes sin votar.</p>
      </section>`}`;
    $("#volver")?.addEventListener("click", (e) => { e.preventDefault(); history.back(); });
  });
}

// Ficha: cómo votó la diputada o diputado en cada votación
function pintarVotosDiputado(d) {
  cargarVotaciones().then(() => {
    const caja = $("#sus-votaciones");
    if (!caja) return;
    const k = VOTACIONES.indice[d.id];
    const suyas = VOTACIONES.votaciones.filter((v) => v.votos[k] && v.votos[k] !== "-");
    let mostrar = 12, filtro = "";
    // estado de asistencia de ese día, para explicar por qué no votó
    const estadoDia = {};
    DATOS.sesiones.forEach((f, i) => { if (!(f in estadoDia) || d.historial[i] !== "a") estadoDia[f] = d.historial[i]; });
    const razon = { l: "con licencia", t: "trabajo parlamentario", j: "ausencia justificada", x: "ausente sin justificar" };
    const pintar = () => {
      const q = sinTildes(filtro.trim());
      const lista = suyas.filter((v) => !q || sinTildes(`${tituloVotacion(v)} ${v.boletin || ""}`).includes(q));
      $("#sv-lista").innerHTML = lista.slice(0, mostrar).map((v) => {
        const op = VOTO[v.votos[k]];
        const porque = v.votos[k] === "n" && razon[estadoDia[v.fecha.slice(0, 10)]];
        return `<a class="sv-fila" href="${P}/v/${v.id}">
          <span class="sv-fecha">${fecha(v.fecha.slice(0, 10), { day: "numeric", month: "short" })}</span>
          <span class="sv-titulo"><strong>${esc(tituloVotacion(v))}</strong>${v.articulo ? `<span>${esc(v.articulo)}</span>` : ""}</span>
          <span class="sv-voto" style="--vc:${op.color}">${op.nombre}${porque ? ` · ${porque}` : ""}</span></a>`;
      }).join("") || `<p class="vacio">Sin resultados.</p>`;
      $("#sv-mas").hidden = lista.length <= mostrar;
    };
    caja.innerHTML = `
      <h2>Cómo votó</h2>
      <p class="sub">Sus votaciones en sala, de la más reciente a la más antigua. Toca una para ver cómo votó el resto.</p>
      <input id="sv-busqueda" class="sv-busqueda" type="search" placeholder="Buscar un proyecto…" aria-label="Buscar en sus votaciones">
      <div id="sv-lista" class="sv-lista"></div>
      <button class="enlace-mas" id="sv-mas" type="button">Ver más votaciones</button>`;
    $("#sv-busqueda").addEventListener("input", (e) => { filtro = e.target.value; mostrar = 12; pintar(); });
    $("#sv-mas").addEventListener("click", () => { mostrar += 20; pintar(); });
    pintar();
  });
}

function vistaPartidos() {
  const grupos = {};
  DATOS.diputados.forEach((d) => {
    const g = (grupos[d.partido || "—"] ??= { alias: d.partido || "—", nombre: d.partido_nombre || "Sin partido", ds: [] });
    g.ds.push(d);
  });
  const prom = (ds, k) => {
    const v = ds.map((d) => d[k]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const filas = Object.values(grupos).map((g) => ({
    ...g,
    asis: prom(g.ds, "pct_asistencia"), asisAj: prom(g.ds, "pct_asistencia_ajustada"),
    vota: prom(g.ds, "pct_votaciones"), votaAj: prom(g.ds, "pct_votaciones_ajustado"),
    sinjust: g.ds.reduce((a, d) => a + d.falta_sin_justificar, 0),
  })).sort((a, b) => b.asis - a.asis);

  $("#app").innerHTML = `
    <div class="contenedor">
    <section class="interior-cabecera">
      ${selectorCamara()}
      <h1>Por <em>partido</em></h1>
      <p>Promedio de sus ${CAMARA.plural}. Toca un partido para ver a cada integrante.
        Ojo: en partidos con pocos integrantes, un solo caso (por ejemplo, una licencia larga) mueve mucho el promedio.</p>
    </section>
    <div class="tabla-envoltura">
      <table>
        <thead><tr><th>Partido</th><th>Integrantes</th><th>Asistencia</th><th>Votaciones</th><th>Faltas sin justificar</th></tr></thead>
        <tbody>${filas.map((f) => `
          <tr>
            <td class="${colorPartido(f.alias) ? "con-color" : ""}"${estiloPartido(f.alias)}><a class="celda-partido" href="${P}/ranking" data-partido="${esc(f.alias)}">${logoPartido(f.alias) || `<span class="sin-logo">${esc(f.alias.slice(0, 4))}</span>`}
              <span><strong>${esc(f.alias)}</strong><span class="chica">${esc(f.nombre)}</span></span></a></td>
            <td>${f.ds.length}</td>
            <td>${pct(f.asis)}<span class="chica">sin justif.: ${pct(f.asisAj)}</span></td>
            <td>${pct(f.vota)}<span class="chica">sin justif.: ${pct(f.votaAj)}</span></td>
            <td>${num(f.sinjust)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
    </div>`;
  document.querySelectorAll("[data-partido]").forEach((a) =>
    a.addEventListener("click", () => { estado.partido = a.dataset.partido; estado.busqueda = ""; }));
}

// ---------- cuánto cuesta el Congreso (presupuesto.json, datos de la DIPRES) ----------
let PRESUPUESTO = null;
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pesos = (n) => "$" + num(Math.round(n));
const millones = (n) => "$" + num(Math.round(n / 1e6)) + " millones";
const sinMovimiento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Cifra que sube desde cero al aparecer en pantalla: <span data-contar="valor" data-formato="pesos|millones|pct">
const FORMATOS = { pesos, millones, pct: (n) => pct(n) };
function animarCifras(raiz) {
  const cifras = raiz.querySelectorAll("[data-contar]");
  const pintar = (el, v) => { el.textContent = FORMATOS[el.dataset.formato](v); };
  if (sinMovimiento() || !("IntersectionObserver" in window)) { cifras.forEach((el) => pintar(el, +el.dataset.contar)); return; }
  const pendientes = new Set(cifras);
  // Las que quedan arriba sin haberse visto (scroll rápido o salto al final) muestran su valor final
  const alPasar = () => {
    pendientes.forEach((el) => {
      if (el.getBoundingClientRect().bottom < 0) { pendientes.delete(el); observador.unobserve(el); pintar(el, +el.dataset.contar); }
    });
    if (!pendientes.size || !el0.isConnected) window.removeEventListener("scroll", alPasar);
  };
  const el0 = cifras[0];
  const observador = new IntersectionObserver((entradas) => entradas.forEach((e) => {
    if (!e.isIntersecting || !pendientes.delete(e.target)) return;
    observador.unobserve(e.target);
    const el = e.target, fin = +el.dataset.contar, inicio = performance.now(), dura = 1600;
    const paso = (t) => {
      const x = Math.min(1, (t - inicio) / dura);
      pintar(el, fin * (1 - Math.pow(1 - x, 3)));  // desacelera al final
      if (x < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }), { threshold: 0.4 });
  cifras.forEach((el) => { pintar(el, 0); observador.observe(el); });
  window.addEventListener("scroll", alPasar, { passive: true });
}

// Lo que gasta el Congreso desde que se abrió la página, a ritmo del presupuesto vigente
function contadorGasto(porMs) {
  const el = $("#gasto-vivo");
  const inicio = performance.now();
  const paso = (t) => {
    if (!el.isConnected) return;
    // dígitos de ancho fijo (CSS) para que no salte; el punto de miles queda angosto
    el.innerHTML = pesos(porMs * Math.max(0, t - inicio)).replace(/\./g, '<span class="sep">.</span>');
    if (!sinMovimiento()) requestAnimationFrame(paso);
  };
  if (sinMovimiento()) { const id = setInterval(() => (el.isConnected ? paso(performance.now()) : clearInterval(id)), 1000); }
  requestAnimationFrame(paso);
}

function barrasGasto(lista, total) {
  const max = Math.max(...lista.map((s) => s.vigente));
  return `<div class="desglose costo-desglose">${lista.slice().sort((a, b) => b.vigente - a.vigente).map((s) => `
    <div class="item" title="${esc(s.nombre)}: ${millones(s.vigente)} en ${PRESUPUESTO.anio}">
      <span>${esc(s.nombre)}</span>
      <div class="barra"><div style="width:${(100 * s.vigente) / max}%;background:var(--acento)"></div></div>
      <span class="num">${pct((100 * s.vigente) / total)}</span>
    </div>`).join("")}</div>`;
}

function graficoMensual(p) {
  const max = Math.max(...p.mensual.map((m) => m.ejecutado));
  const mensual = p.mensual.map((m) => ({ ...m, etiqueta: `${MESES_CORTOS[m.mes - 1]}: ${millones(m.ejecutado)}` }));
  return `<div class="meses-gasto" role="img" aria-label="Gasto por mes: ${mensual.map((m) => m.etiqueta).join("; ")}">
    ${mensual.map((m) => `<div class="mes-gasto" title="${m.etiqueta}" tabindex="0">
      <span class="mg-valor">${num(Math.round(m.ejecutado / 1e6))}</span>
      <div class="mg-pista"><div class="mg-barra" style="height:${(100 * m.ejecutado) / max}%"></div></div>
      <span class="mg-mes">${MESES_CORTOS[m.mes - 1]}</span>
    </div>`).join("")}
  </div>
  <p class="aclaracion">En millones de pesos.</p>`;
}

const diasDelAnio = (anio) => (new Date(anio, 1, 29).getMonth() === 1 ? 366 : 365);
const cargarPresupuesto = async () => (PRESUPUESTO ??= await fetch("presupuesto.json").then((r) => r.json()));

// Versión chica para la portada: el contador en vivo y un par de cifras, con enlace a la sección
async function pintarCostoMini() {
  const p = await cargarPresupuesto().catch(() => null);
  const el = $("#costo-mini");
  if (!p || !el) return;
  const dias = diasDelAnio(p.anio);
  el.innerHTML = `
    <span class="cm-rotulo">Desde que abriste esta página, el Congreso <em>ha gastado</em></span>
    <strong class="cm-vivo" id="gasto-vivo">$0</strong>
    <span class="cm-datos">Presupuesto ${p.anio}: <b data-contar="${p.total.vigente}" data-formato="millones"></b> ·
      <b data-contar="${p.total.vigente / p.poblacion}" data-formato="pesos"></b> por habitante al año</span>
    <span class="cm-ver">¿Cuánto cuesta el Congreso? →</span>`;
  el.hidden = false;
  animarCifras(el);
  contadorGasto(p.total.vigente / (dias * 864e5));
}

async function vistaCosto() {
  $("#app").innerHTML = `<div class="contenedor"><section class="interior-cabecera"><h1>¿Cuánto <em>cuesta</em> el Congreso?</h1></section></div>`;
  const p = await cargarPresupuesto(), t = p.total;
  if (!location.hash.includes("/costo")) return;  // se cambió de página mientras cargaba
  const dias = diasDelAnio(p.anio);
  const avance = (100 * t.ejecutado) / t.vigente;
  const camaras = p.capitulos.filter((c) => c.parlamentarios);
  const otros = p.capitulos.filter((c) => !c.parlamentarios);
  $("#app").innerHTML = `
    <div class="contenedor">
    <section class="interior-cabecera"><h1 id="costo-titulo">¿Cuánto <em>cuesta</em> el Congreso?</h1>
      <p>Presupuesto ${p.anio} del Congreso Nacional (Senado, Cámara, Biblioteca del Congreso y Consejo de Asignaciones
        Parlamentarias) según la Ley de Presupuestos, con lo gastado hasta ${p.mes_nombre}.</p></section>

    <section class="contador costo-vivo" aria-label="Gasto del Congreso desde que abriste esta página">
      <div class="contador-texto">
        <p class="contador-titulo">Desde que abriste esta página, el Congreso <em>ha gastado</em></p>
        <p class="costo-vivo-cifra" id="gasto-vivo" aria-live="off">$0</p>
        <p class="contador-nota">Calculado al ritmo del presupuesto ${p.anio}: ${millones(t.vigente / dias)} al día, unos ${pesos(t.vigente / dias / 86400)} por segundo.</p>
      </div>
    </section>

    <div class="cifras costo-cifras">
      <div class="cifra"><div class="etiqueta">Presupuesto ${p.anio}</div><div class="valor" data-contar="${t.vigente}" data-formato="millones"></div><div class="nota">ley vigente a ${p.mes_nombre}</div></div>
      <div class="cifra"><div class="etiqueta">Al día</div><div class="valor" data-contar="${t.vigente / dias}" data-formato="millones"></div><div class="nota">todos los días del año</div></div>
      <div class="cifra"><div class="etiqueta">Por habitante</div><div class="valor" data-contar="${t.vigente / p.poblacion}" data-formato="pesos"></div><div class="nota">al año (${esc(p.poblacion_fuente)})</div></div>
      <div class="cifra"><div class="etiqueta">Gastado a ${p.mes_nombre}</div><div class="valor" data-contar="${t.ejecutado}" data-formato="millones"></div><div class="nota"><span data-contar="${avance}" data-formato="pct"></span> del presupuesto</div></div>
    </div>

    <div class="tarjetas">
      ${camaras.map((c) => `<div class="tarjeta">
        <h2>${esc(c.nombre)}</h2>
        <div class="grande" data-contar="${c.vigente}" data-formato="millones"></div>
        <div class="detalle">${pct((100 * c.vigente) / t.vigente)} del Congreso · gastado a ${p.mes_nombre}: ${millones(c.ejecutado)}</div>
        <div class="ajustado">Dividido por sus ${c.parlamentarios} ${c.codigo === "01" ? "senadores" : "diputados"}:
          <strong data-contar="${c.vigente / c.parlamentarios}" data-formato="millones"></strong> al año cada uno.
          Incluye funcionarios, asesores, edificios y funcionamiento, no solo la dieta.</div>
      </div>`).join("")}
    </div>
    <div class="bloque costo-otros">
      ${otros.map((c) => `<p><strong>${esc(c.nombre)}</strong>: ${millones(c.vigente)} (${pct((100 * c.vigente) / t.vigente)})</p>`).join("")}
    </div>

    <div class="grid-2 costo-graficos">
      <section class="bloque"><h2>En qué se gasta</h2><p class="sub">Presupuesto ${p.anio} del Congreso por tipo de gasto.</p>
        ${barrasGasto(p.subtitulos, t.vigente)}
        <p class="aclaracion">Las asignaciones parlamentarias pagan el personal de apoyo, asesorías externas y gastos operacionales
          (oficinas, traslados) de cada parlamentario; no son sueldo. La dieta, igual para todos, equivale a la remuneración de un
          ministro de Estado (art. 62 de la Constitución).</p></section>
      <section class="bloque"><h2>Mes a mes</h2><p class="sub">Lo efectivamente gastado cada mes de ${p.anio}.</p>
        ${graficoMensual(p)}</section>
    </div>

    <article class="texto costo-fuente">
      <p>Fuente: <a href="${p.fuente}" rel="noopener">datos abiertos de la Dirección de Presupuestos (DIPRES)</a>, Partida 02
        «Congreso Nacional» de la Ley de Presupuestos ${p.anio}: ley vigente y ejecución a ${p.mes_nombre}. Se cuentan solo los gastos
        (no los ingresos). La DIPRES publica cada mes con uno o dos meses de desfase. El monto por habitante usa las
        ${num(p.poblacion)} personas del ${esc(p.poblacion_fuente)}.</p>
    </article>
    </div>`;
  animarCifras($("#app"));
  contadorGasto(t.vigente / (dias * 864e5));
}

function vistaMetodologia() {
  const r = DATOS.resumen;
  $("#app").innerHTML = `
    <div class="contenedor">
    <section class="interior-cabecera"><h1><em>Metodología</em></h1></section>
    <article class="texto">
      <p>Los datos de la Cámara vienen del <a href="https://opendata.camara.cl" rel="noopener">servicio oficial de datos abiertos</a> de la
        Cámara de Diputadas y Diputados; los del Senado, de la <a href="https://www.senado.cl" rel="noopener">API pública del Senado</a>
        y su servicio de tramitación. Se calculan igual en ambas cámaras y se actualizan automáticamente; la última actualización fue el
        ${fecha(r.actualizado.slice(0, 10), { day: "numeric", month: "long", year: "numeric" })}.</p>

      <h2>Asistencia</h2>
      <p><strong>Considera solo las sesiones de sala.</strong> La sala sesiona de lunes a miércoles, tres semanas al mes; la cuarta es
        semana distrital, en que no hay sesiones porque los parlamentarios trabajan en sus distritos. Por eso hay entre 9 y 13 sesiones al mes.</p>
      <p>Es el porcentaje de sesiones de sala a las que la diputada o diputado asistió. <strong>Toda inasistencia cuenta</strong>,
        sea cual sea el motivo. Para dar contexto, cada falta se clasifica según el motivo registrado por la Cámara:</p>
      <table>
        <tbody>
          <tr><td><span class="punto" style="background:var(--c-licencia)"></span> Licencia</td><td>Licencia médica, permiso prenatal, postnatal y parental.</td></tr>
          <tr><td><span class="punto" style="background:var(--c-trabajo)"></span> Trabajo parlamentario</td><td>Misiones oficiales, actividad propia de la labor parlamentaria, actividades oficiales con el Presidente de la República y gestiones encomendadas por la Cámara.</td></tr>
          <tr><td><span class="punto" style="background:var(--c-justificada)"></span> Otra justificación</td><td>Impedimento grave, permisos por motivos particulares, permisos de los Comités Parlamentarios y otros.</td></tr>
          <tr><td><span class="punto" style="background:var(--c-sinjust)"></span> Sin justificar</td><td>Inasistencias sin justificación registrada.</td></tr>
        </tbody>
      </table>
      <p>Junto a cada porcentaje se muestra, más pequeño ("sin justif."), el mismo cálculo <strong>sin contar las inasistencias
        justificadas por ley</strong>: licencias (médica, prenatal, postnatal y parental), trabajo parlamentario (misiones oficiales,
        actividades con el Presidente) y todas las justificaciones del <strong>Art. 42 del Reglamento</strong> (licencia médica,
        impedimento grave, permiso por motivos particulares, actividad propia de la labor parlamentaria y gestión encomendada por la
        Cámara), que por reglamento no afectan la asistencia. Los permisos de los Comités Parlamentarios sí se cuentan: los Comités
        Parlamentarios son las bancadas de cada partido (no las comisiones), y esos permisos los otorgan los propios jefes de bancada
        sin un motivo público.
        Si después de descontarlos quedan menos de 10 sesiones o 50 votaciones, ese dato no se muestra porque no sería representativo.</p>

      <h2>Votaciones</h2>
      <p>Es el porcentaje de votaciones de sala en que votó a favor, en contra o se abstuvo. Las votaciones en que estaba dispensado
        no se cuentan. "No votó estando presente" significa que registró asistencia a la sesión, pero no votó en esa votación;
        puede incluir casos en que no podía votar por conflicto de interés, o en que estaba en una comisión autorizada para sesionar
        al mismo tiempo que la sala. Los datos oficiales no distinguen esos casos.</p>

      <h2>Comisiones</h2>
      <p>La asistencia a comisiones no está incluida: ni suma ni resta. La Cámara aún no la publica en sus datos abiertos para el
        período ${esc(r.periodo)}. Cuando lo haga, se mostrará como un porcentaje aparte.</p>

      <h2>Senado</h2>
      <p>Se usan los mismos cálculos, con estas diferencias propias de los datos del Senado:</p>
      <ul>
        <li><strong>Motivos de inasistencia:</strong> "Enfermedad" y permisos por nacimiento cuentan como licencia; misiones e invitaciones
          oficiales y sesiones de comisiones o subcomisiones, como trabajo parlamentario; "Otras actividades", como otra justificación.</li>
        <li><strong>Cifra ajustada ("sin justif."):</strong> descuenta toda inasistencia justificada, porque el Senado distingue solo entre
          inasistencias justificadas y sin justificar.</li>
        <li><strong>Pareo:</strong> acuerdo entre dos senadores de posiciones distintas para no votar. No se exige votar en esos casos, igual
          que con las dispensas en la Cámara.</li>
        <li>Los datos del Senado <strong>no indican si cada votación fue aprobada o rechazada</strong>, por eso no se muestra el resultado.</li>
        <li>El Senado ya lista las sesiones programadas a futuro; esas no se cuentan hasta que ocurren.</li>
        <li>El Senado sí publica la asistencia a comisiones; se incorporará más adelante como un porcentaje aparte.</li>
      </ul>

      <h2>Qué no mide</h2>
      <ul>
        <li>El trabajo en comisiones, el trabajo en terreno ni la calidad de las leyes que impulsa cada parlamentario.</li>
        <li>La sesión más reciente puede no aparecer hasta que se publica su asistencia. Sus votaciones se ven en el sitio, pero
          no se suman a las cifras de cada parlamentario hasta que aparece la lista (así se sabe quién tenía licencia o permiso).</li>
        <li>Si el detalle de una votación no coincide con su resultado oficial, se muestra el resultado y no se cuenta por persona.</li>
      </ul>
      <p>El código y los datos procesados son abiertos. Si encuentras un error, avísanos.</p>
      ${creditos()}
    </article>
    </div>`;
}

function creditos() {
  const logos = Object.entries(MEDIOS.partidos).filter(([, m]) => m.logo);
  const fotos = Object.keys(MEDIOS.diputados).length;
  if (!fotos && !logos.length) return "";
  return `<h2>Créditos de imágenes</h2>
    ${fotos ? `<p>Fotografías oficiales de las y los parlamentarios: <a href="https://www.bcn.cl/historiapolitica/resenas_parlamentarias" rel="noopener">Biblioteca
      del Congreso Nacional de Chile</a>, desde sus datos abiertos (<a href="https://datos.bcn.cl" rel="noopener">datos.bcn.cl</a>).</p>` : ""}
    ${logos.length ? `<p>Logos y colores de partidos desde Wikidata y Wikimedia Commons:</p>
    <ul class="creditos">${logos.map(([alias, m]) =>
      `<li>${esc(alias)}: ${m.fuente ? `<a href="${esc(m.fuente)}" rel="noopener">${esc(m.autor || "ver en Commons")}</a>` : esc(m.autor || "")}${m.licencia ? ", " + esc(m.licencia) : ""}</li>`).join("")}</ul>` : ""}`;
}

// ---------- rutas ----------
let rutaAnterior = null;   // última ruta visitada dentro del sitio (para "Volver")
let rutaActual = null;
const scrollPorRuta = {};  // posición de scroll de cada ruta, para volver al mismo punto

// Carga los datos de una cámara (al entrar o al cambiar de cámara)
async function cargarCamara(camara) {
  const [datos, medios] = await Promise.all([
    fetch(camara.base + "datos.json").then((r) => r.json()),
    fetch(camara.base + "medios.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  CAMARA = camara;
  P = camara.prefijo;
  DATOS = datos;
  MEDIOS = medios || { diputados: {}, partidos: {} };
  VOTACIONES = null;
  cargaVotaciones = null;
  Object.assign(estado, { busqueda: "", partido: "" });
  Object.assign(estadoVot, { q: "", tipo: "", resultado: "", dias: 10 });
  document.querySelectorAll("[data-destino]").forEach((a) => { a.href = P + a.dataset.destino; });
  $("#actualizado").textContent = `Última actualización: ${fecha(datos.resumen.actualizado.slice(0, 10), { day: "numeric", month: "long", year: "numeric" })}.`;
  $("#fuente").textContent = camara.nombreFuente;
  $("#fuente").href = camara.fuente;
}

// Subruta actual sin el prefijo de cámara (para que el selector mantenga la sección)
let subrutaActual = "/";
const selectorCamara = () => {
  const destino = /^\/(d|v)\//.test(subrutaActual) ? "/" : subrutaActual.split("?")[0];
  return `<nav class="selector-camara" aria-label="Elegir cámara">${Object.values(CAMARAS).map((c) =>
    `<a href="${c.prefijo}${destino}" ${c === CAMARA ? 'aria-current="page"' : ""}>${c.corto}</a>`).join("")}</nav>`;
};

async function enrutar() {
  const completa = location.hash.replace(/^#/, "") || "/";
  const camara = completa.startsWith("/senado") ? CAMARAS.senado : CAMARAS.diputados;
  if (camara !== CAMARA || !DATOS) await cargarCamara(camara);
  const h = (camara === CAMARAS.senado ? completa.slice("/senado".length) : completa) || "/";
  subrutaActual = h;
  if (rutaActual !== null) { scrollPorRuta[rutaActual] = window.scrollY; rutaAnterior = rutaActual; }
  rutaActual = completa;
  let ruta = "inicio";
  const m = h.match(/^\/d\/(\d+)/);
  if (m) { ruta = "diputado"; vistaDiputado(+m[1]); }
  else if (h.startsWith("/ranking")) {
    ruta = "ranking";
    const orden = new URLSearchParams(h.split("?")[1] || "").get("orden");
    if (orden && ORDENES[orden]) { estado.orden = orden; estado.busqueda = ""; estado.partido = ""; }
    vistaRanking();
  }
  else if (h.match(/^\/v\/(\d+)/)) { ruta = "votaciones"; vistaVotacion(+h.match(/^\/v\/(\d+)/)[1]); }
  else if (h.startsWith("/votaciones")) { ruta = "votaciones"; vistaVotaciones(); }
  else if (h.startsWith("/partidos")) { ruta = "partidos"; vistaPartidos(); }
  else if (h.startsWith("/costo")) {
    ruta = "costo";
    vistaCosto().catch(() => { $("#app").innerHTML = `<p class="vacio">No se pudo cargar el presupuesto. Intenta recargar la página.</p>`; });
  }
  else if (h.startsWith("/metodologia")) { ruta = "metodologia"; vistaMetodologia(); }
  else vistaInicio();
  document.body.classList.toggle("interior", ruta !== "inicio");
  // En páginas interiores la franja de paisaje es baja: se centra para mostrar las cumbres
  $("#cordillera").setAttribute("preserveAspectRatio", ruta === "inicio" ? "xMidYMax slice" : "xMidYMid slice");
  ubicarEscena();
  document.querySelectorAll(".nav a").forEach((a) =>
    a.toggleAttribute("aria-current", a.dataset.ruta === ruta || (ruta === "diputado" && a.dataset.ruta === "ranking")));
  document.querySelectorAll(".nav a[aria-current]").forEach((a) => a.setAttribute("aria-current", "page"));
  window.scrollTo(0, scrollPorRuta[completa] || 0);
}

iniciarTema();
dibujarEscena();
window.addEventListener("hashchange", enrutar);
enrutar().catch(() => { $("#app").innerHTML = `<p class="vacio">No se pudieron cargar los datos. Intenta recargar la página.</p>`; });
