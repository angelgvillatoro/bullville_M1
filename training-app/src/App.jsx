import { useState, useRef, useEffect } from "react";

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

// ─── MANCUERNAS REALES ────────────────────────────────────────────────────────
// ⚠️ Ajusta este array a las mancuernas que tienes de verdad en el gimnasio.
const DUMBBELL_WEIGHTS = [4, 6, 8, 12, 16, 20, 24, 28, 32];
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

// ─── CALENTAMIENTO PRESCRITO PARA TESTS DE MÁXIMO (escalera y vídeo) ────────
// Antes se dejaba a criterio ("sube de carga hasta que la técnica se rompa").
// Ahora hay una progresión concreta de calentamiento antes de ir a la carga
// de test real — reps y descanso fijos en cada escalón, sobre el RM actual
// (que se recalibra solo si guardas un test nuevo).
const WARMUP_LADDER = [
  { pct: 0.40, reps: 5, rest: 90 },
  { pct: 0.55, reps: 3, rest: 120 },
  { pct: 0.70, reps: 2, rest: 150 },
  { pct: 0.80, reps: 1, rest: 180 },
  { pct: 0.90, reps: 1, rest: 180 },
];
function buildWarmup(baseRM) {
  return WARMUP_LADDER.map(w => ({
    weight: Math.round(baseRM * w.pct / 2.5) * 2.5,
    reps: w.reps,
    rest: w.rest,
  }));
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
// Reescala una tabla de series olímpicas (pensada para un RM concreto) de forma
// proporcional al nuevo RM real, conservando la estructura de rampa por semana
// que ya estaba diseñada a mano.
function scaleOlympicTable(sets, oldRM, newRM) {
  if (!oldRM || oldRM === newRM) return sets;
  const ratio = newRM / oldRM;
  return sets.map(week => week.map((v, i) => (i % 2 === 0 ? Math.round(v * ratio / 2.5) * 2.5 : v)));
}

// ─── OLYMPIC SETS: [s1w, s1r, s2w, s2r, s3w, s3r, s4w, s4r] per week ────────
const CJ = [
  [72.5,5,80,4,82.5,4,87.5,3],   // W1
  [72.5,5,80,4,82.5,4,90,3],     // W2
  [82.5,4,82.5,4,90,4,95,2],     // W3
  [82.5,4,87.5,3,92.5,3,95,2],   // W4
  [82.5,4,87.5,3,92.5,2,100,1],  // W5
  [87.5,3,87.5,3,92.5,2,100,1],  // W6
  [87.5,3,87.5,3,95,1,100,1],    // W7
  [87.5,3,90,3,95,1,102.5,1],    // W8
  [87.5,3,90,3,100,1,102.5,1],   // W9
  [87.5,3,90,3,100,1,102.5,1],   // W10
  [87.5,3,92.5,2,100,1,105,1],   // W11
  [90,1,95,1,102.5,1,105,1],     // W12
  [90,2,95,1,102.5,1,105,1],     // W13
  [95,1,100,1,102.5,1,105,1],    // W14
  [95,1,100,1,102.5,1,110,1],    // W15
];

const PS = [
  [52.5,5,57.5,4,60,4,62.5,3],   // W1
  [52.5,5,57.5,4,60,4,65,3],     // W2
  [60,4,60,4,65,4,67.5,2],       // W3
  [60,4,62.5,3,67.5,3,67.5,2],   // W4
  [60,4,62.5,3,67.5,2,72.5,1],   // W5
  [62.5,3,62.5,3,67.5,2,72.5,1], // W6
  [62.5,3,62.5,3,67.5,1,72.5,1], // W7
  [62.5,3,65,3,67.5,1,75,1],     // W8
  [62.5,3,65,3,72.5,1,75,1],     // W9
  [62.5,3,65,3,72.5,1,75,1],     // W10
  [62.5,3,65,2,72.5,1,75,1],     // W11
  [65,1,67.5,1,75,1,75,1],       // W12
  [65,2,67.5,1,75,1,75,1],       // W13
  [67.5,1,72.5,1,75,1,75,1],     // W14
  [67.5,1,72.5,1,75,1,77.5,1],   // W15
];

const DL = [
  [82.5,5,90,4,92.5,4,97.5,3],      // W1
  [82.5,5,90,4,92.5,4,102.5,3],     // W2
  [92.5,4,92.5,4,102.5,4,110,2],    // W3
  [92.5,4,100,3,105,3,110,2],       // W4
  [92.5,4,100,3,105,2,115,1],       // W5
  [97.5,3,100,3,105,2,115,1],       // W6
  [97.5,3,100,3,110,1,115,1],       // W7
  [97.5,3,102.5,3,110,1,117.5,1],   // W8
  [97.5,3,102.5,3,115,1,117.5,1],   // W9
  [97.5,3,102.5,3,115,1,117.5,1],   // W10
  [97.5,3,105,2,115,1,120,1],       // W11
  [102.5,1,110,1,117.5,1,120,1],    // W12
  [102.5,2,110,1,117.5,1,120,1],    // W13
  [110,1,115,1,117.5,1,120,1],      // W14
  [110,1,115,1,117.5,1,125,1],      // W15
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
// testMethod: 'video' (velocidad + regresión carga-velocidad, solo válido en
// básicos con MVT establecido en literatura) · 'ladder' (registro directo del
// peso máximo con técnica limpia, solo para los compuestos que sostienen de
// verdad la progresión del ciclo) · 'repmax' (test de reps con carga submáxima
// + fórmula de Epley — mancuernas Y accesorios de aislamiento, donde buscar un
// 1RM real no aporta nada al riesgo que añade)
// restCategory: qué descanso entre series le corresponde — 'olimpico' (técnica
// + potencia máxima), 'basico' (los 3 grandes: banca/sentadilla/peso muerto),
// 'compuesto' (multiarticulares secundarios), 'aislamiento', 'core'.
//
// Orden anti-fatiga: antes se agrupaban 2-3 ejercicios seguidos del mismo
// grupo muscular (tríceps×3 y luego bíceps×3 el lunes; los dos ejercicios de
// isquios seguidos el sábado). Ahora se intercalan por grupo muscular para que
// nunca lleguen 2 series seguidas al mismo músculo ya fatigado.
const DAYS = [
  {
    name: 'Lunes', label: 'ArmDay', emoji: '💪', nutriDay: 'A',
    exercises: [
      { name: 'Triceps stretches cable pull bar',  rm: 35, unit: 'kg',     testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Bicep curls cable pull',            rm: 30, unit: 'kg',     testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Seated lateral raises dumbbell',    rm: 6,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
      { name: 'Triceps extension cable pull cord', rm: 30, unit: 'kg',     testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Bicep curls sitting dumbbell',      rm: 9,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
      { name: 'Shoulder press sitting dumbbell',   rm: 15, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
      { name: 'Triceps extension one-armed cable', rm: 10, unit: 'kg/arm', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Bicep curls hammer grip seated',    rm: 8,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
      { name: 'Butterfly reverse cable pull',      rm: 10, unit: 'kg/arm', testMethod: 'repmax', restCategory: 'aislamiento' },
    ]
  },
  {
    name: 'Martes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 105, unit: 'kg', type: 'olympic', sets: CJ, testMethod: 'ladder', restCategory: 'olimpico' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS, testMethod: 'ladder', restCategory: 'olimpico' },
      { name: 'Bicep curls sitting dumbbell',rm: 9,   unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
      { name: 'Latzug breit (lat pulldown)', rm: 90,  unit: 'kg', testMethod: 'ladder', restCategory: 'compuesto' },
      { name: 'Bicep curls hammer grip seated', rm: 8, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
    ]
  },
  {
    name: 'Miércoles', label: 'Stretch & Pool', emoji: '🏊', nutriDay: 'A',
    special: 'stretch'
  },
  {
    name: 'Jueves', label: 'ChestDay', emoji: '🏋️', nutriDay: 'B',
    exercises: [
      { name: 'Bench press barbell',               rm: 90,   unit: 'kg', testMethod: 'video', mvt: 0.17, restCategory: 'basico' },
      { name: 'Flys standing cable pull',          rm: 12.5, unit: 'kg/arm', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Bench press inclined barbell',      rm: 72.5, unit: 'kg', testMethod: 'ladder', restCategory: 'compuesto' },
      { name: 'Triceps extension cable pull cord', rm: 30,   unit: 'kg', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS, restCategory: 'compuesto' },
      { name: 'Triceps extension one-armed cable', rm: 10,   unit: 'kg/arm', testMethod: 'repmax', restCategory: 'aislamiento' },
    ]
  },
  {
    name: 'Viernes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 105, unit: 'kg', type: 'olympic', sets: CJ, testMethod: 'ladder', restCategory: 'olimpico' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS, testMethod: 'ladder', restCategory: 'olimpico' },
      { name: 'Bicep curls sitting dumbbell',rm: 9,   unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
      { name: 'Latzug breit (lat pulldown)', rm: 90,  unit: 'kg', testMethod: 'ladder', restCategory: 'compuesto' },
      { name: 'Bicep curls hammer grip seated', rm: 8, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true, restCategory: 'aislamiento' },
    ]
  },
  {
    name: 'Sábado', label: 'LegDay', emoji: '🦵', nutriDay: 'B',
    exercises: [
      { name: 'Deadlift barbell',   rm: 120, unit: 'kg', type: 'olympic', sets: DL, testMethod: 'ladder', restCategory: 'basico' },
      { name: 'Squat barbell',      rm: 105, unit: 'kg', testMethod: 'video', mvt: 0.30, restCategory: 'basico' },
      { name: 'Leg curl machine',   rm: 80,  unit: 'kg', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Hip thrust machine', rm: 120, unit: 'kg', testMethod: 'ladder', restCategory: 'compuesto' },
      { name: 'Nordic curl',        rm: 65,  unit: 'kg', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Pallof press cable (hold isométrico)', type: 'bw', repsByPhase: PALLOF_SECONDS,
        equipLabel: 'Anti-rotación · por lado', unitSuffix: 's/lado', restCategory: 'core',
        note: 'De pie, perpendicular a la polea. Extiende los brazos al frente y AGUANTA ahí quieto sin dejar que la cadera gire — es un aguante estático, no repeticiones de empuje y vuelta. Repite el hold en cada serie, cambia de lado al terminar las 3 series.',
        rm: 15, unit: 'kg', testMethod: 'coreload',
        testTarget: '35s/lado por serie (objetivo de fase Peak, el más exigente de las 4)',
        formCue: 'la cadera gire' },
      { name: 'Weighted plank (disco en la espalda)', type: 'bw', repsByPhase: PLANK_SECONDS,
        equipLabel: 'Anti-extensión · con disco', unitSuffix: 's', restCategory: 'core',
        note: 'Empieza con 5-10kg sobre la zona lumbar-alta. Si aguantas el tiempo objetivo con técnica limpia (sin que caiga la cadera), sube el disco de peso antes de subir el tiempo.',
        rm: 7.5, unit: 'kg', testMethod: 'coreload',
        testTarget: '50s por serie (objetivo de fase Peak, el más exigente de las 4)',
        formCue: 'caiga la cadera' },
    ]
  },
  {
    name: 'Domingo', label: 'ChestDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Bench press barbell',               rm: 90,   unit: 'kg', testMethod: 'video', mvt: 0.17, restCategory: 'basico' },
      { name: 'Flys standing cable pull',          rm: 12.5, unit: 'kg/arm', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Bench press inclined barbell',      rm: 72.5, unit: 'kg', testMethod: 'ladder', restCategory: 'compuesto' },
      { name: 'Triceps extension cable pull cord', rm: 30,   unit: 'kg', testMethod: 'repmax', restCategory: 'aislamiento' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS, restCategory: 'compuesto' },
      { name: 'Triceps extension one-armed cable', rm: 10,   unit: 'kg/arm', testMethod: 'repmax', restCategory: 'aislamiento' },
    ]
  },
];

// Descanso entre series (segundos) según categoría del ejercicio y fase del
// ciclo — sube de Base a Peak porque el %RM también sube, y los olímpicos
// llevan más descanso que el resto por la demanda técnica/neural de cada rep.
const REST_SECONDS = {
  olimpico:    { 'Base': 180, 'Transición': 210, 'Intensidad': 240, 'Peak': 300 },
  basico:      { 'Base': 120, 'Transición': 150, 'Intensidad': 180, 'Peak': 240 },
  compuesto:   { 'Base': 90,  'Transición': 105, 'Intensidad': 120, 'Peak': 150 },
  aislamiento: { 'Base': 60,  'Transición': 60,  'Intensidad': 75,  'Peak': 90  },
  core:        { 'Base': 45,  'Transición': 45,  'Intensidad': 60,  'Peak': 60  },
};
function restSecondsFor(ex, phase) {
  const cat = REST_SECONDS[ex.restCategory || 'aislamiento'];
  return (cat && cat[phase]) || 90;
}

// Días de test (semana 16) — Miércoles, Viernes y Domingo quedan como descanso
// porque repiten ejercicios ya cubiertos en Lunes/Martes/Jueves/Sábado.
const TEST_DAY_NAMES = ['Lunes', 'Martes', 'Jueves', 'Sábado'];
// Un ejercicio compartido entre dos días de entreno (ej. Bicep curls aparece
// Lunes+Martes+Viernes) por defecto se testea el primer día donde aparece —
// pero eso dejaba a Martes y Jueves con solo 2-3 ejercicios de test (los
// olímpicos/básicos) porque Lunes se quedaba con todos los accesorios
// compartidos. Aquí se reasigna explícitamente el día "dueño" del test para
// que ningún día de test se quede sin accesorios que alternar con el
// ejercicio pesado de ese día.
const TEST_OWNER_OVERRIDE = {
  'Bicep curls sitting dumbbell':      'Martes',
  'Bicep curls hammer grip seated':    'Martes',
  'Triceps extension cable pull cord': 'Jueves',
  'Triceps extension one-armed cable': 'Jueves',
};
function buildTestPlan() {
  const seen = new Set();
  const byDay = {};
  TEST_DAY_NAMES.forEach(dayName => { byDay[dayName] = []; });
  TEST_DAY_NAMES.forEach(dayName => {
    const day = DAYS.find(d => d.name === dayName);
    (day.exercises || []).forEach(ex => {
      if (!ex.testMethod) return;         // ej. Dips — progresa solo por reps, sin carga que testear
      if (seen.has(ex.name)) return;      // evita testear dos veces el mismo ejercicio
      seen.add(ex.name);
      const owner = TEST_OWNER_OVERRIDE[ex.name] || dayName;
      byDay[owner].push(ex);
    });
  });
  return byDay;
}

// ─── WEDNESDAY STRETCHES ─────────────────────────────────────────────────────
// Los 3 primeros son bloques continuos de piscina (sin series que contar).
// El resto llevan contador de 60s + contador de series: cada vez que pulsas
// "Iniciar" cuenta como una repetición y arranca la cuenta atrás de esa serie.
const STRETCHES = [
  { name: 'Pool walking',             duration: '10 min',
    desc: 'Camina hacia adelante y hacia atrás en la piscina, agua a la altura del pecho. La resistencia del agua da cardio de bajo impacto sin cargar la rodilla.' },
  { name: 'Float & decompress',       duration: '5 min',
    desc: 'Flota boca arriba con los brazos separados, deja que el agua sostenga todo el peso del cuerpo. Relaja columna y articulaciones — descompresión pasiva, no fuerces nada.' },
  { name: 'Arm circles in water',     duration: '5 min',
    desc: 'De pie en el agua, brazos extendidos, haz círculos hacia adelante y hacia atrás usando la resistencia del agua para movilidad de hombro.' },
  { name: 'Glutes stretch seated',      sets: 4, seconds: 60,
    desc: 'Sentado, cruza un tobillo sobre la rodilla contraria (figura 4) e inclina el torso hacia adelante manteniendo la espalda recta. Notarás el estiramiento en el glúteo de la pierna cruzada.' },
  { name: 'Adductors stretch standing', sets: 4, seconds: 60,
    desc: 'De pie con piernas muy separadas, desplaza el peso hacia un lado flexionando esa rodilla y dejando la otra pierna estirada. El estiramiento se siente en la cara interna del muslo de la pierna estirada.' },
  { name: 'Leg flexor stretch sitting', sets: 3, seconds: 60,
    desc: 'Sentado, una pierna estirada al frente y la otra flexionada con el pie cerca del muslo interno. Inclina el torso desde la cadera hacia el pie de la pierna estirada, espalda recta, sin redondear.' },
  { name: 'Leg stretch standing',       sets: 4, seconds: 60,
    desc: 'Apoya el talón en una superficie elevada (banco bajo) con la pierna estirada y la rodilla de apoyo con un ligero micro-flexión (sin bloquear). Inclina el torso desde la cadera manteniendo la espalda plana. Si molesta la rodilla de apoyo, baja la altura del apoyo.' },
  { name: 'Hip flexor stretch lunge',   sets: 4, seconds: 60,
    desc: 'Zancada con la rodilla trasera apoyada en el suelo (usa una colchoneta o toalla bajo la rodilla). Empuja la cadera hacia adelante manteniendo el torso vertical. El estiramiento se siente en la parte delantera de la cadera de la pierna de atrás.' },
  { name: 'Trapezius stretch sideways', sets: 4, seconds: 60,
    desc: 'Sentado o de pie, inclina la cabeza hacia un lado llevando la oreja hacia el hombro. Puedes ayudarte con la mano del mismo lado para aumentar suavemente el estiramiento en el lado contrario del cuello/trapecio.' },
  { name: 'Torso rotation stretch',     sets: 4, seconds: 60,
    desc: 'Sentado o de pie, rota el torso hacia un lado sujetándote a algo fijo (respaldo de silla) para profundizar el giro, manteniendo la cadera mirando al frente.' },
  { name: 'Torso side bending',         sets: 4, seconds: 60,
    desc: 'De pie, eleva un brazo por encima de la cabeza e inclina el torso hacia el lado contrario. El estiramiento se siente a lo largo del costado del tronco (dorsal/oblicuo).' },
  { name: 'Shoulder cross-body',        sets: 4, seconds: 60,
    desc: 'Lleva un brazo estirado por delante del pecho y usa el otro brazo para presionarlo suavemente hacia ti. El estiramiento se siente en la parte trasera del hombro (deltoide posterior).' },
  { name: 'Quadriceps stretch standing', sets: 4, seconds: 60,
    desc: 'De pie apoyado en algo fijo para el equilibrio (pared o barra — prioridad por la rodilla), agarra el tobillo de la pierna a estirar y llévalo hacia el glúteo manteniendo las rodillas juntas. El estiramiento se siente en la parte delantera del muslo.' },
];

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

// Botón ⏱ compartido — arranca el descanso prescrito (según categoría del
// ejercicio y fase del ciclo) en la barra global de descanso.
function RestButton({ ex, weekIdx, totalSets, startRest }) {
  if (!startRest) return null;
  const phase = PROG[weekIdx].phase;
  const seconds = restSecondsFor(ex, phase);
  return (
    <button
      onClick={() => startRest(ex.name, seconds, totalSets)}
      style={{
        marginTop: 6, padding: '5px 10px', borderRadius: 6, border: '1px solid #334155',
        background: '#0f172a', color: '#38bdf8', fontSize: 12, fontWeight: 600, cursor: 'pointer'
      }}>
      ⏱ Descanso {seconds}s
    </button>
  );
}

function OlympicTable({ ex, weekIdx, rmStore, startRest }) {
  const effRM = effectiveRM(ex, rmStore);
  const overridden = effRM !== ex.rm;
  const sets = overridden ? scaleOlympicTable(ex.sets, ex.rm, effRM) : ex.sets;
  const weekSets = sets[weekIdx];
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#f8fafc', fontWeight: 600, fontSize: 14 }}>🏋️ {ex.name}</span>
        <span style={{ color: overridden ? '#22C55E' : '#94a3b8', fontSize: 12 }}>
          RM: {effRM}kg {overridden && '✓ test'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            background: '#0f172a', borderRadius: 6, padding: '8px 10px', textAlign: 'center'
          }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>Serie {i+1}</div>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 16 }}>{weekSets[i*2]}kg</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>×{weekSets[i*2+1]}</div>
          </div>
        ))}
      </div>
      <RestButton ex={ex} weekIdx={weekIdx} totalSets={4} startRest={startRest} />
    </div>
  );
}

function NonOlympicRow({ ex, weekIdx, rmStore, startRest }) {
  const p = PROG[weekIdx];
  const effRM = effectiveRM(ex, rmStore);
  const overridden = effRM !== ex.rm;
  let weight = wt(effRM, p.pct);
  if (ex.dumbbell) weight = nearestDumbbell(weight);
  const isArm = ex.unit === 'kg/arm';
  return (
    <div style={{
      padding: '10px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 500 }}>{ex.name}</div>
          <div style={{ color: overridden ? '#22C55E' : '#64748b', fontSize: 12 }}>
            RM: {effRM} {ex.unit} {overridden && '✓ test'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 18 }}>
            {weight} {isArm ? 'kg/arm' : 'kg'}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>4 × {p.reps} reps</div>
          {ex.dumbbell && <div style={{ color: '#64748b', fontSize: 11 }}>mancuerna real disponible</div>}
        </div>
      </div>
      <RestButton ex={ex} weekIdx={weekIdx} totalSets={4} startRest={startRest} />
    </div>
  );
}

function BWRow({ ex, weekIdx, rmStore, startRest }) {
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
        <span style={{ color: '#64748b', fontSize: 12 }}>{loadLabel}</span>
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
      <RestButton ex={ex} weekIdx={weekIdx} totalSets={reps.length} startRest={startRest} />
    </div>
  );
}

// Contador de 60s + contador de series para los estiramientos del miércoles.
// Cada pulsación de "Iniciar" cuenta como una repetición de esa serie y
// arranca la cuenta atrás — no hace falta esperar a que termine para que
// cuente, se cuenta en el momento de activar el contador.
function StretchTimerRow({ ex }) {
  const [seriesDone, setSeriesDone] = useState(0);
  const [remaining, setRemaining] = useState(ex.seconds);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  function startTimer() {
    if (running) return;
    setSeriesDone(s => s + 1);
    setRemaining(ex.seconds);
    setRunning(true);
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(intervalRef.current);
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }

  function resetSeries() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    setSeriesDone(0);
    setRemaining(ex.seconds);
  }

  const done = seriesDone >= ex.sets;

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontSize: 14 }}>{ex.name}</span>
        <span style={{ color: done ? '#22C55E' : '#94a3b8', fontSize: 13, fontWeight: 600 }}>
          Serie {Math.min(seriesDone, ex.sets)}/{ex.sets}
        </span>
      </div>
      {ex.desc && <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}>{ex.desc}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={startTimer} disabled={running}
          style={{
            flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: running ? 'default' : 'pointer',
            background: running ? '#334155' : (done ? '#14532d' : '#2563EB'),
            color: running ? '#94a3b8' : (done ? '#86efac' : '#fff'),
            fontWeight: 700, fontSize: 14
          }}>
          {running ? `⏱ 0:${String(remaining).padStart(2, '0')}` : (done ? `✓ Completado — repetir (${ex.seconds}s)` : `▶ Iniciar (${ex.seconds}s)`)}
        </button>
        {(seriesDone > 0 && !running) && (
          <span onClick={resetSeries} style={{ color: '#EF4444', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            reiniciar
          </span>
        )}
      </div>
    </div>
  );
}

function DayWorkout({ day, weekIdx, rmStore, startRest }) {
  if (day.special === 'stretch') {
    return (
      <div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14 }}>
          🏊 Pool Recovery 20 min + 🏊‍♂️ Nado continuo/intervalos 15–20 min + 🧘 Estiramientos 45–60 s por serie
        </div>
        {STRETCHES.map((s, i) => (
          s.sets
            ? <StretchTimerRow key={i} ex={s} />
            : (
              <div key={i} style={{ padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#f8fafc', fontSize: 14 }}>{s.name}</span>
                  <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 500 }}>{s.duration}</span>
                </div>
                {s.desc && <div style={{ color: '#64748b', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{s.desc}</div>}
              </div>
            )
        ))}
      </div>
    );
  }

  return (
    <div>
      {day.exercises.map((ex, i) => {
        if (ex.type === 'olympic') return <OlympicTable key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} startRest={startRest} />;
        if (ex.type === 'bw') return <BWRow key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} startRest={startRest} />;
        return <NonOlympicRow key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} startRest={startRest} />;
      })}
    </div>
  );
}

function TrainingTab({ weekIdx, dayIdx, setDayIdx, completed, markDone, rmStore, startRest }) {
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
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <PhasePill weekIdx={weekIdx} />
        <span style={{ color: '#64748b', fontSize: 13 }}>4 series</span>
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

      <DayWorkout day={day} weekIdx={weekIdx} rmStore={rmStore} startRest={startRest} />

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

function VideoTestCard({ ex, rmStore, saveRM, mvtStore, saveMVT, clearMVT }) {
  const [ladderFallback, setLadderFallback] = useState(false);
  const [plateDiameter, setPlateDiameter] = useState(45); // cm — estándar IWF discos bumper 10-25kg
  const personalMVT = mvtStore ? mvtStore[ex.name] : null;
  const [mvt, setMvt] = useState(effectiveMVT(ex, mvtStore || {}));
  const [videoUrl, setVideoUrl] = useState(null);
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
    return { a, b };
  }
  const fit = points.length >= 3 ? linreg(points) : null;
  const rawEstRM = (fit && fit.b !== 0) ? (mvt - fit.a) / fit.b : null;
  // Corrección de sesgo del método carga-velocidad: la extrapolación lineal a
  // la velocidad mínima tiende a SOBREESTIMAR el 1RM real frente a un test de
  // carga directa. Ajuste tomado tal cual de lo ya decidido en otra conversación
  // (Greig et al. 2023, −3.7%) — no lo he re-verificado yo mismo en esta sesión,
  // lo aplico porque así se acordó, no como hallazgo propio.
  const BIAS_CORRECTION = 0.037;
  const estRM = rawEstRM ? rawEstRM * (1 - BIAS_CORRECTION) : null;

  // R² y SEE del ajuste — calculados directamente de tus propios puntos, no de
  // una cifra de literatura: cuánto se ajusta la recta a lo que mediste de
  // verdad, y qué margen de error (en kg) se traduce a partir de esa dispersión.
  let rSquared = null, seeWeight = null;
  if (fit && points.length >= 3) {
    const meanV = points.reduce((s, p) => s + p.v, 0) / points.length;
    const ssTot = points.reduce((s, p) => s + (p.v - meanV) ** 2, 0);
    const ssRes = points.reduce((s, p) => s + (p.v - (fit.a + fit.b * p.load)) ** 2, 0);
    rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null;
    const seeV = Math.sqrt(ssRes / Math.max(1, points.length - 2));
    seeWeight = fit.b !== 0 ? seeV / Math.abs(fit.b) : null;
  }

  // Avisos de calidad del test — no bloquean guardar, pero avisan de por qué
  // el RM estimado puede no ser fiable.
  const warnings = [];
  if (points.length > 0 && points.length < 3) warnings.push('Añade al menos 3 series para ajustar la recta.');
  if (points.length >= 3) {
    const loads = points.map(p => p.load);
    const maxLoad = Math.max(...loads), minLoad = Math.max(...loads) > 0 ? Math.min(...loads) : 0;
    const baseRMnow = effectiveRM(ex, rmStore);
    if (maxLoad < baseRMnow * 0.8) warnings.push(`La carga más pesada probada (${maxLoad}kg) está lejos de tu RM actual (${baseRMnow}kg) — la extrapolación a MVT es grande y menos fiable. Prueba con cargas más cercanas a tu límite.`);
    if ((maxLoad - minLoad) < baseRMnow * 0.15) warnings.push('Las cargas probadas están muy juntas entre sí — con poco rango de carga la recta carga-velocidad queda mal condicionada. Prueba con más variedad, de ligera a pesada.');
    const tooFast = points.filter(p => p.v > (mvt * 4));
    if (tooFast.length > 0) warnings.push('Alguna serie se movió muy rápido en relación al MVT — puede aportar poco al ajuste o ser un error de marcado. Revisa esas series.');
    if (rSquared !== null && rSquared < 0.85) warnings.push(`R² bajo (${rSquared.toFixed(2)}) — el ajuste no explica bien tus datos. Revisa que el marcado de inicio/fin sea preciso en cada serie.`);
  }

  const current = rmStore[ex.name];
  const markerColor = { calib: '#F59E0B', start: '#3B82F6', end: '#EF4444' };

  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🎥 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {effectiveRM(ex, rmStore)}kg</span>
      </div>
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

          <WarmupBlock baseRM={effectiveRM(ex, rmStore)} unit={ex.unit} />

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
              setVideoUrl(URL.createObjectURL(f));
              setCalibP1(null); setCalibP2(null); setStartClick(null); setEndClick(null); setMode(null);
            }
          }} style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }} />

          {videoUrl && (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <video ref={videoRef} src={videoUrl} controls style={{ width: '100%', borderRadius: 8, display: 'block' }} />
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
            <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
              <span style={{ color: '#22C55E', fontWeight: 700, fontSize: 16 }}>RM estimado: {estRM.toFixed(1)} kg</span>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                Bruto de la extrapolación: {rawEstRM.toFixed(1)}kg · corregido −3.7% (sesgo de sobreestimación del método carga-velocidad): {estRM.toFixed(1)}kg
                {rSquared !== null && <> · R² = {rSquared.toFixed(2)}</>}
                {seeWeight !== null && <> · margen de error ≈ ±{seeWeight.toFixed(1)}kg</>}
              </div>
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ background: '#1e293b', border: '1px solid #F59E0B33', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
              {warnings.map((w, i) => (
                <div key={i} style={{ color: '#F59E0B', fontSize: 12, padding: '2px 0' }}>⚠ {w}</div>
              ))}
            </div>
          )}

          <button
            disabled={!estRM}
            onClick={() => saveRM(ex.name, Math.round(estRM * 2) / 2, ex.unit, 'video', { points, plateDiameter, mvt })}
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

// Bloque de calentamiento prescrito, reutilizado por escalera y vídeo.
function WarmupBlock({ baseRM, unit }) {
  const warmup = buildWarmup(baseRM);
  const u = unit === 'kg/arm' ? 'kg/arm' : 'kg';
  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Calentamiento antes del test
      </div>
      {warmup.map((w, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 12, padding: '2px 0' }}>
          <span>{w.weight}{u === 'kg/arm' ? ' kg/arm' : ' kg'} × {w.reps}</span>
          <span>descanso {w.rest}s</span>
        </div>
      ))}
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
      <WarmupBlock baseRM={baseRM} unit={ex.unit} />
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        Tras el calentamiento, escalera de test (60→105% del RM actual): {ladder.join(' · ')} kg. Sube de carga hasta que la técnica se rompa y anota abajo el peso más alto conseguido limpio.
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

function LadderTestCard({ ex, rmStore, saveRM }) {
  const baseRM = effectiveRM(ex, rmStore);
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>📋 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {baseRM}{ex.unit === 'kg/arm' ? ' kg/arm' : ' kg'}</span>
      </div>
      <LadderBody ex={ex} rmStore={rmStore} saveRM={saveRM} />
    </div>
  );
}

// Test para ejercicios de core cargado (Pallof press, plancha con disco): no
// buscan un 1RM de una repetición — buscan la carga más pesada con la que
// completas el objetivo de reps/tiempo de la fase Peak manteniendo la técnica
// limpia. Esa carga es el punto de partida de todo el ciclo siguiente.
function CoreLoadTestCard({ ex, rmStore, saveRM }) {
  const [value, setValue] = useState('');
  const current = rmStore[ex.name];
  const baseRM = effectiveRM(ex, rmStore);
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🧱 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>Carga actual: {baseRM}{ex.unit}</span>
      </div>
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

// Sirve tanto para mancuernas (peso discreto, selector) como para accesorios
// de polea/máquina (aislamiento) — carga libre por texto. Ninguno de los dos
// busca un 1RM real: en mancuerna por los saltos de peso disponibles, en
// aislamiento porque el riesgo de ir a máximo no aporta nada a un accesorio
// que no sostiene la progresión del ciclo (solo los compuestos que sí la
// sostienen — banca, sentadilla, peso muerto, olímpicos, inclinado, jalón,
// hip thrust — mantienen el test a máximo real vía escalera o vídeo).
function RepMaxTestCard({ ex, rmStore, saveRM }) {
  const isDumbbell = !!ex.dumbbell;
  const unitLabel = ex.unit === 'kg/arm' ? 'kg/arm' : 'kg';
  const [weight, setWeight] = useState(isDumbbell ? DUMBBELL_WEIGHTS[0] : '');
  const [reps, setReps] = useState('');
  const current = rmStore[ex.name];
  const w = isDumbbell ? weight : Number(weight);
  const est = (reps && w) ? epley1RM(w, Number(reps)) : null;
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🔁 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {effectiveRM(ex, rmStore)} {unitLabel}</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        {isDumbbell
          ? 'Ejercicio de mancuerna — pesos discretos, no tiene sentido un 1RM real. Haz el máximo de reps limpias con la mancuerna más pesada que controles y estimamos el RM con la fórmula de Epley.'
          : 'Accesorio de aislamiento — no se busca un 1RM real, el riesgo no lo justifica en un ejercicio que no sostiene la progresión del ciclo. Con una carga submáxima que puedas mover 6-12 veces con técnica limpia, estimamos el RM con la fórmula de Epley.'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          {isDumbbell ? 'Mancuerna (kg)' : `Carga (${unitLabel})`}
          {isDumbbell ? (
            <select value={weight} onChange={e => setWeight(Number(e.target.value))}
              style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }}>
              {DUMBBELL_WEIGHTS.map(w => <option key={w} value={w}>{w}kg</option>)}
            </select>
          ) : (
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
          )}
        </label>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          Reps limpias
          <input type="number" value={reps} onChange={e => setReps(e.target.value)}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        </label>
      </div>
      {est && <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>RM estimado: {est.toFixed(1)} {unitLabel}</div>}
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

function TestTab({ rmStore, saveRM, mvtStore, saveMVT, clearMVT, lastTestDate, startNewCycle }) {
  const [confirming, setConfirming] = useState(false);
  const plan = buildTestPlan();
  return (
    <div>
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: 4 }}>Test Semana 16</div>
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Descanso completo Miércoles, Viernes y Domingo (repiten ejercicios ya testeados). 4 métodos según el ejercicio: vídeo con velocidad (solo sentadilla y press banca — los únicos con MVT validado en literatura), registro directo de la escalera (solo los compuestos que sostienen la progresión: peso muerto, press inclinado, jalón, hip thrust), test de reps con fórmula de Epley (mancuerna y accesorios de aislamiento) y test de carga por objetivo (Pallof press, plancha con disco).
        </div>
        <div style={{ color: '#F59E0B', fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          Clean & jerk y power snatch NO se testean por velocidad — no existe un MVT validado para movimientos de recepción/catch como estos. Se graban si quieres revisar técnica, pero el test en sí va por escalera de carga directa.
        </div>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #F59E0B33', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Antes de testear
        </div>
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Nada de móvil los 30 minutos previos (fatiga neural) · usa el mismo dispositivo/cámara en todos los tests de este ciclo · sin muñequeras ni straps que puedan enmascarar el agarre real · respeta el descanso completo entre cargas del calentamiento, no lo acortes.
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
            if (ex.testMethod === 'video')    return <VideoTestCard    key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} mvtStore={mvtStore} saveMVT={saveMVT} clearMVT={clearMVT} />;
            if (ex.testMethod === 'repmax')   return <RepMaxTestCard   key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} />;
            if (ex.testMethod === 'coreload') return <CoreLoadTestCard key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} />;
            return <LadderTestCard key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} />;
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
function restBtnStyle(bg) {
  return {
    padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: bg, color: '#fff', fontWeight: 700, fontSize: 13
  };
}

// Barra fija inferior con la cuenta atrás del descanso entre series. Solo
// existe un descanso activo a la vez (estado global en App()). Sobrevive a
// que se apague/bloquee la pantalla porque el tiempo restante siempre se
// recalcula a partir de un timestamp absoluto (endAt), nunca contando ticks.
function RestTimerBar({ rest, onPauseResume, onAdjust, onSkip, onClose }) {
  if (!rest) return null;
  const mins = Math.floor(rest.remaining / 60);
  const secs = rest.remaining % 60;
  const finished = rest.remaining <= 0 && !rest.running;
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
      background: '#0f172aee', backdropFilter: 'blur(6px)',
      borderTop: '1px solid #334155', padding: '10px 16px 14px',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.4)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontSize: 13, fontWeight: 600 }}>⏱ Descanso — {rest.name}</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>Serie {rest.setIdx}/{rest.totalRests + 1}</span>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        {finished ? (
          <span style={{ fontSize: 22, fontWeight: 700, color: '#22C55E' }}>✓ Descanso completo — a por la siguiente serie</span>
        ) : (
          <span style={{
            fontSize: 40, fontWeight: 800,
            color: rest.remaining <= 5 ? '#EF4444' : '#22C55E',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => onAdjust(-15)} style={restBtnStyle('#334155')}>−15s</button>
        {!finished && (
          <button onClick={onPauseResume} style={restBtnStyle(rest.running ? '#F59E0B' : '#22C55E')}>
            {rest.running ? '⏸ Pausar' : '▶ Reanudar'}
          </button>
        )}
        <button onClick={() => onAdjust(15)} style={restBtnStyle('#334155')}>+15s</button>
        {rest.setIdx < rest.totalRests && <button onClick={onSkip} style={restBtnStyle('#2563EB')}>Saltar ›</button>}
        <button onClick={onClose} style={restBtnStyle('#EF4444')}>✕ Cerrar</button>
      </div>
    </div>
  );
}

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
  const [mvtStore, setMvtStore] = useState(loadMVT);

  const [section, setSection] = useState('entrenamiento');
  const [sub, setSub] = useState('plan');

  // --- Descanso entre series: estado global, un único contador activo a la
  // vez. rest = { name, seconds, totalRests, setIdx, remaining, running, endAt }
  // totalRests = nº de descansos de la serie (totalSets - 1); setIdx va de
  // 1 a totalRests. endAt es un timestamp absoluto: el tiempo restante se
  // recalcula siempre a partir de él (Date.now()), no contando ticks de
  // setInterval, para que sobreviva a que la pantalla se bloquee/atenúe.
  const [rest, setRest] = useState(null);
  const audioCtxRef = useRef(null);

  const beepAndVibrate = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = audioCtxRef.current || new Ctx();
        audioCtxRef.current = ctx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch {}
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
  };

  // Recalcula remaining/setIdx a partir de endAt. Si toca a cero: avisa
  // (beep+vibración) y, si quedan series, recarga sola el contador para la
  // siguiente; si era la última, se detiene sin recargar.
  const advanceRestIfDue = (prev) => {
    if (!prev || !prev.running) return prev;
    const remaining = Math.max(0, Math.round((prev.endAt - Date.now()) / 1000));
    if (remaining > 0) return remaining === prev.remaining ? prev : { ...prev, remaining };
    beepAndVibrate();
    if (prev.setIdx < prev.totalRests) {
      return { ...prev, setIdx: prev.setIdx + 1, remaining: prev.seconds, endAt: Date.now() + prev.seconds * 1000 };
    }
    return { ...prev, remaining: 0, running: false };
  };

  useEffect(() => {
    if (!rest || !rest.running) return;
    const id = setInterval(() => { setRest(prev => advanceRestIfDue(prev)); }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest && rest.running, rest && rest.endAt, rest && rest.setIdx]);

  // Si la pantalla se apaga/bloquea, setInterval se ralentiza o se pausa;
  // al volver a primer plano forzamos un recálculo inmediato desde endAt.
  useEffect(() => {
    const recompute = () => setRest(prev => advanceRestIfDue(prev));
    document.addEventListener('visibilitychange', recompute);
    window.addEventListener('focus', recompute);
    return () => {
      document.removeEventListener('visibilitychange', recompute);
      window.removeEventListener('focus', recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRest = (name, seconds, totalSets) => {
    const totalRests = Math.max(1, totalSets - 1);
    setRest({ name, seconds, totalRests, setIdx: 1, remaining: seconds, running: true, endAt: Date.now() + seconds * 1000 });
  };

  const pauseResumeRest = () => {
    setRest(prev => {
      if (!prev) return prev;
      if (prev.running) {
        const remaining = Math.max(0, Math.round((prev.endAt - Date.now()) / 1000));
        return { ...prev, running: false, remaining };
      }
      return { ...prev, running: true, endAt: Date.now() + prev.remaining * 1000 };
    });
  };

  const adjustRest = (delta) => {
    setRest(prev => {
      if (!prev) return prev;
      const remaining = Math.max(0, prev.remaining + delta);
      return { ...prev, remaining, endAt: prev.running ? Date.now() + remaining * 1000 : prev.endAt };
    });
  };

  const skipRest = () => {
    setRest(prev => {
      if (!prev) return prev;
      if (prev.setIdx < prev.totalRests) {
        return { ...prev, setIdx: prev.setIdx + 1, remaining: prev.seconds, endAt: Date.now() + prev.seconds * 1000, running: true };
      }
      return null;
    });
  };

  const closeRest = () => setRest(null);

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
    setRmStore(prev => {
      const next = { ...prev, [name]: { rm, unit, method, date: new Date().toISOString(), detail } };
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
    <div style={{
      minHeight: '100vh', background: '#0f172a', color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif', padding: '16px'
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
        <TrainingTab weekIdx={weekIdx} dayIdx={dayIdx} setDayIdx={saveDay} completed={completed} markDone={markDone} rmStore={rmStore} startRest={startRest} />
      )}
      {section === 'entrenamiento' && sub === 'test' && (
        <TestTab rmStore={rmStore} saveRM={saveRM} mvtStore={mvtStore} saveMVT={saveMVT} clearMVT={clearMVT} lastTestDate={lastTestDate} startNewCycle={startNewCycle} />
      )}
      {section === 'alimentacion' && sub === 'compra' && <ShoppingTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'nutricion' && <NutritionTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'supps' && <SupplementsTab />}

      <RestTimerBar
        rest={rest}
        onPauseResume={pauseResumeRest}
        onAdjust={adjustRest}
        onSkip={skipRest}
        onClose={closeRest}
      />
    </div>
  );
}
