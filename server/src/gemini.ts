import { GoogleGenAI, Type } from '@google/genai';
import { CATEGORIES, HEIGHT_BANDS, type Category, type HeightBand } from './db.ts';

export interface Naming {
  type: string;
  category: Category;
  heightBand: HeightBand;
  severity: number;
  spokenLabel_en: string;
  spokenLabel_es: string;
}

/**
 * Returns null when the hazard could not be named (no key, timeout, error, junk output).
 * `typeHint` is a type people already agreed on; the model should write labels for it.
 * `cropBase64` null means text only (label regeneration for a hinted type with no photo).
 */
export type Namer = (cropBase64: string | null, heightBand: HeightBand, typeHint?: string) => Promise<Naming | null>;

const PROMPT = `You are labeling a sidewalk obstacle for a blind pedestrian navigation app.
The photo is a crop of the obstacle. The phone's depth sensor says it is at height band "%BAND%"
(ground = trip hazard on the walking surface, head = overhanging at head height, dropoff = hole, curb or step down).
Return JSON:
- type: short lowercase noun phrase, e.g. "e-scooter", "trash bin", "scaffolding", "low branch", "broken sidewalk"
- category: "moving" (scooters, bins, parked bikes), "temporary" (construction, flooding, fallen branches) or "permanent" (broken pavement, missing curb ramp, low sign)
- heightBand: one of ground, head, dropoff
- severity: 1 (minor) to 3 (dangerous)
- spokenLabel_en: at most 5 words to speak aloud, e.g. "scooter on sidewalk"
- spokenLabel_es: the same label in Spanish`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING },
    category: { type: Type.STRING, enum: [...CATEGORIES] },
    heightBand: { type: Type.STRING, enum: [...HEIGHT_BANDS] },
    severity: { type: Type.INTEGER, minimum: 1, maximum: 3 },
    spokenLabel_en: { type: Type.STRING },
    spokenLabel_es: { type: Type.STRING },
  },
  required: ['type', 'category', 'heightBand', 'severity', 'spokenLabel_en', 'spokenLabel_es'],
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

export function parseNaming(raw: unknown): Naming | null {
  const o = raw as Record<string, unknown>;
  const type = str(o?.type);
  const en = str(o?.spokenLabel_en);
  const es = str(o?.spokenLabel_es);
  if (!type || !en || !es) return null;
  if (!CATEGORIES.includes(o.category as Category)) return null;
  if (!HEIGHT_BANDS.includes(o.heightBand as HeightBand)) return null;
  const severity = Math.min(3, Math.max(1, Math.round(Number(o.severity) || 2)));
  return {
    type: type.toLowerCase(),
    category: o.category as Category,
    heightBand: o.heightBand as HeightBand,
    severity,
    spokenLabel_en: en,
    spokenLabel_es: es,
  };
}

export function geminiNamer(apiKey: string | undefined, model = 'gemini-2.5-flash', timeoutMs = 4000): Namer {
  if (!apiKey) return async () => null;
  const ai = new GoogleGenAI({ apiKey });
  return async (cropBase64, heightBand, typeHint) => {
    const hint = typeHint
      ? `\nPeople on the street identified this obstacle as ${JSON.stringify(typeHint)}. Use that as type and write the labels for it.`
      : '';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                ...(cropBase64 ? [{ inlineData: { mimeType: 'image/jpeg', data: cropBase64 } }] : []),
                { text: PROMPT.replace('%BAND%', heightBand) + hint + (cropBase64 ? '' : '\nNo photo is available; answer from the type alone.') },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
            abortSignal: abort.signal,
          },
        }),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener('abort', () => reject(new Error('gemini timeout'))),
        ),
      ]);
      return parseNaming(JSON.parse(res.text ?? ''));
    } catch (err) {
      console.warn('gemini naming failed:', (err as Error).message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
