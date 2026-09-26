import type { Category, HeightBand } from './db.ts';

export interface HazardType {
  id: string;
  en: string;
  es: string;
  category: Category;
  defaultHeightBand: HeightBand;
}

const t = (id: string, en: string, es: string, category: Category, defaultHeightBand: HeightBand): HazardType => ({
  id, en, es, category, defaultHeightBand,
});

/**
 * The only hazard types the server knows. Models pick an id; people reclassify to an id; spoken labels are built
 * from these names, never from model or user text. "obstacle" is the catch-all.
 */
export const TAXONOMY: readonly HazardType[] = Object.freeze([
  // moving: parked or carried things that come and go (6 h)
  t('trash-bin', 'trash bin', 'cubo de basura', 'moving', 'ground'),
  t('trash-bags', 'trash bags', 'bolsas de basura', 'moving', 'ground'),
  t('e-scooter', 'e-scooter', 'patinete eléctrico', 'moving', 'ground'),
  t('bicycle', 'bicycle', 'bicicleta', 'moving', 'ground'),
  t('motorcycle', 'motorcycle', 'motocicleta', 'moving', 'ground'),
  t('parked-car', 'parked car', 'coche estacionado', 'moving', 'ground'),
  t('open-car-door', 'open car door', 'puerta de coche abierta', 'moving', 'head'),
  t('delivery-robot', 'delivery robot', 'robot de reparto', 'moving', 'ground'),
  t('shopping-cart', 'shopping cart', 'carrito de compras', 'moving', 'ground'),
  t('stroller', 'stroller', 'carrito de bebé', 'moving', 'ground'),
  t('person', 'person', 'persona', 'moving', 'ground'),
  t('dog', 'dog', 'perro', 'moving', 'ground'),
  t('sandwich-board', 'sidewalk sign board', 'cartel de acera', 'moving', 'ground'),
  t('chair', 'chair', 'silla', 'moving', 'ground'),
  t('table', 'table', 'mesa', 'moving', 'ground'),
  t('umbrella', 'umbrella', 'sombrilla', 'moving', 'head'),
  t('box', 'box', 'caja', 'moving', 'ground'),
  t('open-hatch', 'open hatch', 'trampilla abierta', 'moving', 'dropoff'),
  // temporary: construction, weather, debris (7 d)
  t('construction-barrier', 'construction barrier', 'barrera de obra', 'temporary', 'ground'),
  t('construction-fence', 'construction fence', 'valla de obra', 'temporary', 'ground'),
  t('cone', 'traffic cone', 'cono', 'temporary', 'ground'),
  t('scaffolding', 'scaffolding', 'andamio', 'temporary', 'head'),
  t('ladder', 'ladder', 'escalera de mano', 'temporary', 'head'),
  t('open-trench', 'open trench', 'zanja abierta', 'temporary', 'dropoff'),
  t('open-manhole', 'open manhole', 'alcantarilla abierta', 'temporary', 'dropoff'),
  t('fallen-branch', 'fallen branch', 'rama caída', 'temporary', 'ground'),
  t('fallen-tree', 'fallen tree', 'árbol caído', 'temporary', 'ground'),
  t('debris', 'debris', 'escombros', 'temporary', 'ground'),
  t('puddle', 'puddle', 'charco', 'temporary', 'ground'),
  t('flooding', 'flooding', 'inundación', 'temporary', 'ground'),
  t('hose-or-cable', 'hose or cable', 'manguera o cable', 'temporary', 'ground'),
  t('wet-floor-sign', 'wet floor sign', 'señal de piso mojado', 'temporary', 'ground'),
  t('obstacle', 'obstacle', 'obstáculo', 'temporary', 'ground'),
  // permanent: street furniture and the walking surface itself (90 d)
  t('pole', 'pole', 'poste', 'permanent', 'ground'),
  t('sign', 'sign', 'señal', 'permanent', 'ground'),
  t('low-sign', 'low sign', 'señal baja', 'permanent', 'head'),
  t('low-branch', 'low branch', 'rama baja', 'permanent', 'head'),
  t('overhang', 'overhang', 'saliente', 'permanent', 'head'),
  t('awning', 'awning', 'toldo', 'permanent', 'head'),
  t('bench', 'bench', 'banco', 'permanent', 'ground'),
  t('planter', 'planter', 'jardinera', 'permanent', 'ground'),
  t('tree', 'tree', 'árbol', 'permanent', 'ground'),
  t('tree-root', 'tree root', 'raíz de árbol', 'permanent', 'ground'),
  t('fire-hydrant', 'fire hydrant', 'boca de incendios', 'permanent', 'ground'),
  t('bollard', 'bollard', 'bolardo', 'permanent', 'ground'),
  t('bike-rack', 'bike rack', 'aparcabicis', 'permanent', 'ground'),
  t('mailbox', 'mailbox', 'buzón', 'permanent', 'ground'),
  t('parking-meter', 'parking meter', 'parquímetro', 'permanent', 'ground'),
  t('utility-box', 'utility box', 'caja de servicios', 'permanent', 'ground'),
  t('bus-shelter', 'bus shelter', 'parada de autobús', 'permanent', 'ground'),
  t('kiosk', 'kiosk', 'quiosco', 'permanent', 'ground'),
  t('gate', 'gate', 'portón', 'permanent', 'ground'),
  t('fence', 'fence', 'valla', 'permanent', 'ground'),
  t('wall', 'wall', 'pared', 'permanent', 'ground'),
  t('railing', 'railing', 'barandilla', 'permanent', 'ground'),
  t('glass-door', 'glass door', 'puerta de vidrio', 'permanent', 'ground'),
  t('grate', 'grate', 'rejilla', 'permanent', 'ground'),
  t('pothole', 'pothole', 'bache', 'permanent', 'dropoff'),
  t('broken-sidewalk', 'broken sidewalk', 'acera rota', 'permanent', 'ground'),
  t('uneven-pavement', 'uneven pavement', 'pavimento irregular', 'permanent', 'ground'),
  t('curb', 'curb', 'bordillo', 'permanent', 'dropoff'),
  t('ramp-missing', 'missing curb ramp', 'sin rampa de bordillo', 'permanent', 'dropoff'),
  t('ramp', 'ramp', 'rampa', 'permanent', 'ground'),
  t('step-up', 'step up', 'escalón hacia arriba', 'permanent', 'ground'),
  t('step-down', 'step down', 'escalón hacia abajo', 'permanent', 'dropoff'),
  t('stairs-up', 'stairs up', 'escalones hacia arriba', 'permanent', 'ground'),
  t('stairs-down', 'stairs down', 'escalones hacia abajo', 'permanent', 'dropoff'),
]);

export const OBSTACLE = 'obstacle';
export const TYPE_IDS = TAXONOMY.map((e) => e.id);
const BY_ID = new Map(TAXONOMY.map((e) => [e.id, e]));

/** Exact id lookup (trimmed, lowercased, spaces as hyphens: "Trash bin" -> trash-bin); else the "obstacle" catch-all. */
export const taxonomyEntry = (id: unknown): HazardType =>
  BY_ID.get(typeof id === 'string' ? id.trim().toLowerCase().replace(/\s+/g, '-') : '') ?? BY_ID.get(OBSTACLE)!;
export const isTypeId = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);

/** The only source of spoken labels. */
export function labelsFor(id: string, band: HeightBand) {
  const { en, es } = taxonomyEntry(id);
  if (band === 'head') return { spokenLabel_en: `${en} at head height`, spokenLabel_es: `${es} a la altura de la cabeza` };
  if (band === 'dropoff') return { spokenLabel_en: `drop-off: ${en}`, spokenLabel_es: `desnivel: ${es}` };
  return { spokenLabel_en: en, spokenLabel_es: es };
}
