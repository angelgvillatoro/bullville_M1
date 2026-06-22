import { useState } from "react";

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

// ─── DAY DEFINITIONS ─────────────────────────────────────────────────────────
// type: 'non-olympic' | 'olympic' | 'bw' (bodyweight)
const DAYS = [
  {
    name: 'Lunes', label: 'ArmDay', emoji: '💪', nutriDay: 'A',
    exercises: [
      { name: 'Triceps stretches cable pull bar', rm: 35,   unit: 'kg' },
      { name: 'Triceps extension cable pull cord', rm: 30,  unit: 'kg' },
      { name: 'Triceps extension one-armed cable', rm: 10,  unit: 'kg/arm' },
      { name: 'Bicep curls cable pull',            rm: 30,  unit: 'kg' },
      { name: 'Bicep curls sitting dumbbell',      rm: 9,   unit: 'kg/arm' },
      { name: 'Bicep curls hammer grip seated',    rm: 8,   unit: 'kg/arm' },
      { name: 'Seated lateral raises dumbbell',    rm: 6,   unit: 'kg/arm' },
      { name: 'Shoulder press sitting dumbbell',   rm: 15,  unit: 'kg/arm' },
      { name: 'Butterfly reverse cable pull',      rm: 10,  unit: 'kg/arm' },
    ]
  },
  {
    name: 'Martes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',          rm: 105, unit: 'kg',     type: 'olympic', sets: CJ },
      { name: 'Power snatch barbell',           rm: 75,  unit: 'kg',     type: 'olympic', sets: PS },
      { name: 'Latzug breit (lat pulldown)',    rm: 90,  unit: 'kg' },
      { name: 'Bicep curls sitting dumbbell',   rm: 9,   unit: 'kg/arm' },
    ]
  },
  {
    name: 'Miércoles', label: 'Stretch & Pool', emoji: '🏊', nutriDay: 'A',
    special: 'stretch'
  },
  {
    name: 'Jueves', label: 'ChestDay', emoji: '🏋️', nutriDay: 'B',
    exercises: [
      { name: 'Bench press barbell',              rm: 90,   unit: 'kg' },
      { name: 'Bench press inclined barbell',     rm: 72.5, unit: 'kg' },
      { name: 'Flys standing cable pull',         rm: 12.5, unit: 'kg/arm' },
      { name: 'Dips',                             type: 'bw', startReps: 8, maxReps: 15 },
      { name: 'Triceps extension cable pull cord', rm: 30,  unit: 'kg' },
      { name: 'Triceps extension one-armed cable', rm: 10,  unit: 'kg/arm' },
    ]
  },
  {
    name: 'Viernes', label: 'BackDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Clean & jerk barbell',          rm: 105, unit: 'kg',     type: 'olympic', sets: CJ },
      { name: 'Power snatch barbell',           rm: 75,  unit: 'kg',     type: 'olympic', sets: PS },
      { name: 'Latzug breit (lat pulldown)',    rm: 90,  unit: 'kg' },
      { name: 'Bicep curls sitting dumbbell',   rm: 9,   unit: 'kg/arm' },
    ]
  },
  {
    name: 'Sábado', label: 'LegDay', emoji: '🦵', nutriDay: 'B',
    exercises: [
      { name: 'Deadlift barbell',            rm: 120, unit: 'kg',     type: 'olympic', sets: DL },
      { name: 'Squat barbell',               rm: 105, unit: 'kg' },
      { name: 'Leg curl machine',            rm: 80,  unit: 'kg' },
      { name: 'Nordic curl',                 rm: 65,  unit: 'kg' },
      { name: 'Hip thrust machine',          rm: 120, unit: 'kg' },
    ]
  },
  {
    name: 'Domingo', label: 'ChestDay', emoji: '🏋️', nutriDay: 'A',
    exercises: [
      { name: 'Bench press barbell',              rm: 90,   unit: 'kg' },
      { name: 'Bench press inclined barbell',     rm: 72.5, unit: 'kg' },
      { name: 'Flys standing cable pull',         rm: 12.5, unit: 'kg/arm' },
      { name: 'Dips',                             type: 'bw', startReps: 8, maxReps: 15 },
      { name: 'Triceps extension cable pull cord', rm: 30,  unit: 'kg' },
      { name: 'Triceps extension one-armed cable', rm: 10,  unit: 'kg/arm' },
    ]
  },
];

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
    totals: { kcal: '~1.975', protein: '~205g', fat: '~84g', carbs: '~103g' }
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
    totals: { kcal: '~2.030', protein: '~191g', fat: '~97g', carbs: '~98g' }
  }
};

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

// ─── SHOPPING LIST ───────────────────────────────────────────────────────────
// Días A × 5 (Lun/Mar/Mié/Vie/Dom) + Días B × 2 (Jue/Sáb)
// Huevos: 4 uds/día todos los días = 28/semana
// Espinacas + parmesano + semillas: solo días A (tortilla compleja)
// Días B: tortilla simple 4 huevos sin espinacas ni parmesano
const SHOPPING = [
  {
    category: '🥩 Proteínas',
    color: '#EF4444',
    items: [
      { name: 'Pechuga de pollo (cocida)', amount: '1,5 kg', note: '300 g/día × 5 días A' },
      { name: 'Salmón', amount: '500 g', note: '250 g × 2 días B · fresco o congelado' },
      { name: 'Ternera', amount: '440 g', note: '220 g × 2 días B' },
    ]
  },
  {
    category: '🥚 Lácteos y huevos',
    color: '#F59E0B',
    items: [
      { name: 'Arla Skyr 450 g', amount: '7 packs', note: '1 pack/día × 7 días' },
      { name: 'Huevos', amount: '28 uds', note: '4 huevos/día × 7 días (tortilla compleja días A, simple días B)' },
      { name: 'Parmesano', amount: '250 g', note: 'Solo tortilla compleja días A' },
    ]
  },
  {
    category: '🥦 Verduras',
    color: '#22C55E',
    items: [
      { name: 'Brócoli', amount: '1,4 kg', note: '200 g/día × 7 días' },
      { name: 'Espinacas', amount: '700 g', note: 'Solo días A (tortilla compleja)' },
      { name: 'Tomate', amount: '~400 g', note: 'Para sofrito (5 raciones)' },
      { name: 'Pimiento', amount: '~300 g', note: 'Para sofrito' },
      { name: 'Calabacín', amount: '~250 g', note: 'Para sofrito' },
      { name: 'Ajo', amount: '1 cabeza', note: 'Sofrito + tortilla' },
    ]
  },
  {
    category: '🍠 Tubérculos y cereales',
    color: '#8B5CF6',
    items: [
      { name: 'Arroz', amount: '~175 g (seco)', note: '≈ 500 g cocido × 5 días A' },
      { name: 'Boniato', amount: '200 g', note: '100 g × 2 días B' },
      { name: 'Patata', amount: '200 g', note: '100 g × 2 días B' },
    ]
  },
  {
    category: '🍓 Fruta (~2,1 kg/semana · 150g × 2 tomas × 7 días)',
    color: '#EC4899',
    items: [
      { name: '🌸 Fresas',         amount: 'Abr – Jun', note: '32 kcal/100g · bajo IG · vitamina C · mejor fruta del plan' },
      { name: '🌸 Ruibarbo',       amount: 'Abr – May', note: '21 kcal/100g · muy bajo azúcar · suele venderse con fresas' },
      { name: '☀️ Frambuesas',     amount: 'Jun – Ago', note: '52 kcal/100g · alto en fibra · antioxidantes' },
      { name: '☀️ Cerezas',        amount: 'Jun – Jul', note: '63 kcal/100g · antiinflamatorio · melatonina natural' },
      { name: '☀️ Albaricoques',   amount: 'Jun – Jul', note: '48 kcal/100g · beta-caroteno · potasio' },
      { name: '☀️ Grosellas rojas',amount: 'Jun – Jul', note: '56 kcal/100g · vitamina C muy alta · ácidas' },
      { name: '☀️ Arándanos',      amount: 'Jul – Sep', note: '57 kcal/100g · antioxidantes top · bajo IG' },
      { name: '☀️ Melocotón / Nectarina', amount: 'Jul – Sep', note: '39–44 kcal/100g · vitamina C y A · jugosos' },
      { name: '🍂 Ciruelas',       amount: 'Ago – Sep', note: '46 kcal/100g · fibra · hierro · abundantes en CZ' },
      { name: '🍂 Manzana',        amount: 'Sep – Mar', note: '52 kcal/100g · almacenable · opción todo el año' },
      { name: '🍂 Pera',           amount: 'Sep – Nov', note: '57 kcal/100g · fibra · almacenable' },
      { name: '🍂 Uvas',           amount: 'Sep – Oct', note: '67 kcal/100g · resveratrol · más azúcar, cantidad moderada' },
      { name: '🍂 Granada',        amount: 'Oct – Ene', note: '83 kcal/100g · polifenoles · antiinflamatorio' },
      { name: '❄️ Mandarina / Naranja', amount: 'Nov – Mar', note: '47–53 kcal/100g · vitamina C · pico de importación invernal' },
      { name: '❄️ Pomelo',         amount: 'Nov – Mar', note: '42 kcal/100g · bajo IG · nota: interacción con algunos fármacos' },
      { name: '❄️ Kiwi',          amount: 'Nov – Mar', note: '61 kcal/100g · vitamina C altísima · digestión' },
    ],
    note: '🌸 Primavera · ☀️ Verano · 🍂 Otoño · ❄️ Invierno'
  },
  {
    category: '🫙 Despensa',
    color: '#64748b',
    items: [
      { name: 'Semillas de calabaza', amount: '125 g', note: '25 g × 5 días A' },
      { name: 'Aceite de oliva', amount: '~165 ml', note: '25 ml almuerzo × 5 días A + 15 ml almuerzo × 2 días B + 5 ml tortilla × 2 días B' },
    ]
  },
  {
    category: '💊 Suplementos (reposición)',
    color: '#38bdf8',
    items: [
      { name: 'D3+K2 · Natural Elements', amount: '1 comp/semana consumido', note: 'Pack 240 tabs ≈ 8 meses' },
      { name: 'Omega-3 · Natural Elements', amount: '21 cáps/semana', note: 'Pack 365 caps ≈ 17 semanas' },
      { name: 'Magnesio Bisglicinato · Natural Elements', amount: '7 cáps/semana', note: 'Pack 180 caps ≈ 25 semanas' },
      { name: 'Zinc · Natural Elements', amount: '3,5 comp/semana (½/día)', note: 'Pack 365 tabs ≈ 104 semanas' },
    ]
  },
];

// ─── WELLNESS PROTOCOL ───────────────────────────────────────────────────────
const WELLNESS = [
  { day: 'Lun · Mar · Vie', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min' },
  { day: 'Miércoles', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna 3 rondas (10–15min/ronda)' },
  { day: 'Jueves', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna opcional 1 ronda' },
  { day: 'Sábado', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna 3 rondas' },
  { day: 'Domingo', protocol: '🔴 Luz roja 15min · 🧊 Baño frío 5min · 🔥 Sauna 3 rondas · ☀️ UV 10–12min (vitamina D)' },
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

function OlympicTable({ ex, weekIdx }) {
  const sets = ex.sets[weekIdx];
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#f8fafc', fontWeight: 600, fontSize: 14 }}>🏋️ {ex.name}</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>RM: {ex.rm}kg</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            background: '#0f172a', borderRadius: 6, padding: '8px 10px', textAlign: 'center'
          }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>Serie {i+1}</div>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 16 }}>{sets[i*2]}kg</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>×{sets[i*2+1]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NonOlympicRow({ ex, weekIdx }) {
  const p = PROG[weekIdx];
  const weight = wt(ex.rm, p.pct);
  const isArm = ex.unit === 'kg/arm';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6
    }}>
      <div>
        <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 500 }}>{ex.name}</div>
        <div style={{ color: '#64748b', fontSize: 12 }}>RM: {ex.rm} {ex.unit}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 18 }}>
          {weight} {isArm ? 'kg/arm' : 'kg'}
        </div>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>4 × {p.reps} reps</div>
      </div>
    </div>
  );
}

function BWRow({ ex, weekIdx }) {
  const reps = Math.min(ex.startReps + weekIdx, ex.maxReps);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: '#1e293b', borderRadius: 8, marginBottom: 6
    }}>
      <div>
        <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 500 }}>{ex.name}</div>
        <div style={{ color: '#64748b', fontSize: 12 }}>Peso corporal</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 18 }}>BW</div>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>4 × {reps} reps</div>
      </div>
    </div>
  );
}

function DayWorkout({ day, weekIdx }) {
  if (day.special === 'stretch') {
    return (
      <div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14 }}>
          🏊 Pool Recovery 20 min + 🧘 Estiramientos 45–60 s por serie
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
        if (ex.type === 'olympic') return <OlympicTable key={i} ex={ex} weekIdx={weekIdx} />;
        if (ex.type === 'bw') return <BWRow key={i} ex={ex} weekIdx={weekIdx} />;
        return <NonOlympicRow key={i} ex={ex} weekIdx={weekIdx} />;
      })}
    </div>
  );
}

function TrainingTab({ weekIdx, dayIdx, setDayIdx, completed, markDone }) {
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
          <button key={i} onClick={() => saveDay(i)} style={{
            padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600,
            background: i === dayIdx ? '#f8fafc' : '#1e293b',
            color: i === dayIdx ? '#0f172a' : '#94a3b8',
          }}>
            {d.emoji} {d.name}
          </button>
        ))}
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

      <DayWorkout day={day} weekIdx={weekIdx} />

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

function ShoppingTab() {
  const [view, setView]       = useState('semana');
  const [daysA, setDaysA]     = useState(3);
  const [daysB, setDaysB]     = useState(2);
  const [checked, setChecked] = useState({});
  const toggle = k => setChecked(p => ({...p, [k]: !p[k]}));

  const totalDays = daysA + daysB;
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

  function Block({ title, subtitle, items, prefix, accent }) {
    const keys = items.map(i => `${prefix}|${i.name}`);
    const done = keys.filter(k => checked[k]).length;
    const cats = {};
    items.forEach(i => { if (!cats[i.cat]) cats[i.cat]=[]; cats[i.cat].push(i); });
    return (
      <div style={{marginBottom:24}}>
        <div style={{
          background:'#1e293b', borderRadius:10, padding:'12px 16px', marginBottom:14,
          borderLeft:`3px solid ${accent}`
        }}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div>
              <div style={{color:'#f8fafc', fontWeight:700}}>{title}</div>
              <div style={{color:'#64748b', fontSize:12, marginTop:2}}>{subtitle}</div>
            </div>
            <span style={{color: done===items.length ? '#22C55E' : '#94a3b8', fontWeight:600, fontSize:13}}>
              {done}/{items.length} ✓
            </span>
          </div>
        </div>
        {Object.entries(cats).map(([cat, catItems]) =>
          <CatGroup key={cat} catName={cat} items={catItems} prefix={prefix} />
        )}
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

  return (
    <div>
      {/* Sub-tab toggle */}
      <div style={{display:'flex', gap:6, marginBottom:20}}>
        {[['semana','📅 Entre semana'],['custom','⚙️ Personalizado']].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            flex:1, padding:'10px', borderRadius:8, border:'none', cursor:'pointer',
            fontWeight:600, fontSize:13,
            background: view===id ? '#f8fafc' : '#1e293b',
            color: view===id ? '#0f172a' : '#64748b'
          }}>{label}</button>
        ))}
      </div>

      {view === 'semana' && (
        <div>
          <Block title="Lunes · Martes · Miércoles" subtitle="Plan A × 3 días"
            items={scaled(PA, 3)} prefix="lmx" accent="#3B82F6" />
          <Block title="Jueves · Viernes" subtitle="Plan B × 2 días"
            items={scaled(PB, 2)} prefix="jv" accent="#F59E0B" />
          <Suppls />
        </div>
      )}

      {view === 'custom' && (
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
          <Suppls />
        </div>
      )}
    </div>
  );
}

function NutritionTab() {
  const [view, setView] = useState('A');
  const plan = NUTRITION[view];
  return (
    <div>
      {/* Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
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

      {/* Totals */}
      <div style={{
        background: '#0f172a', borderRadius: 10, padding: '14px 16px',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8
      }}>
        {[
          { label: 'Calorías', value: plan.totals.kcal, color: '#f8fafc' },
          { label: 'Proteína', value: plan.totals.protein, color: '#22C55E' },
          { label: 'Grasa',    value: plan.totals.fat,    color: '#F59E0B' },
          { label: 'Carbos',   value: plan.totals.carbs,  color: '#3B82F6' },
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

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// Current week: W10 (Jun 9–15, 2026). Today is Sunday Jun 14 → day index 6
const CURRENT_WEEK = 9;   // 0-indexed = W10
const CURRENT_DAY  = 6;   // 0-indexed = Sunday

export default function App() {
  const [weekIdx, setWeekIdx] = useState(() => {
    try { const s = localStorage.getItem('ta_week'); return s !== null ? Number(s) : CURRENT_WEEK; } catch { return CURRENT_WEEK; }
  });
  const [dayIdx, setDayIdx] = useState(() => {
    try { const s = localStorage.getItem('ta_day'); return s !== null ? Number(s) : CURRENT_DAY; } catch { return CURRENT_DAY; }
  });
  const [tab, setTab] = useState('training');
  const [completed, setCompleted] = useState(() => {
    try { const s = localStorage.getItem('ta_completed'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  const markDone = (weekI, dayI) => {
    const key = `W${weekI+1}-${DAYS[dayI].name}`;
    setCompleted(prev => {
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = new Date().toISOString();
      }
      try { localStorage.setItem('ta_completed', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const saveWeek = (w) => { setWeekIdx(w); try { localStorage.setItem('ta_week', w); } catch {} };
  const saveDay  = (d) => { setDayIdx(d);  try { localStorage.setItem('ta_day',  d); } catch {} };

  const tabs = [
    { id: 'training',  label: '🏋️ Entreno' },
    { id: 'nutrition', label: '🍽 Nutrición' },
    { id: 'supps',     label: '💊 Suplementos' },
    { id: 'shopping',  label: '🛒 Compra' },
  ];

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

      {/* Main tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 13,
            background: tab === t.id ? '#f8fafc' : '#1e293b',
            color: tab === t.id ? '#0f172a' : '#64748b'
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'training'  && <TrainingTab weekIdx={weekIdx} dayIdx={dayIdx} setDayIdx={saveDay} completed={completed} markDone={markDone} />}
      {tab === 'nutrition' && <NutritionTab />}
      {tab === 'supps'     && <SupplementsTab />}
      {tab === 'shopping'  && <ShoppingTab />}
    </div>
  );
}
