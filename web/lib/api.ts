// Pure client of the StepSafe API (frozen contract). No API logic lives in Next.js.

export type Category = "moving" | "temporary" | "permanent";
export type HeightBand = "ground" | "head" | "dropoff";

export type HazardType = { id: string; en: string; es: string; category: Category; defaultHeightBand: HeightBand };

export type HazardSummary = {
  id: string;
  type: string;
  category: Category;
  lat: number;
  lng: number;
  heightBand: HeightBand;
  confidence: number;
  lastSeen: string;
  status: "active" | "cleared";
  label: string;
  sample: boolean;
  distanceM?: number;
};

export type Vote = {
  deviceId: string;
  vote: "up" | "down";
  source: "walker" | "scout" | "verifier";
  weight: number;
  at: string;
};

export type HazardDetail = HazardSummary & {
  measurements: { clearanceM?: number; widthM?: number } | null;
  crop: string | null;
  meshUrl: null;
  spokenLabel_es: string;
  severity: number;
  createdAt: string;
  expiresAt: string;
  votes: Vote[];
  pendingReclassifications: { type?: string; category?: Category; heightBand?: HeightBand; count: number }[];
};

export type HazardEvent = { op: "upsert"; hazard: HazardSummary } | { op: "remove"; id: string };

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787").replace(/\/$/, "");
export const GRAHAM_CENTER: [number, number] = [25.7566, -80.3739];
export const RECLASSIFY_THRESHOLD = 3;

export const CATEGORIES: Category[] = ["moving", "temporary", "permanent"];
export const HEIGHT_BANDS: HeightBand[] = ["ground", "head", "dropoff"];

// Hazard ramp built around brand orange (hazards only). Lightness differs per category and
// every pin also carries its letter, so category never relies on color alone.
export const CATEGORY_META: Record<Category, { label: string; color: string; ink: string; letter: string; lifespan: string }> = {
  moving: { label: "Moving", color: "#ffc23d", ink: "#081624", letter: "M", lifespan: "clears after 6 hours" },
  temporary: { label: "Temporary", color: "#ff7900", ink: "#081624", letter: "T", lifespan: "clears after 7 days" },
  permanent: { label: "Permanent", color: "#d93a1e", ink: "#ffffff", letter: "P", lifespan: "clears after 90 days" },
};

export const HEIGHT_META: Record<HeightBand, { label: string; shape: string }> = {
  ground: { label: "Ground level", shape: "circle" },
  head: { label: "Head height", shape: "triangle" },
  dropoff: { label: "Drop-off", shape: "square" },
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", `Can't reach the StepSafe server at ${API_URL}.`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body?.error ?? "http_error";
    const message =
      code === "rate_limited" ? "Too many actions in a minute. Wait a moment and try again."
      : code === "not_found" ? "That hazard no longer exists."
      : body?.message ?? `Server error (${res.status}).`;
    throw new ApiError(res.status, code, message);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  near: (lat: number, lng: number, radiusM = 5000) =>
    request<HazardSummary[]>(`/hazards/near?lat=${lat}&lng=${lng}&radius_m=${radiusM}`),
  hazard: (id: string) => request<HazardDetail>(`/hazards/${encodeURIComponent(id)}`),
  vote: (id: string, vote: "up" | "down") =>
    post<{ confidence: number; status: "active" | "cleared" }>(`/hazards/${encodeURIComponent(id)}/votes`, {
      vote,
      source: "verifier",
      deviceId: getDeviceId(),
    }),
  reclassify: (id: string, change: { type?: string; category?: Category; heightBand?: HeightBand }) =>
    post<{ applied: boolean; agreeing: number }>(`/hazards/${encodeURIComponent(id)}/reclassify`, {
      ...change,
      deviceId: getDeviceId(),
    }),
  report: (id: string, reason: "spam" | "abuse" | "other") =>
    post<{ ok: true }>(`/hazards/${encodeURIComponent(id)}/report`, { reason, deviceId: getDeviceId() }),
  user: (deviceId: string) => request<{ displayName: string; karma: number }>(`/users/${encodeURIComponent(deviceId)}`),
  taxonomy: () => request<HazardType[]>("/taxonomy"),
};

// --- taxonomy (fetched once per session; cacheable per the frozen contract) ---

let taxonomyPromise: Promise<HazardType[]> | null = null;

/** True when `body` looks enough like `HazardType[]` to trust: an array of objects each with a
 * string `id` (the field everything else keys off). Doesn't check `en`/`es`/`category`/
 * `defaultHeightBand` — a malformed one of those would just show oddly, not break lookups. */
export function isTaxonomyArray(body: unknown): body is HazardType[] {
  return Array.isArray(body) && body.every((t) => t !== null && typeof t === "object" && typeof (t as { id?: unknown }).id === "string");
}

/** The fixed hazard-type list from GET /taxonomy. Cached in memory for the session; a failed fetch
 * (network/HTTP error or a malformed body) clears the cache so the next call retries instead of
 * being stuck failed forever. */
export function getTaxonomy(): Promise<HazardType[]> {
  if (!taxonomyPromise) {
    taxonomyPromise = api
      .taxonomy()
      .then((body) => {
        if (!isTaxonomyArray(body)) throw new ApiError(0, "bad_response", "The server sent a malformed taxonomy list.");
        return body;
      })
      .catch((e) => {
        taxonomyPromise = null;
        throw e;
      });
  }
  return taxonomyPromise;
}

/** The taxonomy's English name for a type id (e.g. "trash-bin" -> "trash bin"), or the raw id when
 * it's unknown or the taxonomy hasn't loaded (legacy free-text types keep their original text). */
export function typeDisplayName(id: string, taxonomy: readonly HazardType[] | null | undefined): string {
  return taxonomy?.find((t) => t.id === id)?.en ?? id;
}

export type ReclassifyPickState = {
  category: Category | "";
  heightBand: HeightBand | "";
  autoFilled: { category: boolean; heightBand: boolean };
};

/** Reclassify form's "pick a type" logic: picking a type pre-fills category/heightBand only while
 * they're still "No change" (never overwrites a value the volunteer set themselves), and tracks
 * which of them it filled. Picking "No change" for type clears only the fields it auto-filled.
 * Pure so it's unit-testable without mounting the form. */
export function applyTypePick(id: string, entry: HazardType | undefined, state: ReclassifyPickState): ReclassifyPickState {
  if (id === "") {
    return {
      category: state.autoFilled.category ? "" : state.category,
      heightBand: state.autoFilled.heightBand ? "" : state.heightBand,
      autoFilled: { category: false, heightBand: false },
    };
  }
  if (!entry) return state;
  return {
    category: state.category === "" ? entry.category : state.category,
    heightBand: state.heightBand === "" ? entry.defaultHeightBand : state.heightBand,
    autoFilled: {
      category: state.autoFilled.category || state.category === "",
      heightBand: state.autoFilled.heightBand || state.heightBand === "",
    },
  };
}

// --- local identity and vote memory (localStorage can throw or be empty; never rely on it) ---

let memoryDeviceId: string | null = null;
const memoryVoted = new Set<string>();

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: in-memory fallback already holds it */
  }
}

const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** 32 random hex chars + "-web". getRandomValues works over plain HTTP; randomUUID does not. */
export function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "-web";
}

export function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  const stored = readStorage("stepsafe.deviceId");
  // Early builds stored "web-<uuid>", which the server shows as "Neighbor-web-"; replace those.
  if (stored && DEVICE_ID_RE.test(stored) && !stored.startsWith("web-")) {
    memoryDeviceId = stored;
  } else {
    memoryDeviceId = newDeviceId();
    writeStorage("stepsafe.deviceId", memoryDeviceId);
  }
  return memoryDeviceId;
}

export function getVotedIds(): Set<string> {
  try {
    const stored = JSON.parse(readStorage("stepsafe.voted") ?? "[]");
    if (Array.isArray(stored)) stored.forEach((id) => memoryVoted.add(String(id)));
  } catch {
    /* corrupt value: ignore */
  }
  return new Set(memoryVoted);
}

export function rememberVote(id: string) {
  memoryVoted.add(id);
  // ponytail: keeps the newest 500 ids; older votes may reappear in the queue (server still holds the vote).
  writeStorage("stepsafe.voted", JSON.stringify([...getVotedIds()].slice(-500)));
}

// --- formatting ---

export const toFeet = (m: number) => m * 3.28084;
export const formatLength = (m: number) => `${toFeet(m).toFixed(1)} ft (${m.toFixed(2)} m)`;

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return "unknown";
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return diff < 0 ? "just now" : "in under a minute";
}

export const cropSrc = (crop: string) => (crop.startsWith("data:") ? crop : `data:image/jpeg;base64,${crop}`);
