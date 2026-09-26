"use client";

import { useEffect, useState } from "react";
import { API_URL, ApiError, GRAHAM_CENTER, api, getDeviceId, getTaxonomy, type HazardEvent, type HazardSummary, type HazardType } from "./api";
import { createLivePins } from "./live-pins";

export type Connection = "loading" | "live" | "reconnecting" | "down";

const RETRY_MS = 5000;

type LiveState = {
  hazards: Map<string, HazardSummary>;
  /** Bumped per id on every upsert, and for everything on each snapshot: drives detail re-fetches. */
  revisions: Map<string, number>;
  epoch: number;
};

/** Active hazards around the Graham Center, kept current by the /events stream. */
export function useLiveHazards() {
  const [live, setLive] = useState<LiveState>({ hazards: new Map(), revisions: new Map(), epoch: 0 });
  const [connection, setConnection] = useState<Connection>("loading");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<string | null>(null);
  /** Hazards this page saw marked cleared live (cleared upserts only): id -> time. Client-side only. */
  const [cleared, setCleared] = useState<Map<string, number>>(new Map());
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let resyncTimer: ReturnType<typeof setTimeout> | undefined;
    // Keep the first time a hazard was seen clearing; a replay after resync must not move it.
    const session = createLivePins((id) => setCleared((c) => (c.has(id) ? c : new Map(c).set(id, Date.now()))));
    const revisions = new Map<string, number>();
    let epoch = 0;

    const publish = () => setLive({ hazards: new Map(session.pins), revisions: new Map(revisions), epoch });

    const fetchSnapshot = async () => {
      try {
        const list = await api.near(GRAHAM_CENTER[0], GRAHAM_CENTER[1], 5000);
        if (cancelled) return null;
        setError(null);
        return list;
      } catch (e) {
        if (cancelled) return null;
        // A network failure is already explained by the "can't reach" state; keep other server errors.
        setError(e instanceof ApiError && e.code === "network" ? null : e instanceof Error ? e.message : String(e));
        return null;
      }
    };

    const load = async () => {
      const result = await session.load(fetchSnapshot);
      if (cancelled || result !== "ok") return result;
      epoch++;
      publish();
      setLoaded(true);
      setLastEventAt(Date.now());
      return "ok" as const;
    };

    // Resync on every open (first connect and each reconnect): events sent while we were not
    // subscribed are gone. "Live" only once the snapshot has landed; if it fails while the
    // stream is up, retry with backoff (1 s .. 30 s) instead of claiming the server is down.
    const resync = async (attempt = 0) => {
      clearTimeout(resyncTimer);
      const result = await load();
      if (cancelled || result === "stale") return;
      if (source?.readyState !== EventSource.OPEN) return;
      if (result === "ok") setConnection("live");
      else {
        setConnection("reconnecting");
        resyncTimer = setTimeout(() => resync(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
      }
    };

    const connect = () => {
      source = new EventSource(`${API_URL}/events`);
      source.onopen = () => resync();
      source.onerror = () => {
        clearTimeout(resyncTimer);
        setConnection("reconnecting");
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          retry = setTimeout(connect, RETRY_MS);
        }
      };
      source.addEventListener("hazard", (e) => {
        let evt: HazardEvent;
        try {
          evt = JSON.parse((e as MessageEvent).data);
        } catch {
          return;
        }
        setLastEventAt(Date.now());
        const added = session.note(evt);
        if (evt.op === "upsert" && evt.hazard?.id) revisions.set(evt.hazard.id, (revisions.get(evt.hazard.id) ?? 0) + 1);
        if (added) setRecentlyAdded(added);
        publish();
      });
    };

    // First contact: nothing to show until /hazards/near answers, so this is the "down" state.
    const start = async () => {
      const result = await load();
      if (cancelled || result === "stale") return;
      if (result === "ok") connect();
      else {
        setConnection("down");
        retry = setTimeout(start, RETRY_MS);
      }
    };
    start();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearTimeout(resyncTimer);
      source?.close();
    };
  }, []);

  /** Changes whenever the server may have changed this hazard (upsert event or resync). */
  const detailVersion = (id: string | null) => (id ? `${live.epoch}:${live.revisions.get(id) ?? 0}` : undefined);

  return { hazards: live.hazards, connection, loaded, error, recentlyAdded, detailVersion, cleared, lastEventAt };
}

/** Current time, re-read every `ms` so relative labels and "last hour" counts stay honest. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Anonymous device identity plus the server's view of its name and karma. */
export function useIdentity() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [user, setUser] = useState<{ displayName: string; karma: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unavailable">("loading");

  useEffect(() => {
    const id = getDeviceId();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = () =>
      api.user(id).then(
        (u) => {
          setUser(u);
          setStatus("ok");
          setDeviceId(id);
        },
        () => {
          setStatus("unavailable");
          setDeviceId(id);
          clearTimeout(retry);
          retry = setTimeout(refresh, 10_000);
        },
      );
    refresh();
    window.addEventListener("stepsafe:voted", refresh);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("stepsafe:voted", refresh);
    };
  }, []);

  return { deviceId, user, status };
}

const TAXONOMY_RETRY_MS = [2000, 5000, 15000];

/** The fixed hazard-type list, fetched once per session (memoized in `getTaxonomy`). On failure,
 * retries with backoff (2 s, 5 s, then every 15 s); `retry()` also retries immediately (for a
 * "Retry" button). */
export function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<HazardType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    getTaxonomy().then(
      (t) => live && setTaxonomy(t),
      (e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        const delay = TAXONOMY_RETRY_MS[Math.min(attempt, TAXONOMY_RETRY_MS.length - 1)];
        timer = setTimeout(() => live && setAttempt((a) => a + 1), delay);
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [attempt]);
  return { taxonomy, error, loading: !taxonomy && !error, retry: () => setAttempt((a) => a + 1) };
}

/** Tell the header to refresh karma after this device acts. */
export const announceAction = () => window.dispatchEvent(new Event("stepsafe:voted"));
