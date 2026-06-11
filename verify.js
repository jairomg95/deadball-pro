/* ============================================================
   VERIFICACIÓN AUTOMÁTICA — DeadBall Manager PRO
   Se ejecuta en GitHub Actions en cada push (ver .github/workflows/verify.yml)
   y también en local:  npm i --no-save jsdom fake-indexeddb && node verify.js

   Comprueba:
   1. Sintaxis de todos los <script> inline del index.html (0 errores).
   2. Render real con jsdom + IndexedDB simulada y red bloqueada:
      la app debe montar, sembrar la BD (>0 equipos) y no lanzar errores.
   Si algo falla, el proceso sale con código 1 → la Action se pone en rojo.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const html0 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
const fail = (msg) => { failures++; console.error('✗ ' + msg); };
const ok = (msg) => console.log('✓ ' + msg);

/* ---------- 1. Sintaxis ---------- */
{
  const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0, errs = 0;
  while ((m = re.exec(html0))) {
    i++;
    try { new vm.Script(m[1]); }
    catch (e) { errs++; fail('Sintaxis script #' + i + ': ' + e.message); }
  }
  if (!errs) ok('Sintaxis: ' + i + ' scripts inline sin errores');
}

/* ---------- 2. Render headless ---------- */
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

// Librerías locales del propio repo; firebase se sustituye por un stub
// (las pruebas no tocan la nube y así no hay red).
const LIBS = ['react.production.min.js', 'react-dom.production.min.js', 'dexie.min.js'];
let html = html0.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  if (LIBS.includes(src)) return '<script>' + fs.readFileSync(path.join(ROOT, src), 'utf8') + '</script>';
  return '<script>/* stub ' + src + ' (verify) */</script>';
});

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + ((e.detail && e.detail.message) || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ').slice(0, 300)));
vc.on('warn', () => {});
vc.on('log', () => {});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.indexedDB = global.indexedDB;
    window.IDBKeyRange = global.IDBKeyRange;
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false, media: q,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}
    }));
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = clearTimeout;
    window.navigator.vibrate = () => {};
    window.addEventListener('error', (e) => errors.push('pageerror: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  }
});

setTimeout(async () => {
  const w = dom.window;
  const root = w.document.getElementById('root');
  const kids = root ? root.children.length : -1;
  if (kids > 0) ok('Render: la app monta (' + kids + ' nodos raíz)');
  else fail('Render: #root vacío — la app no montó');

  let teams = -1;
  try { if (w.db && w.db.teams) teams = await w.db.teams.count(); } catch (e) { fail('Dexie: ' + e.message); }
  if (teams > 0) ok('Dexie: BD sembrada (' + teams + ' equipos)');
  else fail('Dexie: la BD no se sembró (equipos: ' + teams + ')');

  ['dbmAlert', 'dbmConfirm', 'dbmPrompt', 'dbmTrack'].forEach((fn) => {
    if (typeof w[fn] === 'function') ok('Módulo: ' + fn + ' presente');
    else fail('Módulo: falta window.' + fn);
  });

  const errlog = (w.DBM_ERRLOG || []).length;
  if (errlog === 0) ok('DBM_ERRLOG vacío');
  else { fail('DBM_ERRLOG con ' + errlog + ' entradas'); (w.DBM_ERRLOG || []).slice(0, 5).forEach((e) => console.error('   ·', e.kind, e.msg)); }

  if (errors.length === 0) ok('Sin errores de página capturados');
  else { fail(errors.length + ' errores capturados'); errors.slice(0, 8).forEach((e) => console.error('   ·', e.slice(0, 220))); }

  console.log('');
  if (failures) { console.error('RESULTADO: FALLO (' + failures + ' problemas) — NO subir esta versión.'); process.exit(1); }
  console.log('RESULTADO: OK — seguro para desplegar.');
  process.exit(0);
}, 7000);
