import { useState, useRef, useEffect, useCallback, createContext, useContext } from "react";

// ─── CYCLE DATES ──────────────────────────────────────────────────────────────
// W1 empezó el martes 7 abril 2026. Semana/día por defecto se calculan solos
// a partir de la fecha real, en vez de una constante fija que había que
// recordar actualizar a mano cada semana.
const CYCLE_START = new Date('2026-04-07T00:00:00');
// Al terminar el test de Semana 16 se guarda aquí la fecha de inicio del ciclo
// siguiente (día del último test guardado), sustituyendo la constante fija de
// arriba — así no hace falta tocar el código cada 15-16 semanas.
function loadCycleStart() {
  try {
    const s = localStorage.getItem('ta_cycle_start');
    if (s) return new Date(s + 'T00:00:00');
  } catch {}
  return CYCLE_START;
}
function persistCycleStart(dateStr) {
  try { localStorage.setItem('ta_cycle_start', dateStr); } catch {}
}
function computeDefaultWeekDay() {
  const start = loadCycleStart();
  const today = new Date();
  const diffDays = Math.floor((today - start) / 86400000);
  let weekIdx = Math.floor(diffDays / 7);
  weekIdx = Math.max(0, Math.min(14, weekIdx));
  const jsDay = today.getDay(); // 0=domingo..6=sábado
  const dayIdx = jsDay === 0 ? 6 : jsDay - 1; // Lunes=0..Domingo=6
  return { weekIdx, dayIdx };
}

// ─── PROGRESSION TABLE (15 semanas, 0-indexed) ───────────────────────────────
// REDISEÑO 2026-08-06. La tabla anterior era simultáneamente demasiado blanda al
// principio y aritméticamente imposible al final: 70%x7 deja ~5 repeticiones en
// reserva (a 70% del RM se pueden hacer ~12), y 100%x2 o 95%x3 piden más
// repeticiones de las que ese porcentaje permite por definición. Además
// prescribía las MISMAS repeticiones en las 4 series, cuando las tablas de
// repeticiones por porcentaje describen la primera serie en fresco: si la serie 1
// ya va al fallo, las series 2-4 son inviables.
//
// Ahora cada semana lleva su propio esquema de repeticiones POR SERIE, que baja
// conforme se acumula fatiga, y un RIR objetivo para la primera serie.
// Referencia de repeticiones máximas por carga (compuestos, sujeto entrenado):
//   70%→12 · 75%→10 · 80%→8 · 82,5%→7 · 85%→6 · 87,5%→5 · 90%→4 · 92,5%→3 · 95%→2 · 100%→1
//
// El criterio de cercanía al fallo sigue la meta-regresión de Robinson 2024
// (Sports Medicine): la hipertrofia mejora conforme baja el RIR, así que el
// bloque de acumulación trabaja a 2-3 RIR en vez de a 5.
const PROG = [
  { pct: 0.700, sets: [9, 8, 8, 7],  rir: 3, phase: 'Base',       color: '#3B82F6' }, // W1
  { pct: 0.700, sets: [10, 9, 8, 8], rir: 2, phase: 'Base',       color: '#3B82F6' }, // W2
  { pct: 0.750, sets: [8, 7, 7, 6],  rir: 2, phase: 'Base',       color: '#3B82F6' }, // W3
  { pct: 0.750, sets: [8, 8, 7, 7],  rir: 2, phase: 'Base',       color: '#3B82F6' }, // W4
  { pct: 0.800, sets: [6, 5, 5, 5],  rir: 2, phase: 'Transición', color: '#F59E0B' }, // W5
  { pct: 0.800, sets: [6, 6, 5, 5],  rir: 2, phase: 'Transición', color: '#F59E0B' }, // W6
  { pct: 0.825, sets: [5, 5, 4, 4],  rir: 2, phase: 'Transición', color: '#F59E0B' }, // W7
  { pct: 0.850, sets: [4, 4, 4, 3],  rir: 2, phase: 'Transición', color: '#F59E0B' }, // W8
  { pct: 0.875, sets: [4, 4, 3, 3],  rir: 1, phase: 'Intensidad', color: '#EF4444' }, // W9
  { pct: 0.900, sets: [3, 3, 3, 3],  rir: 1, phase: 'Intensidad', color: '#EF4444' }, // W10
  { pct: 0.925, sets: [2, 2, 2, 2],  rir: 1, phase: 'Intensidad', color: '#EF4444' }, // W11
  { pct: 0.950, sets: [2, 2, 1, 1],  rir: 0, phase: 'Intensidad', color: '#EF4444' }, // W12
  { pct: 0.975, sets: [1, 1, 1, 1],  rir: 0, phase: 'Peak',       color: '#22C55E' }, // W13
  { pct: 0.850, sets: [3, 3, 3],     rir: 3, phase: 'Peak',       color: '#22C55E' }, // W14 · descarga
  { pct: 1.000, sets: [1, 1, 1],     rir: 0, phase: 'Peak',       color: '#22C55E' }, // W15 · intento de récord
];
// Repeticiones para un número de series distinto de 4 (ej. leg curl con 8):
// se toma el esquema de la semana y se prolonga repitiendo la última serie.
function repsForSets(weekIdx, n) {
  const base = (PROG[weekIdx] || PROG[0]).sets;
  if (n <= base.length) return base.slice(0, n);
  return base.concat(Array(n - base.length).fill(base[base.length - 1]));
}

// ─── PÉRDIDA DE VELOCIDAD (autorregulación) ──────────────────────────────────
// Corta la serie cuando la velocidad de una repetición cae ese % respecto a la
// más rápida de la serie, aunque queden repeticiones en el papel.
// Básicos: Hernández-Belmonte 2022 — VL<=25% dio más fuerza con ~45% menos
// repeticiones totales. Aislamiento orientado a hipertrofia: Jukic 2023 tolera
// 30-40%. En Peak se aprieta el umbral porque ahí interesa la calidad, no el
// volumen.
const VL_BY_PHASE = {
  'Base':       { heavy: 25, other: 35 },
  'Transición': { heavy: 25, other: 35 },
  'Intensidad': { heavy: 20, other: 30 },
  'Peak':       { heavy: 15, other: 25 },
};
function vlFor(ex, weekIdx) {
  const phase = (PROG[weekIdx] || PROG[0]).phase;
  const cat = restCategory(ex);
  const t = VL_BY_PHASE[phase] || VL_BY_PHASE['Base'];
  return (cat === 'olympic' || cat === 'heavy' || cat === 'compound') ? t.heavy : t.other;
}

// Weight rounded up to nearest 2.5kg
const wt = (rm, pct) => Math.ceil(rm * pct / 2.5) * 2.5;
// Los olímpicos y el peso muerto llevan tabla propia de rampa por series, guardada
// como % del RM (no en kg): así se recalcula sola al cambiar el RM. Redondeo al
// 2,5 más cercano, no hacia arriba, para respetar la rampa original.
const wtOly = (rm, pctNum) => Math.round(rm * (pctNum / 100) / 2.5) * 2.5;

// ─── DESCANSO ENTRE SERIES ───────────────────────────────────────────────────
// Base por categoría de ejercicio (segundos) + suplemento según fase del ciclo.
//
// Evidencia:
//  · Grgic et al. (rev. sistemática, 23 estudios / 491 sujetos): en sujetos YA
//    ENTRENADOS hacen falta >2 min para maximizar las ganancias de fuerza;
//    60–120 s basta sólo en principiantes.
//  · Meta-análisis 2025 en varones entrenados: el descanso corto (<60 s) penaliza
//    fuerza (SMD −0,74) y potencia (SMD −0,64), pero NO hipertrofia (SMD 0,08, ns).
//  · Meta-análisis bayesiano 2024 (hipertrofia): suelo de 60 s; por encima de
//    ~90 s no se detecta beneficio adicional para crecimiento.
//
// Traducción práctica: los básicos pesados mandan el descanso largo (es donde se
// pierde fuerza si recortas); el aislamiento puede ir a 90 s sin coste. La
// distinción compuesto/aislamiento es extrapolación razonable — ningún
// meta-análisis la ha testado por separado.
const REST_BASE = {
  olympic:   210,  // Clean & jerk, power snatch — técnicos y a velocidad máxima
  heavy:     180,  // Básicos con barra pesada
  compound:  120,  // Multiarticulares secundarios
  isolation:  90,  // Monoarticular / cable / mancuerna
  core:       60,  // Isométricos de core
};
// A más % del RM, más descanso: el coste neural de una serie al 95% no es el de
// una al 70%.
const REST_PHASE_ADD = { 'Base': 0, 'Transición': 15, 'Intensidad': 30, 'Peak': 45 };

const REST_HEAVY = ['Bench press barbell', 'Squat barbell', 'Deadlift', 'Hip thrust'];
const REST_COMPOUND = [
  'Bench press inclined', 'Latzug breit', 'Leg curl',
  'Dips', 'Shoulder press sitting dumbbell', 'Seated row cable pull',
  'One-armed row cable pull',
];

function restCategory(ex) {
  // Deadlift está marcado como 'olympic' sólo porque usa tabla de series propia,
  // pero no es un levantamiento olímpico: descansa como básico pesado.
  if (ex.type === 'olympic' && !ex.name.startsWith('Deadlift')) return 'olympic';
  if (ex.testMethod === 'coreload') return 'core';
  if (REST_HEAVY.some(h => ex.name.startsWith(h))) return 'heavy';
  if (REST_COMPOUND.some(c => ex.name.startsWith(c))) return 'compound';
  return 'isolation';
}

function restSecondsFor(ex, weekIdx) {
  const cat = restCategory(ex);
  const phase = (PROG[weekIdx] || PROG[0]).phase;
  // El core isométrico no escala con el % de RM — no sigue la tabla percentual.
  const add = cat === 'core' ? 0 : (REST_PHASE_ADD[phase] || 0);
  return REST_BASE[cat] + add;
}

// ─── PROTOCOLO DE TEST CARGA-VELOCIDAD ───────────────────────────────────────
// Escalera de cargas del perfil carga-velocidad.
//  · Marston et al. 2022 (PLOS ONE, 25 estudios / 842 sujetos): las cargas
//    PESADAS (>=80% 1RM) son las que más pesan en la calidad del ajuste; las
//    muy ligeras aportan poco y ensucian la recta.
//  · Dello Stritto et al. 2025: acotando el rango a ~35-90% y evitando
//    velocidades por encima de 1,0 m/s en el punto más ligero, el error baja a
//    SEE 1,21-2,86 kg — muy por debajo del error típico publicado.
//  · Reps: varias a carga ligera quedándose con la más rápida; single a carga
//    pesada, con >=2 min de descanso, para que la fatiga no contamine el punto
//    que más manda.
const LV_LADDER = [
  { pct: 0.40, reps: 3 },
  { pct: 0.55, reps: 3 },
  { pct: 0.70, reps: 2 },
  { pct: 0.80, reps: 1 },
  { pct: 0.90, reps: 1 },
];
const LV_REST_SEC = 180;
const LV_VMAX_WARN = 1.0;   // por encima de esto la serie ensucia la recta

// Sobrestimación sistemática del método: Greig, Aspe, Hall, Comfort, Cooper &
// Swinton 2023 (Sports Medicine, meta-análisis de datos individuales) — el
// perfil carga-velocidad sobrestima el 1RM real en +4,5 kg = +3,7% de media,
// con independencia del modelo usado. Si no se corrige, ese sesgo se propaga a
// todos los porcentajes del ciclo siguiente.
const LV_OVERESTIMATE = 0.037;
// Error estándar de estimación por ejercicio (mismo meta-análisis): agrupado
// 9,8%; press banca 9,9%; sentadilla 12,3%; peso muerto 8,0%. La sentadilla
// libre es el peor caso — Banyard 2017 midió un CV del 22,5% en la velocidad
// a 1RM, que es lo que hunde la precisión.
const LV_SEE = { 'Bench press barbell': 0.099, 'Squat barbell': 0.123, 'Deadlift barbell': 0.080 };
const LV_SEE_DEFAULT = 0.098;
const seeFor = (name) => LV_SEE[name] ?? LV_SEE_DEFAULT;

function fmtClock(s) {
  const m = Math.floor(Math.abs(s) / 60);
  const sec = Math.abs(s) % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Nº de series que muestra cada tipo de fila, para que el contador sepa cuántas
// rondas de descanso quedan.
function setsCountFor(ex, weekIdx) {
  if (ex.byPhase) {
    const b = ex.byPhase[(PROG[weekIdx] || PROG[0]).phase];
    if (b) return b.sets.length;
  }
  if (ex.type === 'bw' && ex.repsByPhase) {
    const r = ex.repsByPhase[(PROG[weekIdx] || PROG[0]).phase];
    return Array.isArray(r) ? r.length : 4;
  }
  if (ex.setCount) return ex.setCount;
  return (PROG[weekIdx] || PROG[0]).sets.length;   // varía por semana (4, y 3 en descarga y test)
}

// ─── SENTADILLA DE VOLUMEN (miércoles) ───────────────────────────────────────
// Segunda exposición semanal de cuádriceps. Intensidad y repeticiones propias:
// la tabla PROG baja a series de 1 en Peak, y aquí lo que se busca es estímulo
// de hipertrofia constante a 2-3 RIR, no intensidad. Sábado→miércoles son 4 días
// y miércoles→sábado 3: el reparto más simétrico posible en la semana.
const VOLUME_SQUAT = {
  'Base':       { pct: 0.68, sets: [10, 9, 9, 8] },
  'Transición': { pct: 0.70, sets: [10, 9, 9, 8] },
  'Intensidad': { pct: 0.72, sets: [9, 8, 8, 7] },
  'Peak':       { pct: 0.70, sets: [8, 8, 7] },
};

// ─── MANCUERNAS REALES ────────────────────────────────────────────────────────
// ⚠️ Ajusta este array a las mancuernas que tienes de verdad en el gimnasio.
const DUMBBELL_WEIGHTS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
function nearestDumbbell(target) {
  const avail = DUMBBELL_WEIGHTS.filter(w => w <= target);
  if (avail.length === 0) return DUMBBELL_WEIGHTS[0];
  return avail[avail.length - 1];
}
// Estimación de 1RM a partir de un test de repeticiones (fórmula Epley) —
// la forma estándar de estimar RM en ejercicios de mancuerna, donde el peso
// es discreto y no tiene sentido buscar un 1RM real por riesgo/precisión.
function epley1RM(weight, reps) {
  return weight * (1 + reps / 30);
}

// ─── RM: OVERRIDES GUARDADOS TRAS EL TEST (localStorage) ─────────────────────
function loadRM() {
  try { const s = localStorage.getItem('ta_rm'); return s ? JSON.parse(s) : {}; }
  catch { return {}; }
}
function persistRM(store) {
  try { localStorage.setItem('ta_rm', JSON.stringify(store)); } catch {}
}
function effectiveRM(ex, rmStore) {
  const o = rmStore[ex.rmRef || ex.name];
  return o ? o.rm : ex.rm;
}

// ─── HISTORIAL DE RM: cada test guardado se acumula aquí (no se sobrescribe),
// para poder ver la evolución por ejercicio a lo largo de los ciclos.
// Empieza a registrar desde el primer guardado tras esta actualización — los
// valores previos, al no haberse guardado con fecha, no se pueden reconstruir.
function loadRMHistory() {
  try { const s = localStorage.getItem('ta_rm_history'); return s ? JSON.parse(s) : {}; }
  catch { return {}; }
}
function persistRMHistory(store) {
  try { localStorage.setItem('ta_rm_history', JSON.stringify(store)); } catch {}
}

// ─── MVT PERSONAL: sobrescribe el valor de literatura por ejercicio, una vez
// que se ha medido la velocidad real a una carga cercana/igual al 1RM propio.
// Se guarda por nombre de ejercicio y persiste entre ciclos (localStorage).
function loadMVT() {
  try { const s = localStorage.getItem('ta_mvt'); return s ? JSON.parse(s) : {}; }
  catch { return {}; }
}
function persistMVT(store) {
  try { localStorage.setItem('ta_mvt', JSON.stringify(store)); } catch {}
}
function effectiveMVT(ex, mvtStore) {
  const o = mvtStore[ex.name];
  return o ? o.value : ex.mvt;
}
// ─── OLYMPIC SETS: [s1w, s1r, s2w, s2r, s3w, s3r, s4w, s4r] per week ────────
const CJ_PCT = [   // [% del RM, reps] x 4 series
  [68,5,77,4,80,4,84,3],       // W1
  [68,5,77,4,80,4,86,3],       // W2
  [80,4,80,4,86,4,91,2],       // W3
  [80,4,84,3,89,3,91,2],       // W4
  [80,4,84,3,89,2,95,1],       // W5
  [84,3,84,3,89,2,95,1],       // W6
  [84,3,84,3,91,1,95,1],       // W7
  [84,3,86,3,91,1,98,1],       // W8
  [84,3,86,3,95,1,98,1],       // W9
  [84,3,86,3,95,1,98,1],       // W10
  [84,3,89,2,95,1,100,1],      // W11
  [86,3,91,1,98,1,100,1],      // W12
  [86,2,91,1,98,1,100,1],      // W13
  [91,1,95,1,98,1,100,1],      // W14
  [91,1,95,1,98,1,105,1],      // W15
];

const PS_PCT = [   // [% del RM, reps] x 4 series
  [70,5,77,4,80,4,83,3],       // W1
  [70,5,77,4,80,4,87,3],       // W2
  [80,4,80,4,87,4,90,2],       // W3
  [80,4,83,3,88,3,92,2],       // W4
  [80,4,83,3,90,2,97,1],       // W5
  [83,3,83,3,90,2,97,1],       // W6
  [83,3,83,3,90,1,97,1],       // W7
  [83,3,87,3,90,1,100,1],      // W8
  [83,3,87,3,97,1,100,1],      // W9
  [83,3,87,3,97,1,100,1],      // W10
  [83,3,87,2,97,1,100,1],      // W11
  [87,3,90,1,100,1,100,1],     // W12
  [87,2,90,1,100,1,100,1],     // W13
  [90,1,97,1,100,1,100,1],     // W14
  [90,1,97,1,100,1,103,1],     // W15
];

const DL_PCT = [   // [% del RM, reps] x 4 series
  [69,6,75,5,77,5,81,4],       // W1
  [69,6,75,5,77,5,85,4],       // W2
  [77,5,77,5,85,4,92,2],       // W3
  [77,5,83,4,88,3,92,2],       // W4
  [77,5,83,4,88,3,96,1],       // W5
  [81,4,83,4,88,3,96,1],       // W6
  [81,4,83,4,92,2,96,1],       // W7
  [81,4,85,3,92,2,98,1],       // W8
  [81,3,85,3,96,1,98,1],       // W9
  [81,3,85,3,96,1,98,1],       // W10
  [81,3,88,2,96,1,100,1],      // W11
  [85,3,92,1,98,1,100,1],      // W12
  [85,2,92,1,98,1,100,1],      // W13
  [92,1,96,1,98,1,100,1],      // W14
  [92,1,96,1,98,1,104,1],      // W15
];

// ─── DIPS: reps por serie y por fase ─────────────────────────────────────────
// Antes subía linealmente (8+semana, tope 15) sin mirar el rendimiento real.
// Reporte real en Peak: 14/8/8/8 — gran caída entre la serie 1 y las demás.
// En vez de un número plano igual en las 4 series, cada fase tiene su propio
// perfil de 4 series que respeta esa caída de fatiga, y solo sube de fase en
// fase (igual que fuerza y nutrición), no semana a semana.
const DIPS_REPS = {
  'Base':       [10, 7, 6, 6],
  'Transición': [12, 7, 7, 6],
  'Intensidad': [13, 8, 7, 7],
  'Peak':       [14, 8, 8, 8],
};

// ─── CORE: añadido solo el Sábado, tras sentadilla/peso muerto ──────────────
// Sentadilla, peso muerto y olímpicos entrenan el core como estabilizador
// isométrico, pero no entrenan directamente la resistencia a la rotación ni a
// la extensión de tronco — son los dos patrones que más protegen la zona
// lumbar cuando sube la carga en esos mismos levantamientos. Se descarta el
// crunch en polea (flexión de tronco cargada) porque no aporta el mismo
// traspaso a la sentadilla/peso muerto, que exigen resistir la EXTENSIÓN, no
// la flexión — y ya hay más que suficiente flexión de columna en el trabajo
// diario sin necesidad de cargarla más. Ambos ejercicios usan material que ya
// tienes en el gimnasio (polea de cable y un disco), cero impacto en rodilla.
// Isométrico (aguante estático en extensión) en vez de repeticiones de
// empuje-vuelta: en sentadilla/peso muerto el tronco no se mueve, aguanta
// rígido mientras se mueven las extremidades — el hold estático se parece más
// a esa demanda real que una repetición dinámica, y de paso queda coherente
// con la plancha (mismo formato: carga + tiempo aguantado).
const PALLOF_SECONDS = {  // segundos aguantados por lado, 3 series — anti-rotación en polea
  'Base':       [20, 20, 20],
  'Transición': [25, 22, 20],
  'Intensidad': [30, 25, 22],
  'Peak':       [35, 30, 25],
};
const PLANK_SECONDS = {  // segundos por serie, 3 series — plancha con disco sobre la espalda (anti-extensión)
  'Base':       [30, 30, 30],
  'Transición': [40, 35, 30],
  'Intensidad': [45, 40, 35],
  'Peak':       [50, 45, 40],
};

// ─── DESCARGA DE CODO (20/08/2026 → revisar el 02/09/2026) ──────────────────
// El 19/08, primera sesión de tríceps del ciclo nuevo, apareció ardor en la
// inserción medial del tríceps, en el codo. Solo bajo carga, nada en reposo, y
// SOLO en las extensiones en polea: press banca, inclinado y fondos fueron
// perfectos ese mismo día. Eso descarta sobrecarga sistémica del tríceps (los
// fondos son la carga más alta de la sesión) y apunta al patrón de extensión,
// donde la polea mantiene tensión máxima en el bloqueo final del codo — que es
// justo donde trabaja la cabeza medial y donde banca y fondos ya no llegan.
// Causa más probable: el RM de este ejercicio subió de 30 a 39 kg en el test de
// agosto (+30 %) y ésta era la primera sesión aplicándolo.
// Medida: −18 % de carga dos semanas, manteniendo repeticiones. La irritación de
// inserción responde a bajar el PICO de tensión, no el trabajo total.
//
// ⚠ CÓMO SE IMPLEMENTA, Y POR QUÉ ASÍ (corregido 20/08/2026).
// La primera versión bajaba el `rm` del código de 46,5 a 38 y de 39 a 32. Eso
// NO funciona en un dispositivo que tenga los RM del test de agosto guardados:
// `effectiveRM` da prioridad al valor de `localStorage` (§8 de memoria.md), así
// que el móvil habría seguido calculando con 46,5 y la descarga no habría
// existido justo donde importa. Y de paso el banner de "RM descuadrado" saltaba
// contra su propia descarga.
// Ahora el RM se queda en el REAL y la descarga es un factor aparte que se
// aplica al peso final. Sobrevive a lo guardado, la pestaña Test sigue
// mostrando el máximo verdadero y el registro no se ensucia.
const ELBOW_NOTE = 'NO bloquees el codo del todo al final del recorrido: el pico de tensión en el bloqueo es lo que irrita la inserción. Mantén las repeticiones del plan. Si vuelve a quemar con la carga ya bajada, párate y dilo — entonces el problema es de volumen, no de peso.';
const DELOAD_ELBOW = {
  factor: 0.82,               // −18 %
  until: '2026-09-02',
  label: 'Descarga de codo',
  why: 'Irritación de la inserción medial del tríceps (19/08). Baja el pico de tensión, no el volumen.',
};
// Devuelve el estado de una descarga: activa siempre (nunca se retira sola —
// la vuelta se decide mirando el codo, no el calendario), pero avisa cuando la
// fecha de revisión ya ha pasado.
function deloadStatus(dl) {
  if (!dl) return null;
  const due = new Date(dl.until + 'T00:00:00');
  const overdue = new Date() >= due;
  const pct = Math.round((1 - dl.factor) * 100);
  return { pct, overdue, dateLabel: due.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) };
}

// ─── DAY DEFINITIONS ─────────────────────────────────────────────────────────
// type: 'non-olympic' | 'olympic' | 'bw' (bodyweight)
// testMethod: 'video' (velocidad + regresión carga-velocidad) · 'ladder' (registro
// directo del peso máximo con técnica limpia) · 'repmax' (test de reps + fórmula,
// para ejercicios de mancuerna con pesos disponibles discretos)
const DAYS = [
  {
    name: 'Lunes', label: 'ArmDay', emoji: '💪', nutriDay: 'A',
    exercises: [
      // DESCARGA DE CODO 20/08/2026 → revisar el 02/09. El RM se queda en el real
      // y el −18 % se aplica como factor, para que no lo pise el valor guardado.
      { name: 'Triceps stretches cable pull bar',  rm: 46.5, unit: 'kg',   testMethod: 'repmax', deload: DELOAD_ELBOW, note: ELBOW_NOTE },
      { name: 'Triceps extension cable pull cord', rm: 39, unit: 'kg',     testMethod: 'repmax', deload: DELOAD_ELBOW, note: ELBOW_NOTE },
      // ELIMINADO DEL PLAN 24/08/2026 (decisión del usuario). Estuvo suspendido
      // desde el 20/08 por la irritación de codo. El trabajo directo de tríceps se
      // queda en barra + cuerda, y los fondos como tercer movimiento.
      // Nota para el histórico: su RM de 28 kg/brazo parecía imposible (56 kg a dos
      // manos frente a 46,5 y 39 de las versiones bilaterales). Se explicó el
      // 24/08: se había anotado aplicando el falso ×1,5. El real serían ~18,7.
      { name: 'Bicep curls cable pull',            rm: 36, unit: 'kg',     testMethod: 'repmax' },
      { name: 'Bicep curls sitting dumbbell',      rm: 17,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Bicep curls hammer grip seated',    rm: 17.5,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Seated lateral raises dumbbell',    rm: 17,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, setCount: 6 },
      { name: 'Shoulder press sitting dumbbell',   rm: 26.5, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Butterfly reverse cable pull',      rm: 10.5, unit: 'kg/arm', testMethod: 'repmax', step: 1.5,
        note: 'Torre de flys/butterfly: escalones de 1,5 kg y el número impreso son KILOS REALES (1:1, verificado 24/08/2026). RM corregido de 16 a 10,5 el 24/08 — el 16 se había anotado aplicando un ×1,5 que no existe.' },
    ]
  },
  {
    name: 'Martes', label: 'BackDay', emoji: '🏋️', nutriDay: 'B',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 110, unit: 'kg', type: 'olympic', sets: CJ_PCT, testMethod: 'ladder' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS_PCT, testMethod: 'ladder' },
      { name: 'Latzug breit (lat pulldown)', rm: 97.5,unit: 'kg', testMethod: 'ladder' },
      { name: 'Seated row cable pull',       rm: 91,  unit: 'kg',     testMethod: 'repmax' },
      { name: 'One-armed row cable pull',    rm: 45.5,  unit: 'kg/arm', testMethod: 'repmax' },
    ]
  },
  {
    name: 'Miércoles', label: 'Piernas ligeras & Movilidad', emoji: '🦵', nutriDay: 'A',
    special: 'stretch',
    exercises: [
      { name: 'Squat barbell (volumen)', rmRef: 'Squat barbell', rm: 140, unit: 'kg',
        byPhase: VOLUME_SQUAT,
        note: 'Segunda exposición de cuádriceps en la semana. Profundidad completa y controlado — busca 2-3 repeticiones en reserva, no llegues al fallo. Si notas la rodilla, este es el primer bloque que se recorta.' },
    ]
  },
  {
    name: 'Jueves', label: 'ChestDay', emoji: '🏋️', nutriDay: 'C',
    exercises: [
      { name: 'Bench press barbell',               rm: 102,  unit: 'kg', testMethod: 'video', mvt: 0.17 },
      { name: 'Bench press inclined barbell',      rm: 85, unit: 'kg', testMethod: 'ladder' },
      { name: 'Flys standing cable pull',          rm: 15, unit: 'kg/arm', testMethod: 'repmax', step: 1.5,
        note: 'Misma torre que el butterfly reverse: escalones de 1,5 kg, número impreso = kilos reales (1:1, verificado 24/08/2026). RM corregido de 23 a 15 el 24/08 — el 23 se había anotado aplicando un ×1,5 que no existe.' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS },
      // ORDEN CAMBIADO 20/08/2026: el shoulder press sube por delante del tríceps.
      // Iba el último de siete, detrás de banca, inclinado, flys, fondos y dos de
      // tríceps — los seis usan tríceps, así que medía fatiga de tríceps y no
      // fuerza de hombro (19/08: salió 5-6-5-2 contra un 9-8-8-7 prescrito).
      { name: 'Shoulder press sitting dumbbell',   rm: 26.5,   unit: 'kg/arm', testMethod: 'repmax', dumbbell: true,
        note: 'Va antes del tríceps desde el 20/08/2026. Si aun así no salen las repeticiones del plan, entonces sí es el RM y hay que retestearlo en fresco.' },
      // DESCARGA DE CODO 20/08/2026 → revisar el 02/09. RM real, factor aparte.
      { name: 'Triceps extension cable pull cord', rm: 39,   unit: 'kg', testMethod: 'repmax', deload: DELOAD_ELBOW, note: ELBOW_NOTE },
      // ELIMINADO DEL PLAN 24/08/2026 — ver comentario en el bloque del Lunes.
    ]
  },
  {
    name: 'Viernes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 110, unit: 'kg', type: 'olympic', sets: CJ_PCT, testMethod: 'ladder' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS_PCT, testMethod: 'ladder' },
      { name: 'Latzug breit (lat pulldown)', rm: 97.5,unit: 'kg', testMethod: 'ladder' },
      { name: 'Seated row cable pull',       rm: 91,  unit: 'kg',     testMethod: 'repmax' },
      { name: 'One-armed row cable pull',    rm: 45.5,  unit: 'kg/arm', testMethod: 'repmax' },
      { name: 'Seated lateral raises dumbbell', rm: 17,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, setCount: 4 },
      { name: 'Butterfly reverse cable pull', rm: 10.5,  unit: 'kg/arm', testMethod: 'repmax', step: 1.5,
        note: 'Torre de flys/butterfly: escalones de 1,5 kg y el número impreso son KILOS REALES (1:1, verificado 24/08/2026). RM corregido de 16 a 10,5 el 24/08 — el 16 se había anotado aplicando un ×1,5 que no existe.' },
    ]
  },
  {
    name: 'Sábado', label: 'LegDay', emoji: '🦵', nutriDay: 'B',
    exercises: [
      { name: 'Deadlift barbell',   rm: 180, unit: 'kg', type: 'olympic', sets: DL_PCT, testMethod: 'ladder' },
      { name: 'Squat barbell',      rm: 140, unit: 'kg', testMethod: 'video', mvt: 0.30 },
      { name: 'Leg curl machine',   rm: 97.5,  unit: 'kg', testMethod: 'repmax', setCount: 8,
        note: 'Sin Nordic curl: da el tirón fuerte para contraer y luego frena la vuelta controlando la fase excéntrica en vez de soltarla — es el mismo principio (énfasis en la parte excéntrica) sin necesitar la fuerza de un Nordic curl completo.' },
      { name: 'Hip thrust machine', rm: 140, unit: 'kg', testMethod: 'ladder' },
      { name: 'Pallof press cable (hold isométrico)', type: 'bw', repsByPhase: PALLOF_SECONDS,
        equipLabel: 'Anti-rotación · por lado', unitSuffix: 's/lado',
        note: 'De pie, perpendicular a la polea. Extiende los brazos al frente y AGUANTA ahí quieto sin dejar que la cadera gire — es un aguante estático, no repeticiones de empuje y vuelta. Repite el hold en cada serie, cambia de lado al terminar las 3 series.',
        rm: 15, unit: 'kg', testMethod: 'coreload',
        testTarget: '35s/lado por serie (objetivo de fase Peak, el más exigente de las 4)',
        formCue: 'la cadera gire' },
      { name: 'Weighted plank (disco en la espalda)', type: 'bw', repsByPhase: PLANK_SECONDS,
        equipLabel: 'Anti-extensión · con disco', unitSuffix: 's',
        note: 'Empieza con 5-10kg sobre la zona lumbar-alta. Si aguantas el tiempo objetivo con técnica limpia (sin que caiga la cadera), sube el disco de peso antes de subir el tiempo.',
        rm: 10, unit: 'kg', testMethod: 'coreload',
        testTarget: '50s por serie (objetivo de fase Peak, el más exigente de las 4)',
        formCue: 'caiga la cadera' },
    ]
  },
  {
    name: 'Domingo', label: 'ChestDay', emoji: '🏋️', nutriDay: 'C',
    exercises: [
      { name: 'Bench press barbell',               rm: 102,  unit: 'kg', testMethod: 'video', mvt: 0.17 },
      { name: 'Bench press inclined barbell',      rm: 85, unit: 'kg', testMethod: 'ladder' },
      { name: 'Flys standing cable pull',          rm: 15, unit: 'kg/arm', testMethod: 'repmax', step: 1.5,
        note: 'Misma torre que el butterfly reverse: escalones de 1,5 kg, número impreso = kilos reales (1:1, verificado 24/08/2026). RM corregido de 23 a 15 el 24/08 — el 23 se había anotado aplicando un ×1,5 que no existe.' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS },
    ]
  },
];

// Días de test (semana 16) — Miércoles, Viernes y Domingo quedan como descanso
// porque repiten ejercicios ya cubiertos en Lunes/Martes/Jueves/Sábado.
const TEST_DAY_NAMES = ['Lunes', 'Martes', 'Jueves', 'Sábado'];

// ─── ORDEN DE TEST: SEPARAR EJERCICIOS DEL MISMO MÚSCULO ─────────────────────
// El orden del día de ENTRENAMIENTO (arriba, en DAYS) está pensado para la
// sesión normal. Para TESTEAR el máximo de cada ejercicio ese orden es
// contraproducente si agrupa varios ejercicios del mismo músculo seguidos: la
// fatiga residual del primero deprime el máximo medido en el segundo y el
// tercero, y ese número deprimido es justo el que se guarda como RM para todo
// el ciclo siguiente.
//
// Es una recomendación estándar en protocolos de test de 1RM, no una opinión:
//  · Guía ACI de test de 1RM: empezar por el músculo/multiarticular más
//    grande y "alternar ejercicios de tren superior/inferior y/o grupos
//    musculares agonistas/antagonistas" para minimizar la fatiga.
//  · El estudio que valida un único día de test con 8 ejercicios (fiabilidad
//    ICC 0,911–0,993, sin necesidad de sesión de confirmación) evitó
//    deliberadamente testear dos ejercicios del mismo músculo seguidos — la
//    fiabilidad que reportan no cubre el caso de tu Lunes actual (3 series de
//    tríceps seguidas, luego 3 de bíceps seguidas).
//
// Antes: Lunes testeaba tríceps×3 seguidos y luego bíceps×3 seguidos; Sábado
// testeaba leg curl y Nordic curl (los dos, isquiotibiales) uno detrás de
// otro; Jueves testeaba tres ejercicios de pecho/empuje seguidos. Ahora se
// reordena por músculo con un reparto tipo "task scheduler": coloca primero el
// grupo con más ejercicios pendientes, nunca repitiendo el músculo del
// ejercicio anterior si hay alternativa.
const MUSCLE_TAG = {
  'Triceps stretches cable pull bar':  'triceps',
  'Triceps extension cable pull cord': 'triceps',
  'Triceps extension one-armed cable': 'triceps',
  'Bicep curls cable pull':            'biceps',
  'Bicep curls sitting dumbbell':      'biceps',
  'Bicep curls hammer grip seated':    'biceps',
  'Seated lateral raises dumbbell':    'hombro',
  'Shoulder press sitting dumbbell':   'hombro',
  'Butterfly reverse cable pull':      'hombro',
  'Bench press barbell':               'pecho',
  'Bench press inclined barbell':      'pecho',
  'Flys standing cable pull':          'pecho',
  'Leg curl machine':                  'isquios',
  'Seated row cable pull':             'espalda',
  'One-armed row cable pull':          'espalda',
};

function interleaveByMuscle(list) {
  const groups = new Map();
  list.forEach(ex => {
    const tag = MUSCLE_TAG[ex.name] || `__solo__${ex.name}`; // sin tag = grupo propio, no restringe nada
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(ex);
  });
  const buckets = Array.from(groups.entries()).map(([tag, items]) => ({ tag, items, idx: 0 }));
  const result = [];
  let lastTag = null;
  while (result.length < list.length) {
    const pending = buckets.filter(b => b.idx < b.items.length);
    const preferred = pending.filter(b => b.tag !== lastTag);
    const pool = preferred.length ? preferred : pending; // forzado sólo si no queda otra opción
    pool.sort((a, b) => (b.items.length - b.idx) - (a.items.length - a.idx));
    const chosen = pool[0];
    result.push(chosen.items[chosen.idx]);
    chosen.idx += 1;
    lastTag = chosen.tag;
  }
  return result;
}

// Orden en el que cada ejercicio COMPARTIDO entre dos días (p.ej. las dos
// extensiones de tríceps que aparecen tanto en Lunes como en Jueves) se
// "reclama" para deduplicarlo. Importa: si se reclamaran en el orden de
// visualización (Lunes antes que Jueves), Lunes se quedaría con tríceps +
// bíceps + hombro (interleaving posible) pero Jueves se quedaría SOLO con
// tres ejercicios de pecho seguidos (bench, bench inclinado, flys) — el mismo
// problema de fatiga acumulada que se acaba de corregir arriba, sin nada con
// que intercalarlo porque no quedaría ningún ejercicio de otro músculo ese
// día. Reclamando primero para Jueves, ese día pasa a tener pecho + tríceps
// (interleaveable) y Lunes se queda con tríceps(1) + bíceps(3) + hombro(3)
// (también interleaveable). El orden de visualización en la pestaña de test
// sigue siendo Lunes→Martes→Jueves→Sábado; esto solo cambia a quién se le
// "asigna" cada ejercicio repetido antes de intercalar.
const TEST_CLAIM_ORDER = ['Jueves', 'Lunes', 'Martes', 'Sábado'];

function buildTestPlan() {
  const seen = new Set();
  const rawByDay = {};
  TEST_CLAIM_ORDER.forEach(dayName => {
    const day = DAYS.find(d => d.name === dayName);
    const list = [];
    (day.exercises || []).forEach(ex => {
      if (!ex.testMethod) return;         // ej. Dips — progresa solo por reps, sin carga que testear
      if (seen.has(ex.name)) return;      // evita testear dos veces el mismo ejercicio
      seen.add(ex.name);
      list.push(ex);
    });
    rawByDay[dayName] = list;
  });
  const byDay = {};
  TEST_DAY_NAMES.forEach(dayName => { byDay[dayName] = interleaveByMuscle(rawByDay[dayName]); });
  return byDay;
}

// ─── WEDNESDAY STRETCHES ─────────────────────────────────────────────────────
// totalSec/sets alimentan el timer (HoldButton) del miércoles: para los
// bloques de piscina no hay series (sets:1, cuenta atrás única); para los
// estiramientos, totalSec toma el extremo alto del rango "45–60 s" como
// objetivo — el ±15s de la barra deja bajarlo a 45 si hace falta.
const STRETCHES = [
  // Prioritarios — 5 min/semana cada uno. La meseta de ganancia está en 10
  // min/semana por grupo muscular (Warneke 2024, meta-regresión de 189 estudios);
  // antes se hacían 4 min de cada uno, menos de la mitad de la dosis útil.
  { name: 'Sóleo y gemelo en pared (dorsiflexión)', duration: '5 × 60 s', totalSec: 60, sets: 5,
    cue: 'Rodilla hacia la pared sin despegar el talón. Repite con la rodilla estirada para el gemelo y flexionada para el sóleo. Es el limitador habitual de la profundidad de sentadilla: si falta tobillo, compensa la rodilla.' },
  { name: 'Isquiotibiales sentado',                 duration: '5 × 60 s', totalSec: 60, sets: 5,
    cue: 'Espalda recta, giro desde la cadera. Es el grupo con mayor respuesta documentada al estiramiento.' },
  { name: 'Dorsal ancho colgado en barra',          duration: '5 × 60 s', totalSec: 60, sets: 5,
    cue: 'Colgado o con las manos en un soporte alto, deja caer el pecho. El dorsal es el principal limitador de la posición sobre la cabeza en snatch y clean & jerk.' },
  { name: 'Flexores de cadera en zancada',          duration: '5 × 60 s', totalSec: 60, sets: 5,
    cue: 'Glúteo apretado y pelvis retrovertida; si arqueas la lumbar no estás estirando el psoas.' },
  { name: 'Aductores de pie',                       duration: '5 × 60 s', totalSec: 60, sets: 5 },
  { name: 'Glúteo sentado',                         duration: '5 × 60 s', totalSec: 60, sets: 5 },
  { name: 'Cuádriceps de pie',                      duration: '5 × 60 s', totalSec: 60, sets: 5 },
  // Mantenimiento y descarga de tensión — 3 min/semana.
  { name: 'Extensión torácica sobre banco',         duration: '3 × 60 s', totalSec: 60, sets: 3,
    cue: 'Codos en el banco y pecho hacia el suelo. Junto con el dorsal, es lo que abre la posición por encima de la cabeza.' },
  { name: 'Trapecio y cuello lateral',              duration: '3 × 60 s', totalSec: 60, sets: 3 },
  { name: 'Hombro cruzado',                         duration: '3 × 60 s', totalSec: 60, sets: 3 },
];

// ─── GUÍA VISUAL DE ESTIRAMIENTOS ────────────────────────────────────────────
// Cada entrada lleva el dibujo (SVG en línea, sin dependencias ni imágenes
// externas) y las claves de ejecución que se abren desde el botón "?" de cada
// tarjeta del miércoles. Código de color del dibujo: extremidad clara = lado
// cercano, gris azulada = lado lejano, naranja = músculo que debe tirar,
// flecha naranja = dirección del movimiento.
const STRETCH_GUIDE = {
  "Sóleo y gemelo en pared (dorsiflexión)": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 140 28 L 140 200"/><path class="envs" d="M 138.5 36 L 131 44"/><path class="envs" d="M 138.5 48 L 131 56"/><path class="envs" d="M 138.5 60 L 131 68"/><path class="envs" d="M 138.5 72 L 131 80"/><path class="envs" d="M 138.5 84 L 131 92"/><path class="envs" d="M 138.5 96 L 131 104"/><path class="envs" d="M 138.5 108 L 131 116"/><path class="envs" d="M 138.5 120 L 131 128"/><path class="envs" d="M 138.5 132 L 131 140"/><path class="envs" d="M 138.5 144 L 131 152"/><path class="envs" d="M 138.5 156 L 131 164"/><path class="envs" d="M 138.5 168 L 131 176"/><path class="envs" d="M 138.5 180 L 131 188"/><path class="envs" d="M 138.5 192 L 131 200"/><path class="env" d="M 140 200 L 352 200"/><path class="envs" d="M 148 201.5 L 140 209"/><path class="envs" d="M 160 201.5 L 152 209"/><path class="envs" d="M 172 201.5 L 164 209"/><path class="envs" d="M 184 201.5 L 176 209"/><path class="envs" d="M 196 201.5 L 188 209"/><path class="envs" d="M 208 201.5 L 200 209"/><path class="envs" d="M 220 201.5 L 212 209"/><path class="envs" d="M 232 201.5 L 224 209"/><path class="envs" d="M 244 201.5 L 236 209"/><path class="envs" d="M 256 201.5 L 248 209"/><path class="envs" d="M 268 201.5 L 260 209"/><path class="envs" d="M 280 201.5 L 272 209"/><path class="envs" d="M 292 201.5 L 284 209"/><path class="envs" d="M 304 201.5 L 296 209"/><path class="envs" d="M 316 201.5 L 308 209"/><path class="envs" d="M 328 201.5 L 320 209"/><path class="envs" d="M 340 201.5 L 332 209"/><path class="sk2" d="M 239.88 119.67 L 275.13 156.56 A 9.5 9.5 0 0 0 289.91 144.74 L 261.66 102.25 A 14 14 0 1 0 239.88 119.67 Z"/><path class="sk2" d="M 273.02 153.10 L 287.86 196.12 A 6.5 6.5 0 0 0 300.37 192.71 L 291.31 148.11 A 9.5 9.5 0 1 0 273.02 153.10 Z"/><path class="sk2" d="M 281.21 204.33 L 295.75 200.26 A 6.5 6.5 0 1 0 290.68 188.41 L 277.70 196.13 A 4.5 4.5 0 0 0 281.21 204.33 Z"/><path class="sk2" d="M 293.07 200.43 L 317.43 203.96 A 4 4 0 0 0 319.36 196.24 L 296.21 187.89 A 6.5 6.5 0 1 0 293.07 200.43 Z"/><path class="sk2" d="M 249.48 52.22 L 216.24 71.51 A 7.5 7.5 0 0 0 223.25 84.76 L 257.90 68.11 A 9 9 0 1 0 249.48 52.22 Z"/><path class="sk2" d="M 219.74 70.50 L 175.80 72.00 A 6 6 0 0 0 175.80 84.00 L 219.74 85.50 A 7.5 7.5 0 1 0 219.74 70.50 Z"/><path class="sk" d="M 233.00 57.60 L 232.00 109.65 A 18 18 0 0 0 267.84 112.41 L 274.81 60.81 A 21 21 0 1 0 233.00 57.60 Z"/><circle class="sk" cx="258" cy="36" r="14"/><path class="hair" d="M 264.6 23.4 A 14.280000000000001 14.280000000000001 0 0 1 272.2 37.5 A 14.280000000000001 14.280000000000001 0 0 1 261.9 49.7 Z"/><path class="sk" d="M 245.0 38.3 L 240.2 33.8 L 246.0 30.6 Z"/><circle class="eye" cx="250.0" cy="37.6" r="1.5"/><path class="ln" d="M 249.0 28.0 L 257.9 31.8"/><path class="sk" d="M 239.18 101.12 L 204.27 143.66 A 10 10 0 0 0 218.73 157.39 L 259.42 120.35 A 14 14 0 1 0 239.18 101.12 Z"/><path class="sk" d="M 202.91 145.84 L 182.09 191.29 A 6.5 6.5 0 0 0 193.48 197.50 L 220.42 155.39 A 10 10 0 1 0 202.91 145.84 Z"/><path class="sk" d="M 200.94 196.60 L 192.25 189.08 A 6.5 6.5 0 1 0 185.66 200.06 L 196.38 204.20 A 4.5 4.5 0 0 0 200.94 196.60 Z"/><path class="sk" d="M 192.29 189.12 L 146.64 149.00 A 4 4 0 0 0 141.12 154.78 L 183.32 198.51 A 6.5 6.5 0 1 0 192.29 189.12 Z"/><path class="hl" d="M 202.84 153.42 L 181.36 187.04 A 5.5 5.5 0 0 0 190.14 193.62 L 216.40 163.60 A 8.5 8.5 0 1 0 202.84 153.42 Z"/><path class="sk" d="M 252.64 49.10 L 216.86 54.59 A 7.5 7.5 0 0 0 218.52 69.48 L 254.62 66.98 A 9 9 0 1 0 252.64 49.10 Z"/><path class="sk" d="M 218.08 54.50 L 170.06 54.00 A 6 6 0 0 0 169.56 65.98 L 217.45 69.48 A 7.5 7.5 0 1 0 218.08 54.50 Z"/><path class="ar" d="M 300 116 C 274 108 250 112 232 124"/><path class="lead" d="M 172 60 L 124 49"/><circle class="ldot" cx="172" cy="60" r="2.3"/><text class="lbl" x="118" y="52" text-anchor="end"><tspan x="118" dy="0">Manos apoyadas</tspan><tspan x="118" dy="10.5">en la pared</tspan></text><path class="lead" d="M 152 162 L 124 99"/><circle class="ldot" cx="152" cy="162" r="2.3"/><text class="lbl" x="118" y="102" text-anchor="end"><tspan x="118" dy="0">Punta del pie</tspan><tspan x="118" dy="10.5">contra la pared</tspan></text><path class="lead" d="M 196 199 L 124 153"/><circle class="ldot" cx="196" cy="199" r="2.3"/><text class="lbl" x="118" y="156" text-anchor="end"><tspan x="118" dy="0">Talón clavado</tspan><tspan x="118" dy="10.5">en el suelo</tspan></text><path class="lead" d="M 272 120 L 336 57"/><circle class="ldot" cx="272" cy="120" r="2.3"/><text class="lbl" x="342" y="60" text-anchor="start"><tspan x="342" dy="0">La cadera avanza</tspan><tspan x="342" dy="10.5">hasta notar tensión</tspan></text><path class="lead" d="M 206 166 L 336 117"/><circle class="ldot" cx="206" cy="166" r="2.3"/><text class="lbl" x="342" y="120" text-anchor="start"><tspan x="342" dy="0">Rodilla estirada → gemelo</tspan><tspan x="342" dy="10.5">Rodilla flexionada → sóleo</tspan></text><path class="lead" d="M 198 178 L 336 163"/><circle class="ldot" cx="198" cy="178" r="2.3"/><text class="lbl" x="342" y="166" text-anchor="start"><tspan x="342" dy="0">Gemelo y sóleo</tspan><tspan x="342" dy="10.5">(aquí debe tirar)</tspan></text></svg>`,
    cues: ["Punta del pie contra la pared y **talón clavado en el suelo**.", "Manos en la pared y **lleva la cadera y la rodilla hacia delante** hasta notar tensión.", "**Rodilla estirada** → gemelo. **Rodilla algo flexionada** → sóleo. Haz las dos variantes.", "La presión se aumenta acercando la cadera, no forzando el tobillo. Sin rebotes."],
    warn: "Limitador nº1 de la profundidad de sentadilla: con poca dorsiflexión, la rodilla operada compensa.",
  },
  "Isquiotibiales sentado": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 140 200 L 360 200"/><path class="envs" d="M 148 201.5 L 140 209"/><path class="envs" d="M 160 201.5 L 152 209"/><path class="envs" d="M 172 201.5 L 164 209"/><path class="envs" d="M 184 201.5 L 176 209"/><path class="envs" d="M 196 201.5 L 188 209"/><path class="envs" d="M 208 201.5 L 200 209"/><path class="envs" d="M 220 201.5 L 212 209"/><path class="envs" d="M 232 201.5 L 224 209"/><path class="envs" d="M 244 201.5 L 236 209"/><path class="envs" d="M 256 201.5 L 248 209"/><path class="envs" d="M 268 201.5 L 260 209"/><path class="envs" d="M 280 201.5 L 272 209"/><path class="envs" d="M 292 201.5 L 284 209"/><path class="envs" d="M 304 201.5 L 296 209"/><path class="envs" d="M 316 201.5 L 308 209"/><path class="envs" d="M 328 201.5 L 320 209"/><path class="envs" d="M 340 201.5 L 332 209"/><path class="envs" d="M 352 201.5 L 344 209"/><path class="sk2" d="M 180.12 205.00 L 244.08 204.50 A 10.5 10.5 0 0 0 245.39 183.59 L 181.98 175.13 A 15 15 0 1 0 180.12 205.00 Z"/><path class="sk2" d="M 245.01 204.45 L 306.63 198.47 A 6.5 6.5 0 0 0 306.21 185.50 L 244.34 183.51 A 10.5 10.5 0 1 0 245.01 204.45 Z"/><path class="sk2" d="M 316.07 198.07 L 311.87 189.22 A 6.5 6.5 0 1 0 301.69 196.86 L 309.01 203.37 A 4.5 4.5 0 0 0 316.07 198.07 Z"/><path class="sk2" d="M 312.06 194.35 L 321.73 169.45 A 4 4 0 0 0 314.60 165.89 L 300.48 188.56 A 6.5 6.5 0 1 0 312.06 194.35 Z"/><path class="hl" d="M 250.56 203.98 L 294.44 200.48 A 5.5 5.5 0 0 0 293.94 189.50 L 249.92 190.00 A 7 7 0 1 0 250.56 203.98 Z"/><path class="sk" d="M 186.32 118.66 L 162.20 183.36 A 19 19 0 0 0 197.39 197.66 L 225.22 134.46 A 21 21 0 1 0 186.32 118.66 Z"/><circle class="sk" cx="216" cy="104" r="14"/><path class="hair" d="M 203.2 110.3 A 14.280000000000001 14.280000000000001 0 0 1 205.4 94.4 A 14.280000000000001 14.280000000000001 0 0 1 220.9 90.6 Z"/><path class="sk" d="M 227.8 109.8 L 229.1 116.3 L 222.5 115.4 Z"/><circle class="eye" cx="223.4" cy="107.4" r="1.5"/><path class="ln" d="M 218.6 115.8 L 213.6 107.4"/><path class="sk" d="M 193.09 194.97 L 208.88 153.37 A 9.5 9.5 0 0 0 191.97 144.92 L 168.17 182.51 A 14 14 0 1 0 193.09 194.97 Z"/><path class="sk" d="M 193.94 157.32 L 241.85 197.01 A 6.5 6.5 0 0 0 250.61 187.42 L 206.74 143.30 A 9.5 9.5 0 1 0 193.94 157.32 Z"/><path class="sk" d="M 237.62 202.20 L 248.34 198.06 A 6.5 6.5 0 1 0 241.75 187.08 L 233.06 194.60 A 4.5 4.5 0 0 0 237.62 202.20 Z"/><path class="sk" d="M 244.89 198.40 L 265.32 201.94 A 4 4 0 0 0 267.60 194.33 L 248.60 186.04 A 6.5 6.5 0 1 0 244.89 198.40 Z"/><path class="sk" d="M 204.07 134.10 L 250.72 156.75 A 7.5 7.5 0 0 0 257.66 143.45 L 212.39 118.14 A 9 9 0 1 0 204.07 134.10 Z"/><path class="sk" d="M 250.28 156.51 L 297.02 183.21 A 6 6 0 0 0 303.26 172.96 L 258.08 143.70 A 7.5 7.5 0 1 0 250.28 156.51 Z"/><path class="ar" d="M 226 86 C 260 108 292 140 310 164"/><path class="lead" d="M 192 150 L 124 69"/><circle class="ldot" cx="192" cy="150" r="2.3"/><text class="lbl" x="118" y="72" text-anchor="end"><tspan x="118" dy="0">Espalda larga:</tspan><tspan x="118" dy="10.5">bisagra desde la cadera</tspan></text><path class="lead" d="M 198 152 L 124 131"/><circle class="ldot" cx="198" cy="152" r="2.3"/><text class="lbl" x="118" y="134" text-anchor="end"><tspan x="118" dy="0">Rodilla flexionada</tspan><tspan x="118" dy="10.5">hacia fuera</tspan></text><path class="lead" d="M 244 192 L 124 183"/><circle class="ldot" cx="244" cy="192" r="2.3"/><text class="lbl" x="118" y="186" text-anchor="end"><tspan x="118" dy="0">Planta contra el</tspan><tspan x="118" dy="10.5">muslo interno</tspan></text><path class="lead" d="M 222 110 L 336 51"/><circle class="ldot" cx="222" cy="110" r="2.3"/><text class="lbl" x="342" y="54" text-anchor="start"><tspan x="342" dy="0">El pecho va al muslo,</tspan><tspan x="342" dy="10.5">no la frente a la rodilla</tspan></text><path class="lead" d="M 272 192 L 336 117"/><circle class="ldot" cx="272" cy="192" r="2.3"/><text class="lbl" x="342" y="120" text-anchor="start"><tspan x="342" dy="0">Rodilla extendida,</tspan><tspan x="342" dy="10.5">sin bloquearla</tspan></text><path class="lead" d="M 290 196 L 336 163"/><circle class="ldot" cx="290" cy="196" r="2.3"/><text class="lbl" x="342" y="166" text-anchor="start"><tspan x="342" dy="0">Isquiotibiales</tspan><tspan x="342" dy="10.5">(aquí debe tirar)</tspan></text><path class="lead" d="M 316 172 L 336 201"/><circle class="ldot" cx="316" cy="172" r="2.3"/><text class="lbl" x="342" y="204" text-anchor="start"><tspan x="342" dy="0">Pie relajado o en</tspan><tspan x="342" dy="10.5">flexión dorsal</tspan></text></svg>`,
    cues: ["Una pierna extendida y la otra flexionada con la planta hacia el muslo interno.", "**Bisagra desde la cadera con la espalda larga.** No redondees la lumbar para tocar el pie.", "Rodilla extendida pero sin bloquearla a la fuerza.", "El pecho va hacia el muslo, no la frente hacia la rodilla."],
  },
  "Dorsal ancho colgado en barra": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 150 34 L 330 34"/><path class="env2" d="M 160 34 L 160 16"/><path class="env2" d="M 320 34 L 320 16"/><path class="sk" d="M 189.59 38.89 L 184.12 70.64 A 8 8 0 1 0 199.98 72.62 L 202.48 40.51 A 6.5 6.5 0 0 0 189.59 38.89 Z"/><path class="sk" d="M 184.09 73.23 L 189.13 105.69 A 11 11 0 1 0 210.38 100.37 L 199.55 69.36 A 8 8 0 0 0 184.09 73.23 Z"/><path class="sk" d="M 261.52 40.51 L 264.02 72.62 A 8 8 0 1 0 279.88 70.64 L 274.41 38.89 A 6.5 6.5 0 0 0 261.52 40.51 Z"/><path class="sk" d="M 264.45 69.36 L 253.62 100.37 A 11 11 0 1 0 274.87 105.69 L 279.91 73.23 A 8 8 0 0 0 264.45 69.36 Z"/><circle class="sk" cx="196" cy="36" r="7.5"/><circle class="sk" cx="268" cy="36" r="7.5"/><path class="sk" d="M 202.00 119.00 L 262.00 119.00 A 13 13 0 0 0 262.00 93.00 L 202.00 93.00 A 13 13 0 0 0 202.00 119.00 Z"/><path class="sk" d="M 204.12 112.59 L 209.10 166.13 A 23 23 0 0 0 254.90 166.13 L 259.88 112.59 A 28 28 0 1 0 204.12 112.59 Z"/><path class="hl" d="M 202.09 117.21 L 207.58 152.98 A 6.5 6.5 0 0 0 220.48 151.55 L 217.98 115.45 A 8 8 0 1 0 202.09 117.21 Z"/><path class="hl" d="M 246.02 115.45 L 243.52 151.55 A 6.5 6.5 0 0 0 256.42 152.98 L 261.91 117.21 A 8 8 0 1 0 246.02 115.45 Z"/><ellipse class="sk" cx="232" cy="84" rx="12" ry="15" transform="rotate(0 232 84)"/><path class="hair" d="M 219.4 79.5 Q 232 59.849999999999994 244.6 79.5 Z"/><circle class="eye" cx="226.9" cy="82.8" r="1.5"/><circle class="eye" cx="237.1" cy="82.8" r="1.5"/><path class="ln" d="M 232 83.7 L 232 87.9"/><path class="ln" d="M 229 91.5 L 235 91.5"/><path class="sk2" d="M 207.13 162.18 L 203.09 190.74 A 9 9 0 0 0 220.23 195.64 L 231.89 169.25 A 13 13 0 1 0 207.13 162.18 Z"/><path class="sk2" d="M 203.01 191.59 L 202.01 213.73 A 6 6 0 0 0 213.71 215.86 L 220.56 194.78 A 9 9 0 1 0 203.01 191.59 Z"/><path class="sk" d="M 232.11 169.25 L 243.77 195.64 A 9 9 0 0 0 260.91 190.74 L 256.87 162.18 A 13 13 0 1 0 232.11 169.25 Z"/><path class="sk" d="M 243.44 194.78 L 250.29 215.86 A 6 6 0 0 0 261.99 213.73 L 260.99 191.59 A 9 9 0 1 0 243.44 194.78 Z"/><path class="ar" d="M 176 148 L 176 84"/><path class="ar" d="M 288 148 L 288 84"/><path class="lead" d="M 196 36 L 124 45"/><circle class="ldot" cx="196" cy="36" r="2.3"/><text class="lbl" x="118" y="48" text-anchor="end"><tspan x="118" dy="0">Agarre algo más ancho</tspan><tspan x="118" dy="10.5">que los hombros</tspan></text><path class="lead" d="M 206 106 L 124 97"/><circle class="ldot" cx="206" cy="106" r="2.3"/><text class="lbl" x="118" y="100" text-anchor="end"><tspan x="118" dy="0">Hombros sueltos:</tspan><tspan x="118" dy="10.5">deja caer el peso</tspan></text><path class="lead" d="M 212 132 L 124 151"/><circle class="ldot" cx="212" cy="132" r="2.3"/><text class="lbl" x="118" y="154" text-anchor="end"><tspan x="118" dy="0">Dorsal ancho</tspan><tspan x="118" dy="10.5">se alarga</tspan></text><path class="lead" d="M 268 60 L 336 49"/><circle class="ldot" cx="268" cy="60" r="2.3"/><text class="lbl" x="342" y="52" text-anchor="start"><tspan x="342" dy="0">Brazos estirados</tspan><tspan x="342" dy="10.5">del todo</tspan></text><path class="lead" d="M 240 158 L 336 109"/><circle class="ldot" cx="240" cy="158" r="2.3"/><text class="lbl" x="342" y="112" text-anchor="start"><tspan x="342" dy="0">Costillas abajo y</tspan><tspan x="342" dy="10.5">glúteo activo</tspan></text><path class="lead" d="M 252 200 L 336 173"/><circle class="ldot" cx="252" cy="200" r="2.3"/><text class="lbl" x="342" y="176" text-anchor="start"><tspan x="342" dy="0">Para bajar apoya los pies,</tspan><tspan x="342" dy="10.5">nunca saltes</tspan></text></svg>`,
    cues: ["Agarre algo más ancho que los hombros y **deja caer el peso**: hombros sueltos hacia las orejas.", "Costillas abajo y glúteo activo para no arquear la lumbar.", "Si el agarre se agota antes de los 60 s, usa correas: el objetivo es el dorsal, no el antebrazo."],
    warn: "Impacto cero: sube y baja apoyando los pies, nunca saltando al suelo.",
  },
  "Flexores de cadera en zancada": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 140 200 L 360 200"/><path class="envs" d="M 148 201.5 L 140 209"/><path class="envs" d="M 160 201.5 L 152 209"/><path class="envs" d="M 172 201.5 L 164 209"/><path class="envs" d="M 184 201.5 L 176 209"/><path class="envs" d="M 196 201.5 L 188 209"/><path class="envs" d="M 208 201.5 L 200 209"/><path class="envs" d="M 220 201.5 L 212 209"/><path class="envs" d="M 232 201.5 L 224 209"/><path class="envs" d="M 244 201.5 L 236 209"/><path class="envs" d="M 256 201.5 L 248 209"/><path class="envs" d="M 268 201.5 L 260 209"/><path class="envs" d="M 280 201.5 L 272 209"/><path class="envs" d="M 292 201.5 L 284 209"/><path class="envs" d="M 304 201.5 L 296 209"/><path class="envs" d="M 316 201.5 L 308 209"/><path class="envs" d="M 328 201.5 L 320 209"/><path class="envs" d="M 340 201.5 L 332 209"/><path class="envs" d="M 352 201.5 L 344 209"/><rect class="envf" x="162" y="188" width="62" height="12" rx="5"/><path class="sk2" d="M 226.70 119.73 L 182.33 180.39 A 9.5 9.5 0 0 0 196.94 192.48 L 248.23 137.55 A 14 14 0 1 0 226.70 119.73 Z"/><path class="sk2" d="M 187.33 176.88 L 150.17 187.76 A 6.5 6.5 0 0 0 152.84 200.45 L 191.23 195.42 A 9.5 9.5 0 1 0 187.33 176.88 Z"/><path class="sk2" d="M 162.86 194.53 L 156.13 188.98 A 6.5 6.5 0 1 0 150.47 200.32 L 158.94 202.37 A 4.5 4.5 0 0 0 162.86 194.53 Z"/><path class="sk2" d="M 149.15 188.16 L 132.25 196.41 A 4 4 0 0 0 134.75 203.93 L 153.23 200.38 A 6.5 6.5 0 1 0 149.15 188.16 Z"/><path class="hl" d="M 220.59 134.89 L 192.24 176.03 A 7 7 0 0 0 203.43 184.42 L 234.98 145.68 A 9 9 0 1 0 220.59 134.89 Z"/><path class="sk" d="M 215.08 73.87 L 220.07 129.60 A 18 18 0 0 0 256.00 128.32 L 257.00 72.38 A 21 21 0 1 0 215.08 73.87 Z"/><circle class="sk" cx="234" cy="50" r="14"/><path class="hair" d="M 226.9 62.4 A 14.280000000000001 14.280000000000001 0 0 1 219.9 48.0 A 14.280000000000001 14.280000000000001 0 0 1 230.6 36.1 Z"/><path class="sk" d="M 247.0 48.2 L 251.7 52.8 L 245.8 55.8 Z"/><circle class="eye" cx="242.0" cy="48.7" r="1.5"/><path class="ln" d="M 242.7 58.3 L 233.9 54.2"/><path class="sk" d="M 234.52 141.56 L 291.39 156.17 A 10.5 10.5 0 0 0 297.80 136.21 L 243.07 114.95 A 14 14 0 1 0 234.52 141.56 Z"/><path class="sk" d="M 283.53 146.84 L 287.52 196.52 A 6.5 6.5 0 0 0 300.48 196.52 L 304.47 146.84 A 10.5 10.5 0 1 0 283.53 146.84 Z"/><path class="sk" d="M 278.55 204.47 L 294.80 202.45 A 6.5 6.5 0 1 0 291.67 189.93 L 276.39 195.80 A 4.5 4.5 0 0 0 278.55 204.47 Z"/><path class="sk" d="M 293.65 202.49 L 321.79 203.99 A 4 4 0 0 0 322.91 196.11 L 295.48 189.67 A 6.5 6.5 0 1 0 293.65 202.49 Z"/><path class="sk" d="M 231.44 78.16 L 260.53 109.13 A 7.5 7.5 0 0 0 271.82 99.26 L 244.98 66.32 A 9 9 0 1 0 231.44 78.16 Z"/><path class="sk" d="M 260.36 108.94 L 287.48 139.95 A 6 6 0 0 0 296.79 132.39 L 271.99 99.49 A 7.5 7.5 0 1 0 260.36 108.94 Z"/><path class="ar" d="M 200 148 C 222 140 248 136 272 136"/><path class="lead" d="M 236 86 L 124 57"/><circle class="ldot" cx="236" cy="86" r="2.3"/><text class="lbl" x="118" y="60" text-anchor="end"><tspan x="118" dy="0">Tronco vertical</tspan></text><path class="lead" d="M 212 162 L 124 115"/><circle class="ldot" cx="212" cy="162" r="2.3"/><text class="lbl" x="118" y="118" text-anchor="end"><tspan x="118" dy="0">Flexor de cadera</tspan><tspan x="118" dy="10.5">(psoas) se alarga</tspan></text><path class="lead" d="M 192 192 L 124 175"/><circle class="ldot" cx="192" cy="192" r="2.3"/><text class="lbl" x="118" y="178" text-anchor="end"><tspan x="118" dy="0">Rodilla trasera</tspan><tspan x="118" dy="10.5">acolchada</tspan></text><path class="lead" d="M 248 124 L 336 59"/><circle class="ldot" cx="248" cy="124" r="2.3"/><text class="lbl" x="342" y="62" text-anchor="start"><tspan x="342" dy="0">1 · Coxis metido,</tspan><tspan x="342" dy="10.5">glúteo apretado</tspan></text><path class="lead" d="M 262 140 L 336 109"/><circle class="ldot" cx="262" cy="140" r="2.3"/><text class="lbl" x="342" y="112" text-anchor="start"><tspan x="342" dy="0">2 · La cadera se</tspan><tspan x="342" dy="10.5">desliza hacia delante</tspan></text><path class="lead" d="M 294 152 L 336 167"/><circle class="ldot" cx="294" cy="152" r="2.3"/><text class="lbl" x="342" y="170" text-anchor="start"><tspan x="342" dy="0">Rodilla sobre el tobillo,</tspan><tspan x="342" dy="10.5">nunca por delante</tspan></text></svg>`,
    cues: ["Rodilla trasera acolchada, pie delantero plano y **rodilla delantera sobre el tobillo**.", "**Primero retroversión de pelvis** (coxis metido, glúteo apretado); después desliza la cadera hacia delante. Sin ese paso solo arqueas la lumbar.", "Tronco vertical. Para más psoas, sube el brazo del lado trasero por encima de la cabeza."],
    warn: "Si molesta la rodilla derecha apoyada, hazlo con el pie trasero en un banco en vez de la rodilla en el suelo.",
  },
  "Aductores de pie": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 140 200 L 360 200"/><path class="envs" d="M 148 201.5 L 140 209"/><path class="envs" d="M 160 201.5 L 152 209"/><path class="envs" d="M 172 201.5 L 164 209"/><path class="envs" d="M 184 201.5 L 176 209"/><path class="envs" d="M 196 201.5 L 188 209"/><path class="envs" d="M 208 201.5 L 200 209"/><path class="envs" d="M 220 201.5 L 212 209"/><path class="envs" d="M 232 201.5 L 224 209"/><path class="envs" d="M 244 201.5 L 236 209"/><path class="envs" d="M 256 201.5 L 248 209"/><path class="envs" d="M 268 201.5 L 260 209"/><path class="envs" d="M 280 201.5 L 272 209"/><path class="envs" d="M 292 201.5 L 284 209"/><path class="envs" d="M 304 201.5 L 296 209"/><path class="envs" d="M 316 201.5 L 308 209"/><path class="envs" d="M 328 201.5 L 320 209"/><path class="envs" d="M 340 201.5 L 332 209"/><path class="envs" d="M 352 201.5 L 344 209"/><path class="sk2" d="M 259.38 156.34 L 301.27 178.81 A 10 10 0 0 0 312.13 162.10 L 274.59 132.94 A 14 14 0 1 0 259.38 156.34 Z"/><path class="sk2" d="M 297.82 175.75 L 314.68 199.74 A 6.5 6.5 0 0 0 326.05 193.62 L 315.30 166.34 A 10 10 0 1 0 297.82 175.75 Z"/><ellipse class="sk2" cx="320" cy="200" rx="8" ry="6"/><path class="sk2" d="M 213.64 84.66 L 199.04 121.22 A 7.5 7.5 0 0 0 212.73 127.30 L 230.08 91.97 A 9 9 0 1 0 213.64 84.66 Z"/><path class="sk2" d="M 198.56 123.02 L 194.05 157.21 A 6 6 0 0 0 205.86 159.30 L 213.32 125.62 A 7.5 7.5 0 1 0 198.56 123.02 Z"/><path class="sk" d="M 222.00 99.00 L 274.00 99.00 A 13 13 0 0 0 274.00 73.00 L 222.00 73.00 A 13 13 0 0 0 222.00 99.00 Z"/><path class="sk" d="M 225.01 90.82 L 227.01 146.75 A 21 21 0 0 0 268.99 146.75 L 270.99 90.82 A 23 23 0 1 0 225.01 90.82 Z"/><ellipse class="sk" cx="248" cy="60" rx="12" ry="15" transform="rotate(0 248 60)"/><path class="hair" d="M 235.4 55.5 Q 248 35.85 260.6 55.5 Z"/><circle class="eye" cx="242.9" cy="58.8" r="1.5"/><circle class="eye" cx="253.1" cy="58.8" r="1.5"/><path class="ln" d="M 248 59.7 L 248 63.9"/><path class="ln" d="M 245 67.5 L 251 67.5"/><path class="sk" d="M 221.06 133.23 L 183.61 164.31 A 10 10 0 0 0 195.04 180.63 L 237.06 156.09 A 14 14 0 1 0 221.06 133.23 Z"/><path class="sk" d="M 184.23 163.84 L 146.25 190.69 A 6.5 6.5 0 0 0 152.92 201.81 L 194.49 180.94 A 10 10 0 1 0 184.23 163.84 Z"/><ellipse class="sk" cx="150" cy="200" rx="8" ry="6"/><path class="hl" d="M 219.10 143.68 L 184.02 170.86 A 6.5 6.5 0 0 0 191.63 181.39 L 228.46 156.64 A 8 8 0 1 0 219.10 143.68 Z"/><path class="sk" d="M 266.96 93.61 L 290.14 122.68 A 7.5 7.5 0 0 0 302.22 113.81 L 281.47 82.97 A 9 9 0 1 0 266.96 93.61 Z"/><path class="sk" d="M 288.56 118.98 L 294.05 160.78 A 6 6 0 0 0 305.99 159.64 L 303.49 117.55 A 7.5 7.5 0 1 0 288.56 118.98 Z"/><path class="ar" d="M 240 128 C 214 148 190 168 168 184"/><path class="lead" d="M 248 74 L 124 51"/><circle class="ldot" cx="248" cy="74" r="2.3"/><text class="lbl" x="118" y="54" text-anchor="end"><tspan x="118" dy="0">Tronco erguido,</tspan><tspan x="118" dy="10.5">mirada al frente</tspan></text><path class="lead" d="M 204 164 L 124 119"/><circle class="ldot" cx="204" cy="164" r="2.3"/><text class="lbl" x="118" y="122" text-anchor="end"><tspan x="118" dy="0">Pierna estirada:</tspan><tspan x="118" dy="10.5">aquí tira el aductor</tspan></text><path class="lead" d="M 150 200 L 124 175"/><circle class="ldot" cx="150" cy="200" r="2.3"/><text class="lbl" x="118" y="178" text-anchor="end"><tspan x="118" dy="0">Talones siempre</tspan><tspan x="118" dy="10.5">en el suelo</tspan></text><path class="lead" d="M 300 158 L 336 69"/><circle class="ldot" cx="300" cy="158" r="2.3"/><text class="lbl" x="342" y="72" text-anchor="start"><tspan x="342" dy="0">Manos en el muslo</tspan><tspan x="342" dy="10.5">para descargar peso</tspan></text><path class="lead" d="M 306 170 L 336 127"/><circle class="ldot" cx="306" cy="170" r="2.3"/><text class="lbl" x="342" y="130" text-anchor="start"><tspan x="342" dy="0">Rodilla flexionada</tspan><tspan x="342" dy="10.5">(máx. 90°)</tspan></text><path class="lead" d="M 320 200 L 336 177"/><circle class="ldot" cx="320" cy="200" r="2.3"/><text class="lbl" x="342" y="180" text-anchor="start"><tspan x="342" dy="0">Pies paralelos,</tspan><tspan x="342" dy="10.5">apuntando al frente</tspan></text></svg>`,
    cues: ["Pies muy separados y apuntando al frente. **Flexiona una rodilla** y desplaza el peso a ese lado.", "La tensión aparece en la **cara interna del muslo estirado**, no en la rodilla flexionada.", "Manos en el muslo para descargar peso. Talones siempre en el suelo."],
    warn: "Rodilla derecha: no pases de ~90° de flexión. Si hay pinchazo, cámbialo por mariposa sentado.",
  },
  "Glúteo sentado": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 140 212 L 360 212"/><path class="envs" d="M 148 213.5 L 140 221"/><path class="envs" d="M 160 213.5 L 152 221"/><path class="envs" d="M 172 213.5 L 164 221"/><path class="envs" d="M 184 213.5 L 176 221"/><path class="envs" d="M 196 213.5 L 188 221"/><path class="envs" d="M 208 213.5 L 200 221"/><path class="envs" d="M 220 213.5 L 212 221"/><path class="envs" d="M 232 213.5 L 224 221"/><path class="envs" d="M 244 213.5 L 236 221"/><path class="envs" d="M 256 213.5 L 248 221"/><path class="envs" d="M 268 213.5 L 260 221"/><path class="envs" d="M 280 213.5 L 272 221"/><path class="envs" d="M 292 213.5 L 284 221"/><path class="envs" d="M 304 213.5 L 296 221"/><path class="envs" d="M 316 213.5 L 308 221"/><path class="envs" d="M 328 213.5 L 320 221"/><path class="envs" d="M 340 213.5 L 332 221"/><path class="envs" d="M 352 213.5 L 344 221"/><rect class="envf" x="176" y="144" width="150" height="12" rx="3"/><path class="env2" d="M 186 156 L 186 212"/><path class="env2" d="M 316 156 L 316 212"/><path class="sk2" d="M 214.19 137.72 L 208.13 174.37 A 10 10 0 0 0 227.29 179.69 L 241.01 145.17 A 14 14 0 1 0 214.19 137.72 Z"/><path class="sk2" d="M 208.00 175.82 L 207.50 203.88 A 6.5 6.5 0 0 0 220.27 205.71 L 227.65 178.63 A 10 10 0 1 0 208.00 175.82 Z"/><ellipse class="sk2" cx="214" cy="208" rx="8" ry="6"/><path class="sk2" d="M 203.58 82.81 L 188.99 121.34 A 7.5 7.5 0 0 0 202.80 127.16 L 220.16 89.79 A 9 9 0 1 0 203.58 82.81 Z"/><path class="sk2" d="M 192.82 130.79 L 245.46 155.43 A 6 6 0 0 0 250.82 144.70 L 199.53 117.38 A 7.5 7.5 0 1 0 192.82 130.79 Z"/><path class="sk" d="M 212.00 98.00 L 268.00 98.00 A 14 14 0 0 0 268.00 70.00 L 212.00 70.00 A 14 14 0 0 0 212.00 98.00 Z"/><path class="sk" d="M 213.07 90.00 L 217.06 143.70 A 23 23 0 0 0 262.94 143.70 L 266.93 90.00 A 27 27 0 1 0 213.07 90.00 Z"/><ellipse class="sk" cx="240" cy="58" rx="12.8" ry="16" transform="rotate(0 240 58)"/><path class="hair" d="M 226.6 53.2 Q 240 32.2 253.4 53.2 Z"/><circle class="eye" cx="234.6" cy="56.7" r="1.6"/><circle class="eye" cx="245.4" cy="56.7" r="1.6"/><path class="ln" d="M 240 57.7 L 240 62.2"/><path class="ln" d="M 236.8 66 L 243.2 66"/><path class="sk" d="M 245.83 152.57 L 295.60 176.98 A 10 10 0 0 0 305.65 159.75 L 259.91 128.45 A 14 14 0 1 0 245.83 152.57 Z"/><path class="sk" d="M 298.10 158.18 L 228.76 171.62 A 6.5 6.5 0 0 0 230.60 184.47 L 300.92 177.96 A 10 10 0 1 0 298.10 158.18 Z"/><path class="sk" d="M 246.00 171.50 L 230.00 171.50 A 6.5 6.5 0 1 0 231.60 184.30 L 247.11 180.36 A 4.5 4.5 0 0 0 246.00 171.50 Z"/><path class="sk" d="M 228.79 171.61 L 205.26 176.07 A 4 4 0 0 0 205.92 184.00 L 229.86 184.50 A 6.5 6.5 0 1 0 228.79 171.61 Z"/><path class="hl" d="M 257.56 158.96 L 288.00 174.06 A 9 9 0 0 0 296.47 158.19 L 266.96 141.32 A 10 10 0 1 0 257.56 158.96 Z"/><path class="sk" d="M 260.89 91.51 L 288.07 126.59 A 7.5 7.5 0 0 0 300.22 117.82 L 275.47 80.98 A 9 9 0 1 0 260.89 91.51 Z"/><path class="sk" d="M 286.58 123.08 L 292.06 160.86 A 6 6 0 0 0 303.99 159.61 L 301.48 121.51 A 7.5 7.5 0 1 0 286.58 123.08 Z"/><path class="ar" d="M 240 40 C 258 50 268 62 272 74"/><path class="lead" d="M 232 110 L 124 67"/><circle class="ldot" cx="232" cy="110" r="2.3"/><text class="lbl" x="118" y="70" text-anchor="end"><tspan x="118" dy="0">Espalda recta:</tspan><tspan x="118" dy="10.5">inclínate desde la cadera</tspan></text><path class="lead" d="M 214 206 L 124 183"/><circle class="ldot" cx="214" cy="206" r="2.3"/><text class="lbl" x="118" y="186" text-anchor="end"><tspan x="118" dy="0">Pie de apoyo</tspan><tspan x="118" dy="10.5">plano en el suelo</tspan></text><path class="lead" d="M 256 44 L 336 49"/><circle class="ldot" cx="256" cy="44" r="2.3"/><text class="lbl" x="342" y="52" text-anchor="start"><tspan x="342" dy="0">El pecho va al frente,</tspan><tspan x="342" dy="10.5">no la cabeza abajo</tspan></text><path class="lead" d="M 268 146 L 336 101"/><circle class="ldot" cx="268" cy="146" r="2.3"/><text class="lbl" x="342" y="104" text-anchor="start"><tspan x="342" dy="0">Glúteo profundo</tspan><tspan x="342" dy="10.5">(aquí debe tirar)</tspan></text><path class="lead" d="M 230 178 L 336 147"/><circle class="ldot" cx="230" cy="178" r="2.3"/><text class="lbl" x="342" y="150" text-anchor="start"><tspan x="342" dy="0">Tobillo cruzado sobre</tspan><tspan x="342" dy="10.5">la rodilla contraria</tspan></text><path class="lead" d="M 298 162 L 336 193"/><circle class="ldot" cx="298" cy="162" r="2.3"/><text class="lbl" x="342" y="196" text-anchor="start"><tspan x="342" dy="0">Empuja el muslo</tspan><tspan x="342" dy="10.5">hacia abajo, no la rodilla</tspan></text></svg>`,
    cues: ["Sentado en banco, cruza el tobillo sobre la rodilla contraria formando un **4**.", "Espalda recta e **inclínate desde la cadera** hacia delante.", "Presión suave sobre el muslo cruzado. Debe tirar el glúteo profundo, nunca dentro de la rodilla."],
    warn: "La rodilla cruzada queda en rotación externa: si es la derecha y notas tirón por dentro, empuja el muslo y reduce el rango.",
  },
  "Cuádriceps de pie": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 140 28 L 140 200"/><path class="envs" d="M 138.5 36 L 131 44"/><path class="envs" d="M 138.5 48 L 131 56"/><path class="envs" d="M 138.5 60 L 131 68"/><path class="envs" d="M 138.5 72 L 131 80"/><path class="envs" d="M 138.5 84 L 131 92"/><path class="envs" d="M 138.5 96 L 131 104"/><path class="envs" d="M 138.5 108 L 131 116"/><path class="envs" d="M 138.5 120 L 131 128"/><path class="envs" d="M 138.5 132 L 131 140"/><path class="envs" d="M 138.5 144 L 131 152"/><path class="envs" d="M 138.5 156 L 131 164"/><path class="envs" d="M 138.5 168 L 131 176"/><path class="envs" d="M 138.5 180 L 131 188"/><path class="envs" d="M 138.5 192 L 131 200"/><path class="env" d="M 140 200 L 360 200"/><path class="envs" d="M 148 201.5 L 140 209"/><path class="envs" d="M 160 201.5 L 152 209"/><path class="envs" d="M 172 201.5 L 164 209"/><path class="envs" d="M 184 201.5 L 176 209"/><path class="envs" d="M 196 201.5 L 188 209"/><path class="envs" d="M 208 201.5 L 200 209"/><path class="envs" d="M 220 201.5 L 212 209"/><path class="envs" d="M 232 201.5 L 224 209"/><path class="envs" d="M 244 201.5 L 236 209"/><path class="envs" d="M 256 201.5 L 248 209"/><path class="envs" d="M 268 201.5 L 260 209"/><path class="envs" d="M 280 201.5 L 272 209"/><path class="envs" d="M 292 201.5 L 284 209"/><path class="envs" d="M 304 201.5 L 296 209"/><path class="envs" d="M 316 201.5 L 308 209"/><path class="envs" d="M 328 201.5 L 320 209"/><path class="envs" d="M 340 201.5 L 332 209"/><path class="envs" d="M 352 201.5 L 344 209"/><path class="sk2" d="M 236.35 127.10 L 244.74 164.10 A 9.5 9.5 0 0 0 263.50 162.13 L 264.00 124.18 A 14 14 0 1 0 236.35 127.10 Z"/><path class="sk2" d="M 244.54 162.84 L 247.53 196.57 A 6.5 6.5 0 0 0 260.47 196.57 L 263.46 162.84 A 9.5 9.5 0 1 0 244.54 162.84 Z"/><path class="sk2" d="M 238.55 204.47 L 254.80 202.45 A 6.5 6.5 0 1 0 251.67 189.93 L 236.39 195.80 A 4.5 4.5 0 0 0 238.55 204.47 Z"/><path class="sk2" d="M 253.63 202.49 L 279.77 203.99 A 4 4 0 0 0 280.98 196.12 L 255.59 189.70 A 6.5 6.5 0 1 0 253.63 202.49 Z"/><path class="sk2" d="M 244.93 59.06 L 199.11 64.55 A 7.5 7.5 0 0 0 200.41 79.49 L 246.49 76.99 A 9 9 0 1 0 244.93 59.06 Z"/><path class="sk2" d="M 200.09 64.50 L 156.07 64.00 A 6 6 0 0 0 155.52 75.98 L 199.40 79.48 A 7.5 7.5 0 1 0 200.09 64.50 Z"/><path class="sk" d="M 225.15 68.52 L 232.13 126.16 A 18 18 0 0 0 268.00 123.69 L 267.00 65.64 A 21 21 0 1 0 225.15 68.52 Z"/><circle class="sk" cx="250" cy="44" r="14"/><path class="hair" d="M 243.8 56.9 A 14.280000000000001 14.280000000000001 0 0 1 235.8 43.0 A 14.280000000000001 14.280000000000001 0 0 1 245.7 30.4 Z"/><path class="sk" d="M 262.9 41.3 L 267.8 45.6 L 262.2 49.0 Z"/><circle class="eye" cx="257.9" cy="42.1" r="1.5"/><path class="ln" d="M 259.3 51.7 L 250.2 48.2"/><path class="sk" d="M 236.07 125.37 L 240.55 170.93 A 9.5 9.5 0 0 0 259.45 170.93 L 263.93 125.37 A 14 14 0 1 0 236.07 125.37 Z"/><path class="sk" d="M 255.14 162.01 L 215.52 136.53 A 6.5 6.5 0 0 0 207.82 146.98 L 243.89 177.27 A 9.5 9.5 0 1 0 255.14 162.01 Z"/><path class="sk" d="M 224.05 152.05 L 217.86 139.18 A 6.5 6.5 0 1 0 207.14 146.32 L 216.64 156.99 A 4.5 4.5 0 0 0 224.05 152.05 Z"/><path class="sk" d="M 214.96 136.21 L 195.82 126.44 A 4 4 0 0 0 191.41 133.05 L 207.79 146.96 A 6.5 6.5 0 1 0 214.96 136.21 Z"/><path class="hl" d="M 241.02 130.56 L 243.01 162.44 A 7 7 0 0 0 256.99 162.44 L 258.98 130.56 A 9 9 0 1 0 241.02 130.56 Z"/><path class="sk" d="M 238.06 61.76 L 217.38 100.47 A 7.5 7.5 0 0 0 230.36 107.98 L 253.63 70.77 A 9 9 0 1 0 238.06 61.76 Z"/><path class="sk" d="M 216.91 101.56 L 204.33 138.04 A 6 6 0 0 0 215.50 142.39 L 230.88 106.99 A 7.5 7.5 0 1 0 216.91 101.56 Z"/><path class="ar" d="M 296 172 C 282 184 262 188 246 182"/><path class="lead" d="M 160 70 L 124 53"/><circle class="ldot" cx="160" cy="70" r="2.3"/><text class="lbl" x="118" y="56" text-anchor="end"><tspan x="118" dy="0">Mano libre en la pared:</tspan><tspan x="118" dy="10.5">sin pelear por el equilibrio</tspan></text><path class="lead" d="M 208 140 L 124 123"/><circle class="ldot" cx="208" cy="140" r="2.3"/><text class="lbl" x="118" y="126" text-anchor="end"><tspan x="118" dy="0">Sujeta el tobillo</tspan><tspan x="118" dy="10.5">con la otra mano</tspan></text><path class="lead" d="M 254 198 L 124 183"/><circle class="ldot" cx="254" cy="198" r="2.3"/><text class="lbl" x="118" y="186" text-anchor="end"><tspan x="118" dy="0">Pie de apoyo plano</tspan></text><path class="lead" d="M 256 120 L 336 59"/><circle class="ldot" cx="256" cy="120" r="2.3"/><text class="lbl" x="342" y="62" text-anchor="start"><tspan x="342" dy="0">Coxis metido,</tspan><tspan x="342" dy="10.5">glúteo apretado</tspan></text><path class="lead" d="M 252 150 L 336 113"/><circle class="ldot" cx="252" cy="150" r="2.3"/><text class="lbl" x="342" y="116" text-anchor="start"><tspan x="342" dy="0">Cuádriceps</tspan><tspan x="342" dy="10.5">(aquí debe tirar)</tspan></text><path class="lead" d="M 252 176 L 336 169"/><circle class="ldot" cx="252" cy="176" r="2.3"/><text class="lbl" x="342" y="172" text-anchor="start"><tspan x="342" dy="0">Rodillas juntas: la rodilla</tspan><tspan x="342" dy="10.5">viaja hacia atrás</tspan></text></svg>`,
    cues: ["Sujeta el tobillo por detrás y **lleva la rodilla hacia atrás**, alineada con la de apoyo.", "Coxis metido y glúteo apretado: sin eso el estiramiento se lo lleva la lumbar.", "**Apóyate en la pared** con la otra mano; nada de pelear por el equilibrio."],
    warn: "Máxima flexión de rodilla de toda la sesión. Si la derecha aprieta, hazlo tumbado boca abajo con una toalla.",
  },
  "Extensión torácica sobre banco": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="env" d="M 110 200 L 400 200"/><path class="envs" d="M 118 201.5 L 110 209"/><path class="envs" d="M 130 201.5 L 122 209"/><path class="envs" d="M 142 201.5 L 134 209"/><path class="envs" d="M 154 201.5 L 146 209"/><path class="envs" d="M 166 201.5 L 158 209"/><path class="envs" d="M 178 201.5 L 170 209"/><path class="envs" d="M 190 201.5 L 182 209"/><path class="envs" d="M 202 201.5 L 194 209"/><path class="envs" d="M 214 201.5 L 206 209"/><path class="envs" d="M 226 201.5 L 218 209"/><path class="envs" d="M 238 201.5 L 230 209"/><path class="envs" d="M 250 201.5 L 242 209"/><path class="envs" d="M 262 201.5 L 254 209"/><path class="envs" d="M 274 201.5 L 266 209"/><path class="envs" d="M 286 201.5 L 278 209"/><path class="envs" d="M 298 201.5 L 290 209"/><path class="envs" d="M 310 201.5 L 302 209"/><path class="envs" d="M 322 201.5 L 314 209"/><path class="envs" d="M 334 201.5 L 326 209"/><path class="envs" d="M 346 201.5 L 338 209"/><path class="envs" d="M 358 201.5 L 350 209"/><path class="envs" d="M 370 201.5 L 362 209"/><path class="envs" d="M 382 201.5 L 374 209"/><path class="envs" d="M 394 201.5 L 386 209"/><rect class="envf" x="272" y="140" width="100" height="12" rx="3"/><path class="env2" d="M 282 152 L 282 200"/><path class="env2" d="M 362 152 L 362 200"/><path class="sk2" d="M 174.02 146.80 L 176.52 190.54 A 9.5 9.5 0 0 0 195.40 191.40 L 201.85 148.06 A 14 14 0 1 0 174.02 146.80 Z"/><path class="sk2" d="M 183.90 180.74 L 144.56 189.66 A 6.5 6.5 0 0 0 146.48 202.48 L 186.71 199.47 A 9.5 9.5 0 1 0 183.90 180.74 Z"/><path class="sk2" d="M 156.52 195.27 L 149.64 190.62 A 6.5 6.5 0 1 0 145.21 202.45 L 153.45 203.47 A 4.5 4.5 0 0 0 156.52 195.27 Z"/><path class="sk2" d="M 143.74 189.90 L 126.61 196.25 A 4 4 0 0 0 128.33 203.99 L 146.54 202.48 A 6.5 6.5 0 1 0 143.74 189.90 Z"/><path class="sk2" d="M 274.11 180.01 L 323.43 154.67 A 7.5 7.5 0 0 0 316.94 141.15 L 266.33 163.78 A 9 9 0 1 0 274.11 180.01 Z"/><path class="sk2" d="M 321.16 155.41 L 368.93 147.93 A 6 6 0 0 0 367.44 136.03 L 319.30 140.53 A 7.5 7.5 0 1 0 321.16 155.41 Z"/><path class="sk" d="M 282.94 157.24 L 199.28 126.30 A 21 21 0 1 0 185.16 165.85 L 269.48 194.91 A 20 20 0 0 0 282.94 157.24 Z"/><path class="hl" d="M 232.57 164.32 L 266.57 178.32 A 9 9 0 0 0 273.43 161.68 L 239.43 147.68 A 9 9 0 0 0 232.57 164.32 Z"/><path class="sk" d="M 178.20 148.36 L 186.64 197.60 A 9.5 9.5 0 0 0 205.50 196.10 L 206.00 146.14 A 14 14 0 1 0 178.20 148.36 Z"/><path class="sk" d="M 194.35 186.64 L 154.87 193.60 A 6.5 6.5 0 0 0 156.16 206.50 L 196.24 205.50 A 9.5 9.5 0 1 0 194.35 186.64 Z"/><path class="sk" d="M 166.12 198.03 L 159.06 194.26 A 6.5 6.5 0 1 0 156.00 206.50 L 164.00 206.50 A 4.5 4.5 0 0 0 166.12 198.03 Z"/><path class="sk" d="M 154.06 193.80 L 136.81 199.18 A 4 4 0 0 0 138.11 207.00 L 156.18 206.50 A 6.5 6.5 0 1 0 154.06 193.80 Z"/><circle class="sk" cx="302" cy="188" r="14"/><path class="hair" d="M 292.5 198.7 A 14.280000000000001 14.280000000000001 0 0 1 288.6 183.1 A 14.280000000000001 14.280000000000001 0 0 1 301.6 173.7 Z"/><path class="sk" d="M 315.1 188.9 L 318.7 194.5 L 312.3 196.2 Z"/><circle class="eye" cx="310.1" cy="188.4" r="1.5"/><path class="ln" d="M 308.8 197.9 L 301.0 192.1"/><path class="sk" d="M 280.83 183.60 L 330.02 152.33 A 7.5 7.5 0 0 0 322.31 139.47 L 271.57 168.17 A 9 9 0 1 0 280.83 183.60 Z"/><path class="sk" d="M 327.21 153.40 L 372.97 145.92 A 6 6 0 0 0 371.42 134.03 L 325.27 138.54 A 7.5 7.5 0 1 0 327.21 153.40 Z"/><path class="ar" d="M 246 114 L 246 170"/><path class="lead" d="M 192 148 L 124 59"/><circle class="ldot" cx="192" cy="148" r="2.3"/><text class="lbl" x="118" y="62" text-anchor="end"><tspan x="118" dy="0">Cadera alta,</tspan><tspan x="118" dy="10.5">muslo vertical</tspan></text><path class="lead" d="M 196 194 L 124 121"/><circle class="ldot" cx="196" cy="194" r="2.3"/><text class="lbl" x="118" y="124" text-anchor="end"><tspan x="118" dy="0">Rodillas justo</tspan><tspan x="118" dy="10.5">bajo la cadera</tspan></text><path class="lead" d="M 156 200 L 124 179"/><circle class="ldot" cx="156" cy="200" r="2.3"/><text class="lbl" x="118" y="182" text-anchor="end"><tspan x="118" dy="0">Espinillas apoyadas</tspan><tspan x="118" dy="10.5">en el suelo</tspan></text><path class="lead" d="M 324 146 L 380 53"/><circle class="ldot" cx="324" cy="146" r="2.3"/><text class="lbl" x="386" y="56" text-anchor="start"><tspan x="386" dy="0">Codos en el banco</tspan></text><path class="lead" d="M 256 172 L 380 99"/><circle class="ldot" cx="256" cy="172" r="2.3"/><text class="lbl" x="386" y="102" text-anchor="start"><tspan x="386" dy="0">El pecho cae</tspan><tspan x="386" dy="10.5">hacia el suelo</tspan></text><path class="lead" d="M 244 158 L 380 147"/><circle class="ldot" cx="244" cy="158" r="2.3"/><text class="lbl" x="386" y="150" text-anchor="start"><tspan x="386" dy="0">Dorsal y dorsal</tspan><tspan x="386" dy="10.5">media (aquí tira)</tspan></text><path class="lead" d="M 302 188 L 380 193"/><circle class="ldot" cx="302" cy="188" r="2.3"/><text class="lbl" x="386" y="196" text-anchor="start"><tspan x="386" dy="0">Cabeza relajada</tspan><tspan x="386" dy="10.5">entre los brazos</tspan></text></svg>`,
    cues: ["De rodillas frente al banco, **rodillas justo bajo la cadera** y codos apoyados en el banco a la anchura de los hombros.", "**Deja caer el pecho hacia el suelo** manteniendo la cadera alta: el movimiento sale de la dorsal media, no de la lumbar.", "Cabeza relajada entre los brazos, costillas abajo y abdomen activo.", "Junto con el dorsal, es lo que abre la posición overhead del snatch y el jerk."],
  },
  "Trapecio y cuello lateral": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="sk" d="M 164.95 128.80 L 150.88 177.35 A 9.5 9.5 0 0 0 168.89 183.36 L 186.76 136.07 A 11.5 11.5 0 1 0 164.95 128.80 Z"/><path class="sk" d="M 150.55 179.06 L 146.54 219.26 A 7.5 7.5 0 0 0 161.35 221.48 L 169.31 181.87 A 9.5 9.5 0 1 0 150.55 179.06 Z"/><path class="sk" d="M 242.31 131.91 L 264.73 102.70 A 11 11 0 0 0 248.05 88.40 L 222.60 115.02 A 13 13 0 1 0 242.31 131.91 Z"/><path class="sk" d="M 196.10 136.63 L 202.08 218.20 A 30 30 0 0 0 261.92 218.20 L 267.90 136.63 A 36 36 0 1 0 196.10 136.63 Z"/><path class="sk" d="M 180.00 145.00 L 284.00 145.00 A 15 15 0 0 0 284.00 115.00 L 180.00 115.00 A 15 15 0 0 0 180.00 145.00 Z"/><path class="hl" d="M 224.58 110.60 L 194.23 121.67 A 11 11 0 1 0 202.40 142.08 L 232.00 129.17 A 10 10 0 0 0 224.58 110.60 Z"/><ellipse class="sk" cx="272" cy="78" rx="17.6" ry="22" transform="rotate(34 272 78)"/><path class="hair" d="M 260.4 62.2 Q 285 46.6 291 82.9 Z"/><circle class="eye" cx="266.8" cy="72.4" r="2.2"/><circle class="eye" cx="279.2" cy="80.7" r="2.2"/><path class="ln" d="M 272.2 77.6 L 268.8 82.7"/><path class="ln" d="M 262.2 84.7 L 269.5 89.6"/><path class="sk" d="M 291.31 136.88 L 332.04 103.33 A 9.5 9.5 0 0 0 320.53 88.23 L 277.38 118.60 A 11.5 11.5 0 1 0 291.31 136.88 Z"/><path class="sk" d="M 332.48 89.05 L 291.11 50.51 A 7.5 7.5 0 0 0 280.51 61.11 L 319.05 102.48 A 9.5 9.5 0 1 0 332.48 89.05 Z"/><circle class="sk" cx="282" cy="54" r="8"/><path class="ar" d="M 216 48 C 238 32 272 32 296 48"/><path class="ar" d="M 166 150 L 160 194"/><path class="lead" d="M 214 126 L 124 79"/><circle class="ldot" cx="214" cy="126" r="2.3"/><text class="lbl" x="118" y="82" text-anchor="end"><tspan x="118" dy="0">Trapecio superior</tspan><tspan x="118" dy="10.5">del lado estirado</tspan></text><path class="lead" d="M 176 140 L 124 137"/><circle class="ldot" cx="176" cy="140" r="2.3"/><text class="lbl" x="118" y="140" text-anchor="end"><tspan x="118" dy="0">ESTE hombro baja</tspan><tspan x="118" dy="10.5">y se queda abajo</tspan></text><path class="lead" d="M 258 48 L 336 51"/><circle class="ldot" cx="258" cy="48" r="2.3"/><text class="lbl" x="342" y="54" text-anchor="start"><tspan x="342" dy="0">Sin girar la cabeza:</tspan><tspan x="342" dy="10.5">la oreja va al hombro</tspan></text><path class="lead" d="M 306 76 L 336 107"/><circle class="ldot" cx="306" cy="76" r="2.3"/><text class="lbl" x="342" y="110" text-anchor="start"><tspan x="342" dy="0">La mano solo acompaña</tspan><tspan x="342" dy="10.5">el peso: nada de tirones</tspan></text><path class="lead" d="M 258 180 L 336 165"/><circle class="ldot" cx="258" cy="180" r="2.3"/><text class="lbl" x="342" y="168" text-anchor="start"><tspan x="342" dy="0">Tronco de frente,</tspan><tspan x="342" dy="10.5">sin inclinarte</tspan></text></svg>`,
    cues: ["**Lleva la oreja al hombro** del mismo lado. La mano solo acompaña el peso del brazo.", "Clave: **el hombro contrario baja y se queda abajo**. De ahí sale el estiramiento, no de tirar más fuerte.", "Sin girar la cabeza para el trapecio superior; barbilla hacia la axila para el elevador de la escápula.", "Nunca fuerces con tirones: es cuello."],
  },
  "Hombro cruzado": {
    svg: `<svg viewBox="-30 0 520 232" xmlns="http://www.w3.org/2000/svg" role="img"><style>.sk{fill:#cbd5e1;stroke:#0f172a;stroke-width:2;stroke-linejoin:round}.sk2{fill:#7f8b9c;stroke:#334155;stroke-width:1.8;stroke-linejoin:round}.hair{fill:#1e293b}.eye{fill:#0f172a}.ln{fill:none;stroke:#0f172a;stroke-width:1.4;stroke-linecap:round}.hl{fill:#fb923c;fill-opacity:.72;stroke:#ea580c;stroke-width:1.2}.ar{fill:none;stroke:#fb923c;stroke-width:3;stroke-linecap:round;marker-end:url(#arw)}.env{fill:none;stroke:#64748b;stroke-width:3;stroke-linecap:round}.env2{fill:none;stroke:#64748b;stroke-width:2.4;stroke-linecap:round}.envs{fill:none;stroke:#475569;stroke-width:1.6;stroke-linecap:round}.envf{fill:#334155;stroke:#64748b;stroke-width:2}.lead{fill:none;stroke:#64748b;stroke-width:.9}.ldot{fill:#fb923c}.lbl{font:500 10.5px -apple-system,Segoe UI,sans-serif;fill:#cbd5e1}</style><defs><marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#fb923c"/></marker></defs><path class="sk" d="M 196.08 130.45 L 202.07 218.05 A 30 30 0 0 0 261.93 218.05 L 267.92 130.45 A 36 36 0 1 0 196.08 130.45 Z"/><path class="sk" d="M 180.00 139.00 L 284.00 139.00 A 15 15 0 0 0 284.00 109.00 L 180.00 109.00 A 15 15 0 0 0 180.00 139.00 Z"/><ellipse class="sk" cx="232" cy="86" rx="17.6" ry="22" transform="rotate(0 232 86)"/><path class="hair" d="M 213.5 79.4 Q 232 50.6 250.5 79.4 Z"/><circle class="eye" cx="224.5" cy="84.2" r="2.2"/><circle class="eye" cx="239.5" cy="84.2" r="2.2"/><path class="ln" d="M 232 85.6 L 232 91.7"/><path class="ln" d="M 227.6 97 L 236.4 97"/><path class="sk" d="M 280.24 113.13 L 216.90 135.02 A 9.5 9.5 0 0 0 222.56 153.15 L 287.10 135.07 A 11.5 11.5 0 1 0 280.24 113.13 Z"/><path class="sk" d="M 218.82 134.57 L 171.07 140.56 A 7.5 7.5 0 0 0 172.31 155.49 L 220.40 153.49 A 9.5 9.5 0 1 0 218.82 134.57 Z"/><circle class="sk" cx="170" cy="148" r="8.5"/><path class="hl" d="M 281.55 109.09 L 262.72 122.71 A 9 9 0 0 0 271.95 138.09 L 292.83 127.88 A 11 11 0 1 0 281.55 109.09 Z"/><path class="sk2" d="M 164.53 123.24 L 160.52 183.37 A 9.5 9.5 0 0 0 179.42 185.26 L 187.40 125.52 A 11.5 11.5 0 1 0 164.53 123.24 Z"/><path class="sk2" d="M 174.37 192.44 L 243.45 156.66 A 7.5 7.5 0 0 0 236.90 143.17 L 166.07 175.35 A 9.5 9.5 0 1 0 174.37 192.44 Z"/><circle class="sk2" cx="242" cy="148" r="8"/><path class="ar" d="M 292 192 L 198 184"/><path class="lead" d="M 240 150 L 124 97"/><circle class="ldot" cx="240" cy="150" r="2.3"/><text class="lbl" x="118" y="100" text-anchor="end"><tspan x="118" dy="0">Engancha POR ENCIMA</tspan><tspan x="118" dy="10.5">del codo, no de la muñeca</tspan></text><path class="lead" d="M 214 192 L 124 167"/><circle class="ldot" cx="214" cy="192" r="2.3"/><text class="lbl" x="118" y="170" text-anchor="end"><tspan x="118" dy="0">Tronco de frente,</tspan><tspan x="118" dy="10.5">sin rotar el torso</tspan></text><path class="lead" d="M 290 116 L 336 57"/><circle class="ldot" cx="290" cy="116" r="2.3"/><text class="lbl" x="342" y="60" text-anchor="start"><tspan x="342" dy="0">Deltoides posterior</tspan><tspan x="342" dy="10.5">(aquí debe tirar)</tspan></text><path class="lead" d="M 200 146 L 336 115"/><circle class="ldot" cx="200" cy="146" r="2.3"/><text class="lbl" x="342" y="118" text-anchor="start"><tspan x="342" dy="0">Brazo recto cruzado</tspan><tspan x="342" dy="10.5">ante el pecho</tspan></text><path class="lead" d="M 272 128 L 336 171"/><circle class="ldot" cx="272" cy="128" r="2.3"/><text class="lbl" x="342" y="174" text-anchor="start"><tspan x="342" dy="0">Hombro abajo,</tspan><tspan x="342" dy="10.5">nunca hacia la oreja</tspan></text></svg>`,
    cues: ["Brazo recto cruzado ante el pecho; el otro antebrazo engancha **por encima del codo**, no de la muñeca.", "**Hombro abajo y atrás**: si sube hacia la oreja, el deltoides posterior deja de estirarse.", "Tronco de frente, sin rotar para ganar rango."],
  },
};

// Convierte los **negrita** de las claves en <strong> sin meter HTML crudo.
function boldParts(text) {
  return text.split('**').map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: '#e2e8f0', fontWeight: 700 }}>{part}</strong>
      : <span key={i}>{part}</span>
  );
}

// Ficha emergente con el dibujo y las claves de ejecución del estiramiento.
function StretchInfo({ name, onClose }) {
  const g = STRETCH_GUIDE[name];
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (!g) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,6,23,.82)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '24px 12px', overflowY: 'auto'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f172a', border: '1px solid #334155', borderRadius: 14,
          maxWidth: 560, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)'
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
          borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f172a'
        }}>
          <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0 }}>{name}</div>
          <button
            onClick={onClose}
            style={{
              background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
              borderRadius: 8, width: 30, height: 30, fontSize: 16, cursor: 'pointer', flexShrink: 0
            }}
          >×</button>
        </div>

        <div
          style={{ background: '#0b1220', padding: '2px 0' }}
          dangerouslySetInnerHTML={{ __html: g.svg }}
        />

        <div style={{
          display: 'flex', gap: 14, flexWrap: 'wrap', padding: '8px 14px',
          borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b',
          color: '#64748b', fontSize: 10.5
        }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#cbd5e1', marginRight: 5 }} />lado cercano</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#7f8b9c', marginRight: 5 }} />lado lejano</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#fb923c', marginRight: 5 }} />músculo que tira</span>
          <span><span style={{ display: 'inline-block', width: 14, height: 2, background: '#fb923c', marginRight: 5, verticalAlign: 'middle' }} />dirección</span>
        </div>

        <div style={{ padding: '12px 16px 16px' }}>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#94a3b8', fontSize: 13, lineHeight: 1.55 }}>
            {g.cues.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{boldParts(c)}</li>)}
          </ul>
          {g.warn && (
            <div style={{
              marginTop: 10, padding: '9px 11px', borderRadius: 8,
              background: 'rgba(220,38,38,.12)', border: '1px solid rgba(248,113,113,.35)',
              color: '#fca5a5', fontSize: 12, lineHeight: 1.5
            }}>
              ⚠️ {g.warn}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Tarjeta de cada bloque del miércoles: nombre, contador de series en vivo
// (lee del contexto compartido sólo si este es el bloque activo ahora mismo)
// y el botón que arranca la cuenta atrás.
function StretchCard({ s }) {
  const rest = useRest();
  const [info, setInfo] = useState(false);
  const hasGuide = !!STRETCH_GUIDE[s.name];
  const isActive = rest && rest.active && rest.active.id === s.name;
  const hasSets = s.sets > 1;
  let badge = null;
  if (isActive) {
    const finished = rest.nextSet > s.sets;
    badge = finished
      ? '✓ completo'
      : hasSets
        ? `serie ${Math.min(rest.nextSet, s.sets)}/${s.sets}`
        : (rest.running ? 'en marcha' : 'preparado');
  }
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
      padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ color: '#f8fafc', fontSize: 14 }}>{s.name}</div>
          {hasGuide && (
            <button
              onClick={() => setInfo(true)}
              title="Ver cómo se hace"
              aria-label={'Cómo se hace: ' + s.name}
              style={{
                background: '#0f172a', color: '#38bdf8', border: '1px solid #334155',
                borderRadius: 999, width: 20, height: 20, fontSize: 12, fontWeight: 700,
                lineHeight: 1, cursor: 'pointer', flexShrink: 0, padding: 0
              }}
            >?</button>
          )}
        </div>
        {badge && (
          <div style={{ color: '#5eead4', fontSize: 11, fontWeight: 700, marginTop: 2 }}>{badge}</div>
        )}
        {s.cue && (
          <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.4, marginTop: 3 }}>{s.cue}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 500 }}>{s.duration}</span>
        <HoldButton id={s.name} seconds={s.totalSec} sets={s.sets} compact />
      </div>
      {info && <StretchInfo name={s.name} onClose={() => setInfo(false)} />}
    </div>
  );
}

// ─── NUTRITION DATA ───────────────────────────────────────────────────────────
// REORGANIZADO 18/08/2026 por espaciado de absorción. Antes: 4 A + 1 C + 2 B con
// los dos días B pegados (Vie-Sáb). Ahora: 3 A + 2 B + 2 C, con los cuatro
// almuerzos de hierro hemo separados 2 días entre sí — Dom → Mar → Jue → Sáb.
// Motivo: una carga de hierro eleva la hepcidina y frena la absorción de la
// siguiente ~24 h, así que días consecutivos se aprovechan a medias.
// LAS CANTIDADES SEMANALES DE COMPRA NO CAMBIAN. Es puro reordenamiento:
// 1,35 kg pollo · 150 g hígado · 500 g salmón · 440 g ternera, igual que antes.
//
// TRES REGLAS QUE NO SE PUEDEN ROMPER (motivo: absorción de hierro):
//  1. El Skyr va SOLO a las 11:30, nunca dentro del desayuno. Sus ~675mg de
//     calcio bloqueaban el hierro no hemo de las semillas y las espinacas.
//  2. La fruta del desayuno debe ser cítrica (kiwi/mandarina/naranja/fresas).
//     La vitamina C solo potencia el hierro NO hemo, que está todo ahí.
//  3. El almuerzo no lleva lácteo. La fruta del almuerzo es libre.
const NUTRITION = {
  A: {
    label: 'Días A',
    days: 'Lun · Mié · Vie',
    color: '#3B82F6',
    meals: [
      {
        name: '🍳 Desayuno (~8:30) — hora cero',
        items: [
          { food: 'Huevos', amount: '4 uds', macros: '28g P · 20g G · 2g C' },
          { food: 'Espinacas', amount: '140g', macros: '4g P · 1g G · 5g C' },
          { food: 'Semillas de calabaza — POR ENCIMA, no dentro de la tortilla', amount: '25g', macros: '5g P · 7g G · 2g C' },
          { food: 'Ajo', amount: 'al gusto', macros: '—' },
          { food: '⚠️ Fruta CÍTRICA (kiwi/mandarina/naranja/fresas)', amount: '~150g', macros: '1g P · 0g G · 20g C' },
        ]
      },
      {
        name: '🥛 Skyr — desayuno + 3 h (~11:30)',
        items: [
          { food: 'Arla Skyr', amount: '450g', macros: '50g P · 2g G · 27g C' },
        ]
      },
      {
        name: '🧀 Parmesano — desayuno + 4 h 30 (~13:00) · parmesano móvil',
        items: [
          { food: 'Parmesano (en trozo, no dentro del yogur)', amount: '50g', macros: '18g P · 13g G · 2g C' },
        ]
      },
      {
        name: '🍗 Almuerzo (~14:30) · sin lácteo · sin hierro que proteger',
        items: [
          { food: 'Pechuga de pollo', amount: '300g', raw: 300, cooked: 225, yield: 0.75, macros: '69g P · 8g G · 0g C' },
          { food: 'Arroz (cocido)', amount: '100g', macros: '3g P · 0g G · 28g C' },
          { food: 'Sofrito — Tomate', amount: '80g', macros: '1g P · 0g G · 4g C' },
          { food: 'Sofrito — Pimiento', amount: '60g', macros: '1g P · 0g G · 3g C' },
          { food: 'Sofrito — Calabacín', amount: '50g', macros: '0g P · 0g G · 2g C' },
          { food: 'Sofrito — Ajo', amount: '2 dientes', macros: '—' },
          { food: 'Brócoli', amount: '200g', macros: '6g P · 1g G · 14g C' },
          { food: '🌱 Mostaza parda en polvo — AL SERVIR, plato < 60°C', amount: '1g', macros: '—' },
          { food: 'Aceite de oliva', amount: '25ml', macros: '0g P · 23g G · 0g C' },
          { food: 'Fruta (la que quieras)', amount: '~150g', macros: '1g P · 0g G · 12g C' },
        ]
      }
    ],
    totals: { kcal: 1975, protein: 205, fat: 84, carbs: 103 },
    carbFood: 'Arroz (cocido)'
  },
  C: {
    label: 'Días C · Hígado',
    days: 'Dom · Jue',
    color: '#A855F7',
    note: 'Hígado DE POLLO, no de ternera: casi el doble de hierro (~12 vs ~6,5 mg/100g) y un tercio de la vitamina A preformada. PARTIDO EN 2 RACIONES DE 75 g (18/08/2026) — mismos 150 g semanales, pero domingo y jueves. La absorción fraccional del hierro cae con el tamaño de la dosis: dos raciones pequeñas separadas 4 días rinden más hierro absorbido que una de 150 g, y cada una queda en ~2.450 µg de retinol, por debajo del límite de 3.000 µg/día (el exceso de vitamina A también provoca caída de pelo). Se compran los 150 g el sábado: la del domingo va fresca a la nevera y se cocina el domingo; la del jueves se congela CRUDA el sábado (cocinada y congelada queda arenosa), se descongela el martes por la noche y se cocina el miércoles por la tarde. 4 min a fuego fuerte, mínimo aceite, rosa por dentro. Y OJO: buena parte del hierro del hígado NO es hemo, es no hemo unido a ferritina — por eso la fruta de este almuerzo tiene que ser cítrica.',
    meals: [
      {
        name: '🍳 Desayuno (~8:30) — hora cero · igual que días A',
        items: [
          { food: 'Huevos', amount: '4 uds', macros: '28g P · 20g G · 2g C' },
          { food: 'Espinacas', amount: '140g', macros: '4g P · 1g G · 5g C' },
          { food: 'Semillas de calabaza — POR ENCIMA, no dentro de la tortilla', amount: '25g', macros: '5g P · 7g G · 2g C' },
          { food: 'Ajo', amount: 'al gusto', macros: '—' },
          { food: '⚠️ Fruta CÍTRICA (kiwi/mandarina/naranja/fresas)', amount: '~150g', macros: '1g P · 0g G · 20g C' },
        ]
      },
      {
        name: '🥛 Skyr — desayuno + 3 h (~11:30)',
        items: [
          { food: 'Arla Skyr', amount: '450g', macros: '50g P · 2g G · 27g C' },
        ]
      },
      {
        name: '🧀 Parmesano — desayuno + 3 h 30 (~12:00)',
        items: [
          { food: 'Parmesano (en trozo, no dentro del yogur)', amount: '50g', macros: '18g P · 13g G · 2g C' },
        ]
      },
      {
        name: '🫀 Almuerzo — parmesano + 2 h 30 (~14:30) · día de hierro',
        items: [
          { food: 'Hígado de pollo', amount: '75g', raw: 75, cooked: 52, yield: 0.70, macros: '13g P · 4g G · 1g C' },
          { food: 'Pechuga de pollo', amount: '225g', raw: 225, cooked: 169, yield: 0.75, macros: '52g P · 6g G · 0g C' },
          { food: 'Arroz (cocido)', amount: '100g', macros: '3g P · 0g G · 28g C' },
          { food: 'Sofrito — Tomate', amount: '80g', macros: '1g P · 0g G · 4g C' },
          { food: 'Sofrito — Pimiento', amount: '60g', macros: '1g P · 0g G · 3g C' },
          { food: 'Sofrito — Calabacín', amount: '50g', macros: '0g P · 0g G · 2g C' },
          { food: 'Sofrito — Ajo', amount: '2 dientes', macros: '—' },
          { food: 'Brócoli', amount: '200g', macros: '6g P · 1g G · 14g C' },
          { food: '🌱 Mostaza parda en polvo — AL SERVIR, plato < 60°C', amount: '1g', macros: '—' },
          { food: 'Aceite de oliva', amount: '22ml', macros: '0g P · 20g G · 0g C' },
          { food: '⚠️ Fruta CÍTRICA (día de hierro)', amount: '~150g', macros: '1g P · 0g G · 12g C' },
        ]
      }
    ],
    totals: { kcal: 1975, protein: 204, fat: 84, carbs: 103 },
    carbFood: 'Arroz (cocido)'
  },
  B: {
    label: 'Días B',
    days: 'Mar · Sáb',
    color: '#F59E0B',
    meals: [
      {
        name: '🐟 Desayuno (~8:30) — hora cero',
        items: [
          { food: 'Huevos', amount: '4 uds', macros: '28g P · 20g G · 2g C' },
          { food: 'Aceite de oliva (tortilla)', amount: '5ml', macros: '0g P · 5g G · 0g C' },
          { food: 'Salmón', amount: '250g', raw: 250, cooked: 200, yield: 0.80, macros: '50g P · 33g G · 0g C' },
          { food: 'Boniato (cocido)', amount: '100g', macros: '2g P · 0g G · 17g C' },
          { food: '⚠️ Fruta CÍTRICA (kiwi/mandarina/naranja/fresas)', amount: '~150g', macros: '1g P · 0g G · 20g C' },
        ]
      },
      {
        name: '🥛 Skyr — desayuno + 3 h (~11:30)',
        items: [
          { food: 'Arla Skyr', amount: '450g', macros: '50g P · 2g G · 27g C' },
        ]
      },
      {
        name: '🥩 Almuerzo — Skyr + 3 h (~14:30) · sin lácteo',
        items: [
          { food: 'Ternera magra', amount: '220g', raw: 220, cooked: 161, yield: 0.73, macros: '46g P · 15g G · 0g C' },
          { food: 'Patata (cocida)', amount: '100g', macros: '2g P · 0g G · 17g C' },
          { food: 'Brócoli', amount: '200g', macros: '6g P · 1g G · 14g C' },
          { food: '🌱 Mostaza parda en polvo — AL SERVIR, plato < 60°C', amount: '1g', macros: '—' },
          { food: 'Aceite de oliva', amount: '15ml', macros: '0g P · 14g G · 0g C' },
          { food: '⚠️ Fruta CÍTRICA (día de hierro)', amount: '~150g', macros: '1g P · 0g G · 12g C' },
        ]
      }
    ],
    totals: { kcal: 2030, protein: 191, fat: 97, carbs: 98 },
    carbFood: 'Boniato / Patata (cocidos)'
  }
};

// ─── FASES DE NUTRICIÓN ──────────────────────────────────────────────────────
// Mismas 4 fases que ya usa PROG (Base/Transición/Intensidad/Peak) — una sola
// fuente de verdad de "en qué fase estoy" para fuerza y para nutrición.
// El extra se añade siempre vía carbohidrato + fruta + aceite (no proteína,
// que ya está cubierta) para sostener el gasto del condicionamiento nuevo sin
// tocar las cantidades de pollo/salmón/ternera que ya calibran la proteína.
// Recalibrado 8/08/2026 — TECHO DE DÉFICIT AL 20%.
// La versión anterior dejaba la fase Base en 1.991 kcal de media semanal, un
// 27,6% de déficit y 0,69 kg/semana (0,76% del peso corporal). Eso está en el
// rango donde aparece la pérdida de pelo por efluvio telógeno y la pérdida de
// masa magra. Ahora ninguna fase pasa del 20% de déficit ni del 0,55%/semana.
//
// Media semanal con el reparto 3 días A + 2 días B + 2 días C (base 1.991 kcal).
// 18/08/2026: el reparto cambió de 4A+1C+2B a 3A+2B+2C y la media semanal pasa de
// 1.990 a 1.991 kcal — o sea, la tabla de fases de abajo sigue siendo válida tal cual.
//   Base       2.202 kcal · déficit 19,9% · 0,50 kg/sem
//   Transición 2.257 kcal · déficit 17,9% · 0,45 kg/sem
//   Intensidad 2.306 kcal · déficit 16,1% · 0,40 kg/sem
//   Peak       2.360 kcal · déficit 14,2% · 0,35 kg/sem
//
// Gasto de referencia 2.750 kcal (Katch-McArdle sobre 70,8 kg de magra = 1.900
// de basal, por 7 sesiones semanales). NO es el 2.600 que decía el plan viejo,
// que estaba infraestimado. Sigue siendo una ESTIMACIÓN: la que manda es la
// regla de corrección de la pestaña Seguimiento.
//
// El extra entra por carbohidrato + fruta + aceite, NUNCA proteína: ya estás en
// 2,25 g/kg de peso (2,90 g/kg de magra), por encima de la meseta. Además el
// mismo aporte como pollo cuesta ~10 €/semana frente a ~1 € como arroz.
const PHASE_ADD = {
  'Base':       { carbG: 135, fruitG: 100, oilMl: 0 },
  'Transición': { carbG: 160, fruitG: 100, oilMl: 3 },
  'Intensidad': { carbG: 180, fruitG: 100, oilMl: 6 },
  'Peak':       { carbG: 210, fruitG: 120, oilMl: 7 },
};
function phaseAddMacros(p) {
  const carbKcal = p.carbG * 1.2, carbCarbs = p.carbG * 0.28, carbProt = p.carbG * 0.02;
  const fruitKcal = p.fruitG * 0.5, fruitCarbs = p.fruitG * 0.13;
  const oilKcal = p.oilMl * 8.3, oilFat = p.oilMl * 0.92;
  return {
    kcal: Math.round(carbKcal + fruitKcal + oilKcal),
    protein: Math.round(carbProt),
    fat: Math.round(oilFat),
    carbs: Math.round(carbCarbs + fruitCarbs),
  };
}

// ─── SUPPLEMENTS ─────────────────────────────────────────────────────────────
const SUPPS = [
  {
    name: 'D3 + K2',
    brand: 'Natural Elements',
    dose: '1 comprimido / día',
    timing: 'Almuerzo · con aceite oliva + magnesio + 2 cáps omega-3',
    detail: '2.000 UI D3 · K2VITAL® MK-7 >99.7% all-trans',
    why: 'Braunschweig 52°N — déficit solar Sep–Abr (más largo que a latitudes del sur). D3 para inmunidad, K2 para calcio óseo.',
    color: '#F59E0B'
  },
  {
    name: 'Omega-3',
    brand: 'Natural Elements',
    dose: '3 cáps / día — ⏭ NINGUNA los días B (Mar y Sáb)',
    timing: 'Desayuno: 1 cáp · Almuerzo: 2 cáps (con D3+K2 y magnesio). Días de salmón: saltarlas enteras.',
    detail: '1.000mg aceite de pescado/cápsula · forma triglicérido (TG) · 800mg EPA+DHA/cáp',
    why: '2,4g EPA+DHA diarios. Forma TG = mejor absorción que ésteres etílicos. Cubre los días SIN salmón — y solo esos: 18/08/2026 se retiran los días B, porque 250g de salmón ya dan ~5.000mg de EPA+DHA frente a un objetivo de 2.000. Tomarlas ahí era desperdicio puro. Son 6 cápsulas menos por semana: el bote de 120 pasa de ~40 a ~57 días.',
    color: '#3B82F6'
  },
  {
    name: 'Magnesio Bisglicinato',
    brand: 'Natural Elements',
    dose: '1 cápsula / día',
    timing: 'Con el almuerzo',
    detail: '300mg magnesio elemental · forma quelada bisglicinato',
    why: 'La dieta aporta ~235–265mg vs objetivo 450–500mg. Sin legumbres/avena/frutos secos para cubrir déficit con comida.',
    color: '#22C55E'
  },
    {
    name: 'Zinc',
    brand: 'Natural Elements',
    dose: '⏸ SUSPENDIDO — no tomar hasta la analítica',
    timing: '—',
    detail: '25mg/comprimido · Albion® Zinc Bisglicinato (en pausa desde 8/08/2026)',
    why: 'Dos motivos. (1) Interfiere con el hierro: el zinc y el hierro no hemo compiten por el mismo transportador (DMT1), y 12,5mg en el desayuno chocaban de frente con las semillas de calabaza y las espinacas — justo lo que se está intentando proteger. (2) Suplementar a ciegas induce déficit de cobre, y el déficit de cobre da anemia Y caída de pelo, o sea el síntoma que se quiere arreglar. La dieta aporta 8-9mg contra un objetivo de 11: hay hueco, pero pequeño, y el hígado de domingo y jueves (~2mg de zinc por ración de 75g, y de las mejores fuentes de cobre que existen) más el parmesano (~2mg) y la ternera de martes y sábado (~10mg) lo cubren casi entero. Retomar solo si la analítica lo justifica; si se retoma, va en el ALMUERZO y saltándolo los días con hígado (Dom y Jue). NOTA 18/08/2026: con el zinc fuera, los días A se quedan en ~8,3mg frente a un objetivo de 12-15 y la media semanal en ~9,6mg. Es el único hueco real que deja la suspensión, y es el primer parámetro a mirar cuando llegue la analítica.',
    color: '#64748b',
    paused: true
  },
];

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

// ─── MOTOR DEL CONTADOR DE DESCANSO ──────────────────────────────────────────
// Un único contador activo en toda la app: si arrancas el de otro ejercicio, el
// anterior se cancela. Así no hay dos cuentas atrás compitiendo a mitad de
// sesión.
//
// La cuenta atrás se calcula contra un timestamp objetivo (no sumando ticks),
// porque el navegador del móvil ralentiza los intervalos cuando la pantalla se
// apaga o cambias de app. Con deadline, al volver el tiempo restante es el real.
const RestCtx = createContext(null);
const useRest = () => useContext(RestCtx);

function RestProvider({ children }) {
  const [active, setActive] = useState(null);   // { id, label, total, sets, mode }
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [nextSet, setNextSet] = useState(2);
  const [flash, setFlash] = useState(false);    // pulso visual al llegar a cero

  const deadlineRef = useRef(null);
  const audioRef = useRef(null);
  const wakeRef = useRef(null);

  // El AudioContext debe crearse/reanudarse dentro de un gesto del usuario o iOS
  // lo deja mudo. Se crea en el primer toque de "iniciar" y se reutiliza.
  const unlockAudio = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioRef.current) audioRef.current = new Ctx();
      if (audioRef.current.state === 'suspended') audioRef.current.resume();
    } catch {}
  }, []);

  const beep = useCallback(() => {
    try {
      const ac = audioRef.current;
      if (ac && ac.state !== 'closed') {
        const t0 = ac.currentTime;
        [0, 0.30, 0.60].forEach((off, i) => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = 'sine';
          osc.frequency.value = i === 2 ? 1245 : 880;
          osc.connect(gain);
          gain.connect(ac.destination);
          gain.gain.setValueAtTime(0.0001, t0 + off);
          gain.gain.exponentialRampToValueAtTime(0.4, t0 + off + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + (i === 2 ? 0.45 : 0.24));
          osc.start(t0 + off);
          osc.stop(t0 + off + (i === 2 ? 0.5 : 0.28));
        });
      }
    } catch {}
    try { navigator.vibrate && navigator.vibrate([180, 90, 180, 90, 400]); } catch {}
  }, []);

  const releaseWake = useCallback(() => {
    try { wakeRef.current && wakeRef.current.release(); } catch {}
    wakeRef.current = null;
  }, []);

  const requestWake = useCallback(() => {
    try {
      if (navigator.wakeLock && !wakeRef.current) {
        navigator.wakeLock.request('screen')
          .then(l => { wakeRef.current = l; })
          .catch(() => {});
      }
    } catch {}
  }, []);

  const stop = useCallback(() => {
    deadlineRef.current = null;
    setRunning(false);
    setActive(null);
    setLeft(0);
    setNextSet(2);
    releaseWake();
  }, [releaseWake]);

  // Arranca (o reinicia) el contador de un ejercicio concreto.
  // mode: 'rest' (descanso entre series de fuerza) | 'hold' (duración activa de
  // un estiramiento o de un bloque de piscina/cardio del miércoles) — mismo
  // motor de cuenta atrás, solo cambia el texto que se muestra en la barra.
  const start = useCallback((id, label, seconds, sets, mode = 'rest', unit = 'serie') => {
    unlockAudio();
    requestWake();
    setActive(prev => {
      // Cambiar de ejercicio reinicia el contador de series desde el principio.
      // El punto de partida depende del modo: en 'rest' pulsas el botón
      // DESPUÉS de levantar la serie 1 (así que el descanso ya apunta a la
      // serie 2 — nunca hay "descanso antes de la serie 1"). En 'hold' pulsas
      // el botón para EMPEZAR a aguantar/nadar la serie 1 (así que debe
      // mostrar "serie 1", no "serie 2", desde el primer instante).
      if (!prev || prev.id !== id) setNextSet(mode === 'hold' ? 1 : 2);
      return { id, label, total: seconds, sets, mode, unit };
    });
    setLeft(seconds);
    deadlineRef.current = Date.now() + seconds * 1000;
    setRunning(true);
  }, [unlockAudio, requestWake]);

  const pause = useCallback(() => {
    if (!running) return;
    const rem = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
    deadlineRef.current = null;
    setLeft(rem);
    setRunning(false);
    releaseWake();
  }, [running, releaseWake]);

  const resume = useCallback(() => {
    if (running || !active) return;
    unlockAudio();
    requestWake();
    deadlineRef.current = Date.now() + left * 1000;
    setRunning(true);
  }, [running, active, left, unlockAudio, requestWake]);

  // Ajuste rápido ±15 s sin salir del contador (la barra pesada de hoy no es la
  // de la semana que viene).
  const adjust = useCallback((delta) => {
    setLeft(prev => {
      const next = Math.max(5, prev + delta);
      if (running && deadlineRef.current) deadlineRef.current = Date.now() + next * 1000;
      return next;
    });
  }, [running]);

  // Salta al final: marca la serie como descansada sin esperar.
  const skip = useCallback(() => {
    if (!active) return;
    deadlineRef.current = null;
    setRunning(false);
    setLeft(active.total);
    setNextSet(n => Math.min(n + 1, active.sets + 1));
    releaseWake();
  }, [active, releaseWake]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (!deadlineRef.current) return;
      const rem = Math.round((deadlineRef.current - Date.now()) / 1000);
      if (rem <= 0) {
        deadlineRef.current = null;
        setRunning(false);
        beep();
        setFlash(true);
        setTimeout(() => setFlash(false), 2500);
        // Vuelve al estado de espera, ya recargado para la serie siguiente.
        setActive(a => {
          if (a) { setLeft(a.total); setNextSet(n => Math.min(n + 1, a.sets + 1)); }
          return a;
        });
        releaseWake();
      } else {
        setLeft(rem);
      }
    };
    const iv = setInterval(tick, 250);
    tick();
    return () => clearInterval(iv);
  }, [running, beep, releaseWake]);

  // Al volver de segundo plano el wake lock se pierde: hay que repedirlo.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && running) requestWake(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [running, requestWake]);

  useEffect(() => () => releaseWake(), [releaseWake]);

  const value = {
    active, left, running, nextSet, flash,
    start, stop, pause, resume, adjust, skip,
  };
  return <RestCtx.Provider value={value}>{children}</RestCtx.Provider>;
}

// Botón por ejercicio: muestra el descanso prescrito y arranca la cuenta atrás.
function RestButton({ ex, weekIdx, compact }) {
  const rest = useRest();
  const seconds = restSecondsFor(ex, weekIdx);
  const sets = setsCountFor(ex, weekIdx);
  const isActive = rest && rest.active && rest.active.id === ex.name;
  const live = isActive && rest.running;
  return (
    <button
      onClick={() => rest.start(ex.name, ex.name, seconds, sets)}
      title={`Descanso prescrito entre series: ${fmtClock(seconds)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: compact ? '4px 9px' : '5px 11px',
        borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${isActive ? '#38bdf8' : '#334155'}`,
        background: isActive ? '#0c4a6e' : '#0f172a',
        color: isActive ? '#7dd3fc' : '#94a3b8',
        fontSize: compact ? 11 : 12, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}>
      ⏱ {live ? fmtClock(rest.left) : fmtClock(seconds)}
    </button>
  );
}

// Botón para el miércoles: la cuenta atrás ES el ejercicio (aguantar el
// estiramiento, o nadar/caminar el bloque de piscina), no un descanso entre
// series de fuerza — mismo motor que RestButton, mode='hold'.
function HoldButton({ id, seconds, sets, compact }) {
  const rest = useRest();
  const isActive = rest && rest.active && rest.active.id === id;
  const live = isActive && rest.running;
  return (
    <button
      onClick={() => rest.start(id, id, seconds, sets, 'hold')}
      title={sets > 1 ? `${fmtClock(seconds)} × ${sets} series` : `Duración: ${fmtClock(seconds)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: compact ? '4px 9px' : '5px 11px',
        borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${isActive ? '#2dd4bf' : '#334155'}`,
        background: isActive ? '#134e4a' : '#0f172a',
        color: isActive ? '#5eead4' : '#94a3b8',
        fontSize: compact ? 11 : 12, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}>
      ⏱ {live ? fmtClock(rest.left) : fmtClock(seconds)}
    </button>
  );
}

// Botón de descanso para las tarjetas de TEST (no de entrenamiento normal):
// mismo motor que RestButton (mode='rest'), pero con segundos/series/unidad
// explícitos en vez de calculados por categoría+fase — el test no tiene fase
// ni sigue el esquema semanal de PROG. `unit` cambia la palabra que se muestra
// en la barra ("carga" en el perfil carga-velocidad, "serie" en el resto).
// sets<=1 se usa para los intentos de escalera sin número fijo (sube hasta
// que la técnica se rompa): cada pulsación es sólo "otro descanso", sin
// marcar nunca "ejercicio completado".
function TestRestButton({ id, label, seconds, sets = 1, unit = 'serie', compact }) {
  const rest = useRest();
  const isActive = rest && rest.active && rest.active.id === id;
  const live = isActive && rest.running;
  return (
    <button
      onClick={() => rest.start(id, label || id, seconds, sets, 'rest', unit)}
      title={sets > 1 ? `${fmtClock(seconds)} entre cada ${unit}` : `Descanso: ${fmtClock(seconds)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: compact ? '4px 9px' : '5px 11px',
        borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${isActive ? '#38bdf8' : '#334155'}`,
        background: isActive ? '#0c4a6e' : '#0f172a',
        color: isActive ? '#7dd3fc' : '#94a3b8',
        fontSize: compact ? 11 : 12, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}>
      ⏱ {live ? fmtClock(rest.left) : fmtClock(seconds)}
    </button>
  );
}

// Texto y color de la barra según el modo — descanso entre series de fuerza
// frente a mantener un estiramiento o un bloque continuo de piscina (sin
// series, p.ej. nado o pool walking, donde sets=1 y no hay "serie X de Y").
function restBarStatus({ mode, sets, nextSet, running, flash, unit = 'serie' }) {
  // "finished" (ejercicio completado, ya no cuenta series) sólo tiene sentido
  // cuando hay un número de series/cargas fijo. Con sets<=1 — un intento
  // indefinido, como el ladder de "sube hasta que la técnica se rompa" — no
  // hay un final que declarar: cada pulsación es simplemente otro descanso
  // antes del siguiente intento, sin límite. Calcularlo sin este guard fue
  // justo el bug que rompía el miércoles con sets=1 (ver HoldButton).
  const hasSets = sets > 1;
  const finished = hasSets && nextSet > sets;
  if (mode === 'hold') {
    if (flash)    return hasSets ? `✓ ${unit} completada` : '✓ Completado';
    if (finished) return 'Ejercicio completado';
    if (hasSets)  return running ? `Manteniendo → ${unit} ${nextSet} de ${sets}` : `Preparado → ${unit} ${nextSet} de ${sets}`;
    return running ? 'En marcha' : 'Preparado';
  }
  if (flash)    return 'Descanso completado';
  if (finished) return 'Ejercicio completado';
  if (hasSets)  return running ? `Descansando → ${unit} ${nextSet} de ${sets}` : `En espera → ${unit} ${nextSet} de ${sets}`;
  return running ? 'Descansando' : 'En espera';
}

// Barra fija inferior: visible mientras haces scroll al ejercicio siguiente.
function RestBar() {
  const rest = useRest();
  if (!rest || !rest.active) return null;
  const { active, left, running, nextSet, flash } = rest;
  const pct = active.total ? Math.max(0, Math.min(100, (left / active.total) * 100)) : 0;
  const isHold = active.mode === 'hold';
  const accent = flash ? '#22C55E' : running ? (isHold ? '#2dd4bf' : '#38bdf8') : '#fbbf24';
  const statusText = restBarStatus({ mode: active.mode, sets: active.sets, nextSet, running, flash, unit: active.unit });

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
      background: '#0b1220', borderTop: `1px solid ${accent}55`,
      boxShadow: '0 -8px 24px rgba(0,0,0,0.55)',
      padding: '10px 14px calc(10px + env(safe-area-inset-bottom, 0px))',
    }}>
      {/* Barra de progreso */}
      <div style={{ height: 4, borderRadius: 999, background: '#1e293b', overflow: 'hidden', marginBottom: 9 }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: accent,
          transition: 'width 0.25s linear',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: '#f8fafc', fontSize: 13, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {active.label}
          </div>
          <div style={{ color: flash ? '#22C55E' : '#64748b', fontSize: 11, marginTop: 1 }}>
            {statusText}
          </div>
        </div>

        <div style={{
          color: accent, fontSize: 30, fontWeight: 800,
          fontVariantNumeric: 'tabular-nums', letterSpacing: -1, minWidth: 78,
          textAlign: 'right',
        }}>
          {fmtClock(left)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        <button onClick={() => rest.adjust(-15)} style={barBtn('#1e293b', '#94a3b8')}>−15s</button>
        <button onClick={() => rest.adjust(15)} style={barBtn('#1e293b', '#94a3b8')}>+15s</button>
        <button
          onClick={() => (running ? rest.pause() : rest.resume())}
          style={{ ...barBtn(running ? '#78350f' : '#065f46', running ? '#fcd34d' : '#6ee7b7'), flex: 2 }}>
          {running ? '⏸ Pausa' : '▶ Iniciar'}
        </button>
        <button onClick={() => rest.skip()} style={barBtn('#1e293b', '#94a3b8')}>Saltar</button>
        <button onClick={() => rest.stop()} style={barBtn('#1e293b', '#64748b')}>✕</button>
      </div>
    </div>
  );
}

const barBtn = (bg, color) => ({
  flex: 1, padding: '10px 6px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: bg, color, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
});

function PhasePill({ weekIdx }) {
  const p = PROG[weekIdx];
  return (
    <span style={{
      background: p.color + '22', color: p.color,
      border: `1px solid ${p.color}55`,
      borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600
    }}>
      {p.phase} · {Math.round(p.pct * 100)}% RM · RIR {p.rir}
    </span>
  );
}

function OlympicTable({ ex, weekIdx, rmStore }) {
  const effRM = effectiveRM(ex, rmStore);
  const overridden = effRM !== ex.rm;
  const weekSets = ex.sets[weekIdx];   // [% RM, reps] x4
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#f8fafc', fontWeight: 600, fontSize: 14 }}>🏋️ {ex.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: overridden ? '#22C55E' : '#94a3b8', fontSize: 12 }}>
            RM: {effRM}kg {overridden && '✓ test'}
          </span>
          <RestButton ex={ex} weekIdx={weekIdx} compact />
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            background: '#0f172a', borderRadius: 6, padding: '8px 10px', textAlign: 'center'
          }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>Serie {i+1}</div>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 16 }}>{wtOly(effRM, weekSets[i*2])}kg</div>
            <div style={{ color: '#475569', fontSize: 10 }}>{weekSets[i*2]}%</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>×{weekSets[i*2+1]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NonOlympicRow({ ex, weekIdx, rmStore }) {
  const prog = PROG[weekIdx];
  // Un ejercicio puede llevar su propia intensidad/repeticiones por fase
  // (ej. la sentadilla de volumen del miércoles), al margen de la tabla PROG.
  const own = ex.byPhase ? ex.byPhase[prog.phase] : null;
  const p = own ? { ...prog, pct: own.pct, sets: own.sets, rir: 2 } : prog;
  const effRM = effectiveRM(ex, rmStore);
  const overridden = effRM !== ex.rm;
  // La descarga multiplica el peso final y NO toca el RM: así sigue valiendo
  // aunque el dispositivo tenga guardado el RM del último test.
  const dl = deloadStatus(ex.deload);
  const targetKg = effRM * (ex.deload ? ex.deload.factor : 1) * p.pct;
  let weight = wt(effRM * (ex.deload ? ex.deload.factor : 1), p.pct);
  if (ex.dumbbell) weight = nearestDumbbell(weight);
  // Cargas que sólo existen en escalones propios (`step`). En la torre de flys y
  // butterfly reverse los escalones son de 1,5 kg — corregido el 24/08/2026, antes
  // ponía 3,75 porque se daba por bueno un multiplicador ×1,5 que no existe.
  // El redondeo genérico al 2,5 pedía números que no hay en la máquina. Se redondea
  // al múltiplo de `step` más CERCANO —no hacia arriba— porque hacia arriba se sale
  // del rango útil.
  else if (ex.step) weight = Math.max(ex.step, Math.round(targetKg / ex.step) * ex.step);
  const isArm = ex.unit === 'kg/arm';
  const backoffWeight = ex.backoff ? wt(effRM, p.pct * ex.backoff.factor) : null;
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 500 }}>{ex.name}</div>
          <div style={{ color: overridden ? '#22C55E' : '#64748b', fontSize: 12 }}>
            RM: {effRM} {ex.unit} {overridden && '✓ test'}
          </div>
          {dl && (
            <div style={{
              display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 999,
              background: dl.overdue ? '#7c2d12' : '#1c1917',
              border: `1px solid ${dl.overdue ? '#F59E0B' : '#78350f'}`,
              color: dl.overdue ? '#fed7aa' : '#d6d3d1', fontSize: 10.5, fontWeight: 600
            }}>
              {dl.overdue
                ? `⏰ ${ex.deload.label} −${dl.pct}% · tocaba revisar el ${dl.dateLabel}`
                : `🩹 ${ex.deload.label} −${dl.pct}% · revisar el ${dl.dateLabel}`}
            </div>
          )}
          {ex.caution && (
            <div style={{ color: '#F59E0B', fontSize: 11.5, lineHeight: 1.4, marginTop: 4, maxWidth: 260 }}>
              ⚠ {ex.caution}
            </div>
          )}
          {ex.note && (
            <div style={{ color: '#7dd3fc', fontSize: 11.5, lineHeight: 1.4, marginTop: 4, maxWidth: 260 }}>
              ⓘ {ex.note}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: dl ? '#fb923c' : '#fbbf24', fontWeight: 700, fontSize: 18 }}>
            {weight} {isArm ? 'kg/arm' : 'kg'}
          </div>
          {dl && (
            <div style={{ color: '#78716c', fontSize: 10.5, textDecoration: 'line-through' }}>
              {wt(effRM, p.pct)} {isArm ? 'kg/arm' : 'kg'} sin descarga
            </div>
          )}
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            {(own ? own.sets : repsForSets(weekIdx, setsCountFor(ex, weekIdx))).join(' · ')} reps
          </div>
          <div style={{ color: '#64748b', fontSize: 10.5, maxWidth: 190, marginLeft: 'auto' }}>RIR {p.rir} · corta a −{vlFor(ex, weekIdx)}% vel.</div>
          {ex.dumbbell && <div style={{ color: '#64748b', fontSize: 11 }}>mancuerna real disponible</div>}
          <div style={{ marginTop: 5 }}><RestButton ex={ex} weekIdx={weekIdx} compact /></div>
        </div>
      </div>
      {ex.backoff && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Series de bajada
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15 }}>{backoffWeight} kg</span>
              <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>· {ex.backoff.setCount} × {ex.backoff.reps} reps</span>
            </div>
            <BackoffRestButton ex={ex} compact />
          </div>
        </div>
      )}
    </div>
  );
}

// Botón de descanso para las series de bajada (id propio, no comparte timer
// con el bloque principal del mismo ejercicio).
function BackoffRestButton({ ex, compact }) {
  const rest = useRest();
  const id = `${ex.name}__backoff`;
  const seconds = ex.backoff.restSeconds;
  const isActive = rest && rest.active && rest.active.id === id;
  const live = isActive && rest.running;
  return (
    <button
      onClick={() => rest.start(id, `${ex.name} (bajada)`, seconds, ex.backoff.setCount)}
      title={`Descanso series de bajada: ${fmtClock(seconds)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: compact ? '4px 9px' : '5px 11px',
        borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${isActive ? '#38bdf8' : '#334155'}`,
        background: isActive ? '#0c4a6e' : '#0f172a',
        color: isActive ? '#7dd3fc' : '#94a3b8',
        fontSize: compact ? 11 : 12, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
      ⏱ {live ? fmtClock(rest.left) : fmtClock(seconds)}
    </button>
  );
}

function BWRow({ ex, weekIdx, rmStore }) {
  const phase = PROG[weekIdx].phase;
  const reps = ex.repsByPhase[phase];
  const equipLabel = ex.equipLabel || 'Peso corporal';
  const unitSuffix = ex.unitSuffix || '';
  const note = ex.note || 'Objetivo por serie, no un número plano — respeta la caída de fatiga real entre series.';
  const loadLabel = ex.testMethod ? `${equipLabel} · ${effectiveRM(ex, rmStore || {})}kg` : equipLabel;
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#f8fafc', fontSize: 14, fontWeight: 500 }}>{ex.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#64748b', fontSize: 12 }}>{loadLabel}</span>
          <RestButton ex={ex} weekIdx={weekIdx} compact />
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${reps.length}, 1fr)`, gap: 6 }}>
        {reps.map((r, i) => (
          <div key={i} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>Serie {i+1}</div>
            <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 16 }}>{r}{unitSuffix}</div>
          </div>
        ))}
      </div>
      <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>
        {note}
      </div>
    </div>
  );
}

// ─── REPETICIONES vs RIR vs VELOCIDAD ────────────────────────────────────────
// El usuario preguntó el 19/08/2026 si las 10·9·9·8 de la semana 1 son
// obligatorias o si hay que ir al fallo, porque la app también pide dejar 2
// repeticiones en reserva y le parecían dos instrucciones contradictorias.
// No lo son: son la prescripción y su verificación. Se documenta aquí porque es
// la base de toda la autorregulación del plan, y porque el malentendido es
// exactamente lo que destapó que el RM de la sentadilla estaba inflado.
function RepsRirExplainer({ weekIdx }) {
  const [open, setOpen] = useState(false);
  const phase = PROG[weekIdx].phase;
  const vlHeavy = VL_BY_PHASE[phase].heavy;
  const vlOther = VL_BY_PHASE[phase].other;
  return (
    <div style={{
      marginBottom: 16, background: '#0f172a', border: '1px solid #334155',
      borderRadius: 10, overflow: 'hidden'
    }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', textAlign: 'left', background: 'none', border: 'none',
        cursor: 'pointer', padding: '10px 12px', color: '#f8fafc'
      }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>🎯 ¿Las reps son obligatorias o hay que ir al fallo?</span>
        <span style={{ color: '#64748b', fontSize: 11, marginLeft: 8 }}>{open ? '▾' : '▸'}</span>
        {!open && (
          <div style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 3 }}>
            Ni una cosa ni la otra: las reps son el plan, el RIR es su control de calidad.
          </div>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px', color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7 }}>
          <b style={{color:'#e2e8f0'}}>Las repeticiones son el plan.</b> Salen de aplicar el porcentaje al RM.
          Bajan dentro de la sesión (10·9·9·8) porque la fatiga se acumula, y cada número está elegido
          para que <i>esa</i> serie acabe a ~2 repeticiones en reserva.<br/><br/>

          <b style={{color:'#e2e8f0'}}>El RIR es el control de calidad.</b> Si el RM es correcto, al acabar
          la repetición prescrita deben quedar 2. Si sobran 6, la carga es blanda y el RM está infraestimado.
          Si no llegas, o llegas a 0, el RM está inflado. <b style={{color:'#e2e8f0'}}>Eso es exactamente lo que
          pasó el 19/08/2026</b>: el 10·9·9·8 de sentadilla salió 8/6/6/5 y destapó que los 160 kg eran falsos.
          Eran 140.<br/><br/>

          <b style={{color:'#e2e8f0'}}>El objetivo NO es el fallo.</b> Y no por precaución vaga: la curva de
          hipertrofia se aplana al acercarse al fallo mientras la fatiga sigue subiendo recta (Robinson 2024).
          A 1-3 RIR se obtiene casi toda la ganancia con mucha menos fatiga. En tu caso pesa doble —
          <b style={{color:'#e2e8f0'}}> siete días de entrenamiento sin ningún descanso real y cuatro cirugías de
          menisco</b>. Ir al fallo en sentadilla es la peor relación beneficio/riesgo de todo el plan.<br/><br/>

          <div style={{ background:'#1e293b', borderRadius:8, padding:'10px 12px', color:'#cbd5e1' }}>
            <b style={{color:'#f8fafc'}}>Tres cosas pueden cortar una serie. Manda la que llegue primero:</b><br/>
            <b style={{color:'#fbbf24'}}>1.</b> las repeticiones del papel ·
            <b style={{color:'#fbbf24'}}> 2.</b> el RIR (quedan 2-3) ·
            <b style={{color:'#fbbf24'}}> 3.</b> la pérdida de velocidad
            (<b style={{color:'#7dd3fc'}}>−{vlHeavy}%</b> en básicos y compuestos, <b style={{color:'#7dd3fc'}}>−{vlOther}%</b> en
            aislamiento, fase {phase}).<br/><br/>
            Cuando las tres se contradicen, <b style={{color:'#f8fafc'}}>la contradicción es la señal</b> de que el RM
            está mal. No es que el sistema falle: el dato de entrada es el malo.
          </div>
          <br/>
          <b style={{color:'#FCA5A5'}}>Dos avisos del 19/08, por si se repiten.</b> Declaraste 2 en reserva con la
          barra a 0,308 m/s, que <i>es</i> velocidad de 1RM — estabas a 0-1. El RIR percibido se va corto, es un
          sesgo muy documentado, y conviene recalibrarlo contra la velocidad de vez en cuando. Y la serie 1 perdió
          un <b>42 %</b> de velocidad contra un umbral de <b>25 %</b>: tocaba cortar en la repetición 5 o 6.
        </div>
      )}
    </div>
  );
}

// ─── RM GUARDADOS QUE NO COINCIDEN CON EL PLAN ───────────────────────────────
// Un RM guardado en localStorage tiene prioridad sobre el valor por defecto del
// código (ver memoria.md §8). Eso es lo correcto casi siempre —el test manda—
// pero se vuelve una trampa cuando el plan se corrige a la baja: el 19/08/2026
// la sentadilla pasó de 160 a 140 kg en el código, y cualquier dispositivo con
// 160 guardado seguía calculando con 160 sin decir nada. Este banner hace
// visible la discrepancia y permite volver al valor del plan de un toque.
function RMMismatchBanner({ rmStore, clearRM }) {
  const [open, setOpen] = useState(false);
  const seen = new Set();
  const rows = [];
  DAYS.forEach(d => (d.exercises || []).forEach(ex => {
    const key = ex.rmRef || ex.name;
    if (seen.has(key) || ex.rm === undefined) return;
    seen.add(key);
    const saved = rmStore[key];
    if (saved && saved.rm !== ex.rm) rows.push({ key, saved, plan: ex.rm, unit: ex.unit });
  }));
  if (!rows.length) return null;

  return (
    <div style={{
      marginBottom: 16, background: '#1c1917', border: '1px solid #F59E0B',
      borderRadius: 10, overflow: 'hidden'
    }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', textAlign: 'left', background: 'none', border: 'none',
        cursor: 'pointer', padding: '10px 12px', color: '#fff7ed'
      }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          ⚠ {rows.length === 1 ? '1 RM guardado no coincide' : `${rows.length} RM guardados no coinciden`} con el plan
        </span>
        <span style={{ color: '#fed7aa', fontSize: 11, marginLeft: 8 }}>{open ? '▾' : '▸'}</span>
        {!open && (
          <div style={{ color: '#fed7aa', fontSize: 11.5, marginTop: 3 }}>
            Este dispositivo está calculando con {rows.map(r => r.saved.rm).join(' · ')} y el plan dice {rows.map(r => r.plan).join(' · ')}.
          </div>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px', color: '#fed7aa', fontSize: 12.5, lineHeight: 1.7 }}>
          Lo guardado en este navegador <b style={{color:'#fff7ed'}}>gana al valor del código</b>, y no se sincroniza
          entre dispositivos. Es lo correcto cuando el guardado viene de un test más reciente. Pero si el plan se
          ha corregido después —como la sentadilla el 19/08/2026, de 160 a <b style={{color:'#fff7ed'}}>140 kg</b>—
          el valor viejo se queda mandando en silencio.<br/><br/>
          {rows.map(r => (
            <div key={r.key} style={{
              background: '#0f172a', borderRadius: 8, padding: '10px 12px', marginBottom: 6
            }}>
              <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 600 }}>{r.key}</div>
              <div style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 8px' }}>
                guardado <b style={{ color: '#F59E0B' }}>{r.saved.rm} {r.saved.unit || r.unit}</b>
                {r.saved.date && (
                  <span style={{ color: '#475569' }}>
                    {' '}el {new Date(r.saved.date).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })}
                  </span>
                )}
                <span style={{ color: '#475569' }}> · plan </span>
                <b style={{ color: '#7dd3fc' }}>{r.plan} {r.unit}</b>
              </div>
              <button onClick={() => clearRM(r.key)} style={{
                padding: '7px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: '#334155', color: '#f8fafc', fontSize: 12, fontWeight: 600
              }}>
                Usar {r.plan} {r.unit} (el del plan)
              </button>
            </div>
          ))}
          <span style={{ color: '#a8a29e', fontSize: 11.5 }}>
            Borra el valor guardado en este dispositivo; el historial de tests no se toca.
            Si el que vale es el guardado, no toques nada.
          </span>
        </div>
      )}
    </div>
  );
}

function DayWorkout({ day, weekIdx, rmStore }) {
  if (day.special === 'stretch') {
    return (
      <div>
        {(day.exercises || []).map((ex, i) => (
          <NonOlympicRow key={'x'+i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} />
        ))}
        <div style={{ color: '#94a3b8', fontSize: 13, margin: '16px 0 12px' }}>
          🧘 Movilidad · 60 s por serie. El volumen semanal es lo que manda, no la
          intensidad ni cómo lo repartas (Warneke 2024).
        </div>
        {STRETCHES.map((s, i) => <StretchCard key={i} s={s} />)}
      </div>
    );
  }

  return (
    <div>
      {day.exercises.map((ex, i) => {
        if (ex.type === 'olympic') return <OlympicTable key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} />;
        if (ex.type === 'bw') return <BWRow key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} />;
        return <NonOlympicRow key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} />;
      })}
    </div>
  );
}

function TrainingTab({ weekIdx, dayIdx, setDayIdx, completed, markDone, rmStore, clearRM }) {
  const day = DAYS[dayIdx];
  return (
    <div>
      {/* Week bar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {PROG.map((p, i) => (
          <div key={i} style={{
            padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: i === weekIdx ? p.color : '#1e293b',
            color: i === weekIdx ? '#fff' : '#64748b',
            cursor: 'default', border: `1px solid ${i === weekIdx ? p.color : '#334155'}`
          }}>
            W{i+1}
          </div>
        ))}
      </div>

      {/* Phase info */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <PhasePill weekIdx={weekIdx} />
        <span style={{ color: '#64748b', fontSize: 13 }}>{PROG[weekIdx].sets.length} series · {PROG[weekIdx].sets.join('·')} reps</span>
      </div>

      <RMMismatchBanner rmStore={rmStore} clearRM={clearRM} />

      <RepsRirExplainer weekIdx={weekIdx} />

      {/* Leyenda de descansos de la fase actual */}
      <div style={{
        marginBottom: 16, background: '#0f172a', border: '1px solid #1e293b',
        borderRadius: 10, padding: '9px 12px'
      }}>
        <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
          ⏱ Descanso entre series · fase {PROG[weekIdx].phase}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            ['Olímpicos', 'olympic'], ['Básicos', 'heavy'],
            ['Compuestos', 'compound'], ['Aislamiento', 'isolation'], ['Core', 'core'],
          ].map(([label, cat]) => {
            const add = cat === 'core' ? 0 : (REST_PHASE_ADD[PROG[weekIdx].phase] || 0);
            return (
              <span key={cat} style={{
                background: '#1e293b', borderRadius: 6, padding: '3px 8px',
                color: '#94a3b8', fontSize: 11, fontVariantNumeric: 'tabular-nums'
              }}>
                {label} <strong style={{ color: '#7dd3fc' }}>{fmtClock(REST_BASE[cat] + add)}</strong>
              </span>
            );
          })}
        </div>
        <div style={{ color: '#475569', fontSize: 10.5, marginTop: 6, lineHeight: 1.45 }}>
          Pulsa ⏱ en cualquier ejercicio para lanzar la cuenta atrás. Al llegar a cero
          suena y vibra, y queda recargada para la serie siguiente.
        </div>
      </div>

      {/* Day selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        {DAYS.map((d, i) => (
          <button key={i} onClick={() => setDayIdx(i)} style={{
            padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600,
            background: i === dayIdx ? '#f8fafc' : '#1e293b',
            color: i === dayIdx ? '#0f172a' : '#94a3b8',
          }}>
            {completed[`W${weekIdx+1}-${d.name}`] ? '✅' : d.emoji} {d.name}
          </button>
        ))}
      </div>

      {/* Day prev/next buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button
          onClick={() => setDayIdx(Math.max(0, dayIdx - 1))}
          disabled={dayIdx === 0}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: dayIdx === 0 ? 'default' : 'pointer',
            background: dayIdx === 0 ? '#1e293b' : '#334155',
            color: dayIdx === 0 ? '#334155' : '#f8fafc',
            fontWeight: 700, fontSize: 18, transition: 'all 0.15s'
          }}>‹ Anterior</button>
        <span style={{ color: '#64748b', fontSize: 13 }}>
          {dayIdx + 1} / {DAYS.length}
        </span>
        <button
          onClick={() => setDayIdx(Math.min(DAYS.length - 1, dayIdx + 1))}
          disabled={dayIdx === DAYS.length - 1}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: dayIdx === DAYS.length - 1 ? 'default' : 'pointer',
            background: dayIdx === DAYS.length - 1 ? '#1e293b' : '#334155',
            color: dayIdx === DAYS.length - 1 ? '#334155' : '#f8fafc',
            fontWeight: 700, fontSize: 18, transition: 'all 0.15s'
          }}>Siguiente ›</button>
      </div>

      {/* Day header */}
      <div style={{
        background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 18 }}>
            {day.emoji} {day.name} — {day.label}
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
            Nutrición: Día {day.nutriDay}
          </div>
        </div>
        <div style={{
          background: (NUTRITION[day.nutriDay]?.color || '#94a3b8') + '22',
          color: NUTRITION[day.nutriDay]?.color || '#94a3b8',
          borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600
        }}>
          {{ A: '🍗 Pollo', B: '🐟 Salmón / 🥩 Ternera', C: '🫀 Hígado de pollo' }[day.nutriDay]}
        </div>
      </div>

      <DayWorkout day={day} weekIdx={weekIdx} rmStore={rmStore} />

      {/* Condicionamiento añadido */}
      {CONDITIONING[day.name] && (
        <div style={{ marginTop: 18, background: '#0f172a', borderRadius: 10, padding: '12px 16px', border: '1px solid #22C55E33' }}>
          <div style={{ color: '#22C55E', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Condicionamiento añadido
          </div>
          <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            {CONDITIONING[day.name].label}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            {CONDITIONING[day.name].detail}
          </div>
          {CONDITIONING[day.name].alt && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155' }}>
              <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Si no hay bici disponible
              </div>
              <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                {CONDITIONING[day.name].alt.label}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>
                {CONDITIONING[day.name].alt.detail}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Wellness */}
      {day.name !== 'Miércoles' && (
        <div style={{ marginTop: 18, background: '#0f172a', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Post-entrenamiento
          </div>
          {WELLNESS.filter(w => w.day.includes(day.name.substring(0,3))).map((w, i) => (
            <div key={i} style={{ color: '#94a3b8', fontSize: 13 }}>{w.protocol}</div>
          ))}
        </div>
      )}

      {/* Mark session done */}
      {(() => {
        const key = `W${weekIdx+1}-${day.name}`;
        const isDone = !!completed[key];
        return (
          <div style={{ marginTop: 16 }}>
            <button onClick={() => markDone(weekIdx, dayIdx)} style={{
              width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: isDone ? '#14532d' : '#1e3a5f',
              color: isDone ? '#86efac' : '#93c5fd',
              fontWeight: 700, fontSize: 15, transition: 'all 0.2s'
            }}>
              {isDone ? '✅ Sesión completada — pulsa para deshacer' : '✓ Marcar sesión como hecha'}
            </button>
            {isDone && completed[key] && (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginTop: 6 }}>
                Completada el {new Date(completed[key]).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

const WELLNESS = [
  { day: 'Lun · Mar · Vie', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min' },
  { day: 'Miércoles', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna 3 rondas (10–15min/ronda)' },
  { day: 'Jueves', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna opcional 1 ronda' },
  { day: 'Sábado', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna 3 rondas' },
  { day: 'Domingo', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna 3 rondas · ☀️ UV 10–12min (vitamina D)' },
];

// ─── CONDICIONAMIENTO AÑADIDO ────────────────────────────────────────────────
// Assault bike / Airdyne — mejor relación condicionamiento/kcal de las opciones
// disponibles en el gimnasio: brazos + piernas a la vez, sin técnica que
// aprender (a diferencia del remo), resistencia autorregulada por tu propio
// esfuerzo, sentado y sin impacto. Nunca en Martes/Viernes (oly) ni Sábado
// (LegDay), que ya cargan la rodilla ese día.
// Alternativa (si el gimnasio no tiene assault bike ese día): remo. Es la
// segunda mejor opción del gimnasio porque también es full-body (piernas +
// espalda + brazos), sin impacto y con resistencia autorregulada por el
// esfuerzo — mismo protocolo de tiempos, solo cambia la máquina. La cinta con
// inclinación máxima queda descartada como alternativa porque solo trabaja
// piernas y es menos eficiente en tiempo para el mismo objetivo.
const CONDITIONING = {
  'Lunes':   { label: '🚲 Assault bike — intervalos',    detail: '8–10 × (20s esfuerzo máximo / 100s suave) · ~15min total · post-entreno de brazo',
               alt: { label: '🚣 Remo — intervalos',    detail: 'Mismo esquema: 8–10 × (20s esfuerzo máximo / 100s suave) · ~15min total' } },
  'Jueves':  { label: '🚲 Assault bike — zona 2',         detail: '20–25min ritmo continuo moderado',
               alt: { label: '🚣 Remo — zona 2',         detail: '20–25min ritmo continuo moderado (conversacional, ~18-20 paladas/min)' } },
  'Domingo': { label: '🚲 Assault bike — zona 2 suave',   detail: '15–20min suave · pierna descargada tras el sábado',
               alt: { label: '🚣 Remo — zona 2 suave',   detail: '15–20min suave · pierna descargada tras el sábado' } },
};

// ─── TEST TAB (Semana 16) ─────────────────────────────────────────────────────

// Distancia euclídea entre dos puntos en píxeles
const pxDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Historial de RM por ejercicio — lista plegable con fecha y variación desde
// el test anterior. Empieza vacío hasta el primer guardado tras esta versión.
function RMHistoryPanel({ name, unit, rmHistory }) {
  const [open, setOpen] = useState(false);
  const list = ((rmHistory && rmHistory[name]) || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (list.length === 0) return null;
  const unitLabel = unit === 'kg/arm' ? 'kg/arm' : 'kg';
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} Historial ({list.length})
      </button>
      {open && (
        <div style={{ marginTop: 6, background: '#0f172a', borderRadius: 6, padding: '8px 10px' }}>
          {list.map((entry, i) => {
            const older = list[i + 1]; // siguiente en la lista (desc) = anterior en el tiempo
            const delta = older ? Math.round((entry.rm - older.rm) * 10) / 10 : null;
            const dateStr = new Date(entry.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0',
                borderBottom: i < list.length - 1 ? '1px solid #1e293b' : 'none'
              }}>
                <span style={{ color: '#94a3b8' }}>{dateStr}</span>
                <span style={{ color: '#e2e8f0' }}>
                  {entry.rm} {unitLabel}
                  {delta !== null && delta !== 0 && (
                    <span style={{ color: delta > 0 ? '#22C55E' : '#EF4444', marginLeft: 6 }}>
                      {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VideoTestCard({ ex, rmStore, saveRM, mvtStore, saveMVT, clearMVT, rmHistory }) {
  const [ladderFallback, setLadderFallback] = useState(false);
  const [plateDiameter, setPlateDiameter] = useState(45); // cm — estándar IWF discos bumper 10-25kg
  const personalMVT = mvtStore ? mvtStore[ex.name] : null;
  const [mvt, setMvt] = useState(effectiveMVT(ex, mvtStore || {}));
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoError, setVideoError] = useState(null);
  const [load, setLoad] = useState('');
  const [mode, setMode] = useState(null); // null | 'calib1' | 'calib2' | 'start' | 'end'
  const [calibP1, setCalibP1] = useState(null);
  const [calibP2, setCalibP2] = useState(null);
  const [startClick, setStartClick] = useState(null); // {time, x, y}
  const [endClick, setEndClick] = useState(null);
  const [points, setPoints] = useState([]);
  const videoRef = useRef(null);
  const pendingTimeRef = useRef(null);

  const scale = (calibP1 && calibP2) ? plateDiameter / pxDist(calibP1, calibP2) : null; // cm por píxel

  function beginCalibration() {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setCalibP1(null); setCalibP2(null);
    setMode('calib1');
  }
  function beginMark(which) {
    if (!videoRef.current) return;
    videoRef.current.pause();
    pendingTimeRef.current = videoRef.current.currentTime;
    setMode(which);
  }
  function handleOverlayClick(e) {
    if (!mode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (mode === 'calib1') { setCalibP1({ x, y }); setMode('calib2'); }
    else if (mode === 'calib2') { setCalibP2({ x, y }); setMode(null); }
    else if (mode === 'start') { setStartClick({ time: pendingTimeRef.current, x, y }); setMode(null); }
    else if (mode === 'end') { setEndClick({ time: pendingTimeRef.current, x, y }); setMode(null); }
  }

  const duration = (startClick && endClick) ? (endClick.time - startClick.time) : null;
  const dispCm = (scale && startClick && endClick) ? pxDist(startClick, endClick) * scale : null;
  const velocity = (dispCm && duration && duration > 0) ? (dispCm / 100) / duration : null;

  function addPoint() {
    if (!load || !velocity) return;
    setPoints(p => [...p, { load: Number(load), v: Number(velocity.toFixed(3)) }]);
    setStartClick(null); setEndClick(null); setLoad('');
  }
  function removePoint(i) {
    setPoints(p => p.filter((_, idx) => idx !== i));
  }
  function linreg(pts) {
    const n = pts.length;
    const sumX = pts.reduce((s,p)=>s+p.load,0), sumY = pts.reduce((s,p)=>s+p.v,0);
    const sumXY = pts.reduce((s,p)=>s+p.load*p.v,0), sumXX = pts.reduce((s,p)=>s+p.load*p.load,0);
    const denom = (n*sumXX - sumX*sumX);
    if (denom === 0) return null;
    const b = (n*sumXY - sumX*sumY) / denom;
    const a = (sumY - b*sumX) / n;
    // R²: sin esto no hay forma de saber si la recta describe los puntos o si
    // uno de ellos está mal marcado. Un ajuste flojo invalida la extrapolación.
    const meanY = sumY / n;
    const ssTot = pts.reduce((s,p) => s + (p.v - meanY) ** 2, 0);
    const ssRes = pts.reduce((s,p) => s + (p.v - (a + b * p.load)) ** 2, 0);
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    return { a, b, r2 };
  }
  const fit = points.length >= 3 ? linreg(points) : null;
  const rawRM = (fit && fit.b !== 0) ? (mvt - fit.a) / fit.b : null;
  // Corrección del sesgo sistemático (+3,7%) antes de guardar nada: es el valor
  // corregido el que debe alimentar los porcentajes del ciclo nuevo.
  const estRM = rawRM ? rawRM / (1 + LV_OVERESTIMATE) : null;
  const see = seeFor(ex.name);
  const rmLow  = estRM ? estRM * (1 - see) : null;
  const rmHigh = estRM ? estRM * (1 + see) : null;

  // Avisos de calidad del test
  const testRM = effectiveRM(ex, rmStore);
  const tooFast = points.filter(p => p.v > LV_VMAX_WARN);
  const heavyPts = points.filter(p => p.load >= testRM * 0.78);
  const spread = points.length >= 2
    ? (Math.max(...points.map(p => p.load)) - Math.min(...points.map(p => p.load))) / testRM
    : 0;

  const current = rmStore[ex.name];
  const markerColor = { calib: '#F59E0B', start: '#3B82F6', end: '#EF4444' };

  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🎥 {ex.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {effectiveRM(ex, rmStore)}kg</span>
          <TestRestButton id={`${ex.name}__lv`} label={ex.name} seconds={LV_REST_SEC} sets={LV_LADDER.length} unit="carga" compact />
        </span>
      </div>
      <RMHistoryPanel name={ex.name} unit={ex.unit} rmHistory={rmHistory} />
      {ladderFallback ? (
        <>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
            Sin vídeo hoy — registro directo con la escalera de carga. Menos preciso que la velocidad (no detecta cambios finos de forma), pero válido para no perder el test.{' '}
            <span onClick={() => setLadderFallback(false)} style={{ color: '#3B82F6', cursor: 'pointer' }}>volver a vídeo</span>
          </div>
          <LadderBody ex={ex} rmStore={rmStore} saveRM={saveRM} />
        </>
      ) : (
        <>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
            Calibra con el disco (diámetro conocido) una vez por vídeo, luego marca inicio/fin de la fase concéntrica de cada serie sobre el propio fotograma — la app mide el desplazamiento real de la barra y calcula la velocidad. Con ≥3 series se ajusta la recta carga-velocidad y se extrapola el RM a la velocidad mínima (MVT).{' '}
            <span onClick={() => setLadderFallback(true)} style={{ color: '#F59E0B', cursor: 'pointer' }}>no puedo grabar hoy — usar escalera directa</span>
          </div>

          {/* Escalera prescrita para este ejercicio */}
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '1px solid #1e293b' }}>
            <div style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 }}>
              Cargas del test · {LV_REST_SEC / 60} min de descanso entre series
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${LV_LADDER.length}, 1fr)`, gap: 5 }}>
              {LV_LADDER.map((st, i) => {
                const kg = Math.round(effectiveRM(ex, rmStore) * st.pct / 2.5) * 2.5;
                return (
                  <div key={i} style={{ background: '#1e293b', borderRadius: 6, padding: '7px 4px', textAlign: 'center' }}>
                    <div style={{ color: '#64748b', fontSize: 10 }}>{Math.round(st.pct * 100)}%</div>
                    <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 14 }}>{kg}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>×{st.reps}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 7, lineHeight: 1.5 }}>
              Rango 40–90%: por debajo la barra va demasiado rápido y curva la recta, y no se
              sube al 100% porque la extrapolación ya cubre ese tramo sin arriesgar un fallo.
              De cada carga <strong>marca la repetición más rápida</strong>, no la media.
              Intención máxima en todas — también en las ligeras: si no empujas al máximo,
              la recta mide tu contención, no tu capacidad.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
              Diámetro del disco (cm)
              <input type="number" value={plateDiameter} onChange={e => setPlateDiameter(Number(e.target.value))}
                style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
            </label>
            <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
              MVT (m/s)
              <input type="number" step="0.01" value={mvt} onChange={e => setMvt(Number(e.target.value))}
                style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
            </label>
          </div>

          <div style={{ color: '#64748b', fontSize: 11, marginTop: -6, marginBottom: 10 }}>
            {personalMVT
              ? <>MVT personal guardado el {new Date(personalMVT.date).toLocaleDateString()} ({personalMVT.value} m/s).{' '}
                  <span onClick={() => { clearMVT(ex.name); setMvt(ex.mvt); }} style={{ color: '#EF4444', cursor: 'pointer' }}>
                    volver al valor de literatura ({ex.mvt} m/s)
                  </span>
                </>
              : <>Usando MVT de literatura ({ex.mvt} m/s). Márcalo como personal desde una serie a carga cercana a tu límite real.</>}
          </div>

          <input type="file" accept="video/*" onChange={e => {
            const f = e.target.files[0];
            if (f) {
              setVideoError(null);
              setVideoUrl(URL.createObjectURL(f));
              setCalibP1(null); setCalibP2(null); setStartClick(null); setEndClick(null); setMode(null);
            }
          }} style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }} />

          {videoError && (
            <div style={{ background: '#450a0a', border: '1px solid #EF444455', borderRadius: 8, padding: '10px 12px', marginBottom: 8, color: '#fca5a5', fontSize: 12, lineHeight: 1.5 }}>
              ⚠ El navegador no puede reproducir este vídeo. Casi siempre es porque el iPhone graba
              en HEVC/H.265 y Chrome y Firefox no lo decodifican (Safari sí).
              <br /><br />
              Dos soluciones: abrir la app en <strong style={{ color: '#fecaca' }}>Safari</strong>, o
              cambiar el formato de grabación en el iPhone a H.264 en
              <strong style={{ color: '#fecaca' }}> Ajustes → Cámara → Formatos → «Más compatible»</strong> y
              volver a grabar. Los vídeos que ya tengas en HEVC hay que convertirlos aparte.
            </div>
          )}

          {videoUrl && (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <video ref={videoRef} src={videoUrl} controls
                onError={() => setVideoError(true)}
                onLoadedMetadata={() => setVideoError(null)}
                style={{ width: '100%', borderRadius: 8, display: 'block' }} />
              <div onClick={handleOverlayClick} style={{
                position: 'absolute', inset: 0, cursor: mode ? 'crosshair' : 'default'
              }}>
                {calibP1 && <div style={{ position: 'absolute', left: calibP1.x-5, top: calibP1.y-5, width: 10, height: 10, borderRadius: 5, background: markerColor.calib, border: '2px solid #fff' }} />}
                {calibP2 && <div style={{ position: 'absolute', left: calibP2.x-5, top: calibP2.y-5, width: 10, height: 10, borderRadius: 5, background: markerColor.calib, border: '2px solid #fff' }} />}
                {startClick && <div style={{ position: 'absolute', left: startClick.x-5, top: startClick.y-5, width: 10, height: 10, borderRadius: 5, background: markerColor.start, border: '2px solid #fff' }} />}
                {endClick && <div style={{ position: 'absolute', left: endClick.x-5, top: endClick.y-5, width: 10, height: 10, borderRadius: 5, background: markerColor.end, border: '2px solid #fff' }} />}
              </div>
            </div>
          )}

          {mode && (
            <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8 }}>
              {mode === 'calib1' && 'Haz clic en un extremo del disco'}
              {mode === 'calib2' && 'Haz clic en el extremo opuesto del disco (el diámetro)'}
              {mode === 'start' && 'Haz clic sobre la barra en el fotograma actual (inicio)'}
              {mode === 'end' && 'Haz clic sobre la barra en el fotograma actual (fin)'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <button onClick={beginCalibration} disabled={!videoUrl}
              style={{ padding: '8px 12px', borderRadius: 6, border: 'none', cursor: videoUrl ? 'pointer' : 'default',
                background: '#334155', color: '#f8fafc', fontSize: 13 }}>📏 Calibrar disco</button>
            <span style={{ color: '#64748b', fontSize: 12 }}>
              {scale ? `Escala: ${scale.toFixed(3)} cm/px` : 'Sin calibrar'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <button onClick={() => beginMark('start')} disabled={!videoUrl || !scale}
              style={{ padding: '8px 12px', borderRadius: 6, border: 'none', cursor: (videoUrl && scale) ? 'pointer' : 'default',
                background: '#334155', color: '#f8fafc', fontSize: 13 }}>Marcar inicio</button>
            <button onClick={() => beginMark('end')} disabled={!videoUrl || !scale}
              style={{ padding: '8px 12px', borderRadius: 6, border: 'none', cursor: (videoUrl && scale) ? 'pointer' : 'default',
                background: '#334155', color: '#f8fafc', fontSize: 13 }}>Marcar fin</button>
            <span style={{ color: '#64748b', fontSize: 12 }}>
              {duration != null ? `Duración: ${duration.toFixed(2)}s` : 'Sin marcar'}
              {velocity != null && ` · desplazamiento ${dispCm.toFixed(1)}cm · v = ${velocity.toFixed(3)} m/s`}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input type="number" placeholder="Carga (kg)" value={load} onChange={e => setLoad(e.target.value)}
              style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
            <button onClick={addPoint} disabled={!load || !velocity}
              style={{ padding: '8px 14px', borderRadius: 6, border: 'none', cursor: (!load || !velocity) ? 'default' : 'pointer',
                background: (!load || !velocity) ? '#334155' : '#2563EB', color: '#fff', fontSize: 13, fontWeight: 600 }}>
              + Añadir serie
            </button>
          </div>

          {points.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {points.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#94a3b8', fontSize: 12, padding: '4px 0' }}>
                  <span>{p.load}kg · {p.v} m/s</span>
                  <span style={{ display: 'flex', gap: 10 }}>
                    <span
                      onClick={() => { saveMVT(ex.name, p.v); setMvt(p.v); }}
                      title="Marca esta serie como tu carga límite real y guarda su velocidad como tu MVT personal"
                      style={{ cursor: 'pointer', color: '#22C55E' }}>
                      usar como mi MVT
                    </span>
                    <span onClick={() => removePoint(i)} style={{ cursor: 'pointer', color: '#EF4444' }}>eliminar</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {estRM && (
            <div style={{ background: '#0f172a', borderRadius: 8, padding: '11px 14px', marginBottom: 10 }}>
              <div style={{ color: '#22C55E', fontWeight: 700, fontSize: 17 }}>
                RM estimado: {estRM.toFixed(1)} kg
              </div>
              <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
                Rango probable <strong style={{ color: '#e2e8f0' }}>{rmLow.toFixed(1)}–{rmHigh.toFixed(1)} kg</strong>
                {' '}(SEE {(see * 100).toFixed(1)}% para este ejercicio).<br />
                Extrapolación bruta {rawRM.toFixed(1)} kg, corregida −3,7% por la
                sobrestimación sistemática del método (Greig 2023, meta-análisis IPD).
              </div>
              <div style={{
                marginTop: 7, paddingTop: 7, borderTop: '1px dashed #1e293b',
                color: fit.r2 >= 0.95 ? '#22C55E' : fit.r2 >= 0.90 ? '#F59E0B' : '#EF4444',
                fontSize: 12, fontWeight: 600
              }}>
                Ajuste de la recta: R² = {fit.r2.toFixed(3)}
                {fit.r2 >= 0.95 ? ' · bueno'
                  : fit.r2 >= 0.90 ? ' · aceptable, revisa si algún punto está mal marcado'
                  : ' · malo — no te fíes de esta estimación, repite las marcas'}
              </div>
            </div>
          )}

          {/* Avisos de calidad — cada uno corresponde a un fallo concreto que
              la literatura señala como fuente de error en este método. */}
          {points.length > 0 && points.length < 3 && (
            <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8 }}>
              Añade al menos 3 series para ajustar la recta (5 es lo recomendado).
            </div>
          )}
          {points.length >= 3 && points.length < 5 && (
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              Con {points.length} puntos la recta ya sale, pero más cargas mejoran la
              fiabilidad (ICC 0,90 con muchas cargas vs 0,81 con pocas).
            </div>
          )}
          {tooFast.length > 0 && (
            <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8 }}>
              ⚠ {tooFast.length} serie{tooFast.length > 1 ? 's' : ''} por encima de {LV_VMAX_WARN} m/s
              ({tooFast.map(p => `${p.load}kg`).join(', ')}). El tramo muy rápido curva la relación
              y sesga la extrapolación — quítalas o sube esa carga.
            </div>
          )}
          {points.length >= 3 && heavyPts.length === 0 && (
            <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 8 }}>
              ⚠ Ninguna serie por encima del ~80% de tu RM actual. Las cargas pesadas son
              las que más determinan la calidad del ajuste; sin ellas estás extrapolando a ciegas.
            </div>
          )}
          {points.length >= 3 && spread < 0.35 && (
            <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8 }}>
              ⚠ Las cargas están demasiado juntas ({Math.round(spread * 100)}% de rango).
              Separa más los puntos: cuanto más corto el tramo, más se amplifica el error al extrapolar.
            </div>
          )}

          <button
            disabled={!estRM}
            onClick={() => saveRM(ex.name, Math.round(estRM * 2) / 2, ex.unit, 'video',
              { points, plateDiameter, mvt, rawRM: Number(rawRM.toFixed(1)), r2: Number(fit.r2.toFixed(3)),
                range: [Number(rmLow.toFixed(1)), Number(rmHigh.toFixed(1))] })}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: estRM ? 'pointer' : 'default',
              background: estRM ? '#14532d' : '#1e293b', color: estRM ? '#86efac' : '#475569', fontWeight: 700, fontSize: 13
            }}>
            {current ? `✓ Guardado (${current.rm}kg) — actualizar` : 'Guardar como nuevo RM'}
          </button>
        </>
      )}
    </div>
  );
}

// Cuerpo reutilizable del test de escalera de carga (registro directo), sin la
// caja/cabecera propias — así lo puede reutilizar tanto LadderTestCard como el
// fallback "no puedo grabar hoy" dentro de VideoTestCard.
function LadderBody({ ex, rmStore, saveRM }) {
  const [value, setValue] = useState('');
  const current = rmStore[ex.name];
  const baseRM = effectiveRM(ex, rmStore);
  const ladder = [0.60,0.70,0.80,0.90,0.95,1.00,1.05].map(pct => Math.round(baseRM*pct/2.5)*2.5);
  return (
    <>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
        Escalera de referencia (60→105% del RM actual): {ladder.join(' · ')} kg. Sube de carga
        hasta que la técnica se rompa y anota abajo el peso más alto conseguido limpio.
        <br />
        <strong style={{ color: '#94a3b8' }}>3–5 min de descanso</strong> entre los intentos
        del 90% en adelante, y singles a partir de ahí: si encadenas intentos pesados con poco
        descanso, lo que mides es la fatiga acumulada, no tu máximo.
      </div>
      <div style={{ marginBottom: 10 }}>
        <TestRestButton id={`${ex.name}__ladder`} label={ex.name} seconds={240} sets={1} compact />
        <span style={{ color: '#475569', fontSize: 11, marginLeft: 8 }}>
          4 min de referencia — pulsa tras cada intento pesado, tantas veces como intentos hagas.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="number" placeholder={`Peso conseguido (${ex.unit})`} value={value} onChange={e => setValue(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        <button
          disabled={!value}
          onClick={() => saveRM(ex.name, Number(value), ex.unit, 'ladder', {})}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: value ? 'pointer' : 'default',
            background: value ? '#14532d' : '#334155', color: value ? '#86efac' : '#64748b', fontWeight: 700, fontSize: 13 }}>
          Guardar
        </button>
      </div>
      {current && <div style={{ color: '#22C55E', fontSize: 12, marginTop: 6 }}>✓ Guardado: {current.rm} {ex.unit}</div>}
    </>
  );
}

function LadderTestCard({ ex, rmStore, saveRM, rmHistory }) {
  const baseRM = effectiveRM(ex, rmStore);
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>📋 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {baseRM}{ex.unit === 'kg/arm' ? ' kg/arm' : ' kg'}</span>
      </div>
      <RMHistoryPanel name={ex.name} unit={ex.unit} rmHistory={rmHistory} />
      <LadderBody ex={ex} rmStore={rmStore} saveRM={saveRM} />
    </div>
  );
}

// Test para ejercicios de core cargado (Pallof press, plancha con disco): no
// buscan un 1RM de una repetición — buscan la carga más pesada con la que
// completas el objetivo de reps/tiempo de la fase Peak manteniendo la técnica
// limpia. Esa carga es el punto de partida de todo el ciclo siguiente.
function CoreLoadTestCard({ ex, rmStore, saveRM, rmHistory }) {
  const [value, setValue] = useState('');
  const current = rmStore[ex.name];
  const baseRM = effectiveRM(ex, rmStore);
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🧱 {ex.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#64748b', fontSize: 12 }}>Carga actual: {baseRM}{ex.unit}</span>
          <TestRestButton id={`${ex.name}__core`} label={ex.name} seconds={90} sets={1} compact />
        </span>
      </div>
      <RMHistoryPanel name={ex.name} unit={ex.unit} rmHistory={rmHistory} />
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        No es un test de 1 repetición máxima — sube la carga en series sucesivas hasta encontrar el peso más alto con el que completas el objetivo de la fase Peak ({ex.testTarget}) sin que {ex.formCue}. Anota ese peso, es tu carga de partida para todo el ciclo.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="number" step="0.5" placeholder={`Carga conseguida (${ex.unit})`} value={value} onChange={e => setValue(e.target.value)}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        <button
          disabled={!value}
          onClick={() => saveRM(ex.name, Number(value), ex.unit, 'coreload', {})}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: value ? 'pointer' : 'default',
            background: value ? '#14532d' : '#334155', color: value ? '#86efac' : '#64748b', fontWeight: 700, fontSize: 13 }}>
          Guardar
        </button>
      </div>
      {current && <div style={{ color: '#22C55E', fontSize: 12, marginTop: 6 }}>✓ Guardado: {current.rm} {ex.unit}</div>}
    </div>
  );
}

// Test de aislamiento: AMRAP a una carga exigente + fórmula de Epley, en vez de
// buscar un máximo real de una repetición.
//
// Por qué: una revisión sistemática de fiabilidad del test de 1RM (ICCs 0,74–0,99
// en ejercicios monoarticulares, comparable a los multiarticulares) muestra que
// SÍ se puede testear un máximo real con fiabilidad en aislamiento — el problema
// no es que el dato salga malo. Es que no hace falta gastar ahí el presupuesto
// de fatiga del día de test: estos ejercicios no tienen una progresión rígida a
// 15 semanas que dependa de un RM exacto (el ciclo nuevo los recalibra solo,
// semana a semana, por RIR/velocidad), y sí tienen coste — cada serie cercana al
// fallo en codo/hombro/rodilla de un ejercicio monoarticular es fatiga que ya no
// está disponible para el press banca, la sentadilla o los olímpicos, que sí
// dependen de un RM preciso durante todo el ciclo.
// Con mancuerna real (peso discreto, ex.dumbbell) o cable/máquina (peso continuo):
// carga libre en kg en ambos casos — el desplegable de mancuernas se quitó porque
// no cubría todos los pesos reales disponibles en el gimnasio.
// Torre de flys / butterfly reverse. Este archivo decía hasta el 24/08/2026 que
// el número de la placa había que multiplicarlo por 1,5 para obtener kilos
// reales. ⛔ ERA FALSO, y salió caro: infló los dos RM un 50 % durante semanas y
// generó una teoría entera sobre "el déficit escala con el puesto en la sesión"
// que en buena parte lo producía este error.
// Lo verificado el 24/08: el "1.5 KG" del encabezado del selector es LO QUE PESA
// CADA PLACA, no un factor; la columna de al lado es la misma carga en libras
// (7,5 kg ↔ 17 lb) y la estación es 1:1. El número impreso son kilos.
// Sólo afecta a esta torre — el resto de poleas del plan son otra máquina.
const TOWER_1TO1 = ['Butterfly reverse cable pull', 'Flys standing cable pull'];

function RepMaxTestCard({ ex, rmStore, saveRM, rmHistory }) {
  const isDumbbell = !!ex.dumbbell;
  const needsPlateNote = TOWER_1TO1.includes(ex.name);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const current = rmStore[ex.name];
  const w = Number(weight);
  const est = (reps && w) ? epley1RM(w, Number(reps)) : null;
  const unitLabel = ex.unit === 'kg/arm' ? 'kg/arm' : 'kg';
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🏋️‍♂️ {ex.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {effectiveRM(ex, rmStore)} {unitLabel}</span>
          <TestRestButton id={`${ex.name}__amrap`} label={ex.name} seconds={120} sets={1} compact />
        </span>
      </div>
      <RMHistoryPanel name={ex.name} unit={ex.unit} rmHistory={rmHistory} />
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        {isDumbbell
          ? 'Ejercicio de mancuerna — pesos discretos, no tiene sentido un 1RM real. El objetivo es UNA serie que caiga entre 6 y 12 repeticiones limpias, dejando 1–2 en el tanque (no busques el fallo). Si con la mancuerna que cogiste te salen más de 12, no seguir hasta el fallo por curiosidad: descansa los 2 min de arriba y repite con la siguiente mancuerna disponible. Con esa serie estimamos el RM con la fórmula de Epley.'
          : 'Ejercicio de aislamiento — no busques aquí un máximo de una repetición: el riesgo de forma en la articulación no compensa la precisión ganada, y esta carga se recalibra sola cada semana por RIR. El objetivo es UNA serie que caiga entre 6 y 12 repeticiones limpias, dejando 1–2 en el tanque. Si ves que vas a superar las 12, para ahí, descansa los 2 min de arriba y repite subiendo el peso — y si con el primer peso apenas llegas a 4-5 muy cerca del fallo, baja peso y repite igual. Con esa serie estimamos el RM con la fórmula de Epley.'}
      </div>
      {needsPlateNote && (
        <div style={{ color: '#38bdf8', fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          ⓘ <b>Escribe el número que marca el selector, tal cual.</b> En esta torre son
          kilos reales (1:1) y sube de <b>1,5 en 1,5</b>. <b style={{ color: '#FCA5A5' }}>No lo
          multipliques por 1,5</b>: hasta el 24/08/2026 esta app decía que había que hacerlo y
          era falso — el “1.5 KG” del selector es lo que pesa cada placa, no un factor, y por
          eso los RM de estos dos ejercicios estuvieron inflados un 50 %.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          {isDumbbell ? 'Mancuerna (kg)' : 'Carga usada (kg)'}
          <input type="number" step="0.5" value={weight} onChange={e => setWeight(e.target.value)}
            placeholder={isDumbbell ? 'p.ej. 14 (cada 2kg)' : 'kg reales'}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        </label>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          Reps limpias
          <input type="number" value={reps} onChange={e => setReps(e.target.value)}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        </label>
      </div>
      {est && <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>RM estimado: {est.toFixed(1)} {unitLabel}</div>}
      {reps && Number(reps) > 12 && (
        <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ El objetivo es UNA serie entre 6 y 12 reps — con {reps} te has salido por arriba, y
          cuantas más repeticiones, menos fiable es la estimación. No sigas hasta el fallo por ver
          cuánto das: descansa los 2 min de arriba, sube el peso y repite apuntando a esa horquilla.
        </div>
      )}
      {reps && Number(reps) > 0 && Number(reps) < 6 && (
        <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ El objetivo es UNA serie entre 6 y 12 reps — con {reps} te has salido por abajo
          {Number(reps) < 4 ? ' (casi un máximo real, justo lo que este método evita en aislamiento)' : ''}.
          Descansa los 2 min de arriba, baja el peso y repite apuntando a esa horquilla.
        </div>
      )}
      <button
        disabled={!est}
        onClick={() => saveRM(ex.name, Math.round(est*2)/2, ex.unit, 'repmax', { weight: w, reps })}
        style={{
          width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: est ? 'pointer' : 'default',
          background: est ? '#14532d' : '#1e293b', color: est ? '#86efac' : '#475569', fontWeight: 700, fontSize: 13
        }}>
        {current ? `✓ Guardado (${current.rm}${unitLabel}) — actualizar` : 'Guardar como nuevo RM'}
      </button>
    </div>
  );
}

function TestTab({ rmStore, saveRM, rmHistory, mvtStore, saveMVT, clearMVT, lastTestDate, startNewCycle }) {
  const [confirming, setConfirming] = useState(false);
  const plan = buildTestPlan();
  return (
    <div>
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: 4 }}>Test Semana 16</div>
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Descanso completo Miércoles, Viernes y Domingo (repiten ejercicios ya testeados). 4 métodos
          según el ejercicio, con más rigor donde el ciclo lo necesita y menos donde solo cuesta fatiga:
          vídeo con velocidad (sentadilla, press banca — los dos ejercicios donde el ciclo entero depende
          de un RM preciso), registro directo de la escalera hasta el máximo real (olímpicos, peso
          muerto, press inclinado, jalón, hip thrust — compuestos de verdad), test de reps con fórmula de
          Epley sin buscar el fallo (mancuerna, y también aislamiento de cable/máquina como tríceps,
          bíceps, aperturas, remo y leg curl — se recalibran solos cada semana) y test de carga por
          objetivo (Pallof press, plancha con disco).
        </div>
      </div>

      {/* Condiciones del test — cada punto corrige una fuente de error concreta */}
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #38bdf833' }}>
        <div style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Antes de empezar · condiciones del test
        </div>
        {[
          ['Sin móvil los 30 min previos.',
           'Alix-Fages 2023 (ensayo cruzado doble ciego): usar redes sociales antes de entrenar deterioró la velocidad media de la barra en la primera serie (p=0,003) sin que los sujetos lo notaran. El RIR estimado no se veía afectado — o sea, no puedes detectarlo por sensación.'],
          ['Mismo dispositivo en todo el ciclo.',
           'Los encoders no son intercambiables entre sí: tienen sesgos sistemáticos distintos. Si mezclas encoder y vídeo, la comparación entre test deja de significar nada.'],
          ['Sin cinturón de agarre ni straps.',
           'Reducen la validez de la relación carga-velocidad.'],
          ['3 min entre cargas, 3–5 min en los intentos pesados.',
           'La fatiga entre series baja la velocidad y hunde artificialmente la recta, lo que infraestima el RM.'],
          ['Calentamiento idéntico al de la próxima vez.',
           'Es la variable más fácil de estandarizar y la que más ruido mete si cambia.'],
        ].map(([t, d], i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ color: '#e2e8f0', fontSize: 12.5, fontWeight: 600 }}>· {t}</div>
            <div style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.45, paddingLeft: 10 }}>{d}</div>
          </div>
        ))}
      </div>

      {/* Por qué el orden de test ya no es el orden de entrenamiento */}
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #a78bfa33' }}>
        <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7 }}>
          El orden de aquí abajo no es el de un día normal de gimnasio
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.55 }}>
          Testear tríceps tres veces seguidas (o bíceps, o espalda con los dos remos
          uno detrás de otro) contamina el resultado: la fatiga del primero
          deprime el máximo medido en el segundo y el tercero, y ese número deprimido es
          el que se guarda como RM para todo el ciclo. Es la razón por la que los protocolos
          estándar de test de 1RM (guía ACI; el estudio que valida testear 8 ejercicios en
          una sola sesión) alternan grupos musculares o agonista/antagonista en vez de
          agruparlos. Por eso el orden de test intercala músculos aunque el de entrenamiento
          normal los agrupe — incluso cambia qué día "reclama" un ejercicio compartido entre
          dos días (los tríceps de cable que aparecen tanto en Lunes como en Jueves se testean
          en Jueves, alternados con press banca, para no dejar Lunes con tríceps de sobra y
          Jueves con tres ejercicios de pecho seguidos).
        </div>
      </div>

      {/* Por qué los olímpicos NO se testean por velocidad */}
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #F59E0B33' }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7 }}>
          Clean &amp; jerk y power snatch · registro directo, no velocidad
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.55 }}>
          Haff, García-Ramos &amp; James (2020) probaron el perfil carga-velocidad en power clean:
          CV del 10,4% con velocidad pico y del 14,4% con velocidad media (ICC 0,64), y concluyen
          que <strong style={{ color: '#e2e8f0' }}>no es una herramienta aceptable</strong> para
          monitorizar fuerza en ese patrón. El motivo es estructural: estos levantamientos están
          limitados por la recepción, no por el tirón, así que la barra no desacelera hacia un
          umbral de velocidad estable como en un básico. Por eso van por escalera directa.
          Si algún día quieres una estimación por velocidad de tu snatch, hay que perfilar el
          <strong style={{ color: '#e2e8f0' }}> snatch pull</strong> (sin recepción) y retrocalcular —
          Sandau 2021 lo validó en halterófilos de élite con r=0,99 y sesgo de 0,2±1,5 kg.
        </div>
      </div>

      {/* Datos extra que hacen falta para el ciclo nuevo */}
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid #22C55E33' }}>
        <div style={{ color: '#22C55E', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7 }}>
          Apunta también esto — lo necesitamos el domingo
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.55 }}>
          En sentadilla y press banca, guarda la <strong style={{ color: '#e2e8f0' }}>velocidad de
          la serie más pesada</strong> con el botón «usar como mi MVT»: sustituye el valor de
          literatura por el tuyo real y es lo que más reduce el error en los test siguientes.
          <br /><br />
          Y anota la <strong style={{ color: '#e2e8f0' }}>velocidad de la primera repetición al
          70–80%</strong> de cada básico. Ese número es la referencia con la que el ciclo nuevo
          va a cortar las series por pérdida de velocidad (20–25% en básicos), en lugar de
          adivinar las repeticiones que te quedaban.
        </div>
      </div>
      {TEST_DAY_NAMES.map(dayName => (
        <div key={dayName} style={{ marginBottom: 20 }}>
          <div style={{ color: '#64748b', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            {dayName}
          </div>
          {plan[dayName].length === 0 && (
            <div style={{ color: '#475569', fontSize: 13 }}>Sin ejercicios nuevos que testear este día.</div>
          )}
          {plan[dayName].map((ex, i) => {
            if (ex.testMethod === 'video')    return <VideoTestCard    key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} rmHistory={rmHistory} mvtStore={mvtStore} saveMVT={saveMVT} clearMVT={clearMVT} />;
            if (ex.testMethod === 'repmax')   return <RepMaxTestCard   key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} rmHistory={rmHistory} />;
            if (ex.testMethod === 'coreload') return <CoreLoadTestCard key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} rmHistory={rmHistory} />;
            return <LadderTestCard key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} rmHistory={rmHistory} />;
          })}
        </div>
      ))}

      <div style={{ background: '#0f172a', borderRadius: 10, padding: '14px 16px', border: '1px solid #22C55E33' }}>
        <div style={{ color: '#22C55E', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Ciclo nuevo
        </div>
        {lastTestDate ? (
          <>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>
              Último test guardado: {lastTestDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}. La Semana 1 del ciclo nuevo arranca ese día (no el día en que pulses el botón), y se borran las casillas de sesión completada del ciclo anterior. Los RM ya guardados no se tocan.
            </div>
            {!confirming ? (
              <button onClick={() => setConfirming(true)}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: '#14532d', color: '#86efac', fontWeight: 700, fontSize: 13 }}>
                Iniciar ciclo nuevo
              </button>
            ) : (
              <div>
                <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 8 }}>
                  ¿Seguro? Esto pone la Semana en 1 y borra las sesiones marcadas como hechas del ciclo anterior.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { startNewCycle(); setConfirming(false); }}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: '#14532d', color: '#86efac', fontWeight: 700, fontSize: 13 }}>
                    Sí, iniciar
                  </button>
                  <button onClick={() => setConfirming(false)}
                    style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: '#334155', color: '#94a3b8', fontWeight: 700, fontSize: 13 }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ color: '#64748b', fontSize: 13 }}>Guarda al menos un test para poder iniciar el ciclo nuevo.</div>
        )}
      </div>
    </div>
  );
}

// ─── SHOPPING: ITEMS POR DÍA ─────────────────────────────────────────────────
const PA = [
  { cat:'🥩 Proteínas',        name:'Pechuga de pollo (crudo)',  qty:300, unit:'g' },
  { cat:'🥚 Huevos y lácteos', name:'Huevos',                    qty:4,   unit:'uds' },
  { cat:'🥚 Huevos y lácteos', name:'Arla Skyr 450g',            qty:1,   unit:'pack' },
  { cat:'🥚 Huevos y lácteos', name:'Parmesano',                 qty:50,  unit:'g' },
  { cat:'🥦 Verduras',         name:'Brócoli',                   qty:200, unit:'g' },
  { cat:'🥦 Verduras',         name:'Espinacas',                 qty:140, unit:'g' },
  { cat:'🥦 Verduras',         name:'Tomate',                    qty:80,  unit:'g' },
  { cat:'🥦 Verduras',         name:'Pimiento',                  qty:60,  unit:'g' },
  { cat:'🥦 Verduras',         name:'Calabacín',                 qty:50,  unit:'g' },
  { cat:'🍠 Cereales',         name:'Arroz (seco)',              qty:35,  unit:'g' },
  { cat:'🫙 Despensa',         name:'Semillas de calabaza',      qty:25,  unit:'g' },
  { cat:'🫙 Despensa',         name:'Aceite de oliva',           qty:25,  unit:'ml' },
  { cat:'🫙 Despensa',         name:'Senfmehl braun (mostaza parda)', qty:1, unit:'g' },
  { cat:'🍓 Fruta',            name:'Fruta variada',             qty:300, unit:'g' },
];
const PB = [
  { cat:'🥩 Proteínas',        name:'Salmón (crudo)',            qty:250, unit:'g' },
  { cat:'🥩 Proteínas',        name:'Ternera magra (crudo)',     qty:220, unit:'g' },
  { cat:'🥚 Huevos y lácteos', name:'Huevos',                    qty:4,   unit:'uds' },
  { cat:'🥚 Huevos y lácteos', name:'Arla Skyr 450g',            qty:1,   unit:'pack' },
  { cat:'🥦 Verduras',         name:'Brócoli',                   qty:200, unit:'g' },
  { cat:'🍠 Cereales',         name:'Boniato',                   qty:100, unit:'g' },
  { cat:'🍠 Cereales',         name:'Patata',                    qty:100, unit:'g' },
  { cat:'🫙 Despensa',         name:'Aceite de oliva',           qty:20,  unit:'ml' },
  { cat:'🫙 Despensa',         name:'Senfmehl braun (mostaza parda)', qty:1, unit:'g' },
  { cat:'🍓 Fruta',            name:'Fruta variada',             qty:300, unit:'g' },
];
// Día C — domingo y jueves, días de hígado. Igual que PA pero con 75g de pollo
// sustituidos por 75g de hígado y algo menos de aceite, porque el hígado ya trae
// grasa. La proteína queda igual que un día A. Actualizado 18/08/2026: antes era
// un solo día con 150g; ahora dos días con 75g — mismo total semanal, mejor
// absorción fraccional y retinol por debajo del UL cada día.
const PC = [
  { cat:'🥩 Proteínas',        name:'Hígado de pollo (crudo)',   qty:75,  unit:'g' },
  { cat:'🥩 Proteínas',        name:'Pechuga de pollo (crudo)',  qty:225, unit:'g' },
  { cat:'🥚 Huevos y lácteos', name:'Huevos',                    qty:4,   unit:'uds' },
  { cat:'🥚 Huevos y lácteos', name:'Arla Skyr 450g',            qty:1,   unit:'pack' },
  { cat:'🥚 Huevos y lácteos', name:'Parmesano',                 qty:50,  unit:'g' },
  { cat:'🥦 Verduras',         name:'Brócoli',                   qty:200, unit:'g' },
  { cat:'🥦 Verduras',         name:'Espinacas',                 qty:140, unit:'g' },
  { cat:'🥦 Verduras',         name:'Tomate',                    qty:80,  unit:'g' },
  { cat:'🥦 Verduras',         name:'Pimiento',                  qty:60,  unit:'g' },
  { cat:'🥦 Verduras',         name:'Calabacín',                 qty:50,  unit:'g' },
  { cat:'🍠 Cereales',         name:'Arroz (seco)',              qty:35,  unit:'g' },
  { cat:'🫙 Despensa',         name:'Semillas de calabaza',      qty:25,  unit:'g' },
  { cat:'🫙 Despensa',         name:'Aceite de oliva',           qty:22,  unit:'ml' },
  { cat:'🫙 Despensa',         name:'Senfmehl braun (mostaza parda)', qty:1, unit:'g' },
  { cat:'🍓 Fruta',            name:'Fruta variada',             qty:300, unit:'g' },
];
const CAT_COL = {
  '🥩 Proteínas':'#EF4444', '🥚 Huevos y lácteos':'#F59E0B',
  '🥦 Verduras':'#22C55E',  '🍠 Cereales':'#8B5CF6',
  '🫙 Despensa':'#64748b',  '🍓 Fruta':'#EC4899',
};
function fmtQ(qty, unit) {
  if (unit === 'g' && qty >= 1000) return `${+(qty/1000).toFixed(1)} kg`;
  if (unit === 'pack') return qty === 1 ? '1 pack' : `${qty} packs`;
  return `${qty} ${unit}`;
}
function scaled(items, days) { return items.map(i => ({...i, total: i.qty * days})); }
function merged(dA, dB, dC = 0) {
  const map = new Map();
  const add = (items, d) => { if (!d) return; items.forEach(i => {
    if (map.has(i.name)) map.get(i.name).total += i.qty * d;
    else map.set(i.name, {...i, total: i.qty * d});
  }); };
  add(PA, dA); add(PC, dC); add(PB, dB);
  const cats = {};
  map.forEach(v => { if (!cats[v.cat]) cats[v.cat]=[]; cats[v.cat].push(v); });
  return cats;
}

function ShoppingTab({ weekIdx }) {
  // 18/08/2026: reparto nuevo 3 A + 2 B + 2 C (antes 4 + 2 + 1).
  const [daysA, setDaysA]     = useState(3);
  const [daysB, setDaysB]     = useState(2);
  const [daysC, setDaysC]     = useState(2);
  const [checked, setChecked] = useState({});
  const toggle = k => setChecked(p => ({...p, [k]: !p[k]}));

  const totalDays = daysA + daysB + daysC;
  const phase = PROG[weekIdx].phase;
  const add = PHASE_ADD[phase];

  const suppItems = [
    { name:'D3+K2 · Natural Elements',                 qty:totalDays,              unit:'comp' },
    // Omega-3 solo los días SIN salmón: 250g de salmón ya dan ~5.000mg de EPA+DHA,
    // muy por encima del objetivo de 2.000. Saltarlas los días B ahorra 6 cáps/semana.
    { name:'Omega-3 · NE (no en días B — ya hay salmón)', qty:(daysA + daysC) * 3, unit:'cáps' },
    { name:'Magnesio Bisglicinato · Natural Elements', qty:totalDays,              unit:'cáps' },

  ];

  function ItemRow({ item, prefix, color }) {
    const k = `${prefix}|${item.name}`;
    const done = !!checked[k];
    return (
      <div onClick={() => toggle(k)} style={{
        display:'flex', alignItems:'center', gap:12,
        padding:'9px 14px', background:'#1e293b', borderRadius:8,
        marginBottom:5, cursor:'pointer', opacity: done ? 0.4 : 1, transition:'opacity 0.2s'
      }}>
        <div style={{
          width:20, height:20, borderRadius:4, flexShrink:0,
          border:`2px solid ${done ? color : '#334155'}`,
          background: done ? color : 'transparent',
          display:'flex', alignItems:'center', justifyContent:'center'
        }}>
          {done && <span style={{color:'#fff',fontSize:11,fontWeight:700}}>✓</span>}
        </div>
        <span style={{flex:1, color:'#f8fafc', fontSize:14, fontWeight:500, textDecoration: done?'line-through':'none'}}>
          {item.name}
        </span>
        <span style={{color, fontSize:13, fontWeight:700}}>{fmtQ(item.total, item.unit)}</span>
      </div>
    );
  }

  function CatGroup({ catName, items, prefix }) {
    const color = CAT_COL[catName] || '#94a3b8';
    return (
      <div style={{marginBottom:14}}>
        <div style={{color, fontWeight:700, fontSize:13, marginBottom:6, paddingLeft:4}}>{catName}</div>
        {items.map((item, i) => <ItemRow key={i} item={item} prefix={prefix} color={color} />)}
      </div>
    );
  }

  function Suppls() {
    return (
      <div style={{background:'#0f172a', borderRadius:10, padding:'14px 16px', marginTop:8}}>
        <div style={{color:'#38bdf8', fontWeight:700, fontSize:13, marginBottom:10}}>💊 Suplementos</div>
        {suppItems.map((s, i) => {
          const k = `supp-${i}`;
          const done = !!checked[k];
          return (
            <div key={i} onClick={() => toggle(k)} style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'8px 0', borderBottom: i<suppItems.length-1 ? '1px solid #1e293b' : 'none',
              cursor:'pointer', opacity: done ? 0.4 : 1
            }}>
              <span style={{color:'#94a3b8', fontSize:13, textDecoration: done?'line-through':'none'}}>{s.name}</span>
              <span style={{color:'#38bdf8', fontSize:13, fontWeight:600}}>{s.qty} {s.unit}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function PhaseAdd() {
    if (add.carbG === 0 && add.fruitG === 0 && add.oilMl === 0) return null;
    return (
      <div style={{background:'#0f172a', borderRadius:10, padding:'14px 16px', marginTop:12}}>
        <div style={{color:'#22C55E', fontWeight:700, fontSize:13, marginBottom:10}}>⚡ Ajuste de fase — {phase} (extra sobre {totalDays} días)</div>
        <div style={{color:'#94a3b8', fontSize:13, padding:'4px 0'}}>Arroz / boniato / patata extra: {add.carbG * totalDays}g</div>
        <div style={{color:'#94a3b8', fontSize:13, padding:'4px 0'}}>Fruta extra: {add.fruitG * totalDays}g</div>
        <div style={{color:'#94a3b8', fontSize:13, padding:'4px 0'}}>Aceite de oliva extra: {add.oilMl * totalDays}ml</div>
      </div>
    );
  }

  return (
    <div>
      {/* Day selectors */}
      <div style={{display:'flex', gap:10, marginBottom:20}}>
        {[['Plan A', daysA, setDaysA, '#3B82F6'], ['🫀 Hígado', daysC, setDaysC, '#A855F7'], ['Plan B', daysB, setDaysB, '#F59E0B']].map(([label, val, setter, color]) => (
          <div key={label} style={{flex:1, background:'#1e293b', borderRadius:10, padding:'12px 6px', textAlign:'center'}}>
            <div style={{color, fontWeight:700, marginBottom:10, fontSize:13}}>{label}</div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:14}}>
              <button onClick={() => setter(Math.max(0, val-1))} style={{
                width:32, height:32, borderRadius:6, border:'none', cursor:'pointer',
                background:'#334155', color:'#f8fafc', fontSize:20, fontWeight:700, lineHeight:1
              }}>−</button>
              <span style={{color:'#f8fafc', fontWeight:700, fontSize:24, minWidth:28}}>{val}</span>
              <button onClick={() => setter(Math.min(7, val+1))} style={{
                width:32, height:32, borderRadius:6, border:'none', cursor:'pointer',
                background:'#334155', color:'#f8fafc', fontSize:20, fontWeight:700, lineHeight:1
              }}>+</button>
            </div>
            <div style={{color:'#64748b', fontSize:12, marginTop:6}}>días</div>
          </div>
        ))}
      </div>

      {totalDays > 0 ? (
        Object.entries(merged(daysA, daysB, daysC)).map(([cat, items]) =>
          <CatGroup key={cat} catName={cat} items={items} prefix={`c${daysA}${daysB}${daysC}`} />
        )
      ) : (
        <div style={{color:'#64748b', textAlign:'center', padding:32}}>Selecciona al menos 1 día</div>
      )}
      <PhaseAdd />
      <Suppls />
    </div>
  );
}

function NutritionTab({ weekIdx }) {
  const [view, setView] = useState('A');
  const plan = NUTRITION[view];
  const phase = PROG[weekIdx].phase;
  const add = PHASE_ADD[phase];
  const addMacros = phaseAddMacros(add);
  const hasAdd = add.carbG > 0 || add.fruitG > 0 || add.oilMl > 0;
  const totals = hasAdd ? {
    kcal: plan.totals.kcal + addMacros.kcal,
    protein: plan.totals.protein + addMacros.protein,
    fat: plan.totals.fat + addMacros.fat,
    carbs: plan.totals.carbs + addMacros.carbs,
  } : plan.totals;

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['A', 'C', 'B'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, padding: '10px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 13,
            background: v === view ? NUTRITION[v].color : '#1e293b',
            color: v === view ? '#fff' : '#64748b'
          }}>
            {NUTRITION[v].label}
            <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>{NUTRITION[v].days}</div>
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}><PhasePill weekIdx={weekIdx} /></div>

      {plan.note && (
        <div style={{
          background: '#2e1065', border: '1px solid #7c3aed', borderRadius: 10,
          padding: '12px 14px', marginBottom: 16, color: '#e9d5ff', fontSize: 13, lineHeight: 1.6
        }}>
          <b>🫀 Por qué el hígado y cómo tratarlo.</b> {plan.note}
        </div>
      )}

      {/* Regla del hierro — visible siempre */}
      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{color:'#f8fafc', fontWeight:700, marginBottom:6, fontSize:13}}>🩸 Reglas del hierro — no romperlas</div>
        <b style={{color:'#e2e8f0'}}>1.</b> <b>Todo el calcio fuera de las comidas con hierro.</b> Skyr y parmesano van solos, a media mañana. El calcio es el único inhibidor que frena el hierro hemo <i>y</i> el no hemo.<br/>
        <b style={{color:'#e2e8f0'}}>2.</b> La fruta del desayuno tiene que ser <b>cítrica</b> — 2 kiwis son la mejor opción (~140mg de vitamina C). No es opcional: es lo que compensa la fosvitina de la yema del huevo, que también bloquea hierro.<br/>
        <b style={{color:'#e2e8f0'}}>3.</b> El almuerzo <b>no lleva lácteo</b>. La fruta del almuerzo es libre <i>salvo</i> los días con hierro (Dom · Mar · Jue · Sáb), donde también tiene que ser <b>cítrica</b> — ver regla 6.<br/>
        <b style={{color:'#e2e8f0'}}>4.</b> <b>Nada de café ni té</b> en las 2 h alrededor del desayuno. Los polifenoles frenan el hierro no hemo hasta un 60-90%, más que todo lo anterior junto.<br/>
        <b style={{color:'#e2e8f0'}}>5.</b> <b>Nunca dos almuerzos con hierro hemo en días seguidos.</b> Una carga de hierro eleva la hepcidina y frena la absorción de la siguiente ~24 h. Por eso el reparto es <b>Dom → Mar → Jue → Sáb</b>, con 2 días de separación. Es también el motivo de partir el hígado en 2×75g en vez de una ración de 150g.<br/>
        <b style={{color:'#e2e8f0'}}>6.</b> <b>El hígado responde a la vitamina C.</b> Corrección del 18/08/2026: buena parte de su hierro no es hemo, es no hemo unido a ferritina. Así que en Dom · Mar · Jue · Sáb el cítrico va <b>también en el almuerzo</b>, no solo en el desayuno. Es gratis.
      </div>

      {/* Espaciado entre tomas */}
      <div style={{
        background:'#0f172a', border:'1px solid #334155', borderRadius:10,
        padding:'12px 14px', marginBottom:16, color:'#94a3b8', fontSize:12.5, lineHeight:1.7
      }}>
        <div style={{color:'#f8fafc', fontWeight:700, marginBottom:8, fontSize:13}}>⏱ Espaciado entre tomas</div>
        <div style={{color:'#e2e8f0', fontFamily:'ui-monospace, monospace', fontSize:12.5, lineHeight:2, marginBottom:8}}>
          08:30 · Desayuno <span style={{color:'#64748b'}}>(hora cero)</span><br/>
          11:30 · Skyr <span style={{color:'#64748b'}}>— desayuno + 3 h</span><br/>
          12:00 · Parmesano <span style={{color:'#64748b'}}>— días C (Dom · Jue)</span><br/>
          13:00 · Parmesano <span style={{color:'#64748b'}}>— días A (Lun · Mié · Vie)</span><br/>
          14:30 · Almuerzo
        </div>
        <b style={{color:'#e2e8f0'}}>Son offsets, no horas fijas.</b> Si desayunas a las 9:00, todo corre media hora. La inhibición del calcio es concurrente con la comida: depende de que calcio y hierro coincidan en el duodeno, y ahí <b>2 h es el umbral práctico</b>. Por debajo de 1 h 30 es como tomarlos juntos y no habrás ganado nada.<br/><br/>
        <b style={{color:'#e2e8f0'}}>Por qué el parmesano va segundo:</b> es la carga de calcio más pequeña (~590mg frente a ~675mg del Skyr), así que es la que conviene dejar más cerca del almuerzo. Y separarlos 30 min parte los ~1.265mg en dos dosis, que absorben mejor que una sola — por encima de ~500mg por toma la absorción de calcio cae.<br/><br/>
        <b style={{color:'#e2e8f0'}}>Parmesano móvil (18/08/2026):</b> en los días A el almuerzo es pollo, con hierro despreciable, así que el parmesano se va a las <b>13:00</b> — separa las dos cargas de calcio 90 min en vez de 30 y mejora la absorción del propio calcio. En los días C vuelve a las <b>12:00</b> para no comerse las 2 h de margen antes del hígado. Los días B no llevan parmesano.<br/><br/>
        <b style={{color:'#e2e8f0'}}>Re-espaciado del 5/09/2026:</b> con el almuerzo a las 14:30 quedaba un hueco de 3 h 30 antes de comer, así que el Skyr pasó de 10:30 a <b>11:30</b> y el parmesano de 11:00 a <b>12:00</b> (días A, de 12:00 a <b>13:00</b>). Fue <b>por comodidad, no por absorción</b> — las restricciones duras ya se cumplían con el horario viejo. Huecos ahora: 3 h · 30 min · 2 h 30, con el margen calcio→hierro en <b>2 h 30</b>. Si algún día hay que recortar, se recorta de aquí y se vuelve al horario viejo: la regla intocable siguen siendo las 2 h antes del hierro.<br/><br/>
        <b style={{color:'#e2e8f0'}}>Si no te cabe:</b> sacrifica la separación entre Skyr y parmesano (júntalos a las 11:45), nunca las 2 h de margen. Los días que importan de verdad son <b>domingo y jueves (hígado), martes y sábado (ternera)</b>: esos respétalos.<br/><br/>
        Agua, la que quieras y cuando quieras. No interfiere con nada.
      </div>

      {/* Cocción → pestaña Cocina */}
      <div style={{
        background:'#172554', border:'1px solid #3B82F6', borderRadius:10,
        padding:'12px 14px', marginBottom:16, color:'#bfdbfe', fontSize:12.5, lineHeight:1.7
      }}>
        <div style={{color:'#eff6ff', fontWeight:700, marginBottom:6, fontSize:13}}>🔥 Cómo cocinar cada cosa → pestaña <b>👨‍🍳 Cocina</b></div>
        Métodos por alimento, el reparto semanal de cocina (la sesión grande es el domingo), el protocolo del brócoli con mostaza y
        el aviso de seguridad por no recalentar viven ahí, para no repetirlos aquí.<br/><br/>
        <b style={{color:'#FCA5A5'}}>Los dos de memoria:</b> el pollo a <b style={{color:'#dbeafe'}}>150-160 °C hasta 68-70 °C de interior</b>,
        y <b style={{color:'#dbeafe'}}>congelar los tuppers del día 4 en adelante</b> — el pollo cocido aguanta 3-4 días y tú no recalientas.
      </div>

      {/* Pesos en crudo — aviso */}
      <div style={{
        background:'#1c1917', border:'1px solid #F59E0B', borderRadius:10,
        padding:'12px 14px', marginBottom:16, color:'#fed7aa', fontSize:12.5, lineHeight:1.7
      }}>
        <div style={{color:'#fff7ed', fontWeight:700, marginBottom:6, fontSize:13}}>⚖️ Todos los pesos de carne y pescado son EN CRUDO</div>
        Es lo que compras y lo que dice la lista de la compra. El peso cocido va al lado solo como referencia, para que puedas comprobarlo en el plato si ya lo has cocinado. <b>Los macros corresponden al peso crudo.</b><br/><br/>
        Rendimientos aproximados usados: <b>pollo 75 %</b> · <b>ternera 73 %</b> · <b>salmón 80 %</b> · <b>hígado 70 %</b>. Varían con el método y el punto de cocción — si asas más, pierdes más agua y el cocido baja. Nunca al revés.<br/><br/>

        <div style={{background:'#0f172a', borderRadius:8, padding:'10px 12px', marginBottom:10, color:'#cbd5e1'}}>
          <b style={{color:'#f8fafc'}}>🍱 Reparto del batch cook — solo el pollo lo necesita.</b> Ternera, salmón e hígado se cocinan al momento en su día, así que ahí basta con pesarlos crudos. El pollo se cocina entero el domingo y hay que dividirlo después: <b style={{color:'#F59E0B'}}>por proporción, no por gramos</b> — pesa todo el pollo cocido y divídelo en <b style={{color:'#f8fafc'}}>18 partes</b> (día A, 4 partes · día C, 3 partes).<br/>
          <span style={{color:'#64748b'}}>La regla completa, con el arroz y el brócoli, está en la pestaña <b style={{color:'#94a3b8'}}>👨‍🍳 Cocina</b>.</span>
        </div>

        <b style={{color:'#FCA5A5'}}>⚠ Pendiente de decidir (18/08/2026):</b> los totales de abajo están escritos a mano y <b>no cuadran con la suma de los ítems</b>. Sumando ítem a ítem salen ~1.907 kcal en día A frente a los 1.975 declarados, y la diferencia mayor está en los carbohidratos (121 g sumados vs 103 g declarados). No se ha tocado nada: cambiar el total mueve el déficit de fase y eso es una decisión, no una limpieza. <b>Hay que reconciliarlo antes de fiarse de la tabla de fases.</b>
      </div>

      {/* Meals */}
      {plan.meals.map((meal, mi) => (
        <div key={mi} style={{ marginBottom: 20 }}>
          <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
            {meal.name}
          </div>
          {meal.items.map((item, ii) => (
            <div key={ii} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 5
            }}>
              <div>
                <span style={{ color: '#f8fafc', fontSize: 14 }}>{item.food}</span>
                {item.raw ? (
                  <span style={{ fontSize: 13, marginLeft: 8 }}>
                    <b style={{ color: '#F59E0B' }}>{item.raw}g crudo</b>
                    <span style={{ color: '#475569' }}> → </span>
                    <span style={{ color: '#64748b' }}>~{item.cooked}g cocido</span>
                    <span style={{ color: '#475569', fontSize: 11 }}> ({Math.round(item.yield * 100)}%)</span>
                  </span>
                ) : (
                  <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>{item.amount}</span>
                )}
              </div>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{item.macros}</span>
            </div>
          ))}
        </div>
      ))}

      {/* Phase top-up */}
      {hasAdd && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#22C55E', fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
            ⚡ Ajuste de fase — {phase}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 5
          }}>
            <span style={{ color: '#f8fafc', fontSize: 14 }}>{plan.carbFood} extra</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>+{add.carbG}g</span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 5
          }}>
            <span style={{ color: '#f8fafc', fontSize: 14 }}>Fruta extra</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>+{add.fruitG}g</span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 5
          }}>
            <span style={{ color: '#f8fafc', fontSize: 14 }}>Aceite de oliva extra</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>+{add.oilMl}ml</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
            Estimación de partida sobre un gasto supuesto de 2.750 kcal. Lo que manda es la regla de corrección de la pestaña <b>📈 Seguimiento</b>: objetivo 0,45–0,55 kg/semana de media semanal. Dos semanas por encima de 0,65 → +150 kcal/día. Dos por debajo de 0,25 → −150 kcal/día.
          </div>
        </div>
      )}

      {/* Totals */}
      <div style={{
        background: '#0f172a', borderRadius: 10, padding: '14px 16px',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8
      }}>
        {[
          { label: 'Calorías', value: `~${totals.kcal.toLocaleString('de-DE')}`, color: '#f8fafc' },
          { label: 'Proteína', value: `~${totals.protein}g`, color: '#22C55E' },
          { label: 'Grasa',    value: `~${totals.fat}g`,    color: '#F59E0B' },
          { label: 'Carbos',   value: `~${totals.carbs}g`,  color: '#3B82F6' },
        ].map((t, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ color: t.color, fontWeight: 700, fontSize: 16 }}>{t.value}</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{t.label}</div>
          </div>
        ))}
      </div>

    </div>
  );
}

function SupplementsTab() {
  return (
    <div>
      {SUPPS.map((s, i) => (
        <div key={i} style={{
          background: '#1e293b', borderRadius: 12, padding: '16px', marginBottom: 12
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 16 }}>{s.name}</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{s.brand}</div>
            </div>
            <span style={{
              background: s.color + '22', color: s.color,
              border: `1px solid ${s.color}55`,
              borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600
            }}>
              {s.dose}
            </span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>
            ⏱ {s.timing}
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>
            {s.detail}
          </div>
          <div style={{
            background: '#0f172a', borderRadius: 6, padding: '8px 12px',
            color: '#94a3b8', fontSize: 12, lineHeight: 1.5
          }}>
            💡 {s.why}
          </div>
        </div>
      ))}

      {/* D3 seasonal note */}
      <div style={{
        background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginTop: 4
      }}>
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>
          <b style={{color:'#f8fafc'}}>Desayuno (~8:30):</b> 1 cáp Omega-3. <b style={{color:'#EF4444'}}>Nada más</b> — el desayuno lleva el hierro no hemo del día y no debe compartir comida con zinc ni con calcio.<br/>
          <b style={{color:'#f8fafc'}}>Media mañana (11:30 / 12:00):</b> Skyr y parmesano, solos. Sin suplementos.<br/>
          <b style={{color:'#f8fafc'}}>Almuerzo:</b> D3+K2 + Magnesio + 2 cáps Omega-3 (con aceite de oliva = absorción óptima).<br/>
          <b style={{color:'#f8fafc'}}>Días B (Mar · Sáb):</b> <b style={{color:'#F59E0B'}}>cero cápsulas de Omega-3</b> — el salmón ya aporta ~5.000mg de EPA+DHA. D3+K2 y magnesio sí, como siempre.<br/>
          <b style={{color:'#f8fafc'}}>Zinc:</b> ⏸ suspendido hasta la analítica. Si se retoma, va en el <b>almuerzo</b> (no en el desayuno) y se salta los días con hígado (Dom y Jue).
        </div>
      </div>
    </div>
  );
}

// ─── SEGUIMIENTO ─────────────────────────────────────────────────────────────
// Añadido 8/08/2026. La tabla de calorías descansa sobre un gasto ESTIMADO de
// 2.750 kcal (Katch-McArdle + 7 sesiones). Si el gasto real fuera 2.950, las
// 2.200 kcal serían un 25% de déficit y volveríamos a la zona de riesgo de
// efluvio telógeno sin enterarnos. Esta pestaña existe para cerrar ese hueco:
// no protege la tabla, protege la regla de corrección.
const TRACK_TARGET_LO = 0.25;   // kg/semana — por debajo, el déficit se quedó corto
const TRACK_TARGET_HI = 0.65;   // kg/semana — por encima, el déficit aprieta de más
const TRACK_BAND = [0.45, 0.55]; // objetivo

function loadTrack() {
  try { const s = localStorage.getItem('ta_track'); return s ? JSON.parse(s) : []; }
  catch { return []; }
}
function saveTrack(rows) {
  try { localStorage.setItem('ta_track', JSON.stringify(rows)); } catch {}
}
function loadLabs() {
  try { const s = localStorage.getItem('ta_labs'); return s ? JSON.parse(s) : {}; }
  catch { return {}; }
}
function saveLabs(o) {
  try { localStorage.setItem('ta_labs', JSON.stringify(o)); } catch {}
}

const LAB_PANEL = [
  { k:'blutbild', de:'großes Blutbild',   es:'Hemograma completo',
    why:'Base de todo. Descarta anemia franca y da pistas de inflamación.' },
  { k:'ferritin', de:'Ferritin',          es:'Ferritina',
    why:'El parámetro clave. El folículo sufre por debajo de 40-70 ng/ml aunque la hemoglobina esté normal.' },
  { k:'crp',      de:'CRP',               es:'Proteína C reactiva',
    why:'NO es opcional. La ferritina sube con la inflamación y con el entrenamiento duro; sin CRP no sabes si una ferritina normal es real o está falseada al alza.' },
  { k:'tsh',      de:'TSH und fT4',       es:'TSH y T4 libre',
    why:'El hipotiroidismo subclínico da caída difusa exactamente igual que el efluvio.' },
  { k:'vitd',     de:'25-OH-Vitamin D',   es:'Vitamina D',
    why:'Braunschweig está a 52,3°N. En invierno no hay síntesis cutánea útil, haga el sol que haga.' },
  { k:'zink',     de:'Zink',              es:'Zinc',
    why:'Déficit y exceso dan ambos caída de pelo. Por eso se mide antes de suplementar.' },
  { k:'b12',      de:'Vitamin B12',       es:'Vitamina B12',
    why:'Se cubre de sobra con la dieta, pero es barato descartarlo.' },
];

function daysBetween(a, b) {
  return (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000;
}

// Ritmo semanal de pérdida entre dos registros. Positivo = está bajando.
function rateBetween(prev, cur) {
  const d = daysBetween(prev.date, cur.date);
  if (!d || d <= 0) return null;
  return (prev.weight - cur.weight) / (d / 7);
}

function TrackingTab() {
  const [rows, setRows] = useState(loadTrack);
  const [labs, setLabs] = useState(loadLabs);
  const [date, setDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [weight, setWeight] = useState('');
  const [waist, setWaist]   = useState('');
  const [hair, setHair]     = useState('igual');

  const sorted = [...rows].sort((a, b) => a.date < b.date ? -1 : 1);

  const add = () => {
    const w = parseFloat(String(weight).replace(',', '.'));
    if (!date || !w || w < 40 || w > 200) return;
    const wa = parseFloat(String(waist).replace(',', '.'));
    const next = [...rows.filter(r => r.date !== date),
                  { date, weight: w, waist: (wa && wa > 40 && wa < 200) ? wa : null, hair }];
    next.sort((a, b) => a.date < b.date ? -1 : 1);
    setRows(next); saveTrack(next);
    setWeight(''); setWaist('');
  };
  const del = (d) => {
    const next = rows.filter(r => r.date !== d);
    setRows(next); saveTrack(next);
  };
  const toggleLab = (k) => {
    const next = { ...labs, [k]: !labs[k] };
    setLabs(next); saveLabs(next);
  };

  // Últimos dos ritmos semana-a-semana — la regla habla de "dos semanas seguidas"
  const rates = [];
  for (let i = 1; i < sorted.length; i++) {
    const r = rateBetween(sorted[i - 1], sorted[i]);
    if (r !== null) rates.push({ to: sorted[i].date, rate: r });
  }
  const last2 = rates.slice(-2);
  const latest = sorted[sorted.length - 1];

  // Ritmo medio de las últimas 4 semanas (más estable que un solo salto)
  let avgRate = null;
  if (sorted.length >= 2) {
    const window = sorted.slice(-5);
    const first = window[0], last = window[window.length - 1];
    avgRate = rateBetween(first, last);
  }

  let verdict = null;
  if (latest && latest.hair === 'mas') {
    verdict = { color:'#EF4444', bg:'#450a0a', title:'Sube 150 kcal/día — ahora',
      text:'Has marcado que la caída de pelo ha aumentado. Esto manda por encima de la báscula: la caída es una señal más temprana y más fiable de que el déficit aprieta de más que cualquier número de peso. Sube 150 kcal/día aunque el ritmo esté en rango.' };
  } else if (last2.length === 2 && last2.every(r => r.rate > TRACK_TARGET_HI)) {
    verdict = { color:'#F59E0B', bg:'#451a03', title:'Sube 150 kcal/día',
      text:`Dos semanas seguidas por encima de ${TRACK_TARGET_HI} kg/sem. Tu gasto real es mayor del que asumimos (2.750) y estás en un déficit más profundo del que crees — justo el escenario que queríamos evitar.` };
  } else if (last2.length === 2 && last2.every(r => r.rate < TRACK_TARGET_LO)) {
    verdict = { color:'#3B82F6', bg:'#172554', title:'Baja 150 kcal/día',
      text:`Dos semanas seguidas por debajo de ${TRACK_TARGET_LO} kg/sem. O el gasto real es menor del estimado, o hay ingesta que no se está contabilizando. Antes de recortar, revisa lo segundo.` };
  } else if (last2.length === 2) {
    verdict = { color:'#22C55E', bg:'#052e16', title:'En rango — no toques nada',
      text:`El ritmo está dentro de la banda segura (${TRACK_BAND[0]}–${TRACK_BAND[1]} kg/sem, tolerancia ${TRACK_TARGET_LO}–${TRACK_TARGET_HI}). Ni pérdida de masa magra ni riesgo de efluvio a este ritmo.` };
  } else {
    verdict = { color:'#64748b', bg:'#0f172a', title:'Faltan datos',
      text:'Necesitas al menos tres registros semanales para que la regla de corrección diga algo. Con dos ya se ve un ritmo, pero un solo salto puede ser agua.' };
  }

  const inp = {
    background:'#0f172a', border:'1px solid #334155', borderRadius:8,
    padding:'9px 10px', color:'#f8fafc', fontSize:14, width:'100%',
    boxSizing:'border-box', outline:'none'
  };
  const lbl = { color:'#64748b', fontSize:11, marginBottom:4, fontWeight:600 };

  return (
    <div>
      {/* Veredicto */}
      <div style={{
        background: verdict.bg, border:`1px solid ${verdict.color}`, borderRadius:12,
        padding:'14px 16px', marginBottom:16
      }}>
        <div style={{ color: verdict.color, fontWeight:700, fontSize:16, marginBottom:6 }}>
          {verdict.title}
        </div>
        <div style={{ color:'#cbd5e1', fontSize:13, lineHeight:1.6 }}>{verdict.text}</div>
      </div>

      {/* Métricas */}
      <div style={{
        background:'#0f172a', borderRadius:10, padding:'14px 16px', marginBottom:16,
        display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8
      }}>
        {[
          { label:'Peso actual', value: latest ? `${latest.weight.toFixed(1)} kg` : '—', color:'#f8fafc' },
          { label:'Ritmo (últ. 4 sem)', value: avgRate !== null ? `${avgRate >= 0 ? '' : '+'}${Math.abs(avgRate).toFixed(2)} kg/sem` : '—',
            color: avgRate === null ? '#64748b' : (avgRate > TRACK_TARGET_HI || avgRate < TRACK_TARGET_LO) ? '#F59E0B' : '#22C55E' },
          { label:'Cintura', value: latest && latest.waist ? `${latest.waist.toFixed(1)} cm` : '—', color:'#3B82F6' },
        ].map((m, i) => (
          <div key={i} style={{ textAlign:'center' }}>
            <div style={{ color:m.color, fontWeight:700, fontSize:16 }}>{m.value}</div>
            <div style={{ color:'#64748b', fontSize:11 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Cómo medir */}
      <div style={{
        background:'#0f172a', border:'1px solid #334155', borderRadius:10,
        padding:'12px 14px', marginBottom:16, color:'#94a3b8', fontSize:12.5, lineHeight:1.7
      }}>
        <div style={{ color:'#f8fafc', fontWeight:700, marginBottom:6, fontSize:13 }}>📏 Cómo medir para que esto sirva</div>
        <b style={{color:'#e2e8f0'}}>Peso:</b> pésate a diario en ayunas, después de orinar, y apunta aquí <b>la media de los 7 días</b>, nunca el dato de un día suelto. El peso fluctúa 1-2 kg por agua y glucógeno sin que signifique nada.<br/>
        <b style={{color:'#e2e8f0'}}>Cintura:</b> una vez por semana, en ayunas, a la altura del ombligo, sin apretar y sin meter barriga. Con esta magnitud de cambio la cinta métrica es <b>más fiable que tu báscula de bioimpedancia</b>, que tiene ±3-4 puntos de error en el % de grasa y es muy sensible a la hidratación.<br/>
        <b style={{color:'#e2e8f0'}}>Las 2 primeras semanas</b> verás 1-2 kg de bajada que son glucógeno y agua, no grasa. No corrijas nada con esos datos.<br/>
        <b style={{color:'#e2e8f0'}}>Si ganas masa magra</b>, el peso bajará menos de lo previsto mientras el % de grasa sigue cayendo. La báscula miente en esa dirección concreta — por eso está la cintura.
      </div>

      {/* Nuevo registro */}
      <div style={{ background:'#1e293b', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
        <div style={{ color:'#f8fafc', fontWeight:700, fontSize:15, marginBottom:12 }}>➕ Registro semanal</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div>
            <div style={lbl}>FECHA</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
          </div>
          <div>
            <div style={lbl}>PESO MEDIO SEMANAL (kg)</div>
            <input type="number" inputMode="decimal" step="0.1" placeholder="91.0"
              value={weight} onChange={e => setWeight(e.target.value)} style={inp} />
          </div>
          <div>
            <div style={lbl}>CINTURA (cm) · opcional</div>
            <input type="number" inputMode="decimal" step="0.5" placeholder="94"
              value={waist} onChange={e => setWaist(e.target.value)} style={inp} />
          </div>
          <div>
            <div style={lbl}>CAÍDA DE PELO</div>
            <select value={hair} onChange={e => setHair(e.target.value)} style={inp}>
              <option value="menos">Menos que la semana pasada</option>
              <option value="igual">Igual</option>
              <option value="mas">Más</option>
            </select>
          </div>
        </div>
        <button onClick={add} style={{
          width:'100%', padding:'11px', borderRadius:8, border:'none', cursor:'pointer',
          background:'#22C55E', color:'#052e16', fontWeight:700, fontSize:14
        }}>Guardar semana</button>
      </div>

      {/* Historial */}
      {sorted.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ color:'#f8fafc', fontWeight:700, fontSize:15, marginBottom:10 }}>📊 Historial</div>
          {[...sorted].reverse().map((r, i) => {
            const idx = sorted.indexOf(r);
            const rate = idx > 0 ? rateBetween(sorted[idx - 1], r) : null;
            const rateCol = rate === null ? '#64748b'
              : (rate > TRACK_TARGET_HI || rate < TRACK_TARGET_LO) ? '#F59E0B' : '#22C55E';
            const hairIcon = { menos:'📉', igual:'➡️', mas:'📈' }[r.hair] || '';
            return (
              <div key={r.date} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 14px', background:'#1e293b', borderRadius:8, marginBottom:5
              }}>
                <span style={{ color:'#64748b', fontSize:12, minWidth:78 }}>{r.date}</span>
                <span style={{ color:'#f8fafc', fontSize:14, fontWeight:600, minWidth:60 }}>{r.weight.toFixed(1)} kg</span>
                <span style={{ color:'#3B82F6', fontSize:12, minWidth:52 }}>{r.waist ? `${r.waist} cm` : '—'}</span>
                <span style={{ fontSize:13, minWidth:24 }} title={`Pelo: ${r.hair}`}>{hairIcon}</span>
                <span style={{ color:rateCol, fontSize:12, fontWeight:700, flex:1, textAlign:'right' }}>
                  {rate === null ? '' : `${rate >= 0 ? '−' : '+'}${Math.abs(rate).toFixed(2)} kg/sem`}
                </span>
                <button onClick={() => del(r.date)} style={{
                  background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:16, padding:0
                }}>×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Regla de corrección */}
      <div style={{
        background:'#0f172a', border:'1px solid #334155', borderRadius:10,
        padding:'12px 14px', marginBottom:16, color:'#94a3b8', fontSize:12.5, lineHeight:1.7
      }}>
        <div style={{ color:'#f8fafc', fontWeight:700, marginBottom:6, fontSize:13 }}>⚖️ La regla de corrección</div>
        Objetivo: <b style={{color:'#22C55E'}}>0,45–0,55 kg/semana</b>.<br/>
        Dos semanas seguidas por encima de <b>0,65</b> → <b style={{color:'#F59E0B'}}>+150 kcal/día</b>.<br/>
        Dos semanas seguidas por debajo de <b>0,25</b> → <b style={{color:'#3B82F6'}}>−150 kcal/día</b>.<br/>
        <b style={{color:'#EF4444'}}>Guardarraíl del pelo:</b> si la caída aumenta, sube 150 kcal aunque el peso vaya en el ritmo correcto. Manda por encima de la báscula.<br/><br/>
        En tres o cuatro semanas esto te calibra el gasto real mejor que cualquier fórmula. El 2.750 de la tabla de fases es una estimación; esto es una medida.
      </div>

      {/* Analítica */}
      <div style={{ background:'#1e293b', borderRadius:12, padding:'14px 16px' }}>
        <div style={{ color:'#f8fafc', fontWeight:700, fontSize:15, marginBottom:4 }}>🩸 Analítica pendiente</div>
        <div style={{ color:'#94a3b8', fontSize:12.5, lineHeight:1.7, marginBottom:12 }}>
          Es el siguiente paso y manda sobre todo lo demás. <b style={{color:'#e2e8f0'}}>Ve un lunes</b>, no un domingo después del LegDay — el entrenamiento duro sube la ferritina y falsea la lectura. <b style={{color:'#e2e8f0'}}>En ayunas</b>, aunque tengas que retrasar el desayuno: el zinc tiene variación diurna y baja tras comer. <b style={{color:'#e2e8f0'}}>Sin biotina</b> los días previos — falsea tiroides y troponina.
        </div>
        {LAB_PANEL.map(p => (
          <div key={p.k} onClick={() => toggleLab(p.k)} style={{
            display:'flex', gap:10, padding:'10px 12px', background:'#0f172a',
            borderRadius:8, marginBottom:5, cursor:'pointer', opacity: labs[p.k] ? 0.45 : 1
          }}>
            <div style={{
              width:18, height:18, borderRadius:4, flexShrink:0, marginTop:2,
              border:`2px solid ${labs[p.k] ? '#22C55E' : '#334155'}`,
              background: labs[p.k] ? '#22C55E' : 'transparent',
              display:'flex', alignItems:'center', justifyContent:'center'
            }}>
              {labs[p.k] && <span style={{ color:'#052e16', fontSize:11, fontWeight:700 }}>✓</span>}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ color:'#f8fafc', fontSize:14, fontWeight:600 }}>
                {p.de} <span style={{ color:'#64748b', fontWeight:400 }}>· {p.es}</span>
              </div>
              <div style={{ color:'#94a3b8', fontSize:12, lineHeight:1.5, marginTop:2 }}>{p.why}</div>
            </div>
          </div>
        ))}
        <div style={{ color:'#94a3b8', fontSize:12.5, lineHeight:1.7, marginTop:12 }}>
          <b style={{ color:'#f8fafc' }}>Dónde, en Braunschweig.</b><br/>
          <b style={{color:'#e2e8f0'}}>Barato:</b> tu Hausarzt, presentándolo como <i>«Haarausfall seit mehreren Monaten»</i>. Con esa indicación el seguro público suele cubrir Blutbild, Ferritin y TSH. Vitamina D y zinc casi siempre van como IGeL, ~20-30 € cada uno.<br/>
          <b style={{color:'#e2e8f0'}}>Rápido:</b> HIB Blutanalyselabor, Papenstieg 8 (Schloss Carree). Autopagador, sin receta y sin cita, lu-vi 8:00-13:00. Tel. 0531 2311325.<br/><br/>
          <b style={{ color:'#EF4444' }}>No suplementes hierro sin la ferritina medida.</b> La sobrecarga de hierro hace más daño que el déficit.
        </div>
      </div>
    </div>
  );
}

// ─── SECCIONES PRINCIPALES ────────────────────────────────────────────────────
// ─── COCINA ──────────────────────────────────────────────────────────────────
// Métodos de cocción por alimento, reparto semanal de cocina (sesión grande el domingo) y
// seguridad alimentaria. Añadido 18/08/2026 a partir de memoria.md 6.5 / 6.5b /
// 6.8, que estaba repartido entre bloques de la pestaña Nutrición.
//
// Principio que resuelve la mitad de las decisiones: lo frágil va al plato, no
// a la sartén; y lo enzimático (ajo, mostaza) necesita esperar ANTES del calor.
//
// Dato que condiciona todo lo demás: el usuario NO recalienta nada. Como mucho
// atempera el tupper fuera de la nevera. Eso (a) hace que la textura en frío
// importe tanto como el sabor en caliente, (b) hace innecesario esperar a que
// el plato baje de 60 °C para la mostaza, y (c) abre un problema real de
// seguridad alimentaria, porque no queda ningún paso de calor que mate nada.
// Reparto semanal de cocina — reorganizado 22/08/2026.
// Antes todo era una sesión grande el sábado. No vale: la nevera y el congelador
// del usuario son pequeños y no cabe la semana entera de una vez, y además no
// puede pararse a cocinar los miércoles salvo algo corto por la tarde. El plan
// lo diseñó él; aquí van las tres correcciones que se le hicieron, marcadas.
const COOK_PLAN = [
  {
    day: 'Sábado', color: '#3B82F6', role: 'Día B · compra y primera tanda',
    items: [
      'Salmón y ternera **del día**, al momento. Tortilla sencilla.',
      '**Congela CRUDOS** el salmón (250 g) y la ternera (220 g) **del martes**.',
      '**Congela CRUDO** el hígado del jueves (75 g).',
      'Asa brócoli para **sáb · dom · lun · mar · mié** — 5 raciones.',
      'Compra de la semana.',
    ],
  },
  {
    day: 'Domingo', color: '#A855F7', role: 'Día C · LA SESIÓN GRANDE',
    items: [
      '**5 tortillas de espinacas** (días A y C). Las 2 sencillas de los días B se hacen al momento.',
      '**Arroz ×5**, enjuagado y enfriado rápido.',
      '**Pollo 1,35 kg al horno**, 150-160 °C hasta 68-70 °C de interior.',
      'Hígado del domingo, **fresco**, 4 min.',
      'Reparto → **nevera: dom · lun · mié** · **congelador: jue · vie**.',
    ],
  },
  {
    day: 'Martes', color: '#F59E0B', role: 'Día B · nada que preparar',
    items: [
      'Salmón y ternera **descongelados el lunes por la noche**, cocinados al momento.',
      'Tortilla sencilla del día.',
      'Por la noche: **saca el hígado** del congelador para mañana.',
    ],
  },
  {
    day: 'Miércoles (tarde)', color: '#22C55E', role: 'Rato corto, dos cosas',
    items: [
      '**Hígado del jueves**, 4 min de sartén, a la nevera ya hecho.',
      'En el mismo horno: **brócoli para jue · vie** (segunda tanda).',
    ],
  },
];

// Las tres correcciones al plan original, que son el "por qué" del reparto.
const COOK_PLAN_FIXES = [
  {
    t: 'El hígado del jueves se congela CRUDO, no cocinado',
    d: 'Cocido, congelado y comido frío queda arenoso y seco. Son 4 min de sartén el miércoles por la tarde. Si el miércoles se complica, cocinar los dos el domingo y congelar uno hecho **es seguro** — solo se pierde textura.',
  },
  {
    t: 'El salmón y la ternera del martes se congelan CRUDOS el sábado',
    d: 'No cocinados el sábado para el martes. El motivo es específico del salmón: EPA y DHA son los ácidos grasos más oxidables que existen, y cocinado y guardado 3 días se oxidan. Es de donde sale el olor fuerte del pescado del día siguiente — y es justo lo que el salmón aporta.',
  },
  {
    t: 'El brócoli va en dos tandas de horno, no en una',
    d: 'Asado congela mal (sale blando y aguado, lo contrario de lo que buscas) y de domingo a viernes son demasiados días. Las dos tandas caen en días en los que ya estás cocinando: sábado y miércoles por la tarde. **Máximo 4 días de antigüedad.**',
  },
];

const COOK_METHODS = [
  {
    food: '🍗 Pollo', when: 'batch',
    how: 'Horno **150-160 °C hasta 68-70 °C de interior**. Termómetro de sonda.',
    why: 'A fuego suave pierde menos agua → más rendimiento y mejor textura en frío. A 200 °C se seca y el 75 % de rendimiento deja de cumplirse. El termómetro además hace predecible el reparto de los tuppers.'
  },
  {
    food: '🍳 Tortilla', when: 'batch',
    how: '**Bien hecha.** Espinacas trituradas en crudo con el huevo. **5 con espinacas el domingo · las 2 sencillas de los días B, al momento.**',
    why: 'No hay recalentado que la termine. Y triturar en crudo es una sola exposición al calor: mejor folato que rehogar y luego cuajar.'
  },
  {
    food: '🥦 Brócoli', when: 'sabado',
    how: '**220 °C, capa única, 15-20 min**, seco, con aceite y **sin sal**. Tallo a ~5-8 mm. Mostaza al servir. **Dos tandas: sábado y miércoles.**',
    why: 'El horno no lixivia nada al agua, que es la ventaja real frente a hervir. Corrección del 18/08: los "~180 °C" que se recomendaron primero eran un error — a esa temperatura se cuece en su propia humedad y acumula más exposición térmica total.'
  },
  {
    food: '🍚 Arroz', when: 'batch',
    how: '**Enjuagar bien.** Cocer y enfriar.',
    why: 'El enjuague reduce arsénico inorgánico y comes arroz 5 días/semana. Enfriarlo genera almidón resistente.'
  },
  {
    food: '🍅 Sofrito', when: 'batch',
    how: 'Largo y con aceite, **como ya lo haces**.',
    why: 'Único caso donde cocinar mucho mejora la nutrición: el licopeno se vuelve más biodisponible con el calor y es liposoluble.'
  },
  {
    food: '🫀 Hígado', when: 'miercoles',
    how: 'Sartén muy caliente, **mínimo aceite**, 4 min, **rosa por dentro**. El del domingo, fresco; el del jueves, el miércoles por la tarde.',
    why: 'Foods 2020: plancha sin aceite pierde un 8 % del folato, con aceite un 22 %, horno combinado 20-41 %. 75 g dan 350-450 µg de folato: los días de hígado arreglan solos el déficit. Pasado queda seco y arenoso.'
  },
  {
    food: '🥩 Ternera', when: 'día',
    how: 'Al punto que te guste. Evita solo el churrascado fuerte.',
    why: '**El grado de cocción NO afecta al hierro hemo** — se comprobó y los datos no lo respaldan (9,6 / 9,2 / 9,0 µg/g en barbacoa, gratinado y sartén, sin patrón). Las razones para no pasarla son textura y aminas heterocíclicas.'
  },
  {
    food: '🐟 Salmón', when: 'día',
    how: 'Suave: horno **150-160 °C** o vapor. Nunca sartén fuerte.',
    why: 'EPA y DHA son los ácidos grasos más oxidables que existen, y es tu única fuente alimentaria real de vitamina D.'
  },
  {
    food: '🥔 Patata y boniato', when: 'día',
    how: 'Cocidos o al vapor. Si los asas, **dorar poco**.',
    why: 'Es el alimento clásico de la acrilamida, que se forma con el tostado fuerte (al contrario que el brócoli, donde no es problema). El boniato, con algo de grasa por el betacaroteno.'
  },
  {
    food: '🧄 Ajo', when: 'regla',
    how: 'Picar o aplastar y **esperar 10 min** antes del calor.',
    why: 'La alicina no está en el ajo: la forma la aliinasa al romper la célula, y el calor mata la enzima. La alicina ya formada sí resiste. Mismo principio que la mostaza.'
  },
  {
    food: '🎃 Semillas de calabaza', when: 'servir',
    how: '**Por encima al servir**, 25 g. Nunca dentro de la tortilla.',
    why: 'Su grasa es mayoritariamente poliinsaturada, la más oxidable. Los minerales aguantan el calor; la grasa no. Y en frío quedan mejor de textura.'
  },
  {
    food: '🌱 Mostaza parda', when: 'servir',
    how: '**1 g en polvo sobre el brócoli, en el plato**, en cada comida.',
    why: 'Repone la mirosinasa que el horno destruye. Ver el bloque de abajo: es la mejora más grande de toda la cocina.'
  },
  {
    food: '🫒 Aceite de oliva', when: 'servir',
    how: 'Parte para cocinar, **parte en crudo al servir**.',
    why: 'Los polifenoles del virgen extra se degradan con el calor, y los 220 °C del brócoli superan su punto de humo. Mismos ml, más polifenoles.'
  },
];

const WHEN_TAG = {
  batch:  { label: 'domingo', bg: '#2e1065', fg: '#e9d5ff' },
  sabado: { label: 'sábado', bg: '#1e3a8a', fg: '#bfdbfe' },
  miercoles: { label: 'miércoles tarde', bg: '#052e16', fg: '#bbf7d0' },
  'día':  { label: 'al momento',   bg: '#7c2d12', fg: '#fed7aa' },
  regla:  { label: 'regla',        bg: '#3f3f46', fg: '#e4e4e7' },
  servir: { label: 'al servir',    bg: '#14532d', fg: '#bbf7d0' },
};

// Convierte **negritas** en <b>. Mismo criterio que boldParts, pero devolviendo
// nodos ya listos para pintar dentro de un párrafo.
function cookBold(text, color = '#f8fafc') {
  return text.split('**').map((part, i) =>
    i % 2 === 1
      ? <b key={i} style={{ color }}>{part}</b>
      : <span key={i}>{part}</span>
  );
}

function CookingTab() {
  const [open, setOpen] = useState(null);

  return (
    <div>
      {/* Seguridad — lo primero porque es lo único con riesgo real */}
      <div style={{
        background: '#450a0a', border: '1px solid #EF4444', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#fecaca', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#fff1f2', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          ⚠ Seguridad — no recalientas nada
        </div>
        El pollo cocido aguanta <b style={{color:'#fff1f2'}}>3-4 días</b> en nevera y tu semana son <b style={{color:'#fff1f2'}}>7</b>.
        Sin recalentado no queda ningún paso de calor que mate nada, y la <i>Listeria monocytogenes</i> crece
        a temperatura de nevera.<br/><br/>
        Cocinas el domingo y comes hasta el viernes: son <b style={{color:'#fff1f2'}}>5 días</b>. Por eso el reparto es
        <b style={{color:'#fff1f2'}}> nevera para domingo · lunes · miércoles</b> y
        <b style={{color:'#fff1f2'}}> congelador para jueves · viernes</b>. Pásalos a la nevera la noche antes.<br/><br/>
        <b style={{color:'#fff1f2'}}>El arroz va en el mismo tupper y sigue el mismo criterio.</b> Arroz cocido guardado
        5 días es el caso clásico de <i>Bacillus cereus</i>, cuyas esporas sobreviven a la cocción: enfríalo rápido y
        mételo en frío <b style={{color:'#fff1f2'}}>dentro de la primera hora</b>.<br/><br/>
        Al cocinar el domingo, <b style={{color:'#fff1f2'}}>enfría rápido y reparte</b>: no dejes 1,35 kg enfriándose
        despacio en la encimera. Y descongela <b style={{color:'#fff1f2'}}>siempre en nevera</b>, nunca en la encimera.
      </div>

      {/* Principio */}
      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          🔥 El principio que resuelve la mitad
        </div>
        <b style={{color:'#e2e8f0'}}>Lo frágil va al plato, no a la sartén</b> — semillas, mostaza y parte del aceite.
        Y <b style={{color:'#e2e8f0'}}>lo enzimático necesita esperar antes del calor</b>: el ajo, 10 min desde que lo
        picas; la mostaza, directamente nunca ve el horno.<br/><br/>
        Lo demás es una decisión por alimento, y casi siempre se resume en bajar la temperatura.
        La excepción es el sofrito, donde cocinar mucho mejora la nutrición, y el brócoli, que quiere
        220 °C precisamente para pasar el menor tiempo total dentro del horno.
      </div>

      {/* Tabla por alimento */}
      <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
        Cómo cocinar cada cosa
      </div>
      <div style={{ marginBottom: 20 }}>
        {COOK_METHODS.map((m, i) => {
          const tag = WHEN_TAG[m.when];
          const isOpen = open === i;
          return (
            <div key={i} style={{ background: '#1e293b', borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
              <button onClick={() => setOpen(isOpen ? null : i)} style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 14px', color: '#f8fafc'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{m.food}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                    background: tag.bg, color: tag.fg, whiteSpace: 'nowrap'
                  }}>{tag.label}</span>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
                  {cookBold(m.how, '#f8fafc')}
                </div>
                <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
                  {isOpen ? '▾ por qué' : '▸ por qué'}
                </div>
              </button>
              {isOpen && (
                <div style={{
                  padding: '0 14px 12px', color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7
                }}>
                  {cookBold(m.why, '#e2e8f0')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Brócoli + mostaza */}
      <div style={{
        background: '#052e16', border: '1px solid #22C55E', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#bbf7d0', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#f0fdf4', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          🥦 Brócoli + mostaza — la mejora más grande de toda la cocina
        </div>
        <b style={{color:'#dcfce7'}}>En el batch cook:</b> pieza entera, seca, con el aceite, <b style={{color:'#f0fdf4'}}>sin sal</b>,
        en una sola capa sin amontonar, <b style={{color:'#f0fdf4'}}>220 °C · 15-20 min</b>. El tallo, cortado más fino
        (~5-8 mm) que los ramilletes.<br/><br/>
        <b style={{color:'#dcfce7'}}>Al servir:</b> espolvorea <b style={{color:'#f0fdf4'}}>1 g de mostaza parda en polvo</b> y
        cómetelo. Como no recalientas, el plato ya está templado y no hay que esperar nada — solo no dejarlo
        reposar después de echarla.<br/><br/>
        <b style={{color:'#f0fdf4'}}>Por qué.</b> El sulforafano no está en el brócoli: lo forma la <b style={{color:'#f0fdf4'}}>mirosinasa</b>,
        una enzima que el horno destruye por completo. La mostaza la repone desde fuera. En el ensayo cruzado de
        Okunade (2018), 12 adultos con 200 g de brócoli cocido — la misma ración que tú — pasaron de 9,8 a
        44,7 µmol de SF-NAC en orina de 24 h: <b style={{color:'#f0fdf4'}}>más de 4× más sulforafano biodisponible</b>.<br/><br/>
        <b style={{color:'#FCA5A5'}}>Los dos errores que lo anulan todo:</b> meter la mostaza <b>antes</b> del horno
        (su enzima es igual de termolábil: no hace absolutamente nada) o mezclarla en el <b>batch cook</b>{' '}
        (trabaja toda la semana en la nevera y el sulforafano, que es inestable, se degrada antes de comerlo).<br/><br/>
        <b style={{color:'#dcfce7'}}>Nota del tallo:</b> los ramilletes tienen ~4,7× más glucosinolatos que el tallo por
        gramo de peso seco (Liu 2018). No es motivo para tirarlo — es fibra y potasio gratis — pero 200 g de pieza
        entera rinden bastante menos sulforafano que 200 g de ramilletes.
      </div>

      {/* Reparto semanal de cocina */}
      <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
        🗓 Cuándo se cocina cada cosa
      </div>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
        La sesión grande es el <b style={{ color: '#A855F7' }}>domingo</b>, no el sábado: la nevera y el congelador
        no dan para la semana entera de una vez. El sábado ya estás cocinando lo del día y compras, y el miércoles
        por la tarde caben dos cosas cortas.
      </div>
      <div style={{ marginBottom: 14 }}>
        {COOK_PLAN.map(d => (
          <div key={d.day} style={{
            background: '#1e293b', borderRadius: 8, padding: '11px 14px', marginBottom: 6,
            borderLeft: `3px solid ${d.color}`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: d.color, fontSize: 14, fontWeight: 700 }}>{d.day}</span>
              <span style={{ color: '#64748b', fontSize: 11 }}>{d.role}</span>
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7 }}>
              {d.items.map((it, k) => <li key={k}>{cookBold(it, '#e2e8f0')}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
        padding: '10px 14px', marginBottom: 16, color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.7
      }}>
        <b style={{ color: '#f8fafc' }}>🌙 Regla diaria:</b> cada noche saca del congelador lo del día siguiente.
        Descongelar <b style={{ color: '#f8fafc' }}>siempre en nevera</b>, nunca en la encimera.
      </div>

      {/* Reparto del pollo */}
      <div style={{
        background: '#1c1917', border: '1px solid #F59E0B', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#fed7aa', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#fff7ed', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          ⚖️ Reparto del pollo — por proporción, no por gramos
        </div>
        El rendimiento varía cada semana: si apuntas a 225 g fijos, el último tupper te sale corto o largo.
        <b style={{ color: '#fff7ed' }}> Pesa todo el pollo cocido y divídelo en 18 partes.</b> Cada
        <b style={{ color: '#fff7ed' }}> día A se lleva 4 partes</b> (22,2 %) y cada
        <b style={{ color: '#fff7ed' }}> día C, 3 partes</b> (16,7 %). 3×4 + 2×3 = 18, cuadra exacto.<br/>
        <span style={{ color: '#a8a29e' }}>Con 1,35 kg crudo salen ~1.010 g cocidos → 1 parte ≈ 56 g → día A ≈ 225 g · día C ≈ 169 g.</span><br/><br/>
        <b style={{ color: '#fff7ed' }}>Destino:</b> domingo, lunes y miércoles a la <b style={{ color: '#fff7ed' }}>nevera</b>;
        jueves y viernes al <b style={{ color: '#fff7ed' }}>congelador</b>, en bolsa plana (~400 g).<br/><br/>
        Mismo criterio con el <b style={{ color: '#fff7ed' }}>arroz</b> (÷ 5) y el <b style={{ color: '#fff7ed' }}>brócoli</b>
        (÷ 5 la tanda del sábado, ÷ 2 la del miércoles). El brócoli asado es el más impredecible de todos: cuanto más
        seco lo dejes, más peso pierde, así que ahí perseguir gramos no tiene sentido.
      </div>

      {/* Por qué el reparto es así */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
          Las tres correcciones al plan original
        </div>
        {COOK_PLAN_FIXES.map((f, i) => (
          <div key={i} style={{
            background: '#1e293b', borderRadius: 8, padding: '11px 14px', marginBottom: 6,
            display: 'flex', gap: 12, alignItems: 'flex-start'
          }}>
            <div style={{
              minWidth: 24, height: 24, borderRadius: 999, background: '#334155', color: '#f8fafc',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f8fafc', fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>{f.t}</div>
              <div style={{ color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7 }}>{cookBold(f.d, '#e2e8f0')}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Espacio de nevera */}
      <div style={{
        background: '#0c4a6e', border: '1px solid #0ea5e9', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#bae6fd', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#f0f9ff', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          🧊 Espacio de nevera — lo que no cuesta nada de tiempo
        </div>
        Hazlo antes de reorganizar nada: entre las tres cosas se liberan del orden de
        <b style={{ color: '#f0f9ff' }}> 8-10 litros</b>.<br/><br/>
        <b style={{ color: '#f0f9ff' }}>La fruta (2,1 kg) fuera</b>, a la despensa. Manzana, naranja, pera, plátano y
        kiwi aguantan a temperatura ambiente, y el kiwi madura mejor fuera.<br/>
        <b style={{ color: '#f0f9ff' }}>Los huevos (28) fuera.</b> En Alemania se venden sin refrigerar porque no se
        lavan y conservan la cutícula. Regla: no cambiarlos de régimen.<br/>
        <b style={{ color: '#f0f9ff' }}>Espinacas congeladas en vez de frescas.</b> 700 g de hoja fresca son 5-6 litros
        de volumen; el congelado, menos de uno. Y como las trituras con el huevo, la textura —único argumento a favor
        de la fresca— te da igual.<br/><br/>
        <b style={{ color: '#f0f9ff' }}>Guardar a granel, no en 7 tuppers</b> (paredes y huecos de aire), y lo
        congelado <b style={{ color: '#f0f9ff' }}>en bolsa plana</b>: se apila como libros y descongela antes.
      </div>

      {/* Lo que NUNCA entra en el batch cook */}
      <div style={{
        background: '#1c1917', border: '1px solid #F59E0B', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#fed7aa', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#fff7ed', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          🚫 Lo que nunca entra en el batch cook
        </div>
        <b style={{color:'#fff7ed'}}>Mostaza</b> — trabajaría toda la semana en la nevera y el sulforafano se degradaría antes de comerlo.<br/>
        <b style={{color:'#fff7ed'}}>Semillas de calabaza</b> — su grasa poliinsaturada se oxida; van por encima al servir.<br/>
        <b style={{color:'#fff7ed'}}>Sal en el brócoli</b> — le saca agua durante toda la semana y lo apelmaza.<br/>
        <b style={{color:'#fff7ed'}}>Parmesano</b> — no va en la tortilla desde el 8/08: se come en trozo a media mañana, aislado de las comidas con hierro.
      </div>

      {/* Kit */}
      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          🛒 Lo que falta comprar
        </div>
        <b style={{color:'#e2e8f0'}}>Termómetro de sonda.</b> Es lo que hace posible el 68-70 °C y, de paso, lo que hace
        predecible el rendimiento del pollo y por tanto el reparto de los tuppers.<br/><br/>
        <b style={{color:'#e2e8f0'}}>Mostaza parda en polvo</b> (<i>Brassica juncea</i>, más activa que la amarilla).
        Buscar <b style={{color:'#e2e8f0'}}>“braune Senfsaat ganz”</b> o <b style={{color:'#e2e8f0'}}>“Senfkörner braun”</b> — grano
        entero, sin ambigüedad de procesado, y se muele en casa. Si la prefieres molida:
        <b style={{color:'#e2e8f0'}}> “Senfmehl braun”</b> / <b style={{color:'#e2e8f0'}}>“Senfsaat braun gemahlen”</b>.
        Comprueba que en los ingredientes ponga <b>solo semilla de mostaza</b>, sin cúrcuma ni especias.<br/><br/>
        En Braunschweig: <b style={{color:'#e2e8f0'}}>Kaufland</b> la tiene en bote de 70 g; y
        <b style={{color:'#e2e8f0'}}> SarayMarket</b> y cualquier tienda turca, india o asiática venden semilla parda o
        negra a granel (<i>rai</i> / <i>sarson</i>) — más barata y más fresca.<br/><br/>
        <b style={{color:'#FCA5A5'}}>No vale el Senf de tarro</b> (no está ensayado y la acidez reduce la actividad),
        ni las mezclas con cúrcuma. <b style={{color:'#e2e8f0'}}>“Senfmehl” a secas suele ser amarillo</b> (<i>Sinapis alba</i>):
        funciona, pero tiene menos mirosinasa.<br/><br/>
        <span style={{color:'#64748b'}}>Consumo: 1 g por ración × 7 = 7 g/semana. Un bote de 70 g dura 10 semanas.
        Guardar seco, cerrado y oscuro — el polvo pierde actividad con el tiempo.</span>
      </div>

      {/* Lo que ya hace bien */}
      <div style={{
        background: '#052e16', border: '1px solid #166534', borderRadius: 10,
        padding: '12px 14px', marginBottom: 16, color: '#bbf7d0', fontSize: 12.5, lineHeight: 1.7
      }}>
        <div style={{ color: '#f0fdf4', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
          ✅ Lo que ya haces bien — no lo toques
        </div>
        <b style={{color:'#dcfce7'}}>Trituras las espinacas en crudo con el huevo</b>, así que nunca escurres agua y el folato
        y el magnesio se quedan dentro. La recomendación de “rehogar y evaporar” que se llegó a dar era para un
        problema que no tienes, y encima habría añadido una segunda exposición al calor.<br/><br/>
        <b style={{color:'#dcfce7'}}>El sofrito largo con aceite</b> y <b style={{color:'#dcfce7'}}>el brócoli al horno</b> también
        están bien como están: el horno no lixivia nada al agua, que es la ventaja real frente a hervir.
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: 'entrenamiento', label: '🏋️ Entrenamiento', subtabs: [
      { id: 'plan', label: 'Plan' },
      { id: 'test', label: 'Test' },
  ]},
  { id: 'alimentacion', label: '🍽 Alimentación', subtabs: [
      { id: 'compra', label: '🛒 Compra' },
      { id: 'nutricion', label: 'Nutrición' },
      { id: 'cocina', label: '👨‍🍳 Cocina' },
      { id: 'supps', label: '💊 Suplementos' },
  ]},
  { id: 'seguimiento', label: '📈 Seguimiento', subtabs: [
      { id: 'control', label: 'Peso · Pelo · Analítica' },
  ]},
];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const defaults = computeDefaultWeekDay();
  const [weekIdx, setWeekIdx] = useState(() => {
    try { const s = localStorage.getItem('ta_week'); return s !== null ? Number(s) : defaults.weekIdx; } catch { return defaults.weekIdx; }
  });
  const [dayIdx, setDayIdx] = useState(() => {
    try { const s = localStorage.getItem('ta_day'); return s !== null ? Number(s) : defaults.dayIdx; } catch { return defaults.dayIdx; }
  });
  const [completed, setCompleted] = useState(() => {
    try { const s = localStorage.getItem('ta_completed'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [rmStore, setRmStore] = useState(loadRM);
  const [rmHistory, setRmHistory] = useState(loadRMHistory);
  const [mvtStore, setMvtStore] = useState(loadMVT);

  const [section, setSection] = useState('entrenamiento');
  const [sub, setSub] = useState('plan');

  const markDone = (weekI, dayI) => {
    const key = `W${weekI+1}-${DAYS[dayI].name}`;
    setCompleted(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = new Date().toISOString();
      try { localStorage.setItem('ta_completed', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const saveRM = (name, rm, unit, method, detail) => {
    const date = new Date().toISOString();
    setRmStore(prev => {
      const next = { ...prev, [name]: { rm, unit, method, date, detail } };
      persistRM(next);
      return next;
    });
    setRmHistory(prev => {
      const prevList = prev[name] || [];
      const next = { ...prev, [name]: [...prevList, { rm, unit, method, date, detail }] };
      persistRMHistory(next);
      return next;
    });
  };

  // Borra el RM guardado de un ejercicio en este dispositivo para volver al
  // valor por defecto del código (el del plan). El historial no se toca.
  const clearRM = (name) => {
    setRmStore(prev => {
      const next = { ...prev };
      delete next[name];
      persistRM(next);
      return next;
    });
  };

  // MVT personal: sustituye el valor de literatura de un ejercicio por una
  // velocidad medida directamente en una carga cercana/igual al 1RM real.
  const saveMVT = (name, value) => {
    setMvtStore(prev => {
      const next = { ...prev, [name]: { value, date: new Date().toISOString() } };
      persistMVT(next);
      return next;
    });
  };
  const clearMVT = (name) => {
    setMvtStore(prev => {
      const next = { ...prev };
      delete next[name];
      persistMVT(next);
      return next;
    });
  };

  const saveWeek = (w) => { setWeekIdx(w); try { localStorage.setItem('ta_week', w); } catch {} };
  const saveDay  = (d) => { setDayIdx(d);  try { localStorage.setItem('ta_day',  d); } catch {} };

  // Fecha del último test guardado (el más reciente de todos los RM en
  // rmStore) — es la que se usa como inicio del ciclo nuevo, no la fecha en
  // la que se pulsa el botón, para que cuadre aunque tardes unos días en
  // arrancar la Semana 1 después de terminar los tests.
  const lastTestDate = (() => {
    const dates = Object.values(rmStore).map(o => new Date(o.date).getTime()).filter(t => !isNaN(t));
    return dates.length ? new Date(Math.max(...dates)) : null;
  })();

  const startNewCycle = () => {
    if (!lastTestDate) return;
    const iso = lastTestDate.toISOString().slice(0, 10); // YYYY-MM-DD
    persistCycleStart(iso);
    try { localStorage.removeItem('ta_completed'); } catch {}
    setCompleted({});
    const next = computeDefaultWeekDay();
    saveWeek(next.weekIdx);
    saveDay(next.dayIdx);
  };

  const currentSection = SECTIONS.find(s => s.id === section);

  return (
    <RestProvider>
    <div style={{
      minHeight: '100vh', background: '#0f172a', color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      // Hueco inferior para que la barra fija del contador no tape el botón de
      // "marcar sesión como hecha".
      padding: '16px 16px 150px'
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>
          💪 Plan de Entrenamiento
        </div>
        <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
          15 semanas · Inicio 7 abril 2026 · Test VBT S16
        </div>
      </div>

      {/* Week slider */}
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: '14px 16px', marginBottom: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ color: '#f8fafc', fontWeight: 700 }}>
            Semana {weekIdx + 1} <PhasePill weekIdx={weekIdx} />
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => saveWeek(Math.max(0, weekIdx - 1))} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#334155', color: '#f8fafc', fontSize: 16
            }}>‹</button>
            <button onClick={() => saveWeek(Math.min(14, weekIdx + 1))} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#334155', color: '#f8fafc', fontSize: 16
            }}>›</button>
          </div>
        </div>
        <input type="range" min={0} max={14} value={weekIdx}
          onChange={e => saveWeek(Number(e.target.value))}
          style={{ width: '100%', accentColor: PROG[weekIdx].color }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontSize: 11, marginTop: 4 }}>
          <span>W1 · Base</span><span>W5 · Transición</span><span>W9 · Intensidad</span><span>W13 · Peak</span>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => { setSection(s.id); setSub(s.subtabs[0].id); }} style={{
            flex: 1, padding: '12px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 14,
            background: section === s.id ? '#f8fafc' : '#1e293b',
            color: section === s.id ? '#0f172a' : '#64748b'
          }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Sub tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {currentSection.subtabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} style={{
            flex: 1, padding: '9px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 13,
            background: sub === t.id ? '#334155' : '#1e293b',
            color: sub === t.id ? '#f8fafc' : '#64748b'
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {section === 'entrenamiento' && sub === 'plan' && (
        <TrainingTab weekIdx={weekIdx} dayIdx={dayIdx} setDayIdx={saveDay} completed={completed} markDone={markDone} rmStore={rmStore} clearRM={clearRM} />
      )}
      {section === 'entrenamiento' && sub === 'test' && (
        <TestTab rmStore={rmStore} saveRM={saveRM} rmHistory={rmHistory} mvtStore={mvtStore} saveMVT={saveMVT} clearMVT={clearMVT} lastTestDate={lastTestDate} startNewCycle={startNewCycle} />
      )}
      {section === 'alimentacion' && sub === 'compra' && <ShoppingTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'nutricion' && <NutritionTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'cocina' && <CookingTab />}
      {section === 'alimentacion' && sub === 'supps' && <SupplementsTab />}
      {section === 'seguimiento' && <TrackingTab />}
    </div>
    <RestBar />
    </RestProvider>
  );
}
