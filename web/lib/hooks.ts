"use client";

import { useEffect, useState } from "react";
import { API_URL, ApiError, GRAHAM_CENTER, api, getDeviceId, type HazardEvent, type HazardSummary } from "./api";

export type Connection = "loading" | "live" | "reconnecting" | "down";

const RETRY_MS = 5000;

/** Active hazards around the Graham Center, kept current by the /events stream. */
export function useLiveHazards() {
  const [hazards, setHazards] = useState<Map<string, HazardSummary>>(new Map());
  const [connection, setConnection] = useState<Connection>("loading");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const list = await api.near(GRAHAM_CENTER[0], GRAHAM_CENTER[1], 5000);
        if (cancelled) return;
        setHazards(new Map(list.map((h) => [h.id, h])));
        setLoaded(true);
        setError(null);
        return true;
      } catch (e) {
        if (cancelled) return;
        // A network failure is already explained by the "can't reach" state; keep other server errors.
        setError(e instanceof ApiError && e.code === "network" ? null : e instanceof Error ? e.message : String(e));
        setConnection("down");
        return false;
      }
    };

    const connect = () => {
      source = new EventSource(`${API_URL}/events`);
      source.onopen = () => {
        setConnection("live");
        // Resync on every open (first connect and each reconnect): events sent while we
        // were not subscribed are gone, so replace the pin set from /hazards/near.
        // ponytail: an event landing while this fetch is in flight can be overwritten by the
        // snapshot; the next event or reconnect corrects it.
        load();
      };
      source.onerror = () => {
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
        setHazards((prev) => {
          const next = new Map(prev);
          if (evt.op === "remove") next.delete(evt.id);
          else if (evt.op === "upsert" && evt.hazard?.id) {
            if (evt.hazard.status === "cleared") next.delete(evt.hazard.id);
            else {
              if (!prev.has(evt.hazard.id)) setRecentlyAdded(evt.hazard.id);
              next.set(evt.hazard.id, evt.hazard);
            }
          }
          return next;
        });
      });
    };

    const start = async () => {
      if (await load()) connect();
      else if (!cancelled) retry = setTimeout(start, RETRY_MS);
    };
    start();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      source?.close();
    };
  }, []);

  return { hazards, connection, loaded, error, recentlyAdded };
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
