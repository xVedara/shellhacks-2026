"use client";

import { useSyncExternalStore } from "react";
import { getVotedIds, subscribeVoted } from "./api";

const NO_VOTES: Set<string> = new Set();

/** Ids this browser has voted on. Server HTML uses an empty set; the client snapshot is localStorage. */
export function useVotedIds(): Set<string> {
  return useSyncExternalStore(subscribeVoted, getVotedIds, () => NO_VOTES);
}
