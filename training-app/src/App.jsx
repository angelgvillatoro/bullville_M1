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

// ─── PROGRESSION TABLE (15 weeks, 0-indexed) ─────────────────────────────────
const PROG = [
  { pct: 0.70, reps: 7, phase: 'Base',       color: '#3B82F6' }, // W1
  { pct: 0.70, reps: 7, phase: 'Base',       color: '#3B82F6' }, // W2
  { pct: 0.75, reps: 5, phase: 'Base',       color: '#3B82F6' }, // W3
  { pct: 0.75, reps: 6, phase: 'Base',       color: '#3B82F6' }, // W4
  { pct: 0.80, reps: 4, phase: 'Transición', color: '#F59E0B' }, // W5
  { pct: 0.80, reps: 5, phase: 'Transición', color: '#F59E0B' }, // W6
  { pct: 0.85, reps: 3, phase: 'Transición', color: '#F59E0B' }, // W7
  { pct: 0.85, reps: 4, phase: 'Transición', color: '#F59E0B' }, // W8
  { pct: 0.90, reps: 3, phase: 'Intensidad', color: '#EF4444' }, // W9
  { pct: 0.90, reps: 4, phase: 'Intensidad', color: '#EF4444' }, // W10
  { pct: 0.95, reps: 2, phase: 'Intensidad', color: '#EF4444' }, // W11
  { pct: 0.95, reps: 3, phase: 'Intensidad', color: '#EF4444' }, // W12
  { pct: 1.00, reps: 1, phase: 'Peak',       color: '#22C55E' }, // W13
  { pct: 1.00, reps: 2, phase: 'Peak',       color: '#22C55E' }, // W14
  { pct: 1.03, reps: 1, phase: 'Peak',       color: '#22C55E' }, // W15
];

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
  if (ex.type === 'bw' && ex.repsByPhase) {
    const r = ex.repsByPhase[(PROG[weekIdx] || PROG[0]).phase];
    return Array.isArray(r) ? r.length : 4;
  }
  if (ex.setCount) return ex.setCount;
  return 4;
}

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
  const o = rmStore[ex.name];
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

// ─── DAY DEFINITIONS ─────────────────────────────────────────────────────────
// type: 'non-olympic' | 'olympic' | 'bw' (bodyweight)
// testMethod: 'video' (velocidad + regresión carga-velocidad) · 'ladder' (registro
// directo del peso máximo con técnica limpia) · 'repmax' (test de reps + fórmula,
// para ejercicios de mancuerna con pesos disponibles discretos)
const DAYS = [
  {
    name: 'Lunes', label: 'ArmDay', emoji: '💪', nutriDay: 'A',
    exercises: [
      { name: 'Triceps stretches cable pull bar',  rm: 46.5, unit: 'kg',     testMethod: 'repmax' },
      { name: 'Triceps extension cable pull cord', rm: 39, unit: 'kg',     testMethod: 'repmax' },
      { name: 'Triceps extension one-armed cable', rm: 28, unit: 'kg/arm', testMethod: 'repmax' },
      { name: 'Bicep curls cable pull',            rm: 36, unit: 'kg',     testMethod: 'repmax' },
      { name: 'Bicep curls sitting dumbbell',      rm: 17,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Bicep curls hammer grip seated',    rm: 17.5,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Seated lateral raises dumbbell',    rm: 17,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, setCount: 6 },
      { name: 'Shoulder press sitting dumbbell',   rm: 26.5, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Butterfly reverse cable pull',      rm: 16, unit: 'kg/arm', testMethod: 'repmax' },
    ]
  },
  {
    name: 'Martes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 110, unit: 'kg', type: 'olympic', sets: CJ_PCT, testMethod: 'ladder' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS_PCT, testMethod: 'ladder' },
      { name: 'Latzug breit (lat pulldown)', rm: 97.5,unit: 'kg', testMethod: 'ladder' },
      { name: 'Seated row cable pull',       rm: 91,  unit: 'kg',     testMethod: 'repmax' },
      { name: 'One-armed row cable pull',    rm: 45.5,  unit: 'kg/arm', testMethod: 'repmax' },
    ]
  },
  {
    name: 'Miércoles', label: 'Stretch & Pool', emoji: '🏊', nutriDay: 'A',
    special: 'stretch'
  },
  {
    name: 'Jueves', label: 'ChestDay', emoji: '🏋️', nutriDay: 'B',
    exercises: [
      { name: 'Bench press barbell',               rm: 102,  unit: 'kg', testMethod: 'video', mvt: 0.17 },
      { name: 'Bench press inclined barbell',      rm: 85, unit: 'kg', testMethod: 'ladder' },
      { name: 'Flys standing cable pull',          rm: 23, unit: 'kg/arm', testMethod: 'repmax' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS },
      { name: 'Triceps extension cable pull cord', rm: 39,   unit: 'kg', testMethod: 'repmax' },
      { name: 'Triceps extension one-armed cable', rm: 28,   unit: 'kg/arm', testMethod: 'repmax' },
      { name: 'Shoulder press sitting dumbbell',   rm: 26.5,   unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
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
      { name: 'Butterfly reverse cable pull', rm: 16,  unit: 'kg/arm', testMethod: 'repmax' },
    ]
  },
  {
    name: 'Sábado', label: 'LegDay', emoji: '🦵', nutriDay: 'B',
    exercises: [
      { name: 'Deadlift barbell',   rm: 120, unit: 'kg', type: 'olympic', sets: DL_PCT, testMethod: 'ladder' },
      { name: 'Squat barbell',      rm: 105, unit: 'kg', testMethod: 'video', mvt: 0.30,
        backoff: { factor: 0.72, reps: 10, setCount: 3, restSeconds: 120 } },
      { name: 'Leg curl machine',   rm: 80,  unit: 'kg', testMethod: 'repmax', setCount: 8,
        note: 'Sin Nordic curl: da el tirón fuerte para contraer y luego frena la vuelta controlando la fase excéntrica en vez de soltarla — es el mismo principio (énfasis en la parte excéntrica) sin necesitar la fuerza de un Nordic curl completo.' },
      { name: 'Hip thrust machine', rm: 120, unit: 'kg', testMethod: 'ladder' },
      { name: 'Pallof press cable (hold isométrico)', type: 'bw', repsByPhase: PALLOF_SECONDS,
        equipLabel: 'Anti-rotación · por lado', unitSuffix: 's/lado',
        note: 'De pie, perpendicular a la polea. Extiende los brazos al frente y AGUANTA ahí quieto sin dejar que la cadera gire — es un aguante estático, no repeticiones de empuje y vuelta. Repite el hold en cada serie, cambia de lado al terminar las 3 series.',
        rm: 15, unit: 'kg', testMethod: 'coreload',
        testTarget: '35s/lado por serie (objetivo de fase Peak, el más exigente de las 4)',
        formCue: 'la cadera gire' },
      { name: 'Weighted plank (disco en la espalda)', type: 'bw', repsByPhase: PLANK_SECONDS,
        equipLabel: 'Anti-extensión · con disco', unitSuffix: 's',
        note: 'Empieza con 5-10kg sobre la zona lumbar-alta. Si aguantas el tiempo objetivo con técnica limpia (sin que caiga la cadera), sube el disco de peso antes de subir el tiempo.',
        rm: 7.5, unit: 'kg', testMethod: 'coreload',
        testTarget: '50s por serie (objetivo de fase Peak, el más exigente de las 4)',
        formCue: 'caiga la cadera' },
    ]
  },
  {
    name: 'Domingo', label: 'ChestDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Bench press barbell',               rm: 102,  unit: 'kg', testMethod: 'video', mvt: 0.17 },
      { name: 'Bench press inclined barbell',      rm: 85, unit: 'kg', testMethod: 'ladder' },
      { name: 'Flys standing cable pull',          rm: 23, unit: 'kg/arm', testMethod: 'repmax' },
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
  { name: 'Pool walking',               duration: '10 min',      totalSec: 600, sets: 1 },
  { name: 'Float & decompress',         duration: '5 min',       totalSec: 300, sets: 1 },
  { name: 'Arm circles in water',       duration: '5 min',       totalSec: 300, sets: 1 },
  { name: 'Glutes stretch seated',      duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Adductors stretch standing', duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Leg flexor stretch sitting', duration: '3 × 45–60 s', totalSec: 60,  sets: 3 },
  { name: 'Leg stretch standing',       duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Hip flexor stretch lunge',   duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Trapezius stretch sideways', duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Torso rotation stretch',     duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Torso side bending',         duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Shoulder cross-body',        duration: '4 × 45–60 s', totalSec: 60,  sets: 4 },
  { name: 'Quadriceps stretch standing', duration: '4 × 45–60 s', totalSec: 60, sets: 4 },
];

// Tarjeta de cada bloque del miércoles: nombre, contador de series en vivo
// (lee del contexto compartido sólo si este es el bloque activo ahora mismo)
// y el botón que arranca la cuenta atrás.
function StretchCard({ s }) {
  const rest = useRest();
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
        <div style={{ color: '#f8fafc', fontSize: 14 }}>{s.name}</div>
        {badge && (
          <div style={{ color: '#5eead4', fontSize: 11, fontWeight: 700, marginTop: 2 }}>{badge}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 500 }}>{s.duration}</span>
        <HoldButton id={s.name} seconds={s.totalSec} sets={s.sets} compact />
      </div>
    </div>
  );
}

// ─── NUTRITION DATA ───────────────────────────────────────────────────────────
const NUTRITION = {
  A: {
    label: 'Días A',
    days: 'Lun · Mar · Mié',
    color: '#3B82F6',
    meals: [
      {
        name: '🍳 Desayuno (8:00–8:30)',
        items: [
          { food: 'Huevos', amount: '4 uds', macros: '28g P · 20g G · 2g C' },
          { food: 'Espinacas', amount: '140g', macros: '4g P · 1g G · 5g C' },
          { food: 'Parmesano', amount: '50g', macros: '18g P · 13g G · 2g C' },
          { food: 'Semillas de calabaza', amount: '25g', macros: '5g P · 7g G · 2g C' },
          { food: 'Ajo', amount: 'al gusto', macros: '—' },
          { food: 'Arla Skyr', amount: '450g', macros: '50g P · 2g G · 27g C' },
          { food: 'Fruta (naranja/manzana)', amount: '~150g', macros: '1g P · 0g G · 20g C' },
        ]
      },
      {
        name: '🍗 Almuerzo (13:00)',
        items: [
          { food: 'Pechuga de pollo (cocida)', amount: '300g', macros: '78g P · 6g G · 0g C' },
          { food: 'Arroz (cocido)', amount: '100g', macros: '3g P · 0g G · 28g C' },
          { food: 'Sofrito — Tomate', amount: '80g', macros: '1g P · 0g G · 4g C' },
          { food: 'Sofrito — Pimiento', amount: '60g', macros: '1g P · 0g G · 3g C' },
          { food: 'Sofrito — Calabacín', amount: '50g', macros: '0g P · 0g G · 2g C' },
          { food: 'Sofrito — Ajo', amount: '2 dientes', macros: '—' },
          { food: 'Brócoli', amount: '200g', macros: '6g P · 1g G · 14g C' },
          { food: 'Aceite de oliva', amount: '25ml', macros: '0g P · 23g G · 0g C' },
          { food: 'Fruta', amount: '~150g', macros: '1g P · 0g G · 12g C' },
        ]
      }
    ],
    totals: { kcal: 1975, protein: 205, fat: 84, carbs: 103 },
    // qué añadir en el "ajuste de fase" (rico en carbohidrato de este día)
    carbFood: 'Arroz (cocido)'
  },
  B: {
    label: 'Días B',
    days: 'Jue · Vie',
    color: '#F59E0B',
    meals: [
      {
        name: '🐟 Desayuno (8:00–8:30)',
        items: [
          { food: 'Huevos', amount: '4 uds', macros: '28g P · 20g G · 2g C' },
          { food: 'Aceite de oliva (tortilla)', amount: '5ml', macros: '0g P · 5g G · 0g C' },
          { food: 'Salmón (cocido)', amount: '250g', macros: '55g P · 22g G · 0g C' },
          { food: 'Boniato (cocido)', amount: '100g', macros: '2g P · 0g G · 17g C' },
          { food: 'Arla Skyr', amount: '450g', macros: '50g P · 2g G · 27g C' },
          { food: 'Fruta', amount: '~150g', macros: '1g P · 0g G · 20g C' },
        ]
      },
      {
        name: '🥩 Almuerzo (13:00)',
        items: [
          { food: 'Ternera (cocida)', amount: '220g', macros: '55g P · 14g G · 0g C' },
          { food: 'Patata (cocida)', amount: '100g', macros: '2g P · 0g G · 17g C' },
          { food: 'Brócoli', amount: '200g', macros: '6g P · 1g G · 14g C' },
          { food: 'Aceite de oliva', amount: '15ml', macros: '0g P · 14g G · 0g C' },
          { food: 'Fruta', amount: '~150g', macros: '1g P · 0g G · 12g C' },
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
const PHASE_ADD = {
  'Base':       { carbG: 0,   fruitG: 0,   oilMl: 0  },
  'Transición': { carbG: 40,  fruitG: 100, oilMl: 5  },
  'Intensidad': { carbG: 80,  fruitG: 150, oilMl: 8  },
  'Peak':       { carbG: 120, fruitG: 150, oilMl: 12 },
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
    dose: '3 cápsulas / día',
    timing: 'Desayuno: 1 cáp (con zinc) · Almuerzo: 2 cáps (con D3+K2 y magnesio)',
    detail: '1.000mg aceite de pescado/cápsula · forma triglicérido (TG) · 800mg EPA+DHA/cáp',
    why: '2,4g EPA+DHA diarios. Forma TG = mejor absorción que ésteres etílicos. Cubre los días sin salmón.',
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
    dose: '½ comp/día · o 1 comp cada 2 días (equivalente)',
    timing: 'Desayuno · con 1 cáp omega-3 (separado del magnesio)',
    detail: '25mg/comprimido · Albion® Zinc Bisglicinato · alta biodisponibilidad',
    why: 'Días A: ~8–9mg vs objetivo 12–15mg. Revisar cobre a los 3–4 meses (zinc alto inhibe absorción de cobre).',
    color: '#8B5CF6'
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
      {p.phase} · {Math.round(p.pct * 100)}% RM · {p.reps} reps
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
  const p = PROG[weekIdx];
  const effRM = effectiveRM(ex, rmStore);
  const overridden = effRM !== ex.rm;
  let weight = wt(effRM, p.pct);
  if (ex.dumbbell) weight = nearestDumbbell(weight);
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
          <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 18 }}>
            {weight} {isArm ? 'kg/arm' : 'kg'}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>{ex.setCount || 4} × {p.reps} reps</div>
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

function DayWorkout({ day, weekIdx, rmStore }) {
  if (day.special === 'stretch') {
    return (
      <div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14 }}>
          🏊 Pool Recovery 20 min + 🏊‍♂️ Nado continuo/intervalos 15–20 min + 🧘 Estiramientos 45–60 s por serie
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

function TrainingTab({ weekIdx, dayIdx, setDayIdx, completed, markDone, rmStore }) {
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
        <span style={{ color: '#64748b', fontSize: 13 }}>4 series</span>
      </div>

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
          background: day.nutriDay === 'A' ? '#3B82F622' : '#F59E0B22',
          color: day.nutriDay === 'A' ? '#3B82F6' : '#F59E0B',
          borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600
        }}>
          {day.nutriDay === 'A' ? '🍗 Pollo' : '🐟 Salmón / 🥩 Ternera'}
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
// Máquinas donde el número de la placa NO es el peso real (hay que multiplicar
// por 1.5 para obtener los kg reales) — el valor que se introduce aquí siempre
// es el kg real ya calculado, no el número que marca la máquina.
const MACHINE_PLATE_NOTE = ['Butterfly reverse cable pull', 'Flys standing cable pull'];

function RepMaxTestCard({ ex, rmStore, saveRM, rmHistory }) {
  const isDumbbell = !!ex.dumbbell;
  const needsPlateNote = MACHINE_PLATE_NOTE.includes(ex.name);
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
          ⓘ En esta máquina el número que marca la placa NO es el peso real — hay que
          multiplicarlo ×1.5. Haz esa cuenta antes de escribir el peso abajo: aquí siempre
          se introduce el kg real, nunca el número que marca la máquina.
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
  { cat:'🥩 Proteínas',        name:'Pechuga de pollo (cocida)', qty:300, unit:'g' },
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
  { cat:'🍓 Fruta',            name:'Fruta variada',             qty:300, unit:'g' },
];
const PB = [
  { cat:'🥩 Proteínas',        name:'Salmón',                    qty:250, unit:'g' },
  { cat:'🥩 Proteínas',        name:'Ternera',                   qty:220, unit:'g' },
  { cat:'🥚 Huevos y lácteos', name:'Huevos',                    qty:4,   unit:'uds' },
  { cat:'🥚 Huevos y lácteos', name:'Arla Skyr 450g',            qty:1,   unit:'pack' },
  { cat:'🥦 Verduras',         name:'Brócoli',                   qty:200, unit:'g' },
  { cat:'🍠 Cereales',         name:'Boniato',                   qty:100, unit:'g' },
  { cat:'🍠 Cereales',         name:'Patata',                    qty:100, unit:'g' },
  { cat:'🫙 Despensa',         name:'Aceite de oliva',           qty:20,  unit:'ml' },
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
function merged(dA, dB) {
  const map = new Map();
  const add = (items, d) => items.forEach(i => {
    if (map.has(i.name)) map.get(i.name).total += i.qty * d;
    else map.set(i.name, {...i, total: i.qty * d});
  });
  add(PA, dA); add(PB, dB);
  const cats = {};
  map.forEach(v => { if (!cats[v.cat]) cats[v.cat]=[]; cats[v.cat].push(v); });
  return cats;
}

function ShoppingTab({ weekIdx }) {
  const [daysA, setDaysA]     = useState(3);
  const [daysB, setDaysB]     = useState(2);
  const [checked, setChecked] = useState({});
  const toggle = k => setChecked(p => ({...p, [k]: !p[k]}));

  const totalDays = daysA + daysB;
  const phase = PROG[weekIdx].phase;
  const add = PHASE_ADD[phase];

  const suppItems = [
    { name:'D3+K2 · Natural Elements',                 qty:totalDays,              unit:'comp' },
    { name:'Omega-3 · Natural Elements',               qty:totalDays * 3,          unit:'cáps' },
    { name:'Magnesio Bisglicinato · Natural Elements', qty:totalDays,              unit:'cáps' },
    { name:'Zinc · Natural Elements',                  qty:Math.ceil(totalDays*.5), unit:'comp' },
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
        {[['Plan A', daysA, setDaysA, '#3B82F6'], ['Plan B', daysB, setDaysB, '#F59E0B']].map(([label, val, setter, color]) => (
          <div key={label} style={{flex:1, background:'#1e293b', borderRadius:10, padding:'14px', textAlign:'center'}}>
            <div style={{color, fontWeight:700, marginBottom:10}}>{label}</div>
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
        Object.entries(merged(daysA, daysB)).map(([cat, items]) =>
          <CatGroup key={cat} catName={cat} items={items} prefix={`c${daysA}${daysB}`} />
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
        {['A', 'B'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 14,
            background: v === view ? (v === 'A' ? '#3B82F6' : '#F59E0B') : '#1e293b',
            color: v === view ? '#fff' : '#64748b'
          }}>
            {NUTRITION[v].label}
            <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>{NUTRITION[v].days}</div>
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}><PhasePill weekIdx={weekIdx} /></div>

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
                <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>{item.amount}</span>
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
            Estimación de partida — ajusta ±100 kcal/día según la tendencia real de peso, no según el objetivo teórico.
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
          <b style={{color:'#f8fafc'}}>Desayuno:</b> Zinc + 1 cáp Omega-3 (la grasa del huevo y el parmesano facilita la absorción del zinc).<br/>
          <b style={{color:'#f8fafc'}}>Almuerzo:</b> D3+K2 + Magnesio + 2 cáps Omega-3 (con aceite de oliva = absorción óptima).<br/>
          <b style={{color:'#f8fafc'}}>Zinc a largo plazo:</b> Revisar cobre a los 3–4 meses.
        </div>
      </div>
    </div>
  );
}

// ─── SECCIONES PRINCIPALES ────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'entrenamiento', label: '🏋️ Entrenamiento', subtabs: [
      { id: 'plan', label: 'Plan' },
      { id: 'test', label: 'Test' },
  ]},
  { id: 'alimentacion', label: '🍽 Alimentación', subtabs: [
      { id: 'compra', label: '🛒 Compra' },
      { id: 'nutricion', label: 'Nutrición' },
      { id: 'supps', label: '💊 Suplementos' },
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
        <TrainingTab weekIdx={weekIdx} dayIdx={dayIdx} setDayIdx={saveDay} completed={completed} markDone={markDone} rmStore={rmStore} />
      )}
      {section === 'entrenamiento' && sub === 'test' && (
        <TestTab rmStore={rmStore} saveRM={saveRM} rmHistory={rmHistory} mvtStore={mvtStore} saveMVT={saveMVT} clearMVT={clearMVT} lastTestDate={lastTestDate} startNewCycle={startNewCycle} />
      )}
      {section === 'alimentacion' && sub === 'compra' && <ShoppingTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'nutricion' && <NutritionTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'supps' && <SupplementsTab />}
    </div>
    <RestBar />
    </RestProvider>
  );
}
