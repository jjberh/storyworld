import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldClient } from "@storyworld/contracts/model";
import {
  holdWorldClient,
  peekWorldClient,
  releaseWorldClient,
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
