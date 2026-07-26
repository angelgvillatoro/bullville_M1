import { useState, useRef } from "react";

// ─── CYCLE DATES ──────────────────────────────────────────────────────────────
// W1 empezó el martes 7 abril 2026. Semana/día por defecto se calculan solos
// a partir de la fecha real, en vez de una constante fija que había que
// recordar actualizar a mano cada semana.
const CYCLE_START = new Date('2026-04-07T00:00:00');
function computeDefaultWeekDay() {
  const today = new Date();
  const diffDays = Math.floor((today - CYCLE_START) / 86400000);
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

// ─── DAY DEFINITIONS ─────────────────────────────────────────────────────────
// type: 'non-olympic' | 'olympic' | 'bw' (bodyweight)
// testMethod: 'video' (velocidad + regresión carga-velocidad) · 'ladder' (registro
// directo del peso máximo con técnica limpia) · 'repmax' (test de reps + fórmula,
// para ejercicios de mancuerna con pesos disponibles discretos)
const DAYS = [
  {
    name: 'Lunes', label: 'ArmDay', emoji: '💪', nutriDay: 'A',
    exercises: [
      { name: 'Triceps stretches cable pull bar',  rm: 35, unit: 'kg',     testMethod: 'ladder' },
      { name: 'Triceps extension cable pull cord', rm: 30, unit: 'kg',     testMethod: 'ladder' },
      { name: 'Triceps extension one-armed cable', rm: 10, unit: 'kg/arm', testMethod: 'ladder' },
      { name: 'Bicep curls cable pull',            rm: 30, unit: 'kg',     testMethod: 'ladder' },
      { name: 'Bicep curls sitting dumbbell',      rm: 9,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Bicep curls hammer grip seated',    rm: 8,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Seated lateral raises dumbbell',    rm: 6,  unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Shoulder press sitting dumbbell',   rm: 15, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Butterfly reverse cable pull',      rm: 10, unit: 'kg/arm', testMethod: 'ladder' },
    ]
  },
  {
    name: 'Martes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 105, unit: 'kg', type: 'olympic', sets: CJ, testMethod: 'ladder' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS, testMethod: 'ladder' },
      { name: 'Latzug breit (lat pulldown)', rm: 90,  unit: 'kg', testMethod: 'ladder' },
      { name: 'Bicep curls sitting dumbbell',rm: 9,   unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Bicep curls hammer grip seated', rm: 8, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
    ]
  },
  {
    name: 'Miércoles', label: 'Stretch & Pool', emoji: '🏊', nutriDay: 'A',
    special: 'stretch'
  },
  {
    name: 'Jueves', label: 'ChestDay', emoji: '🏋️', nutriDay: 'B',
    exercises: [
      { name: 'Bench press barbell',               rm: 90,   unit: 'kg', testMethod: 'video', rom: 40, mvt: 0.17 },
      { name: 'Bench press inclined barbell',      rm: 72.5, unit: 'kg', testMethod: 'ladder' },
      { name: 'Flys standing cable pull',          rm: 12.5, unit: 'kg/arm', testMethod: 'ladder' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS },
      { name: 'Triceps extension cable pull cord', rm: 30,   unit: 'kg', testMethod: 'ladder' },
      { name: 'Triceps extension one-armed cable', rm: 10,   unit: 'kg/arm', testMethod: 'ladder' },
    ]
  },
  {
    name: 'Viernes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',        rm: 105, unit: 'kg', type: 'olympic', sets: CJ, testMethod: 'ladder' },
      { name: 'Power snatch barbell',        rm: 75,  unit: 'kg', type: 'olympic', sets: PS, testMethod: 'ladder' },
      { name: 'Latzug breit (lat pulldown)', rm: 90,  unit: 'kg', testMethod: 'ladder' },
      { name: 'Bicep curls sitting dumbbell',rm: 9,   unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
      { name: 'Bicep curls hammer grip seated', rm: 8, unit: 'kg/arm', testMethod: 'repmax', dumbbell: true },
    ]
  },
  {
    name: 'Sábado', label: 'LegDay', emoji: '🦵', nutriDay: 'B',
    exercises: [
      { name: 'Deadlift barbell',   rm: 120, unit: 'kg', type: 'olympic', sets: DL, testMethod: 'ladder' },
      { name: 'Squat barbell',      rm: 105, unit: 'kg', testMethod: 'video', rom: 50, mvt: 0.30 },
      { name: 'Leg curl machine',   rm: 80,  unit: 'kg', testMethod: 'ladder' },
      { name: 'Nordic curl',        rm: 65,  unit: 'kg', testMethod: 'ladder' },
      { name: 'Hip thrust machine', rm: 120, unit: 'kg', testMethod: 'ladder' },
    ]
  },
  {
    name: 'Domingo', label: 'ChestDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Bench press barbell',               rm: 90,   unit: 'kg', testMethod: 'video', rom: 40, mvt: 0.17 },
      { name: 'Bench press inclined barbell',      rm: 72.5, unit: 'kg', testMethod: 'ladder' },
      { name: 'Flys standing cable pull',          rm: 12.5, unit: 'kg/arm', testMethod: 'ladder' },
      { name: 'Dips',                              type: 'bw', repsByPhase: DIPS_REPS },
      { name: 'Triceps extension cable pull cord', rm: 30,   unit: 'kg', testMethod: 'ladder' },
      { name: 'Triceps extension one-armed cable', rm: 10,   unit: 'kg/arm', testMethod: 'ladder' },
    ]
  },
];

// Días de test (semana 16) — Miércoles, Viernes y Domingo quedan como descanso
// porque repiten ejercicios ya cubiertos en Lunes/Martes/Jueves/Sábado.
const TEST_DAY_NAMES = ['Lunes', 'Martes', 'Jueves', 'Sábado'];
function buildTestPlan() {
  const seen = new Set();
  const byDay = {};
  TEST_DAY_NAMES.forEach(dayName => {
    const day = DAYS.find(d => d.name === dayName);
    const list = [];
    (day.exercises || []).forEach(ex => {
      if (ex.type === 'bw') return;      // ej. Dips — ya progresa por reps, sin test
      if (seen.has(ex.name)) return;      // evita testear dos veces el mismo ejercicio
      seen.add(ex.name);
      list.push(ex);
    });
    byDay[dayName] = list;
  });
  return byDay;
}

// ─── WEDNESDAY STRETCHES ─────────────────────────────────────────────────────
const STRETCHES = [
  { name: 'Pool walking',             duration: '10 min' },
  { name: 'Float & decompress',       duration: '5 min' },
  { name: 'Arm circles in water',     duration: '5 min' },
  { name: 'Glutes stretch seated',    duration: '4 × 45–60 s' },
  { name: 'Adductors stretch standing', duration: '4 × 45–60 s' },
  { name: 'Leg flexor stretch sitting', duration: '3 × 45–60 s' },
  { name: 'Leg stretch standing',     duration: '4 × 45–60 s' },
  { name: 'Hip flexor stretch lunge', duration: '4 × 45–60 s' },
  { name: 'Trapezius stretch sideways', duration: '4 × 45–60 s' },
  { name: 'Torso rotation stretch',   duration: '4 × 45–60 s' },
  { name: 'Torso side bending',       duration: '4 × 45–60 s' },
  { name: 'Shoulder cross-body',      duration: '4 × 45–60 s' },
  { name: 'Quadriceps stretch standing', duration: '4 × 45–60 s' },
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

function OlympicTable({ ex, weekIdx, rmStore }) {
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
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6
    }}>
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
  );
}

function BWRow({ ex, weekIdx }) {
  const phase = PROG[weekIdx].phase;
  const reps = ex.repsByPhase[phase];
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#f8fafc', fontSize: 14, fontWeight: 500 }}>{ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>Peso corporal</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {reps.map((r, i) => (
          <div key={i} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>Serie {i+1}</div>
            <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 16 }}>{r}</div>
          </div>
        ))}
      </div>
      <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>
        Objetivo por serie, no un número plano — respeta la caída de fatiga real entre series.
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
        {STRETCHES.map((s, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6
          }}>
            <span style={{ color: '#f8fafc', fontSize: 14 }}>{s.name}</span>
            <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 500 }}>{s.duration}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {day.exercises.map((ex, i) => {
        if (ex.type === 'olympic') return <OlympicTable key={i} ex={ex} weekIdx={weekIdx} rmStore={rmStore} />;
        if (ex.type === 'bw') return <BWRow key={i} ex={ex} weekIdx={weekIdx} />;
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
const CONDITIONING = {
  'Lunes':   { label: '🚲 Assault bike — intervalos',    detail: '8–10 × (20s esfuerzo máximo / 100s suave) · ~15min total · post-entreno de brazo' },
  'Jueves':  { label: '🚲 Assault bike — zona 2',         detail: '20–25min ritmo continuo moderado' },
  'Domingo': { label: '🚲 Assault bike — zona 2 suave',   detail: '15–20min suave · pierna descargada tras el sábado' },
};

// ─── TEST TAB (Semana 16) ─────────────────────────────────────────────────────

function VideoTestCard({ ex, rmStore, saveRM }) {
  const [rom, setRom] = useState(ex.rom);
  const [mvt, setMvt] = useState(ex.mvt);
  const [videoUrl, setVideoUrl] = useState(null);
  const [load, setLoad] = useState('');
  const [startT, setStartT] = useState(null);
  const [endT, setEndT] = useState(null);
  const [points, setPoints] = useState([]);
  const videoRef = useRef(null);

  const duration = (startT != null && endT != null) ? (endT - startT) : null;
  const velocity = (duration && duration > 0) ? (rom / 100) / duration : null;

  function addPoint() {
    if (!load || !velocity) return;
    setPoints(p => [...p, { load: Number(load), v: Number(velocity.toFixed(3)) }]);
    setStartT(null); setEndT(null); setLoad('');
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
  const estRM = (fit && fit.b !== 0) ? (mvt - fit.a) / fit.b : null;

  const current = rmStore[ex.name];

  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🎥 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {effectiveRM(ex, rmStore)}kg</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
        Vídeo semi-manual: marca inicio/fin de la fase concéntrica y calculamos la velocidad con el ROM que indiques. Con ≥3 series se ajusta la recta carga-velocidad y se extrapola el RM a la velocidad mínima (MVT).
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          ROM concéntrico (cm)
          <input type="number" value={rom} onChange={e => setRom(Number(e.target.value))}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        </label>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          MVT (m/s)
          <input type="number" step="0.01" value={mvt} onChange={e => setMvt(Number(e.target.value))}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        </label>
      </div>

      <input type="file" accept="video/*" onChange={e => {
        const f = e.target.files[0];
        if (f) setVideoUrl(URL.createObjectURL(f));
      }} style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }} />

      {videoUrl && (
        <video ref={videoRef} src={videoUrl} controls style={{ width: '100%', borderRadius: 8, marginBottom: 8 }} />
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={() => videoRef.current && setStartT(videoRef.current.currentTime)}
          disabled={!videoUrl}
          style={{ padding: '8px 12px', borderRadius: 6, border: 'none', cursor: videoUrl ? 'pointer' : 'default',
            background: '#334155', color: '#f8fafc', fontSize: 13 }}>Marcar inicio</button>
        <button onClick={() => videoRef.current && setEndT(videoRef.current.currentTime)}
          disabled={!videoUrl}
          style={{ padding: '8px 12px', borderRadius: 6, border: 'none', cursor: videoUrl ? 'pointer' : 'default',
            background: '#334155', color: '#f8fafc', fontSize: 13 }}>Marcar fin</button>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          {duration != null ? `Duración: ${duration.toFixed(2)}s` : 'Sin marcar'}
          {velocity != null && ` · v = ${velocity.toFixed(3)} m/s`}
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
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 12, padding: '4px 0' }}>
              <span>{p.load}kg · {p.v} m/s</span>
              <span onClick={() => removePoint(i)} style={{ cursor: 'pointer', color: '#EF4444' }}>eliminar</span>
            </div>
          ))}
        </div>
      )}

      {estRM && (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
          <span style={{ color: '#22C55E', fontWeight: 700, fontSize: 16 }}>RM estimado: {estRM.toFixed(1)} kg</span>
        </div>
      )}
      {points.length > 0 && points.length < 3 && (
        <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 10 }}>Añade al menos 3 series para ajustar la recta.</div>
      )}

      <button
        disabled={!estRM}
        onClick={() => saveRM(ex.name, Math.round(estRM * 2) / 2, ex.unit, 'video', { points, rom, mvt })}
        style={{
          width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: estRM ? 'pointer' : 'default',
          background: estRM ? '#14532d' : '#1e293b', color: estRM ? '#86efac' : '#475569', fontWeight: 700, fontSize: 13
        }}>
        {current ? `✓ Guardado (${current.rm}kg) — actualizar` : 'Guardar como nuevo RM'}
      </button>
    </div>
  );
}

function LadderTestCard({ ex, rmStore, saveRM }) {
  const [value, setValue] = useState('');
  const current = rmStore[ex.name];
  const baseRM = effectiveRM(ex, rmStore);
  const ladder = [0.60,0.70,0.80,0.90,0.95,1.00,1.05].map(pct => Math.round(baseRM*pct/2.5)*2.5);
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>📋 {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {baseRM}{ex.unit === 'kg/arm' ? ' kg/arm' : ' kg'}</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        Escalera de referencia (60→105% del RM actual): {ladder.join(' · ')} kg. Sube de carga hasta que la técnica se rompa y anota abajo el peso más alto conseguido limpio.
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
    </div>
  );
}

function RepMaxTestCard({ ex, rmStore, saveRM }) {
  const [weight, setWeight] = useState(DUMBBELL_WEIGHTS[0]);
  const [reps, setReps] = useState('');
  const current = rmStore[ex.name];
  const est = reps ? epley1RM(weight, Number(reps)) : null;
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>🏋️‍♂️ {ex.name}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>RM actual: {effectiveRM(ex, rmStore)} kg/arm</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        Ejercicio de mancuerna — pesos discretos, no tiene sentido un 1RM real. Haz el máximo de reps limpias con la mancuerna más pesada que controles y estimamos el RM con la fórmula de Epley.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          Mancuerna (kg)
          <select value={weight} onChange={e => setWeight(Number(e.target.value))}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }}>
            {DUMBBELL_WEIGHTS.map(w => <option key={w} value={w}>{w}kg</option>)}
          </select>
        </label>
        <label style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
          Reps limpias
          <input type="number" value={reps} onChange={e => setReps(e.target.value)}
            style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#f8fafc' }} />
        </label>
      </div>
      {est && <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>RM estimado: {est.toFixed(1)} kg/arm</div>}
      <button
        disabled={!est}
        onClick={() => saveRM(ex.name, Math.round(est*2)/2, ex.unit, 'repmax', { weight, reps })}
        style={{
          width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: est ? 'pointer' : 'default',
          background: est ? '#14532d' : '#1e293b', color: est ? '#86efac' : '#475569', fontWeight: 700, fontSize: 13
        }}>
        {current ? `✓ Guardado (${current.rm}kg/arm) — actualizar` : 'Guardar como nuevo RM'}
      </button>
    </div>
  );
}

function TestTab({ rmStore, saveRM }) {
  const plan = buildTestPlan();
  return (
    <div>
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: 4 }}>Test Semana 16</div>
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          Descanso completo Miércoles, Viernes y Domingo (repiten ejercicios ya testeados). 3 métodos según el ejercicio: vídeo con velocidad (sentadilla, press banca), registro directo de la escalera (olímpicos, peso muerto y accesorios de barra/cable), y test de reps con fórmula (ejercicios de mancuerna).
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
            if (ex.testMethod === 'video')  return <VideoTestCard  key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} />;
            if (ex.testMethod === 'repmax') return <RepMaxTestCard key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} />;
            return <LadderTestCard key={i} ex={ex} rmStore={rmStore} saveRM={saveRM} />;
          })}
        </div>
      ))}
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
    setRmStore(prev => {
      const next = { ...prev, [name]: { rm, unit, method, date: new Date().toISOString(), detail } };
      persistRM(next);
      return next;
    });
  };

  const saveWeek = (w) => { setWeekIdx(w); try { localStorage.setItem('ta_week', w); } catch {} };
  const saveDay  = (d) => { setDayIdx(d);  try { localStorage.setItem('ta_day',  d); } catch {} };

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
        <TrainingTab weekIdx={weekIdx} dayIdx={dayIdx} setDayIdx={saveDay} completed={completed} markDone={markDone} rmStore={rmStore} />
      )}
      {section === 'entrenamiento' && sub === 'test' && (
        <TestTab rmStore={rmStore} saveRM={saveRM} />
      )}
      {section === 'alimentacion' && sub === 'compra' && <ShoppingTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'nutricion' && <NutritionTab weekIdx={weekIdx} />}
      {section === 'alimentacion' && sub === 'supps' && <SupplementsTab />}
    </div>
  );
}
