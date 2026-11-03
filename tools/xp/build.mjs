// Genera ../../xp.html a partir de ../../index.html para las PCs con
// Windows XP (Chrome 49, el último que corre en XP).
//
//   cd tools/xp && npm install && npm run build
//
// Qué hace:
//  - Baja el JavaScript (de la app y de supabase-js) al nivel de Chrome 49
//    con esbuild: async/await, ?., ?? y {...obj} pasan a código que entiende.
//  - Agrega SOLO los polyfills de core-js que el código usa (babel, modo
//    "usage"), más algunos arreglos propios (shims.js).
//  - Pone los scripts al final del <body> para que el login se dibuje antes.
//  - Reemplaza CSS que Chrome 49 no entiende (grid, gap en flex, min()).
// Si index.html cambia y alguno de esos reemplazos ya no encuentra su texto,
// lo avisa en la consola.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import babel from '@babel/core';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');
const TARGET = 'chrome49';
// esbuild cree que Chrome 49 no tiene destructuring (lo completó en la 51), pero
// babel lo deja en los parámetros porque la 49 ya lo soporta.
const SOPORTA = { destructuring: true };
const avisos = [];

let html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

// --- 1. Separar el script de la app ----------------------------------------
// Es el único <script> sin src; termina en el último </script> del archivo.
const ini = /<script>\r?\n/.exec(html);
const fin = html.lastIndexOf('</script>');
if (!ini || fin < ini.index) throw new Error('No encontré el <script> de la app en index.html');
let app = html.slice(ini.index + ini[0].length, fin);
html = html.slice(0, ini.index) + '<!--SCRIPTS-XP-->' + html.slice(fin + '</script>'.length);

// supabase-js va empaquetado adentro del archivo, no desde el CDN.
const antes = html;
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"><\/script>\r?\n?/, '');
if (html === antes) avisos.push('no encontré el <script> de supabase-js en el <head>');

// --- 2. Reemplazos de texto ------------------------------------------------
function reemplazar(texto, buscar, poner, nombre) {
  const nuevo = texto.replace(buscar, poner);
  if (nuevo === texto) avisos.push(`reemplazo sin efecto: ${nombre}`);
  return nuevo;
}

html = reemplazar(html, /<title>/, '<title>[XP] ', 'título');

// pdf.js 3.x no corre en Chrome 49; la 2.6.347 compilada en ES5 sí (probado
// leyendo un PDF en Chromium 49).
const PDFJS_XP = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.6.347/es5/build/';
app = reemplazar(app, /pdfjsLib: \[[^\]]*\]/, `pdfjsLib: ['${PDFJS_XP}pdf.min.js']`, 'pdf.js para XP');
app = reemplazar(app, /const PDF_WORKER = '[^']*';/, `const PDF_WORKER = '${PDFJS_XP}pdf.worker.min.js';`, 'worker de pdf.js para XP');

// min(A, B) en anchos -> ancho fijo + max-width (Chrome < 79)
const reMin = /width:\s*min\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/g;
html = html.replace(reMin, 'width:$1; max-width:$2');
app = app.replace(reMin, 'width:$1; max-width:$2');

// Grillas de tarjetas (indicadores): grid -> flex con wrap (Chrome < 57)
const tamGrilla = new Set();
app = app.replace(/<div style="display:grid; grid-template-columns:repeat\(auto-(?:fit|fill),minmax\((\d+)px,1fr\)\); gap:(\d+)px;/g, (m, ancho, gap) => {
  tamGrilla.add(ancho + '-' + gap);
  return `<div class="xp-grilla-${ancho}-${gap}" style="display:flex; flex-wrap:wrap;`;
});
if (!tamGrilla.size) avisos.push('reemplazo sin efecto: grillas de indicadores');

// Hoja de etiquetas: grid de 3 columnas -> flex
app = reemplazar(app,
  '.hoja { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }',
  '.hoja { display: flex; flex-wrap: wrap; } .hoja > * { width: calc((100% - 6mm) / 3); margin: 0 3mm 3mm 0; page-break-inside: avoid; } .hoja > *:nth-child(3n) { margin-right: 0; }',
  'hoja de etiquetas');

// gap en flex (Chrome < 84): margenes equivalentes
const gapsInline = new Set();
for (const m of (html + app).matchAll(/gap:\s?(\d+)px/g)) gapsInline.add(m[1]);
const cssXP = `
/* --- compatibilidad con Chrome 49 / Windows XP (generado por tools/xp) --- */
.fila-form > * { margin-right: 10px; margin-bottom: 6px; }
.fila-form label > * { margin-top: 4px; }
header .usuario > * { margin-left: 12px; }
nav.tabs > * { margin-right: 2px; }
.barra-filtros > * { margin-right: 10px; }
${[...gapsInline].map(n => `[style*="gap:${n}px"] > *:not(:last-child), [style*="gap: ${n}px"] > *:not(:last-child) { margin-right: ${n}px; }`).join('\n')}
${[...tamGrilla].map(t => { const [ancho, gap] = t.split('-'); return `.xp-grilla-${t} > * { flex: 1 1 ${ancho}px; margin: 0 ${gap}px ${gap}px 0; }`; }).join('\n')}
`;
html = reemplazar(html, /<\/style>/, cssXP + '</style>', 'CSS de compatibilidad');

// --- 3. JavaScript al nivel de Chrome 49 -----------------------------------
// Babel baja la sintaxis (async/await, destructuring, ?., ??, {...obj}) y
// anota qué polyfills de core-js usa cada código; esos require() se sacan y
// se juntan en un solo paquete de polyfills.
const modulos = new Set();
function bajarAChrome49(codigo, nombre) {
  const r = babel.transformSync(codigo, {
    babelrc: false, configFile: false, sourceType: 'script', compact: false, filename: nombre,
    presets: [['@babel/preset-env', { targets: { chrome: '49' }, useBuiltIns: 'usage', corejs: '3.51', modules: false }]],
  });
  return r.code.replace(/^require\("(core-js\/modules\/[^"]+)"\);\r?\n/gm, (m, mod) => { modulos.add(mod); return ''; });
}

// La app: sin empaquetar, para que sus funciones sigan siendo globales (las
// usan los onclick="..." del HTML).
const appBajada = bajarAChrome49(app, 'app.js');
if (/require\(/.test(appBajada.slice(0, 2000))) avisos.push('quedó un require() al principio del código de la app');

const supa = await esbuild.build({
  entryPoints: [path.join(aqui, 'supabase-entry.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', charset: 'utf8',
  platform: 'browser', legalComments: 'none',
});
// Dentro de una función, para que los ayudantes de babel no queden globales.
const supaBajada = '(function(){' + bajarAChrome49(supa.outputFiles[0].text, 'supabase.js') + '\n})();';
const supaJs = (await esbuild.transform(supaBajada, { target: TARGET, supported: SOPORTA, minify: true, charset: 'utf8', legalComments: 'none' })).code;
// Estos los usa supabase-js de formas que babel no siempre ve.
['es.global-this', 'es.object.from-entries', 'es.promise.finally', 'es.string.pad-start', 'es.array.flat', 'es.object.values', 'es.object.entries', 'web.url', 'web.url-search-params', 'web.dom-collections.for-each']
  .forEach(m => modulos.add('core-js/modules/' + m));

const entradaPolyfills = [...modulos].sort().map(m => `import '${m}';`).join('\n') + `\nimport './shims.js';\n`;
const poly = await esbuild.build({
  stdin: { contents: entradaPolyfills, resolveDir: aqui, loader: 'js' },
  bundle: true, write: false, format: 'iife', target: TARGET, minify: true, charset: 'utf8', legalComments: 'none',
});
const polyJs = poly.outputFiles[0].text;

// La app se achica (espacios y comentarios) pero sin renombrar nada.
const appFinal = (await esbuild.transform(appBajada, { target: TARGET, supported: SOPORTA, minifyWhitespace: true, minifySyntax: true, charset: 'utf8' })).code;

// Un </script> dentro del código cortaría el <script> antes de tiempo.
const seguro = js => js.replace(/<\/script/gi, '<\\/script');

// --- 4. Armar xp.html --------------------------------------------------------
const scripts = [
  `<script>${seguro(polyJs)}</script>`,
  `<script>${seguro(supaJs)}</script>`,
  `<script>${seguro(appFinal)}</script>`,
].join('\n');
html = html.replace('<!--SCRIPTS-XP-->', () => scripts);

const aviso = `<!-- ARCHIVO GENERADO: no editar a mano. Se arma desde index.html con tools/xp (npm run build). -->\n`;
html = html.replace(/^(<!DOCTYPE html>\r?\n)/i, '$1' + aviso);

// Lo que todavía no entiende Chrome 49 y conviene revisar.
if (/display:\s*grid/.test(html)) avisos.push('quedó algún "display: grid" sin reemplazar');

fs.writeFileSync(path.join(raiz, 'xp.html'), html);
const kb = n => Math.round(Buffer.byteLength(n) / 1024) + ' KB';
console.log(`xp.html generado: ${kb(html)} (polyfills ${kb(polyJs)} con ${modulos.size} módulos, supabase ${kb(supaJs)}, app ${kb(appFinal)})`);
for (const a of avisos) console.warn('AVISO:', a);
