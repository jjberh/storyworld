import { describe, expect, it } from "vitest";
import { RESTING_POSE } from "./stage-motion";
import {
  DRAWING_LIFT,
  introBackdrop,
  introDurationMs,
  introPieceStartMs,
  KEEPSAKE_INTRO,
  liftOrder,
  LIVE_INTRO,
  RESTING_BACKDROP_ALPHA,
  sampleIntro,
  weightPose,
} from "./intro-motion";

const piece = (id: string, x: number, y = 100) => ({
  id,
  bounds: { x, y, width: 100, height: 100 },
});

describe.each([
  ["live", LIVE_INTRO],
  ["keepsake", KEEPSAKE_INTRO],
])("%s intro motion", (_name, timing) => {
  const lift = timing.liftMs;

  it("starts flat: every piece hidden over the full-strength drawing", () => {
    for (let index = 0; index < 3; index++)
      expect(sampleIntro(0, index, 3, false, timing)).toEqual({
        pose: RESTING_POSE,
        alpha: 0,
        idle: 0,
      });
    expect(introBackdrop(0, 3, timing)).toEqual({
      backdropAlpha: 1,
      matteAlpha: 0,
    });
  });

  it("lifts each piece up, shakes it, and lands it at rest", () => {
    const start = introPieceStartMs(1, 3, timing);
    const mid = sampleIntro(start + lift * 0.35, 1, 3, false, timing);
    expect(mid.pose.dy).toBeLessThan(-15);
    expect(mid.pose.scaleX).toBeGreaterThan(1.05);
    expect(mid.alpha).toBe(1);
    const shaking = [0.3, 0.4, 0.5, 0.6].map(
      (t) => sampleIntro(start + lift * t, 1, 3, false, timing).pose.rotation,
    );
    expect(Math.max(...shaking)).toBeGreaterThan(0.005);
    expect(Math.min(...shaking)).toBeLessThan(-0.005);
    expect(sampleIntro(start + lift, 1, 3, false, timing)).toEqual({
      pose: RESTING_POSE,
      alpha: 1,
      idle: 1,
    });
  });

  it("staggers pieces and ends with the resting stage", () => {
    expect(introPieceStartMs(0, 3, timing)).toBe(timing.leadMs);
    expect(introPieceStartMs(2, 3, timing)).toBeGreaterThan(
      introPieceStartMs(1, 3, timing),
    );
    const end = introDurationMs(3, timing);
    for (let index = 0; index < 3; index++)
      expect(sampleIntro(end, index, 3, false, timing).alpha).toBe(1);
    expect(introBackdrop(end, 3, timing)).toEqual({
      backdropAlpha: RESTING_BACKDROP_ALPHA,
      matteAlpha: 1,
    });
  });

  it("only fades pieces in under reduced motion", () => {
    const start = introPieceStartMs(0, 2, timing);
    for (const t of [0.1, 0.35, 0.5, 0.9]) {
      const sample = sampleIntro(start + lift * t, 0, 2, true, timing);
      expect(sample.pose).toEqual(RESTING_POSE);
      expect(sample.alpha).toBeGreaterThan(0);
      expect(sample.alpha).toBeLessThan(1);
    }
    // The gentle reveal takes as long as the full one.
    expect(sampleIntro(start - 1, 0, 2, true, timing).alpha).toBe(0);
    expect(sampleIntro(start + lift, 0, 2, true, timing).alpha).toBe(1);
  });
});

describe("keepsake intro", () => {
  it("keeps busy drawings short enough for the movie", () => {
    expect(introDurationMs(1, KEEPSAKE_INTRO)).toBeLessThan(2500);
    expect(introDurationMs(60, KEEPSAKE_INTRO)).toBeLessThanOrEqual(
      introDurationMs(8, KEEPSAKE_INTRO) + 1,
    );
    expect(introDurationMs(60, KEEPSAKE_INTRO)).toBeLessThanOrEqual(3250);
  });
});

describe("live reveal", () => {
  it("lasts 3 to 5 seconds, and busy scenes stay within 5", () => {
    for (const count of [1, 2, 3, 4, 6])
      expect(introDurationMs(count, LIVE_INTRO)).toBeGreaterThanOrEqual(3000);
    for (const count of [1, 3, 8, 20, 60, 200])
      expect(introDurationMs(count, LIVE_INTRO)).toBeLessThanOrEqual(5000);
    expect(introDurationMs(3, LIVE_INTRO)).toBe(3240);
    expect(introDurationMs(200, LIVE_INTRO)).toBe(3700);
  });

  it("lifts the pieces together, a small stagger apart", () => {
    for (const count of [2, 3, 8, 60]) {
      const last = introPieceStartMs(count - 1, count, LIVE_INTRO);
      const gap = introPieceStartMs(1, count, LIVE_INTRO) - LIVE_INTRO.leadMs;
      expect(gap).toBeLessThanOrEqual(120);
      // The last piece starts well before the first one lands, so every
      // piece is in the air at once.
      expect(last).toBeLessThan(LIVE_INTRO.leadMs + LIVE_INTRO.liftMs / 2);
      const moment = last + 1;
      for (let index = 0; index < count; index++)
        expect(
          sampleIntro(moment, index, count, false, LIVE_INTRO).pose.dy,
        ).toBeLessThan(0);
    }
  });

  it("orders pieces left to right, not by role: the hero is not last", () => {
    const hero = { ...piece("hero", 900), role: "character" };
    expect(liftOrder([hero, piece("river", 400), piece("castle", 50)])).toEqual(
      ["castle", "river", "hero"],
    );
    const leftHero = { ...piece("hero", 10), role: "character" };
    expect(liftOrder([piece("river", 400), leftHero])).toEqual([
      "hero",
      "river",
    ]);
    // Pieces in line lift top to bottom.
    expect(liftOrder([piece("low", 100, 400), piece("high", 100, 50)])).toEqual(
      ["high", "low"],
    );
  });

  it("ends with every piece at rest: no wave or extra gesture", () => {
    const count = 3;
    const lastLanding =
      introPieceStartMs(count - 1, count, LIVE_INTRO) + LIVE_INTRO.liftMs;
    for (
      let at = lastLanding;
      at <= introDurationMs(count, LIVE_INTRO);
      at += 50
    )
      for (let index = 0; index < count; index++)
        expect(sampleIntro(at, index, count, false, LIVE_INTRO)).toEqual({
          pose: RESTING_POSE,
          alpha: 1,
          idle: 1,
        });
    // The quiet tail is short.
    expect(introDurationMs(count, LIVE_INTRO) - lastLanding).toBe(
      LIVE_INTRO.settleMs,
    );
  });
});

describe("a new drawing's lift-off", () => {
  it("is shorter than the reveal and starts at once", () => {
    expect(introDurationMs(1, DRAWING_LIFT)).toBe(DRAWING_LIFT.liftMs);
    expect(introDurationMs(1, DRAWING_LIFT)).toBeLessThan(
      introDurationMs(1, LIVE_INTRO) / 2,
    );
    expect(introPieceStartMs(0, 1, DRAWING_LIFT)).toBe(0);
  });

  it("stays fully shown as its cutout hands over, rises, shakes and lands", () => {
    const lift = DRAWING_LIFT.liftMs;
    expect(sampleIntro(0, 0, 1, false, DRAWING_LIFT).alpha).toBe(1);
    expect(sampleIntro(lift * 0.05, 0, 1, false, DRAWING_LIFT).alpha).toBe(1);
    const up = sampleIntro(lift * 0.35, 0, 1, false, DRAWING_LIFT);
    expect(up.pose.dy).toBeLessThan(-15);
    const shaking = [0.3, 0.4, 0.5, 0.6].map(
      (t) => sampleIntro(lift * t, 0, 1, false, DRAWING_LIFT).pose.rotation,
    );
    expect(Math.max(...shaking)).toBeGreaterThan(0.005);
    expect(Math.min(...shaking)).toBeLessThan(-0.005);
    expect(sampleIntro(lift, 0, 1, false, DRAWING_LIFT)).toEqual({
      pose: RESTING_POSE,
      alpha: 1,
      idle: 1,
    });
  });

  it("only fades in under reduced motion", () => {
    const lift = DRAWING_LIFT.liftMs;
    expect(sampleIntro(0, 0, 1, true, DRAWING_LIFT).alpha).toBe(0);
    for (const t of [0.1, 0.35, 0.5, 0.9]) {
      const sample = sampleIntro(lift * t, 0, 1, true, DRAWING_LIFT);
      expect(sample.pose).toEqual(RESTING_POSE);
      expect(sample.alpha).toBeGreaterThan(0);
      expect(sample.alpha).toBeLessThan(1);
    }
  });
});

describe("weightPose", () => {
  it("weights a pose toward rest", () => {
    const pose = { dx: 10, dy: -4, scaleX: 1.2, scaleY: 0.8, rotation: 0.1 };
    expect(weightPose(pose, 0)).toEqual(RESTING_POSE);
    expect(weightPose(pose, 1)).toBe(pose);
    const half = weightPose(pose, 0.5);
    expect(half.dx).toBe(5);
    expect(half.scaleX).toBeCloseTo(1.1);
    expect(half.scaleY).toBeCloseTo(0.9);
  });
});
