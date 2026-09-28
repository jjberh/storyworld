import { describe, expect, it } from "vitest";
import { routeLabel } from "./route-label";

describe("routeLabel", () => {
  it("names free play instead of a missing route", () => {
    expect(routeLabel("free_play")).toBe("Free play: draw anything!");
    expect(routeLabel("free_play")).not.toMatch(/route/i);
  });

  it("keeps the goal labels", () => {
    expect(routeLabel("available")).toBe("Route opened");
    expect(routeLabel("blocked")).toBe("River blocks the route");
    expect(routeLabel("idle")).toBe("No route yet");
  });
});
