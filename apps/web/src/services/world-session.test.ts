import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldClient } from "@storyworld/contracts/model";
import {
  holdWorldClient,
  peekWorldClient,
  releaseWorldClient,
  markRoomRevealed,
  roomOwesReveal,
  worldRoomHref,
} from "./world-session";

function fakeClient(): WorldClient {
  return { dispose: vi.fn() } as unknown as WorldClient;
}

afterEach(() => {
  releaseWorldClient("story-1");
  releaseWorldClient("story-2");
});

describe("world session", () => {
  it("holds one client per world id and disposes a replaced client", () => {
    const first = fakeClient();
    const second = fakeClient();
    holdWorldClient("story-1", first);
    expect(peekWorldClient("story-1")).toBe(first);
    expect(peekWorldClient("story-2")).toBeUndefined();
    holdWorldClient("story-1", second);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(peekWorldClient("story-1")).toBe(second);
    holdWorldClient("story-1", second);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it("release disposes only the matching held client", () => {
    const client = fakeClient();
    holdWorldClient("story-1", client);
    releaseWorldClient("story-2");
    expect(client.dispose).not.toHaveBeenCalled();
    expect(peekWorldClient("story-1")).toBe(client);
    releaseWorldClient("story-1");
    expect(client.dispose).toHaveBeenCalledOnce();
    expect(peekWorldClient("story-1")).toBeUndefined();
  });

  it("owes the room its lift-off reveal until a stage starts it", () => {
    const client = fakeClient();
    holdWorldClient("story-1", client, { reveal: true });
    expect(roomOwesReveal("story-2")).toBe(false);
    // Reading is pure: a render that runs twice sees the same answer.
    expect(roomOwesReveal("story-1")).toBe(true);
    expect(roomOwesReveal("story-1")).toBe(true);
    markRoomRevealed("story-2");
    expect(roomOwesReveal("story-1")).toBe(true);
    markRoomRevealed("story-1");
    // Started: opening the room again on this page skips the reveal.
    expect(roomOwesReveal("story-1")).toBe(false);
    markRoomRevealed("story-1");
    expect(roomOwesReveal("story-1")).toBe(false);
    expect(peekWorldClient("story-1")).toBe(client);
  });

  it("owes no reveal unless Start my story asked for one", () => {
    // A room opened without a held client (a reload, a guest link, another
    // tab) is owed nothing.
    expect(roomOwesReveal("story-1")).toBe(false);
    holdWorldClient("story-1", fakeClient());
    expect(roomOwesReveal("story-1")).toBe(false);
    // Releasing the client drops a reveal that never started.
    holdWorldClient("story-2", fakeClient(), { reveal: true });
    releaseWorldClient("story-2");
    expect(roomOwesReveal("story-2")).toBe(false);
  });

  it("builds a shareable room URL and leaves /join", () => {
    expect(
      worldRoomHref("story-abc", "live", {
        pathname: "/join",
        search: "?mode=live&fixture=nova",
      }),
    ).toBe("/?mode=live&world=story-abc");
    expect(
      worldRoomHref("story-abc", "fixture", {
        pathname: "/",
        search: "?mode=live",
      }),
    ).toBe("/?mode=fixture&world=story-abc");
  });
});
