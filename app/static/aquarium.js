/* ===== Aero Reef · acuario de arrecife =====
   Todo el acuario se dibuja en un <canvas> con un bucle de animación:
   1) update() mueve peces, comida y burbujas
   2) draw() pinta el agua, el arrecife, los peces y la luz
   Se repite ~60 veces por segundo con requestAnimationFrame.

   Para que se vea realista:
   - Las partes que no se mueven (agua de fondo, arena, rocas y corales) se pintan una sola vez
     en lienzos auxiliares ("capas") y luego se copian en cada fotograma: es mucho más rápido.
   - Cada pez tiene una profundidad z: los del fondo son más pequeños y quedan tras una capa de
     agua; los de delante se ven grandes y nítidos.
   - El cuerpo del pez se dibuja como una silueta que ondula de la cabeza a la cola al nadar.
   - De noche, la luz azul hace que los corales brillen (fluorescencia), como en un acuario real. */

const canvas = document.getElementById('tank');
const ctx = canvas.getContext('2d');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // accesibilidad
let W = 0, H = 0;     // tamaño del canvas en píxeles CSS
let SCALE = 1;        // escala general según el ancho del acuario
const MAX_FISH = 40;  // debe coincidir con MAX_FISH en app/main.py

// Calidad adaptativa: si el equipo va lento (por ejemplo, una máquina virtual sin aceleración
// gráfica), se desactivan los efectos más costosos (rayos de luz, cáusticas, detalles de las aletas)
// y el canvas se dibuja a menor resolución.
let lowQuality = false, slowTime = 0;
const pixelRatio = () => (window.devicePixelRatio || 1) * (lowQuality ? 0.65 : 1);

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;
const floorY = () => H * 0.82;  // donde empieza la arena
const reefY = () => H * 0.93;   // base de las rocas (delante queda una franja de arena)

// Números aleatorios "con semilla": el arrecife sale igual cada vez que se redibuja
function seeded(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- 1. DATOS: especies con su ficha y su aspecto ----------
   IMPORTANTE: el orden de esta lista es el número de especie que se guarda en la base de datos.
   Si añades especies, ponlas al final y actualiza SPECIES_COUNT en app/main.py.
   Aspecto: len = largo en px, alto = alto/largo, snout = forma del hocico (más alto = más
   puntiagudo), hump = dónde es más alto el cuerpo, top/body/belly = colores del lomo, flanco y
   vientre (sombreado natural), fin = color de las aletas, cola = forma de la aleta caudal. */
const SPECIES = [
  { nombre: 'Pez payaso', cientifico: 'Amphiprion ocellaris', tam: '8-11 cm',
    habitat: 'Arrecifes de coral del Indo-Pacífico', dieta: 'Omnívoro',
    dato: 'Vive entre los tentáculos de las anémonas, que lo protegen sin picarle.',
    len: 44, alto: 0.46, snout: 0.55, top: '#c94a06', body: '#f26b12', belly: '#f8a25a',
    fin: 'rgba(240,110,20,.9)', finEdge: '#111', iris: '#e8a33a', patron: 'payaso',
    cola: 'redonda', colaLen: 0.26, dorsal: 0.32, anal: 0.24, color: '#f26b12',
    nombres: ['Nemo', 'Coral', 'Mango', 'Ámbar'] },
  { nombre: 'Pez cirujano azul', cientifico: 'Paracanthurus hepatus', tam: '25-30 cm',
    habitat: 'Arrecifes del Indo-Pacífico', dieta: 'Algas y plancton',
    dato: 'Tiene una espina afilada junto a la cola, como un bisturí, de ahí su nombre.',
    len: 62, alto: 0.56, snout: 0.5, top: '#123f9e', body: '#1f63d8', belly: '#4b8de6',
    fin: 'rgba(25,70,170,.9)', finEdge: '#06123a', iris: '#2a2a2a', patron: 'cirujano',
    cola: 'recta', colaColor: '#f5c814', colaLen: 0.24, dorsal: 0.2, anal: 0.16, color: '#1f63d8',
    nombres: ['Dory', 'Azulón', 'Marina', 'Índigo'] },
  { nombre: 'Pez ángel emperador', cientifico: 'Pomacanthus imperator', tam: '30-40 cm',
    habitat: 'Arrecifes del Indo-Pacífico y el mar Rojo', dieta: 'Esponjas y algas',
    dato: 'De joven es azul oscuro con anillos blancos; de adulto cambia por completo a rayas amarillas y azules.',
    len: 64, alto: 0.62, snout: 0.5, hump: 0.44, top: '#101d68', body: '#1c3bb5', belly: '#2f5bd2',
    fin: 'rgba(28,58,170,.92)', iris: '#1a1a1a', patron: 'emperador',
    cola: 'redonda', colaColor: '#ffcf2e', colaLen: 0.22, dorsal: 0.24, anal: 0.2, color: '#ffcf2e',
    nombres: ['Zafiro', 'Emperador', 'Rayos'] },
  { nombre: 'Cromis verde', cientifico: 'Chromis viridis', tam: '7-10 cm',
    habitat: 'Arrecifes del Indo-Pacífico', dieta: 'Plancton',
    dato: 'Nada en grupo sobre los corales ramificados y se esconde entre ellos al detectar peligro.',
    len: 26, alto: 0.45, snout: 0.55, top: '#3a9cb0', body: '#73d6d8', belly: '#c3f3ea',
    fin: 'rgba(150,235,235,.45)', iris: '#d8f0f0', patron: 'cromis', banco: true,
    cola: 'horquilla', colaLen: 0.32, dorsal: 0.25, anal: 0.2, color: '#5fd0d4',
    nombres: ['Turquesa', 'Brisa', 'Ola', 'Menta', 'Celeste', 'Aguamar', 'Nube'] },
  { nombre: 'Pez globo', cientifico: 'Arothron nigropunctatus', tam: '25-30 cm',
    habitat: 'Arrecifes del Indo-Pacífico', dieta: 'Corales, esponjas y crustáceos',
    dato: 'Cuando se siente amenazado se infla con agua para parecer más grande. Tócalo y verás.',
    len: 46, alto: 0.62, snout: 0.38, hump: 0.4, top: '#6c6f74', body: '#a8aaa7', belly: '#ede2b0',
    fin: 'rgba(195,195,185,.5)', iris: '#2b6f66', patron: 'globo',
    cola: 'redonda', colaLen: 0.2, dorsal: 0.18, anal: 0.16, color: '#a8aaa7',
    nombres: ['Bola', 'Pompón', 'Globito', 'Burbuja'] },
  { nombre: 'Pez león', cientifico: 'Pterois volitans', tam: '30-38 cm',
    habitat: 'Arrecifes del Indo-Pacífico', dieta: 'Peces pequeños y crustáceos',
    dato: 'Sus espinas largas y vistosas son venenosas: avisan a los depredadores de que no se acerquen.',
    len: 64, alto: 0.4, snout: 0.55, top: '#6e1d12', body: '#bf5038', belly: '#f3e2d6',
    fin: 'rgba(245,220,205,.35)', iris: '#c82a1a', patron: 'leon',
    cola: 'redonda', colaLen: 0.22, dorsal: 0.3, anal: 0.25, color: '#bf5038',
    nombres: ['Melena', 'Abanico', 'Tigre'] },
  { nombre: 'Ídolo moro', cientifico: 'Zanclus cornutus', tam: '15-23 cm',
    habitat: 'Arrecifes del Indo-Pacífico', dieta: 'Esponjas y pequeños invertebrados',
    dato: 'Su aleta dorsal termina en un largo filamento que puede medir más que su propio cuerpo.',
    len: 50, alto: 0.88, snout: 0.78, hump: 0.45, top: '#e8d68a', body: '#f7f0d2', belly: '#fcf9ec',
    fin: 'rgba(250,250,245,.8)', iris: '#222', patron: 'idolo',
    cola: 'recta', colaColor: '#161616', colaLen: 0.22, dorsal: 1.0, anal: 0.85, color: '#f0d36a',
    nombres: ['Moro', 'Bandera', 'Látigo'] },
  { nombre: 'Anthias dorado', cientifico: 'Pseudanthias squamipinnis', tam: '10-15 cm',
    habitat: 'Arrecifes del Indo-Pacífico y el mar Rojo', dieta: 'Plancton',
    dato: 'Viven en grupos con un solo macho; si este desaparece, una hembra se transforma en macho.',
    len: 30, alto: 0.4, snout: 0.6, top: '#e0502c', body: '#ff8a52', belly: '#ffc895',
    fin: 'rgba(255,150,90,.65)', iris: '#c33', patron: 'anthias', banco: true,
    cola: 'lira', colaLen: 0.36, dorsal: 0.3, anal: 0.22, color: '#ff8a52',
    nombres: ['Coralina', 'Mandarina', 'Ascua', 'Salmón', 'Aurora', 'Llama'] },
  { nombre: 'Cirujano amarillo', cientifico: 'Zebrasoma flavescens', tam: '18-20 cm',
    habitat: 'Arrecifes de Hawái y del Pacífico', dieta: 'Algas',
    dato: 'De noche pierde parte de su color y le aparece una franja blanca en el costado.',
    len: 54, alto: 0.74, snout: 0.72, hump: 0.42, top: '#e2b300', body: '#ffd60a', belly: '#ffe86a',
    fin: 'rgba(255,212,10,.93)', iris: '#222', patron: 'amarillo',
    cola: 'recta', colaLen: 0.22, dorsal: 0.6, anal: 0.55, color: '#ffd60a',
    nombres: ['Limón', 'Sol', 'Canario'] },
  { nombre: 'Pez mariposa', cientifico: 'Chaetodon auriga', tam: '20-23 cm',
    habitat: 'Arrecifes del Indo-Pacífico y el mar Rojo', dieta: 'Pólipos de coral y gusanos',
    dato: 'Una franja negra le oculta el ojo y la mancha de la aleta dorsal hace de ojo falso para despistar.',
    len: 48, alto: 0.74, snout: 0.8, hump: 0.45, top: '#d6d2ca', body: '#f4f2ee', belly: '#fbfaf7',
    fin: 'rgba(255,212,40,.92)', iris: '#222', patron: 'mariposa',
    cola: 'redonda', colaColor: '#ffd228', colaLen: 0.2, dorsal: 0.36, anal: 0.3, color: '#ffd228',
    nombres: ['Pétalo', 'Hilo', 'Mariposa'] }
];

// Anémonas (posición como fracción del ancho): los peces payaso vuelven a ellas
const ANEMONES = [{ x: 0.405, seed: 1, hue: 'rosa' }, { x: 0.775, seed: 2, hue: 'naranja' }];

/* ---------- 2. ESTADO del acuario ---------- */
let fishes = [];      // peces vivos
let foods = [];       // trocitos de comida
let bubbles = [];     // burbujas
let selected = null;  // pez seleccionado (para la ficha)
let t = 0;            // tiempo total en segundos

// Luz: 1 = día, 0 = noche. lightMode decide cómo cambia.
const DAY_LENGTH = 120;      // en modo automático, un día completo dura 2 minutos
let lightMode = 'auto';      // 'auto', 'dia' o 'noche'
let light = 1;

// Capas estáticas y texturas (se crean en resize)
let bgLayer = null, reefLayer = null, fluoLayer = null, frameLayer = null;
let causticPattern = null, scalePattern = null;
let sandEdge = [];           // contorno superior de la arena, para recortar las cáusticas

/* ---------- 3. CAPAS ESTÁTICAS: se pintan una vez por cada cambio de tamaño ---------- */
function makeLayer() {
  const c = document.createElement('canvas');
  const dpr = pixelRatio();
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [c, g];
}

// Fondo: agua muy luminosa iluminada desde arriba y un arrecife lejano difuminado
function buildBackground() {
  const [c, g] = makeLayer();
  const water = g.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, '#7fe3ff'); water.addColorStop(0.18, '#36b6f2');
  water.addColorStop(0.55, '#1279de'); water.addColorStop(1, '#0a3f9e');
  g.fillStyle = water; g.fillRect(0, 0, W, H);

  // Arrecife lejano: dos capas de siluetas, más borrosas y azuladas cuanto más lejos
  const r = seeded(42);
  [[9, 'rgba(18,90,190,.55)', 0.2], [4, 'rgba(14,70,160,.6)', 0.12]].forEach(([blur, col, hgt], layer) => {
    g.save();
    g.filter = `blur(${Math.round(blur * SCALE)}px)`;
    g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 20) {
      g.lineTo(x, floorY() - H * hgt * (0.5 + 0.5 * Math.sin(x * 0.013 + layer * 2) * Math.sin(x * 0.004 + 1)) - r() * 8);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
    for (let i = 0; i < 14; i++) { // ramas de coral y gorgonias lejanas
      const x = r() * W, y = floorY() - H * hgt * 0.6, h = H * (0.08 + r() * 0.14);
      g.lineWidth = (2 + r() * 3) * SCALE;
      for (let k = -2; k <= 2; k++) {
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + k * 6, y - h * 0.6, x + k * 14 * SCALE, y - h * (1 - Math.abs(k) * 0.12)); g.stroke();
      }
    }
    g.restore();
  });
  return c;
}

// Contorno de una roca viva: suma de ondas lentas para que sea irregular pero suave
function moundTop(m, x) {
  const u = (x - m.x0) / (m.x1 - m.x0);
  if (u <= 0 || u >= 1) return reefY();
  const shape = Math.pow(Math.sin(u * Math.PI), 0.7);
  const bumps = 1 + 0.12 * Math.sin(u * 13 + m.seed) + 0.07 * Math.sin(u * 29 + m.seed * 2);
  return reefY() - m.h * H * shape * bumps;
}

// Arena, rocas vivas y corales. En "f" (capa de fluorescencia) se pinta lo que brilla de noche.
function buildReef() {
  const [c, g] = makeLayer();
  const [fc, f] = makeLayer();
  const fy = floorY(), S = SCALE;

  // Arena blanca de coral, con grano y onditas
  const r = seeded(7);
  sandEdge = [];
  for (let x = 0; x <= W + 8; x += 8) sandEdge.push([x, fy + Math.sin(x * 0.012) * 5 * S + Math.sin(x * 0.041) * 2]);
  g.beginPath(); g.moveTo(0, H); sandEdge.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(W, H); g.closePath();
  const sand = g.createLinearGradient(0, fy, 0, H);
  sand.addColorStop(0, '#d9e6ea'); sand.addColorStop(0.5, '#efe8d6'); sand.addColorStop(1, '#d8c9a6');
  g.fillStyle = sand; g.fill();
  g.save(); g.clip();
  for (let i = 0; i < W * (H - fy) * 0.05; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(120,100,70,${0.1 + r() * 0.18})` : `rgba(255,255,250,${0.3 + r() * 0.4})`;
    g.fillRect(r() * W, fy - 8 + r() * (H - fy + 8), (0.6 + r() * 1.2) * S, (0.6 + r() * 1.2) * S);
  }
  g.strokeStyle = 'rgba(150,130,100,.18)'; g.lineWidth = 1.2 * S;
  for (let i = 0; i < 9; i++) { // marcas de las corrientes en la arena
    const y = fy + 12 * S + i * (H - fy) / 9;
    g.beginPath();
    for (let x = 0; x <= W; x += 10) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2 * S);
    g.stroke();
  }
  g.restore();

  const mounds = [
    { x0: -0.04 * W, x1: 0.37 * W, h: 0.27, seed: 1 },
    { x0: 0.46 * W, x1: 0.84 * W, h: 0.33, seed: 2 },
    { x0: 0.83 * W, x1: 1.05 * W, h: 0.19, seed: 3 }
  ];
  const on = (m, fx) => [fx * W, moundTop(m, fx * W)];   // punto sobre la roca

  // Gorgonias (abanicos de mar): van detrás de las rocas
  seaFan(g, seeded(11), ...on(mounds[0], 0.21), 120 * S, '#9a3fb8');
  seaFan(g, seeded(12), ...on(mounds[1], 0.68), 140 * S, '#e0602a');
  seaFan(g, seeded(13), ...on(mounds[2], 0.95), 80 * S, '#c73a7a');

  mounds.forEach(m => liveRock(g, seeded(20 + m.seed), m));
  mounds.forEach(m => coverRock(g, f, seeded(70 + m.seed), m)); // la roca queda cubierta de vida

  // Corales sobre las rocas
  staghorn(g, f, seeded(31), ...on(mounds[0], 0.05), 70 * S, '#e889b8', '#ffd0ea');
  brainCoral(g, f, seeded(32), ...on(mounds[0], 0.12), 34 * S, '#c8b26a', '#7e6a2e');
  tubeSponge(g, seeded(33), ...on(mounds[0], 0.27), 18 * S, '#f2c22a', '#9c6a06');
  mushrooms(g, f, seeded(34), ...on(mounds[0], 0.17), 4, '#3fae6a');
  zoanthids(g, f, seeded(35), ...on(mounds[0], 0.31), '#ff9a3a', '#5fe07a');

  staghorn(g, f, seeded(41), ...on(mounds[1], 0.53), 84 * S, '#6fa0e8', '#b8f0ff');
  brainCoral(g, f, seeded(42), ...on(mounds[1], 0.61), 44 * S, '#8fb66a', '#4d6a2a');
  plateCoral(g, seeded(43), ...on(mounds[1], 0.715), 52 * S, '#b88a6c');
  zoanthids(g, f, seeded(44), ...on(mounds[1], 0.565), '#ff5fa8', '#7cf0ff');
  mushrooms(g, f, seeded(45), ...on(mounds[1], 0.745), 5, '#d0643a');
  staghorn(g, f, seeded(46), ...on(mounds[1], 0.665), 48 * S, '#f3b33c', '#fff1b0');

  tubeSponge(g, seeded(51), ...on(mounds[2], 0.9), 15 * S, '#a85ad8', '#4c1c74');
  staghorn(g, f, seeded(52), ...on(mounds[2], 0.975), 52 * S, '#f07a6a', '#ffd6cc');

  // Algas verdes y piedrecitas sobre la arena
  [[0.035, 1], [0.44, 2], [0.86, 3]].forEach(([x, s]) => algae(g, seeded(60 + s), x * W, reefY() + 8 * S));
  for (let i = 0; i < 26; i++) { // conchas y trocitos de coral en primer plano
    const x = r() * W, y = reefY() + r() * (H - reefY()), w = (2 + r() * 4) * S;
    g.fillStyle = r() < 0.5 ? '#f6f1e6' : '#e7c9b8';
    g.beginPath(); g.ellipse(x, y, w, w * 0.55, r() * 3, 0, TAU); g.fill();
  }

  // Tinte azul: el agua tiñe todo de azul, más cuanto más abajo (solo donde ya hay dibujo)
  g.globalCompositeOperation = 'source-atop';
  const tint = g.createLinearGradient(0, H * 0.4, 0, H);
  tint.addColorStop(0, 'rgba(30,110,230,.32)'); tint.addColorStop(1, 'rgba(20,70,190,.12)');
  g.fillStyle = tint; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  // Fluorescencia con halo: la capa se difumina una sola vez y se suma a sí misma nítida
  const [gc, gl] = makeLayer();
  gl.filter = `blur(${Math.round(3 * S)}px)`; gl.drawImage(fc, 0, 0, W, H);
  gl.filter = 'none'; gl.globalAlpha = 0.7; gl.drawImage(fc, 0, 0, W, H);
  return [c, gc];
}

// Roca viva: masa irregular con poros, grietas, relieve y costras de alga coralina
function liveRock(g, r, m) {
  const S = SCALE, pts = [], span = m.x1 - m.x0;
  for (let x = m.x0; x <= m.x1 + 1; x += 6) pts.push([x, moundTop(m, x)]);
  g.beginPath(); g.moveTo(m.x0, reefY() + 6 * S);
  pts.forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(m.x1, reefY() + 6 * S); g.closePath();
  const grad = g.createLinearGradient(0, reefY() - m.h * H, 0, reefY());
  grad.addColorStop(0, '#b3a39c'); grad.addColorStop(0.45, '#887683'); grad.addColorStop(1, '#4a3f52');
  g.fillStyle = grad; g.fill();
  g.save(); g.clip();
  const onRock = () => { const x = m.x0 + r() * span; return [x, moundTop(m, x) + r() * (reefY() - moundTop(m, x))]; };
  // Relieve suave: zonas más claras donde da la luz (sin bordes marcados)
  for (let i = 0; i < span * 0.05; i++) {
    const [x, y] = onRock(), rad = (10 + r() * 22) * S;
    const b = g.createRadialGradient(x, y - rad * 0.3, 0, x, y, rad);
    b.addColorStop(0, 'rgba(235,220,215,.22)'); b.addColorStop(1, 'rgba(235,220,215,0)');
    g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Grietas oscuras
  g.strokeStyle = 'rgba(20,12,25,.35)'; g.lineCap = 'round';
  for (let i = 0; i < span * 0.03; i++) {
    let [x, y] = onRock(), a = r() * TAU;
    g.lineWidth = (0.8 + r() * 1.5) * S;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 6 * S; y += Math.sin(a) * 4 * S; g.lineTo(x, y); }
    g.stroke();
  }
  // Poros y motas
  for (let i = 0; i < span * 1.2; i++) {
    const [x, y] = onRock();
    g.fillStyle = r() < 0.6 ? `rgba(25,15,30,${0.15 + r() * 0.25})` : `rgba(240,230,225,${0.1 + r() * 0.2})`;
    g.beginPath(); g.ellipse(x, y, (0.6 + r() * 1.6) * S, (0.5 + r()) * S, 0, 0, TAU); g.fill();
  }
  // Costras de alga coralina: manchas orgánicas hechas de muchos puntitos rosas y morados
  for (let i = 0; i < span * 0.03; i++) {
    const [cx, cy] = onRock(), col = r() < 0.6 ? '226,120,175' : '160,110,220';
    for (let k = 0; k < 30; k++) {
      g.fillStyle = `rgba(${col},${0.25 + r() * 0.35})`;
      g.beginPath(); g.arc(cx + (r() - 0.5) * 26 * S, cy + (r() - 0.5) * 12 * S, (1.5 + r() * 2.5) * S, 0, TAU); g.fill();
    }
  }
  // Sombra donde la roca toca la arena
  const sh = g.createLinearGradient(0, reefY() - 20 * S, 0, reefY() + 6 * S);
  sh.addColorStop(0, 'rgba(20,10,40,0)'); sh.addColorStop(1, 'rgba(20,10,40,.45)');
  g.fillStyle = sh; g.fillRect(m.x0, reefY() - 20 * S, span, 30 * S);
  g.restore();
}

// Cubre la roca de vida: muchos corales y esponjas pequeños repartidos por la superficie
function coverRock(g, f, r, m) {
  const items = [];
  const n = Math.round((m.x1 - m.x0) / (11 * SCALE));
  for (let i = 0; i < n; i++) {
    const x = m.x0 + (0.04 + r() * 0.92) * (m.x1 - m.x0);
    const y = moundTop(m, x) + Math.pow(r(), 1.15) * (reefY() - moundTop(m, x)) * 0.9;
    items.push([x, y, r()]);
  }
  items.sort((a, b) => a[1] - b[1]); // de atrás (arriba) hacia delante (abajo)
  const S = SCALE;
  for (const [x, y, k] of items) {
    if (k < 0.18) zoanthids(g, f, r, x, y, pick2(r, ['#ff9a3a', '#ff5fa8', '#ffd23a']), pick2(r, ['#5fe07a', '#7cf0ff', '#ff6a3a']), 10);
    else if (k < 0.32) mushrooms(g, f, r, x, y, 2, pick2(r, ['#3fae6a', '#d0643a', '#6a5fd0', '#2fa0a8']));
    else if (k < 0.46) starPolyps(g, f, r, x, y);
    else if (k < 0.58) sponge(g, r, x, y, pick2(r, ['#e8442e', '#ff8a2a', '#c43a8a']));
    else if (k < 0.7) toadstool(g, r, x, y, (14 + r() * 10) * S);
    else if (k < 0.82) staghorn(g, f, r, x, y, (28 + r() * 22) * S, ...pick2(r, [['#e889b8', '#ffd0ea'], ['#7fb6ee', '#d6f6ff'], ['#c9a2ef', '#f2e2ff'], ['#9fd36a', '#eaffc0']]));
    else brainCoral(g, f, r, x, y + 4 * S, (10 + r() * 8) * S, ...pick2(r, [['#c8b26a', '#7e6a2e'], ['#8fb66a', '#4d6a2a'], ['#d08a6a', '#7a3e2a']]));
  }
}
const pick2 = (r, arr) => arr[Math.floor(r() * arr.length)]; // elegir con la semilla

// Pólipos estrella: alfombra de pequeños pólipos verdes
function starPolyps(g, f, r, x, y) {
  for (let i = 0; i < 24; i++) {
    const px = x + (r() - 0.5) * 30 * SCALE, py = y + (r() - 0.5) * 10 * SCALE, rad = (1.4 + r()) * SCALE;
    g.strokeStyle = 'rgba(120,230,110,.85)'; g.lineWidth = 0.7;
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * TAU + r();
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * rad * 2, py + Math.sin(a) * rad * 2); g.stroke();
    }
    g.fillStyle = '#c8ff9a'; g.beginPath(); g.arc(px, py, rad * 0.6, 0, TAU); g.fill();
    f.fillStyle = '#7dff6a'; f.beginPath(); f.arc(px, py, rad * 1.4, 0, TAU); f.fill();
  }
}

// Esponja incrustante: mancha de color con pequeños agujeros
function sponge(g, r, x, y, col) {
  for (let i = 0; i < 9; i++) {
    g.fillStyle = col;
    g.beginPath(); g.arc(x + (r() - 0.5) * 22 * SCALE, y + (r() - 0.5) * 9 * SCALE, (4 + r() * 5) * SCALE, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(40,10,10,.45)';
  for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(x + (r() - 0.5) * 22 * SCALE, y + (r() - 0.5) * 8 * SCALE, 1.2 * SCALE, 0, TAU); g.fill(); }
}

// Coral de cuero (seta): tallo claro y sombrero ondulado con pólipos
function toadstool(g, r, x, y, w) {
  g.fillStyle = '#d9cfa6';
  g.beginPath(); g.moveTo(x - w * 0.18, y); g.lineTo(x - w * 0.12, y - w * 0.6); g.lineTo(x + w * 0.12, y - w * 0.6); g.lineTo(x + w * 0.18, y); g.closePath(); g.fill();
  const cy = y - w * 0.62;
  const grad = g.createLinearGradient(0, cy - w * 0.25, 0, cy + w * 0.1);
  grad.addColorStop(0, '#f1e7c0'); grad.addColorStop(1, '#a89a6a');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(x, cy, w * 0.6, w * 0.22, (r() - 0.5) * 0.3, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,250,225,.7)'; g.lineWidth = 0.7;
  for (let i = 0; i < 26; i++) { // pólipos como pelusa
    const a = Math.PI + r() * Math.PI, px = x + Math.cos(a) * w * 0.55 * r(), py = cy + Math.sin(a) * w * 0.2 * r();
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * 2, py - 3 * SCALE); g.stroke();
  }
}

// Coral cuerno de ciervo: ramas que se dividen y se estrechan; las puntas son más claras
function staghorn(g, f, r, x, y, size, col, tip) {
  const S = SCALE;
  const branch = (x0, y0, ang, len, w, depth) => {
    const x1 = x0 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len;
    const mx = (x0 + x1) / 2 + (r() - 0.5) * len * 0.2, my = (y0 + y1) / 2;
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = w * 0.35; // brillo lateral
    g.beginPath(); g.moveTo(x0 - w * 0.2, y0); g.quadraticCurveTo(mx - w * 0.2, my, x1 - w * 0.2, y1); g.stroke();
    if (depth === 0 || len < 6 * S) {
      g.fillStyle = tip; g.beginPath(); g.arc(x1, y1, w * 0.55, 0, TAU); g.fill();
      f.fillStyle = tip; f.beginPath(); f.arc(x1, y1, w * 0.9, 0, TAU); f.fill(); // brilla de noche
      return;
    }
    const n = 2 + (r() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      branch(x1, y1, ang + (i - (n - 1) / 2) * (0.45 + r() * 0.3), len * (0.68 + r() * 0.12), w * 0.72, depth - 1);
    }
  };
  for (let i = 0; i < 4; i++) branch(x + (r() - 0.5) * size * 0.4, y + 4 * S, (r() - 0.5) * 1.1, size * 0.32, 7 * S, 4);
}

// Coral cerebro: cúpula con surcos que serpentean
function brainCoral(g, f, r, x, y, rad, col, dark) {
  const ry = rad * 0.72;
  const grad = g.createRadialGradient(x - rad * 0.3, y - ry * 0.9, rad * 0.1, x, y - ry * 0.3, rad * 1.1);
  grad.addColorStop(0, '#f4ecc6'); grad.addColorStop(0.45, col); grad.addColorStop(1, dark);
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(x, y, rad, ry, 0, Math.PI, 0); g.closePath(); g.fill();
  g.save(); g.beginPath(); g.ellipse(x, y, rad, ry, 0, Math.PI, 0); g.closePath(); g.clip();
  g.lineCap = 'round';
  for (let k = 0; k < 26; k++) { // surcos: caminos aleatorios que giran poco a poco
    let px = x + (r() - 0.5) * rad * 2, py = y - r() * ry, a = r() * TAU;
    g.beginPath(); g.moveTo(px, py);
    f.beginPath(); f.moveTo(px, py);
    for (let s = 0; s < 14; s++) {
      a += (r() - 0.5) * 1.2; px += Math.cos(a) * rad * 0.09; py += Math.sin(a) * rad * 0.06;
      g.lineTo(px, py); f.lineTo(px, py);
    }
    g.strokeStyle = 'rgba(40,30,10,.45)'; g.lineWidth = 1.6 * SCALE; g.stroke();
    g.strokeStyle = 'rgba(255,250,220,.35)'; g.lineWidth = 0.7 * SCALE; g.stroke();
    f.strokeStyle = 'rgba(120,255,140,.5)'; f.lineWidth = 1.2 * SCALE; f.stroke();
  }
  g.restore();
}

// Gorgonia: abanico de ramitas finas que se dividen muchas veces
function seaFan(g, r, x, y, size, col) {
  g.strokeStyle = col; g.lineCap = 'round';
  const branch = (x0, y0, ang, len, w, depth) => {
    const x1 = x0 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    if (depth === 0) return;
    branch(x1, y1, ang - 0.25 - r() * 0.2, len * 0.82, w * 0.75, depth - 1);
    branch(x1, y1, ang + 0.25 + r() * 0.2, len * 0.82, w * 0.75, depth - 1);
  };
  g.globalAlpha = 0.85;
  for (let i = -2; i <= 2; i++) branch(x, y, i * 0.32, size * 0.24, 2.6 * SCALE, 5);
  g.globalAlpha = 1;
}

// Esponja de tubo: cilindros con la boca oscura arriba
function tubeSponge(g, r, x, y, w, col, dark) {
  for (let i = 0; i < 4; i++) {
    const tx = x + (i - 1.5) * w * 0.85 + (r() - 0.5) * w * 0.3, h = w * (2.2 + r() * 2.4), tw = w * (0.45 + r() * 0.15);
    const grad = g.createLinearGradient(tx - tw, 0, tx + tw, 0);
    grad.addColorStop(0, dark); grad.addColorStop(0.35, col); grad.addColorStop(0.6, col); grad.addColorStop(1, dark);
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(tx - tw * 0.85, y + 4);
    g.lineTo(tx - tw, y - h); g.lineTo(tx + tw, y - h); g.lineTo(tx + tw * 0.85, y + 4); g.closePath(); g.fill();
    g.fillStyle = col; g.beginPath(); g.ellipse(tx, y - h, tw, tw * 0.35, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(20,10,0,.75)'; g.beginPath(); g.ellipse(tx, y - h, tw * 0.7, tw * 0.22, 0, 0, TAU); g.fill();
  }
}

// Coral de plato: capas planas superpuestas
function plateCoral(g, r, x, y, w, col) {
  for (let i = 0; i < 3; i++) {
    const py = y - i * w * 0.22, pw = w * (1 - i * 0.22), px = x + (r() - 0.5) * w * 0.2;
    const grad = g.createLinearGradient(0, py - pw * 0.12, 0, py + pw * 0.12);
    grad.addColorStop(0, '#f2d6bf'); grad.addColorStop(0.5, col); grad.addColorStop(1, '#5e3f30');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(px, py, pw, pw * 0.13, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,240,220,.4)'; g.lineWidth = 1;
    g.beginPath(); g.ellipse(px, py - 1, pw * 0.95, pw * 0.1, 0, Math.PI, TAU); g.stroke();
  }
}

// Corales champiñón: discos con rayas desde el centro
function mushrooms(g, f, r, x, y, n, col) {
  for (let i = 0; i < n; i++) {
    const mx = x + (r() - 0.5) * 50 * SCALE, my = y + r() * 10 * SCALE - 4, rad = (5 + r() * 4) * SCALE;
    g.fillStyle = col; g.beginPath(); g.ellipse(mx, my, rad, rad * 0.6, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 0.6;
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * TAU;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a) * rad, my + Math.sin(a) * rad * 0.6); g.stroke();
    }
    f.fillStyle = col; f.beginPath(); f.ellipse(mx, my, rad, rad * 0.6, 0, 0, TAU); f.fill();
  }
}

// Zoántidos: colonias de pólipos diminutos de colores
function zoanthids(g, f, r, x, y, ring, center, n = 26) {
  for (let i = 0; i < n; i++) {
    const px = x + (r() - 0.5) * (n < 20 ? 22 : 44) * SCALE, py = y + (r() - 0.3) * 10 * SCALE, rad = (2.2 + r() * 1.4) * SCALE;
    g.fillStyle = ring; g.beginPath(); g.arc(px, py, rad, 0, TAU); g.fill();
    g.fillStyle = center; g.beginPath(); g.arc(px, py, rad * 0.45, 0, TAU); g.fill();
    f.fillStyle = center; f.beginPath(); f.arc(px, py, rad, 0, TAU); f.fill();
  }
}

// Algas verdes en matojo (Caulerpa)
function algae(g, r, x, y) {
  for (let i = 0; i < 22; i++) {
    const a = (r() - 0.5) * 1.6, len = (10 + r() * 22) * SCALE;
    g.strokeStyle = r() < 0.5 ? '#3da54a' : '#62c25a'; g.lineWidth = (2 + r() * 2) * SCALE; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.sin(a) * len * 0.3, y - len * 0.6, x + Math.sin(a) * len, y - Math.cos(a) * len); g.stroke();
  }
}

// Textura de cáusticas: la red de luz que proyectan las ondas de la superficie (ruido de Worley)
function buildCaustics() {
  const N = 192, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), r = seeded(9);
  const pts = Array.from({ length: 34 }, () => [r() * N, r() * N]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let d1 = 1e9, d2 = 1e9;
      const wx = x + Math.sin(y / N * Math.PI * 4) * 5, wy = y + Math.sin(x / N * Math.PI * 6) * 5; // bordes curvos
      for (const [px, py] of pts) {
        let dx = Math.abs(((wx - px) % N + N) % N), dy = Math.abs(((wy - py) % N + N) % N);
        dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy); // se repite sin costuras
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);           // pequeño cerca de los bordes de cada celda
      const v = Math.pow(clamp(1 - edge / 4.5, 0, 1), 2.2);
      const i = (y * N + x) * 4;
      img.data[i] = 225; img.data[i + 1] = 250; img.data[i + 2] = 255; img.data[i + 3] = v * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

// Textura de escamas: arcos pequeños que se repiten sobre el cuerpo de los peces
function buildScales() {
  const c = document.createElement('canvas');
  c.width = 6; c.height = 5;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.6;
  g.beginPath(); g.arc(3, 0, 3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.35)';
  g.beginPath(); g.arc(0, 2.5, 3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.beginPath(); g.arc(6, 2.5, 3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  return ctx.createPattern(c, 'repeat');
}

// Luz de la lámpara y viñeta: no se mueven, se pintan una vez
function buildFrame() {
  const [c, g] = makeLayer();
  const top = g.createLinearGradient(0, 0, 0, H * 0.3);
  top.addColorStop(0, 'rgba(255,255,255,.55)'); top.addColorStop(0.15, 'rgba(210,245,255,.22)'); top.addColorStop(1, 'rgba(210,245,255,0)');
  g.fillStyle = top; g.fillRect(0, 0, W, H * 0.3);
  const v = g.createRadialGradient(W / 2, H * 0.4, Math.min(W, H) * 0.4, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,20,60,0)'); v.addColorStop(1, 'rgba(0,20,60,.3)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return c;
}

function resize() {
  W = canvas.clientWidth; H = canvas.clientHeight;
  if (!W || !H) return;
  const dpr = pixelRatio(); // nitidez en pantallas de alta densidad (menos si la calidad es reducida)
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  SCALE = clamp(W / 760, 0.62, 1.35);
  bgLayer = buildBackground();
  [reefLayer, fluoLayer] = buildReef();
  frameLayer = buildFrame();
  causticPattern = causticPattern || buildCaustics();
  scalePattern = scalePattern || buildScales();
  fishes.forEach(f => { f.x = clamp(f.x, 30, W - 30); f.y = clamp(f.y, 50, floorY() - 20); });
}

/* ---------- 4. SONIDO: burbujas sintetizadas con Web Audio (sin archivos de audio) ---------- */
let audio = null;        // el AudioContext se crea al activar el sonido (los navegadores lo exigen)
let soundOn = false;     // empieza en silencio
let lastBlub = 0;

// Un "blub": un tono corto que sube de frecuencia y se apaga enseguida
function blub(size = 1) {
  if (!soundOn || !audio) return;
  const now = audio.currentTime;
  if (now - lastBlub < 0.09) return; // no más de ~10 sonidos por segundo
  lastBlub = now;
  const osc = audio.createOscillator(), gain = audio.createGain();
  const f0 = rand(280, 520) / size;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(f0 * 2.6, now + 0.09);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.1, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain).connect(audio.destination);
  osc.start(now); osc.stop(now + 0.16);
}

/* ---------- 5. CREAR peces y burbujas ---------- */
function createFish(sp, name, id) {
  const f = {
    sp, id, name: name || pick(sp.nombres),     // id = identificador en la base de datos
    x: rand(60, Math.max(61, W - 60)), y: rand(60, Math.max(61, floorY() - 60)),
    z: sp.banco ? rand(0.8, 0.9) : rand(0.65, 1), // profundidad: 1 = junto al cristal
    vx: rand(-40, 40), vy: 0, dvx: 0, dvy: 0,  // velocidad actual y deseada
    dir: Math.random() < 0.5 ? -1 : 1, flip: 1, // dirección (izq/der) y giro suave
    phase: rand(0, TAU),                        // fase del ondulado del cuerpo
    hunger: rand(5, 40),                        // 0 = lleno, 100 = hambriento
    speed: rand(38, 66), timer: 0, born: Date.now(),
    scare: 0, sx: 0, sy: 0,                     // susto: tiempo restante y punto del que huye
    puff: 0                                     // inflado del pez globo (0 a 1)
  };
  if (sp.patron === 'globo') { // manchas propias de cada pez globo
    f.spots = Array.from({ length: 22 }, () => [rand(0.08, 0.92), rand(-0.42, 0.25), rand(0.025, 0.045)]);
  }
  return f;
}
const newBubble = (x, y, r) => ({ x, y, r: r || rand(1.5, 4.5), v: rand(30, 60), seed: rand(0, TAU) });
function burst(x, y, n) {
  for (let i = 0; i < n; i++) bubbles.push(newBubble(x + rand(-8, 8), y + rand(-6, 6)));
  blub(n > 3 ? 1.4 : 1);
}

// Asusta a un pez: huye del punto (x, y) durante unos segundos
function scareFish(f, x, y, time) {
  f.scare = time; f.sx = x; f.sy = y;
  if (f.sp.patron === 'globo') f.puff = 1; // el pez globo se infla
}

/* ---------- 6. ACTUALIZAR: lógica y movimiento ---------- */
function updateLight(dt) {
  let target;
  if (lightMode === 'dia') target = 1;
  else if (lightMode === 'noche') target = 0;
  else {
    // Coseno suavizado: pasa más tiempo de pleno día y de plena noche que en el atardecer
    const c = Math.cos((t / DAY_LENGTH) * TAU);
    target = clamp(0.5 + c * 0.8, 0, 1);
  }
  light += (target - light) * Math.min(1, dt * 1.5); // transición suave
}

function updateFish(f, dt) {
  f.hunger = Math.min(100, f.hunger + dt * 1.5);
  f.timer -= dt;
  f.scare = Math.max(0, f.scare - dt);
  f.puff = Math.max(0, f.puff - dt * 0.35);
  const activity = 0.45 + 0.55 * light; // de noche los peces nadan más despacio

  // Si tiene hambre, busca la comida más cercana
  let food = null;
  if (f.hunger > 30 && !f.scare) {
    let best = Infinity;
    for (const p of foods) {
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d < best) { best = d; food = p; }
    }
  }

  if (f.scare) {
    // Huir rápido del punto del susto
    const d = Math.hypot(f.x - f.sx, f.y - f.sy) || 1;
    f.dvx = (f.x - f.sx) / d * f.speed * 3;
    f.dvy = (f.y - f.sy) / d * f.speed * 2;
  } else if (food) {
    const d = Math.hypot(food.x - f.x, food.y - f.y) || 1;
    f.dvx = (food.x - f.x) / d * f.speed * 1.6;
    f.dvy = (food.y - f.y) / d * f.speed * 1.6;
    f.z += (0.95 - f.z) * Math.min(1, dt); // se acerca al frente, donde cae la comida
    if (d < 14 + f.sp.len * SCALE * f.z * 0.25) { // ¡comida!
      foods.splice(foods.indexOf(food), 1);
      f.hunger = Math.max(0, f.hunger - 35);
      burst(f.x + f.dir * f.sp.len * SCALE * f.z / 2, f.y, 2);
    }
  } else {
    // Nado tranquilo: cada pocos segundos elige un nuevo rumbo
    if (f.timer <= 0) {
      f.timer = rand(2, 5);
      f.dvx = (Math.random() < 0.5 ? -1 : 1) * f.speed * rand(0.5, 1);
      f.dvy = rand(-0.25, 0.25) * f.speed;
    }
    if (f.sp.banco) schoolWith(f, dt);
    if (f.sp.patron === 'payaso') stayHome(f, dt);
  }

  // Girar al acercarse a las paredes, la superficie o la arena
  if (f.x < 50) f.dvx = Math.abs(f.dvx) || f.speed;
  if (f.x > W - 50) f.dvx = -Math.abs(f.dvx) || -f.speed;
  if (f.y < 60) f.dvy = Math.abs(f.dvy) + 10;
  if (f.y > floorY() - 24) f.dvy = -Math.abs(f.dvy) - 10;

  keepDistance(f, dt);

  // La velocidad se acerca poco a poco a la deseada (movimiento suave)
  const k = Math.min(1, dt * (f.scare ? 5 : 1.8));
  f.vx += (f.dvx - f.vx) * k;
  f.vy += (f.dvy - f.vy) * k;
  const move = (f.scare ? 1 : activity) * SCALE * (0.55 + 0.45 * f.z); // los del fondo parecen más lentos
  f.x = clamp(f.x + f.vx * dt * move, 20, W - 20);
  f.y = clamp(f.y + f.vy * dt * move, 50, floorY() - 10);

  if (Math.abs(f.vx) > 8) f.dir = f.vx > 0 ? 1 : -1;
  f.flip += (f.dir - f.flip) * Math.min(1, dt * 6);                               // giro suave
  f.phase += dt * (4 + Math.hypot(f.vx, f.vy) / 10) * (f.scare ? 1.6 : activity); // ondula más rápido si nada rápido
  if (Math.random() < dt * 0.04) burst(f.x + f.dir * f.sp.len * SCALE * f.z / 2, f.y - 3, 1); // burbuja ocasional
}

// Banco de peces: se acerca al centro del grupo, copia la dirección y la profundidad de sus vecinos
function schoolWith(f, dt) {
  let n = 0, cx = 0, cy = 0, avx = 0, avy = 0, az = 0;
  for (const o of fishes) {
    if (o === f || o.sp !== f.sp) continue;
    if (Math.hypot(o.x - f.x, o.y - f.y) < 170 * SCALE) { n++; cx += o.x; cy += o.y; avx += o.vx; avy += o.vy; az += o.z; }
  }
  if (!n) return;
  cx /= n; cy /= n; avx /= n; avy /= n; az /= n;
  const k = Math.min(1, dt * 1.2);
  f.dvx += ((cx - f.x) * 0.6 + avx - f.dvx) * k;
  f.dvy += ((cy - f.y) * 0.6 + avy - f.dvy) * k;
  f.z += (az - f.z) * k * 0.3;
}

// El pez payaso no se aleja mucho de la anémona más cercana
function stayHome(f, dt) {
  let best = null, bd = Infinity;
  for (const a of ANEMONES) {
    const ax = a.x * W, ay = reefY() - 40 * SCALE, d = Math.hypot(ax - f.x, ay - f.y);
    if (d < bd) { bd = d; best = [ax, ay]; }
  }
  if (best && bd > 70 * SCALE) {
    const k = Math.min(1, dt * 0.8);
    f.dvx += ((best[0] - f.x) * 0.5 - f.dvx) * k;
    f.dvy += ((best[1] - f.y) * 0.5 - f.dvy) * k;
  }
}

// Separación: ningún pez se monta encima de otro que nade a una profundidad parecida
function keepDistance(f, dt) {
  for (const o of fishes) {
    if (o === f || Math.abs(o.z - f.z) > 0.15) continue;
    const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 0.01;
    const min = (f.sp.len + o.sp.len) * SCALE * 0.42;
    if (d < min) {
      f.vx += dx / d * 80 * dt;
      f.vy += dy / d * 80 * dt;
    }
  }
}

function update(dt) {
  t += dt;
  updateLight(dt);
  fishes.forEach(f => updateFish(f, dt));

  // La comida cae despacio balanceándose; en la arena desaparece tras unos segundos
  for (const p of foods) {
    if (p.y < floorY() - 4) { p.y += 26 * dt; p.x += Math.sin(t * 2 + p.rot) * 6 * dt; p.rot += dt * p.spin; }
    else p.age += dt;
  }
  foods = foods.filter(p => p.age < 10);

  // Burbujas: columna del difusor (oculto tras las rocas) y alguna suelta; crecen un poco al subir
  if (Math.random() < dt * (calm ? 4 : 12)) bubbles.push(newBubble(W * 0.455 + rand(-4, 4), floorY() + 6, rand(1, 3) * SCALE));
  if (Math.random() < dt * 0.8) bubbles.push(newBubble(rand(0, W), floorY(), rand(1, 2.5)));
  if (Math.random() < dt * 1.2) blub(1.6); // sonido suave y ocasional del difusor
  for (const b of bubbles) {
    b.y -= b.v * dt * SCALE;
    b.x += Math.sin(t * 3 + b.seed) * 12 * dt;
    b.r = Math.min(b.r * (1 + dt * 0.08), 7);
  }
  bubbles = bubbles.filter(b => b.y > 4);
}

/* ---------- 7. DIBUJAR ---------- */

// Rayos de luz: haces suaves que entran desde la lámpara y se mueven despacio
function drawRays() {
  const a = 0.05 + 0.11 * light;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const x0 = W * (0.06 + i * 0.18) + Math.sin(t * 0.17 + i * 1.7) * 40 * SCALE;
    const w = (34 + (i % 3) * 20) * SCALE;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.9);
    const col = light > 0.5 ? '235,250,255' : '150,170,255'; // de noche, luz azul tenue
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    for (const k of [1, 0.6, 0.3]) { // tres capas para que los bordes sean suaves
      ctx.beginPath();
      ctx.moveTo(x0 - w * k, 0); ctx.lineTo(x0 + w * k, 0);
      ctx.lineTo(x0 - W * 0.1 + w * k * 1.8, H); ctx.lineTo(x0 - W * 0.1 - w * k * 1.8, H);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// Anémona: tentáculos que se mecen con la corriente
function drawAnemone(a) {
  const r = seeded(a.seed * 97), x0 = a.x * W, y0 = reefY() - 6 * SCALE;
  const [base, tip] = a.hue === 'rosa' ? ['#c9467a', '#ffc2dc'] : ['#d8682a', '#ffd9a8'];
  // Pie de la anémona
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.ellipse(x0, y0 + 4 * SCALE, 20 * SCALE, 9 * SCALE, 0, 0, TAU); ctx.fill();
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const ang = -1.35 + (i / 39) * 2.7 + (r() - 0.5) * 0.15;
    const len = (24 + r() * 16) * SCALE;
    const sway = Math.sin(t * 1.3 + i * 0.35 + a.seed) * 0.35 * (calm ? 0.3 : 1);
    const bx = x0 + Math.sin(ang) * 14 * SCALE, by = y0 - Math.cos(ang) * 4 * SCALE;
    const tx = bx + Math.sin(ang + sway) * len, ty = by - Math.cos(ang * 0.7 + sway * 0.4) * len;
    const mx = bx + Math.sin(ang) * len * 0.5, my = by - len * 0.6;
    ctx.strokeStyle = base; ctx.lineWidth = 4.2 * SCALE;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
    if (lowQuality) continue;
    ctx.strokeStyle = tip; ctx.lineWidth = 2.2 * SCALE;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.quadraticCurveTo((mx + tx) / 2, (my + ty) / 2 - 2, tx, ty); ctx.stroke();
  }
}

// Cáusticas animadas sobre la arena y la base de las rocas (dos capas en sentidos distintos)
function drawCaustics() {
  if (!causticPattern || !sandEdge.length) return;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0, H);
  sandEdge.forEach(([x, y]) => ctx.lineTo(x, y - 2));
  ctx.lineTo(W, H); ctx.closePath(); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const speed = calm ? 0.2 : 1;
  [[1, 9, 4, 0.16], [1.35, -6, 7, 0.11]].forEach(([s, vx, vy, a]) => {
    ctx.save();
    ctx.globalAlpha = a * (0.1 + 0.9 * light);
    ctx.scale(s * 1.6 * SCALE, s * 0.7 * SCALE); // aplastadas en vertical: el suelo se ve en perspectiva
    const ox = (t * vx * speed) % 192, oy = (t * vy * speed) % 192;
    ctx.translate(ox, oy);
    ctx.fillStyle = causticPattern;
    ctx.fillRect(-ox - 192, -oy - 192, W / (s * 1.6 * SCALE) + 384, H / (s * 0.7 * SCALE) + 384);
    ctx.restore();
  });
  ctx.restore();
}

// Grosor del cuerpo en el punto u (0 = hocico, 1 = base de la cola), relativo al alto del pez
function bodyHalf(s, u) {
  const k = s.hump || 0.36;
  const front = Math.pow(Math.sin(Math.min(u / k, 1) * Math.PI / 2), s.snout || 0.6);
  const back = u < k ? 1 : 1 - Math.pow((u - k) / (1 - k), 1.25) * 0.82;
  return 0.5 * front * back;
}

// Aleta sobre el contorno del cuerpo (dorsal o anal): base entre los puntos i0 e i1.
// Devuelve la punta de la aleta (sirve para colgar el filamento del ídolo moro).
function drawFin(pts, i0, i1, hgt, dir, color, rays) {
  const a = pts[i0], b = pts[i1];
  const sweep = (a[0] - b[0]) * 0.55;
  const tx = b[0] - sweep * 0.4, ty = (a[1] + b[1]) / 2 + dir * hgt;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(a[0] - sweep * 0.1, a[1] + dir * hgt * 0.9, tx, ty);
  ctx.quadraticCurveTo(b[0] + sweep * 0.05, b[1] + dir * hgt * 0.3, b[0], b[1]);
  for (let i = i1; i >= i0; i--) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.fillStyle = color; ctx.fill();
  if (rays && !lowQuality) { // radios de la aleta
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.5;
    for (let j = 1; j < 5; j++) {
      const p = pts[Math.round(i0 + (i1 - i0) * j / 5)];
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + (tx - p[0]) * 0.85, p[1] + (ty - p[1]) * 0.85); ctx.stroke();
    }
  }
  return [tx, ty];
}

// Aleta caudal (cola) según la especie, dibujada en coordenadas propias que giran con el ondulado
function drawTail(s, L, Hh, ang) {
  const Lc = L * s.colaLen, Hc = Hh * 0.55, p = Hh * 0.08;
  ctx.save(); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, -p);
  switch (s.cola) {
    case 'horquilla':
      ctx.quadraticCurveTo(-Lc * 0.5, -Hc * 0.55, -Lc, -Hc);
      ctx.quadraticCurveTo(-Lc * 0.55, 0, -Lc, Hc);
      ctx.quadraticCurveTo(-Lc * 0.5, Hc * 0.55, 0, p); break;
    case 'lira':
      ctx.quadraticCurveTo(-Lc * 0.5, -Hc * 0.6, -Lc * 1.25, -Hc * 1.1);
      ctx.quadraticCurveTo(-Lc * 0.55, -Hc * 0.1, -Lc * 0.7, 0);
      ctx.quadraticCurveTo(-Lc * 0.55, Hc * 0.1, -Lc * 1.25, Hc * 1.1);
      ctx.quadraticCurveTo(-Lc * 0.5, Hc * 0.6, 0, p); break;
    case 'recta':
      ctx.lineTo(-Lc, -Hc * 0.95);
      ctx.quadraticCurveTo(-Lc * 0.88, 0, -Lc, Hc * 0.95);
      ctx.lineTo(0, p); break;
    default: // redonda
      ctx.bezierCurveTo(-Lc * 0.35, -Hc * 1.1, -Lc * 1.1, -Hc * 0.95, -Lc, 0);
      ctx.bezierCurveTo(-Lc * 1.1, Hc * 0.95, -Lc * 0.35, Hc * 1.1, 0, p);
  }
  ctx.closePath();
  ctx.fillStyle = s.colaColor || s.fin; ctx.fill();
  if (s.finEdge) { ctx.strokeStyle = s.finEdge; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(0.8, Hh * 0.04); ctx.stroke(); ctx.globalAlpha = 1; }
  // Radios de la cola
  ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 0.5;
  for (let j = -3; j <= 3; j++) {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-Lc * 0.92, j / 3 * Hc * 0.85); ctx.stroke();
  }
  if (s.patron === 'idolo') { // borde blanco en la cola del ídolo moro
    ctx.save(); ctx.clip(); ctx.fillStyle = '#f4f2ea'; ctx.fillRect(-Lc * 1.1, -Hc * 1.2, Lc * 0.22, Hc * 2.4); ctx.restore();
  }
  ctx.restore();
}

// Dibujo propio de cada especie (se llama con el recorte ya hecho al cuerpo)
function drawPattern(f, s, L, Hh, cy) {
  const X = u => L * (0.5 - u); // posición horizontal del punto u del cuerpo
  switch (s.patron) {
    case 'payaso': // tres bandas blancas con borde negro
      [[0.24, 0.1], [0.52, 0.12], [0.9, 0.06]].forEach(([u, w]) => {
        ctx.fillStyle = '#111'; ctx.fillRect(X(u) - L * (w / 2 + 0.025), -Hh, L * (w + 0.05), Hh * 2);
        ctx.fillStyle = '#fbfbf7'; ctx.fillRect(X(u) - L * w / 2, -Hh, L * w, Hh * 2);
      });
      break;
    case 'cirujano': // la "paleta" negra del cirujano azul
      ctx.strokeStyle = '#0a0f24'; ctx.lineCap = 'round';
      ctx.lineWidth = Hh * 0.2;
      ctx.beginPath(); ctx.moveTo(X(0.12), -Hh * 0.08); ctx.quadraticCurveTo(X(0.5), -Hh * 0.55, X(0.97), -Hh * 0.05); ctx.stroke();
      ctx.lineWidth = Hh * 0.13;
      ctx.beginPath(); ctx.moveTo(X(0.42), -Hh * 0.25); ctx.quadraticCurveTo(X(0.7), Hh * 0.2, X(0.97), Hh * 0.02); ctx.stroke();
      break;
    case 'emperador': // rayas amarillas curvas y antifaz oscuro con borde azul claro
      ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = Hh * 0.04;
      for (let k = -7; k <= 7; k++) {
        const y = cy + k * Hh * 0.075;
        ctx.beginPath(); ctx.moveTo(X(0.26), y - Hh * 0.06); ctx.quadraticCurveTo(X(0.62), y + Hh * 0.05, X(1.02), y + k * Hh * 0.025); ctx.stroke();
      }
      ctx.fillStyle = '#0b1238';
      ctx.beginPath(); ctx.ellipse(X(0.19), cy - Hh * 0.05, L * 0.06, Hh * 0.42, 0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#7fc8ff'; ctx.lineWidth = Hh * 0.03;
      ctx.beginPath(); ctx.ellipse(X(0.19), cy - Hh * 0.05, L * 0.075, Hh * 0.45, 0.15, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#e8ecf4'; ctx.beginPath(); ctx.ellipse(X(0.03), cy + Hh * 0.04, L * 0.04, Hh * 0.08, 0, 0, TAU); ctx.fill();
      break;
    case 'cromis': { // reflejo verdoso iridiscente
      const g = ctx.createLinearGradient(X(0), 0, X(1), 0);
      g.addColorStop(0, 'rgba(120,255,200,.25)'); g.addColorStop(1, 'rgba(80,160,255,.25)');
      ctx.fillStyle = g; ctx.fillRect(-L, -Hh, L * 2, Hh * 2);
      break;
    }
    case 'globo': // manchitas negras por todo el cuerpo y antifaz
      ctx.fillStyle = 'rgba(20,20,25,.75)';
      for (const [u, v, r] of f.spots) { ctx.beginPath(); ctx.arc(X(u), Hh * v, L * r * 0.5, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(15,15,20,.6)';
      ctx.beginPath(); ctx.ellipse(X(0.16), cy - Hh * 0.07, L * 0.07, Hh * 0.16, 0, 0, TAU); ctx.fill();
      break;
    case 'leon': // rayas verticales finas, inclinadas
      ctx.save(); ctx.transform(1, 0, -0.25, 1, 0, 0);
      for (let u = 0.04; u < 1; u += 0.07) {
        ctx.fillStyle = 'rgba(250,238,228,.85)'; ctx.fillRect(X(u), -Hh, L * 0.022, Hh * 2);
        ctx.fillStyle = 'rgba(90,18,10,.45)'; ctx.fillRect(X(u + 0.035), -Hh, L * 0.012, Hh * 2);
      }
      ctx.restore();
      break;
    case 'idolo': // dos bandas negras anchas, mancha amarilla y hocico naranja
      ctx.fillStyle = 'rgba(255,196,40,.85)';
      ctx.beginPath(); ctx.ellipse(X(0.47), cy - Hh * 0.22, L * 0.12, Hh * 0.28, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.fillRect(X(0.36), -Hh, L * 0.2, Hh * 2);
      ctx.fillRect(X(0.8), -Hh, L * 0.2, Hh * 2);
      ctx.fillStyle = '#f39a2a'; ctx.beginPath(); ctx.arc(X(0.0), cy + Hh * 0.02, Hh * 0.05, 0, TAU); ctx.fill();
      break;
    case 'anthias': // línea lila bajo el ojo
      ctx.strokeStyle = 'rgba(200,150,255,.85)'; ctx.lineWidth = Hh * 0.06; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(0.15), cy - Hh * 0.02); ctx.lineTo(X(0.34), cy + Hh * 0.3); ctx.stroke();
      break;
    case 'amarillo': // espina blanca junto a la cola
      ctx.fillStyle = '#fbfbf2'; ctx.beginPath(); ctx.ellipse(X(0.9), cy, L * 0.03, Hh * 0.04, 0, 0, TAU); ctx.fill();
      break;
    case 'mariposa': // líneas cruzadas en "V", trasera amarilla y franja negra sobre el ojo
      ctx.strokeStyle = 'rgba(70,70,70,.5)'; ctx.lineWidth = Hh * 0.025;
      for (let k = 0; k < 8; k++) {
        ctx.beginPath(); ctx.moveTo(X(0.36 + k * 0.06), cy - Hh * 0.6); ctx.lineTo(X(0.2 + k * 0.06), cy + Hh * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(0.22 + k * 0.05), cy - Hh * 0.6); ctx.lineTo(X(0.44 + k * 0.05), cy + Hh * 0.1); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,205,30,.92)'; ctx.fillRect(X(1.02), -Hh, L * 0.36, Hh * 2);
      ctx.fillStyle = '#151515'; ctx.fillRect(X(0.24), -Hh, L * 0.06, Hh * 2);
      break;
  }
}

// Dibuja un pez completo
function drawFish(f) {
  const s = f.sp, sc = f.z * SCALE, L = s.len * sc, Hh = L * s.alto;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(Math.sign(f.flip || 1) * Math.max(Math.abs(f.flip), 0.3), 1); // espejo según la dirección (sin aplanarse del todo al girar)
  ctx.rotate(Math.atan2(f.vy, Math.abs(f.vx) + 30) * 0.45);               // inclinación al subir/bajar
  if (f.puff) { const p = 1 + 0.4 * f.puff; ctx.scale(p, p * 1.25); }    // pez globo inflado

  // Contorno del cuerpo: puntos de arriba y de abajo; la parte trasera ondula al nadar
  const amp = Hh * (f.scare ? 0.24 : 0.14) * (s.alto > 0.7 ? 0.6 : 1), N = 18, top = [], bot = [];
  const mid = u => amp * u * u * Math.sin(f.phase - u * 2.6);
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = L * (0.5 - u), c = mid(u), h = bodyHalf(s, u) * Hh;
    top.push([x, c - h]); bot.push([x, c + h]);
  }
  const bodyPath = () => {
    ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i <= N; i++) ctx.lineTo(top[i][0], top[i][1]);
    for (let i = N; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
  };

  // Aletas que quedan detrás del cuerpo
  const tailAng = Math.cos(f.phase - 2.6) * 0.42;
  ctx.save(); ctx.translate(-L / 2, mid(1));
  drawTail(s, L, Hh, tailAng);
  ctx.restore();
  if (s.patron === 'leon') leonSpines(f, top, L, Hh, sc);
  const dark = s.patron === 'idolo';
  const dTip = drawFin(top, Math.round(N * (dark ? 0.28 : 0.32)), Math.round(N * 0.68), Hh * s.dorsal, -1, dark ? 'rgba(25,25,25,.85)' : s.fin, true);
  drawFin(bot, Math.round(N * 0.55), Math.round(N * 0.82), Hh * s.anal, 1, dark ? 'rgba(25,25,25,.8)' : s.fin, true);
  if (s.patron === 'idolo') { // filamento largo de la aleta dorsal
    ctx.strokeStyle = 'rgba(250,250,244,.95)'; ctx.lineCap = 'round';
    ctx.lineWidth = 2.2 * sc;
    ctx.beginPath(); ctx.moveTo(dTip[0], dTip[1]);
    ctx.quadraticCurveTo(dTip[0] - L * 0.3, dTip[1] - Hh * 0.35, -L * 0.85 + Math.sin(f.phase) * 4, dTip[1] + Hh * 0.15); ctx.stroke();
  }
  if (s.patron === 'mariposa') { // falso ojo en la aleta dorsal
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(dTip[0] + L * 0.04, dTip[1] + Hh * 0.18, Hh * 0.07, 0, TAU); ctx.fill();
  }

  // Cuerpo: sombreado natural (lomo oscuro, vientre claro)
  bodyPath();
  const g = ctx.createLinearGradient(0, -Hh / 2, 0, Hh / 2);
  g.addColorStop(0, s.top); g.addColorStop(0.45, s.body); g.addColorStop(1, s.belly);
  ctx.fillStyle = g; ctx.fill();

  ctx.save(); ctx.clip();
  drawPattern(f, s, L, Hh, mid(0.5));
  // Escamas: textura muy sutil
  if (scalePattern && L > 22 && !lowQuality) { ctx.globalAlpha = 0.16; ctx.fillStyle = scalePattern; ctx.fillRect(-L, -Hh, L * 2, Hh * 2); ctx.globalAlpha = 1; }
  // Volumen: brillo suave arriba, sombra abajo y borde un poco más oscuro
  const vol = ctx.createLinearGradient(0, -Hh / 2, 0, Hh / 2);
  vol.addColorStop(0, 'rgba(255,255,255,.3)'); vol.addColorStop(0.35, 'rgba(255,255,255,0)');
  vol.addColorStop(0.75, 'rgba(0,0,0,0)'); vol.addColorStop(1, 'rgba(0,0,0,.24)');
  ctx.fillStyle = vol; ctx.fillRect(-L, -Hh, L * 2, Hh * 2);
  if (!lowQuality) { bodyPath(); ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = Math.max(1, Hh * 0.1); ctx.stroke(); }
  // Opérculo (tapa de las branquias)
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = Math.max(0.6, Hh * 0.03);
  ctx.beginPath(); ctx.arc(L * 0.44, mid(0.2), Hh * 0.38, Math.PI * 0.62, Math.PI * 1.38); ctx.stroke();
  ctx.restore();

  // Ojo: iris de color, pupila grande y un reflejo
  const ex = L * 0.34 - (s.snout > 0.7 ? L * 0.05 : 0), ey = mid(0.16) - Hh * 0.07;
  const er = Math.max(1.4, Math.min(Hh, L * 0.5) * 0.11 * (s.patron === 'globo' ? 1.4 : 1));
  ctx.fillStyle = s.iris; ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fill();
  ctx.fillStyle = '#05080a'; ctx.beginPath(); ctx.arc(ex + er * 0.1, ey, er * 0.62, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(ex - er * 0.25, ey - er * 0.3, er * 0.22, 0, TAU); ctx.fill();

  // Aleta pectoral: el pez león tiene un gran abanico rayado; el resto, una aleta pequeña translúcida
  ctx.save();
  ctx.translate(L * 0.2, mid(0.3) + Hh * 0.1);
  if (s.patron === 'leon') {
    ctx.rotate(Math.sin(f.phase * 0.8) * 0.12);
    ctx.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const a = 0.15 + i * 0.13, len = L * (0.42 - Math.abs(i - 5) * 0.015);
      const tx = -Math.cos(a) * len, ty = Math.sin(a) * len;
      ctx.strokeStyle = 'rgba(245,225,215,.35)'; ctx.lineWidth = 4 * sc; // membrana
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = '#8c2a1a'; ctx.lineWidth = 1.2 * sc; ctx.setLineDash([3 * sc, 3 * sc]); // radio rayado
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    ctx.rotate(0.5 + Math.sin(f.phase * 1.7) * 0.35);
    ctx.fillStyle = s.fin; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-L * 0.12, -Hh * 0.12, -L * 0.2, Hh * 0.05);
    ctx.quadraticCurveTo(-L * 0.1, Hh * 0.12, 0, 0); ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}

// Espinas dorsales del pez león: largas, rayadas y unidas por una membrana fina
function leonSpines(f, top, L, Hh, sc) {
  const tips = [];
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const p = top[3 + i];
    const tip = [p[0] - L * 0.05, p[1] - Hh * (1.15 - i * 0.06) + Math.sin(f.phase * 0.7 + i) * 1.5];
    tips.push(tip);
    ctx.strokeStyle = '#f4e3d8'; ctx.lineWidth = 1.4 * sc;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.strokeStyle = '#8c2a1a'; ctx.setLineDash([2.5 * sc, 2.5 * sc]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(200,90,70,.18)';
  ctx.beginPath(); ctx.moveTo(top[3][0], top[3][1]);
  tips.forEach(([x, y]) => ctx.lineTo(x, y + Hh * 0.35));
  ctx.lineTo(top[14][0], top[14][1]); ctx.closePath(); ctx.fill();
}

// Marca del pez seleccionado: aro de luz fino y una etiqueta de cristal con su nombre
function drawSelection() {
  if (!selected) return;
  const f = selected, L = f.sp.len * SCALE * f.z, rx = L * 0.7 * (1 + 0.4 * f.puff), ry = Math.max(L * f.sp.alto, 14) * 0.85;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2;
  ctx.shadowColor = 'rgba(120,220,255,.9)'; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.ellipse(f.x, f.y, rx, ry, 0, 0, TAU); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '600 12px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(f.name).width + 14, tx = f.x - tw / 2, ty = f.y - ry - 24;
  const g = ctx.createLinearGradient(0, ty, 0, ty + 18);
  g.addColorStop(0, 'rgba(255,255,255,.92)'); g.addColorStop(0.5, 'rgba(235,245,252,.85)'); g.addColorStop(0.51, 'rgba(210,232,248,.85)'); g.addColorStop(1, 'rgba(230,243,252,.9)');
  ctx.fillStyle = g; ctx.strokeStyle = 'rgba(20,70,120,.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(tx, ty, tw, 18, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#0f2a44'; ctx.fillText(f.name, f.x, ty + 9.5);
  ctx.restore();
}

// Comida en escamas: trocitos irregulares que giran al caer
function drawFood(p) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
  ctx.fillStyle = p.col;
  ctx.beginPath(); ctx.ellipse(0, 0, 3 * SCALE, 1.6 * SCALE, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// Burbuja realista: casi transparente, con borde claro y un reflejo
function drawBubble(b) {
  const r = b.r;
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = Math.max(0.6, r * 0.18);
  const g = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.8, 'rgba(210,245,255,.08)'); g.addColorStop(1, 'rgba(255,255,255,.35)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill(); ctx.stroke();
  if (r > 1.8) {
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(b.x - r * 0.35, b.y - r * 0.35, r * 0.22, 0, TAU); ctx.fill();
  }
}

// Superficie del agua vista desde abajo: ondas en movimiento
function drawSurface() {
  const sy = H * 0.03;
  ctx.strokeStyle = `rgba(255,255,255,${0.3 + 0.4 * light})`; ctx.lineWidth = 1.2;
  for (const [k, off] of [[0.035, 0], [0.06, 2.1]]) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, sy + Math.sin(x * k + t * 1.4 + off) * 1.8 + Math.sin(x * k * 2.3 - t + off) * 1.1);
    ctx.stroke();
  }
}

function draw() {
  if (!bgLayer) return;
  const back = fishes.filter(f => f.z < 0.78).sort((a, b) => a.z - b.z);
  const front = fishes.filter(f => f.z >= 0.78).sort((a, b) => a.z - b.z);

  ctx.drawImage(bgLayer, 0, 0, W, H);
  if (!lowQuality) drawRays();
  back.forEach(drawFish);
  ctx.fillStyle = 'rgba(25,110,220,.2)';      // agua entre el fondo y el frente
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(reefLayer, 0, 0, W, H);
  if (!lowQuality) drawCaustics();
  ANEMONES.forEach(drawAnemone);
  front.forEach(drawFish);
  foods.forEach(drawFood);
  bubbles.forEach(drawBubble);

  // Noche: luz azul tenue; los corales brillan (fluorescencia)
  const dark = 1 - light;
  if (dark > 0.01) {
    ctx.fillStyle = `rgba(8,10,60,${0.62 * dark})`;
    ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * dark;
    ctx.drawImage(fluoLayer, 0, 0, W, H);
    ctx.restore();
  }
  drawSelection();
  drawSurface();
  ctx.drawImage(frameLayer, 0, 0, W, H);
  if (!fishes.length) {
    ctx.fillStyle = '#fff'; ctx.font = '300 20px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,30,60,.8)'; ctx.shadowBlur = 6;
    ctx.fillText('No hay peces. Pulsa "Añadir pez".', W / 2, H / 2); ctx.shadowBlur = 0;
  }
}

/* ---------- 8. INTERFAZ: panel, lista y botones ---------- */
const $ = id => document.getElementById(id);
const info = $('info'), list = $('fish-list'), statusEl = $('status'), select = $('species-select');
const setStatus = msg => { statusEl.textContent = msg; };

// Selector de especie
select.innerHTML = '<option value="-1">Aleatoria</option>' +
  SPECIES.map((s, i) => `<option value="${i}">${s.nombre}</option>`).join('');

// Ficha del pez seleccionado
function renderInfo() {
  if (!selected) {
    info.innerHTML = '<h2>Elige un pez</h2><p>Toca un pez en el acuario o en la lista para ver su ficha.</p>';
    return;
  }
  const s = selected.sp;
  info.innerHTML = `<h2 id="i-name"></h2><p class="species">${s.nombre}</p>
    <dl><dt>Científico</dt><dd><em>${s.cientifico}</em></dd>
    <dt>Tamaño</dt><dd>${s.tam}</dd>
    <dt>Hábitat</dt><dd>${s.habitat}</dd>
    <dt>Dieta</dt><dd>${s.dieta}</dd>
    <dt>Vida en grupo</dt><dd>${s.banco ? 'Nada en banco' : 'Independiente'}</dd>
    <dt>En el acuario</dt><dd id="i-time"></dd></dl>
    <p class="fact">${s.dato}</p>
    <div class="hunger"><span id="i-hunger"></span><div class="meter"><i id="i-bar"></i></div></div>`;
  $('i-name').textContent = selected.name; // el nombre lo elige el usuario: siempre como texto
  liveInfo();
}

// Datos que cambian con el tiempo (hambre y tiempo en el acuario)
function liveInfo() {
  if (!selected) return;
  const secs = Math.floor((Date.now() - selected.born) / 1000);
  $('i-time').textContent = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
  const h = selected.hunger;
  $('i-hunger').textContent = h < 30 ? 'Satisfecho' : h < 65 ? 'Con apetito' : 'Tiene hambre';
  $('i-bar').style.width = (100 - h) + '%';
}

// Lista de peces (también sirve para elegir con teclado)
function renderList() {
  $('count').textContent = fishes.length;
  list.innerHTML = '';
  fishes.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (f === selected ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = f.sp.color;
    b.append(dot, f.name);
    b.addEventListener('click', () => selectFish(f));
    list.appendChild(b);
  });
}

function selectFish(f) { selected = f; renderInfo(); renderList(); }

// Comunicación con el servidor: cada pez pertenece a un usuario y se guarda en SQLite
const csrf = document.querySelector('meta[name="csrf"]').content;
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(res.status);
  return res.status === 204 ? null : res.json();
}

async function addFish() {
  if (fishes.length >= MAX_FISH) { setStatus(`El acuario está lleno (máximo ${MAX_FISH} peces).`); return; }
  const i = +select.value;
  const idx = i < 0 ? Math.floor(Math.random() * SPECIES.length) : i;
  try {
    const saved = await api('POST', '/api/peces', { species: idx, name: pick(SPECIES[idx].nombres) });
    const f = createFish(SPECIES[idx], saved.name, saved.id);
    fishes.push(f); burst(f.x, f.y, 6);
    setStatus(`${f.name} (${f.sp.nombre}) se ha unido al acuario.`);
    selectFish(f);
  } catch { setStatus('No se pudo añadir el pez.'); }
}

async function removeFish() {
  const f = selected || fishes[fishes.length - 1]; // el seleccionado o el último
  if (!f) { setStatus('No quedan peces que quitar.'); return; }
  try {
    await api('DELETE', `/api/peces/${f.id}`);
    fishes.splice(fishes.indexOf(f), 1); burst(f.x, f.y, 6);
    if (selected === f) selected = null;
    setStatus(`${f.name} ha salido del acuario.`);
    renderInfo(); renderList();
  } catch { setStatus('No se pudo quitar el pez.'); }
}

function dropFood(x, y, n) {
  for (let i = 0; i < n && foods.length < 60; i++) {
    foods.push({ x: x + rand(-20, 20), y: y + rand(-10, 10), age: 0, rot: rand(0, TAU), spin: rand(-3, 3),
      col: pick(['#c4682a', '#a8542a', '#d9913c', '#8f5a2e']) });
  }
}

// Botón de luz: automático -> día -> noche -> automático
const LIGHT_LABELS = { auto: 'Luz: ciclo automático', dia: 'Luz: siempre de día', noche: 'Luz: siempre de noche' };
const NEXT_LIGHT = { auto: 'dia', dia: 'noche', noche: 'auto' };
function setLightMode(mode) {
  lightMode = mode;
  $('btn-light').textContent = LIGHT_LABELS[mode];
}

// Botón de sonido: alterna entre silencio y sonido de burbujas
function toggleSound() {
  soundOn = !soundOn;
  if (soundOn) {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  }
  const b = $('btn-sound');
  b.setAttribute('aria-pressed', soundOn);
  b.textContent = soundOn ? 'Silenciar burbujas' : 'Activar sonido';
  setStatus(soundOn ? 'Sonido de burbujas activado.' : 'Sonido silenciado.');
  blub();
}

$('btn-add').addEventListener('click', addFish);
$('btn-remove').addEventListener('click', removeFish);
$('btn-feed').addEventListener('click', () => {
  for (let i = 0; i < 8; i++) dropFood(rand(W * 0.1, W * 0.9), H * 0.06, 1);
  setStatus('Has echado comida.');
});
$('btn-light').addEventListener('click', () => setLightMode(NEXT_LIGHT[lightMode]));
$('btn-sound').addEventListener('click', toggleSound);

// Clic o toque en el acuario:
//  - sobre un pez: lo selecciona y se asusta (los vecinos cercanos también se apartan)
//  - sobre el agua: echa comida
canvas.addEventListener('pointerdown', e => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  // Se prueba primero el pez más cercano al cristal
  const hit = [...fishes].sort((a, b) => b.z - a.z)
    .find(f => Math.hypot(f.x - x, f.y - y) < Math.max(f.sp.len * SCALE * f.z * 0.6, 18));
  if (hit) {
    selectFish(hit);
    scareFish(hit, x, y, 1.2);
    fishes.forEach(o => { if (o !== hit && Math.hypot(o.x - x, o.y - y) < 90 * SCALE) scareFish(o, x, y, 0.7); });
    burst(hit.x, hit.y, 4);
    setStatus(hit.sp.patron === 'globo' ? `${hit.name} se ha inflado del susto.` : `${hit.name} se ha asustado.`);
  } else {
    dropFood(x, y, 3);
    setStatus('Has echado comida.');
  }
});

/* ---------- 9. BUCLE PRINCIPAL ---------- */
let last = performance.now(), liveTimer = 0;
function loop(now) {
  const frameMs = now - last;
  const dt = Math.min(0.05, frameMs / 1000); // limitar dt evita saltos si la pestaña estuvo oculta
  last = now;
  // Si durante 3 segundos los fotogramas tardan más de 40 ms (menos de 25 por segundo), baja la calidad
  if (!lowQuality && frameMs < 1000) {
    slowTime = frameMs > 40 ? slowTime + frameMs : Math.max(0, slowTime - frameMs);
    if (slowTime > 3000) { lowQuality = true; resize(); }
  }
  if (W && H) { update(dt); draw(); }
  liveTimer += dt;
  if (liveTimer > 0.4) { liveTimer = 0; liveInfo(); }
  requestAnimationFrame(loop);
}

// Arranque: ajustar tamaño, empezar a animar y cargar los peces del usuario
new ResizeObserver(resize).observe(canvas);
resize();
setLightMode('auto');
renderInfo(); renderList();
requestAnimationFrame(loop);
api('GET', '/api/peces').then(rows => {
  rows.forEach(r => { if (SPECIES[r.species]) fishes.push(createFish(SPECIES[r.species], r.name, r.id)); });
  renderList();
}).catch(() => setStatus('No se pudieron cargar los peces.'));
