import type { WorldClient } from "@storyworld/contracts/model";

export type RoomMode = "fixture" | "live";

let held:
  | {
      id: string;
      client: WorldClient;
    }
  | undefined;

/**
 * Keeps the in-memory world client after confirmation so the room can reuse
 * it. This is not a second store of world state; SpacetimeDB (or the fixture
 * client) remains the authority.
 */
export function holdWorldClient(id: string, client: WorldClient) {
  if (held && held.client !== client) held.client.dispose();
  held = { id, client };
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
