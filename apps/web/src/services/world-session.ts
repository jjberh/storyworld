import type { WorldClient } from "@storyworld/contracts/model";

export type RoomMode = "fixture" | "live";

let held:
  | {
      id: string;
      client: WorldClient;
      /** The room still owes this page its lift-off reveal. */
      reveal: boolean;
    }
  | undefined;

/**
 * Keeps the in-memory world client after confirmation so the room can reuse
 * it. This is not a second store of world state; SpacetimeDB (or the fixture
 * client) remains the authority.
 *
 * `reveal` hands the room a one-shot "play the lift-off reveal" flag: set
 * only by "Start my story" and kept in memory (never persisted). The room
 * reads it with `roomOwesReveal` (a pure read, safe to repeat while
 * rendering) and clears it with `markRoomRevealed` once its stage has started
 * the reveal. A reload, a guest link or another tab opens the room with a
 * fresh client and no flag, so the pieces are already standing.
 */
export function holdWorldClient(
  id: string,
  client: WorldClient,
  options: { reveal?: boolean } = {},
) {
  if (held && held.client !== client) held.client.dispose();
  held = { id, client, reveal: options.reveal ?? false };
}

/**
 * Whether the room for `id` still owes its lift-off reveal (see
 * `holdWorldClient`). Reading it changes nothing.
 */
export function roomOwesReveal(id: string) {
  return held?.id === id && held.reveal;
}

/** The reveal has started on a stage: no later room or stage replays it. */
export function markRoomRevealed(id: string) {
  if (held?.id === id) held.reveal = false;
}

export function peekWorldClient(id: string) {
  return held?.id === id ? held.client : undefined;
}

export function releaseWorldClient(id: string) {
  if (held?.id !== id) return;
  held.client.dispose();
  held = undefined;
}

/** Addressable room URL. `replaceState` so a refresh or guest can reopen it. */
export function worldRoomHref(
  id: string,
  roomMode: RoomMode,
  current: { pathname: string; search: string },
) {
  const path = current.pathname.startsWith("/join") ? "/" : current.pathname;
  const next = new URL(path + current.search, "https://storyworld.local");
  next.searchParams.delete("fixture");
  next.searchParams.set("world", id);
  next.searchParams.set("mode", roomMode);
  return next.pathname + next.search;
}

export function enterWorldRoom(id: string, roomMode: RoomMode) {
  history.replaceState(null, "", worldRoomHref(id, roomMode, location));
}
