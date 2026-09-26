"use client";

import { useEffect, useState } from "react";
import { API_URL, ApiError, GRAHAM_CENTER, api, getDeviceId, type HazardEvent, type HazardSummary } from "./api";

export type Connection = "loading" | "live" | "reconnecting" | "down";

const RETRY_MS = 5000;

/** Apply one stream event to a pin map. Returns the id when it added a pin that was not there. */
export function applyEvent(pins: Map<string, HazardSummary>, evt: HazardEvent): string | null {
  if (evt.op === "remove") {
    pins.delete(evt.id);
    return null;
  }
  if (evt.op !== "upsert" || !evt.hazard?.id) return null;
  if (evt.hazard.status === "cleared") {
    pins.delete(evt.hazard.id);
    return null;
  }
  const added = !pins.has(evt.hazard.id);
  pins.set(evt.hazard.id, evt.hazard);
  return added ? evt.hazard.id : null;
}

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

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let resyncTimer: ReturnType<typeof setTimeout> | undefined;
    // Source of truth for this subscription; React state gets a copy after each change.
    let pins = new Map<string, HazardSummary>();
    const revisions = new Map<string, number>();
    let epoch = 0;
    // Events received while a snapshot request is in flight, replayed on top of it.
    let buffer: HazardEvent[] | null = null;

    const publish = () => setLive({ hazards: new Map(pins), revisions: new Map(revisions), epoch });

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

    // Replace the pin set from a snapshot, then replay whatever the stream delivered meanwhile,
    // so an older snapshot can never undo a newer upsert or remove.
    const load = async () => {
      buffer = [];
      const list = await fetchSnapshot();
      const pending = buffer ?? [];
      buffer = null;
      if (cancelled || !list) return false;
      pins = new Map(list.map((h) => [h.id, h]));
      for (const evt of pending) applyEvent(pins, evt);
      epoch++;
      publish();
      setLoaded(true);
      return true;
    };

    // Resync on every open (first connect and each reconnect): events sent while we were not
    // subscribed are gone. "Live" only once the snapshot has landed; if it fails while the
    // stream is up, retry with backoff (1 s .. 30 s) instead of claiming the server is down.
    const resync = async (attempt = 0) => {
      clearTimeout(resyncTimer);
      const ok = await load();
      if (cancelled || source?.readyState !== EventSource.OPEN) return;
      if (ok) setConnection("live");
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
        buffer?.push(evt);
        const added = applyEvent(pins, evt);
        if (evt.op === "upsert" && evt.hazard?.id) revisions.set(evt.hazard.id, (revisions.get(evt.hazard.id) ?? 0) + 1);
        if (added) setRecentlyAdded(added);
        publish();
      });
    };

    // First contact: nothing to show until /hazards/near answers, so this is the "down" state.
    const start = async () => {
      if (await load()) connect();
      else if (!cancelled) {
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

  return { hazards: live.hazards, connection, loaded, error, recentlyAdded, detailVersion };
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

/** Tell the header to refresh karma after this device acts. */
export const announceAction = () => window.dispatchEvent(new Event("stepsafe:voted"));
