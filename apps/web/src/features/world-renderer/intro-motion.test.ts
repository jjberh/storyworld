import { describe, expect, it } from "vitest";
import { RESTING_POSE } from "./stage-motion";
import {
  INTRO_LEAD_MS,
  INTRO_LIFT_MS,
  introBackdrop,
  introDurationMs,
  introPieceStartMs,
  RESTING_BACKDROP_ALPHA,
  sampleIntro,
  weightPose,
} from "./intro-motion";

describe("intro motion", () => {
  it("starts flat: every piece hidden over the full-strength drawing", () => {
    for (let index = 0; index < 3; index++)
      expect(sampleIntro(0, index, 3, false)).toEqual({
        pose: RESTING_POSE,
        alpha: 0,
        idle: 0,
      });
    expect(introBackdrop(0, 3)).toEqual({ backdropAlpha: 1, matteAlpha: 0 });
  });

  it("lifts each piece up, shakes it, and lands it at rest", () => {
    const start = introPieceStartMs(1, 3);
    const mid = sampleIntro(start + INTRO_LIFT_MS * 0.35, 1, 3, false);
    expect(mid.pose.dy).toBeLessThan(-15);
    expect(mid.pose.scaleX).toBeGreaterThan(1.05);
    expect(mid.alpha).toBe(1);
    const shaking = [0.3, 0.4, 0.5, 0.6].map(
      (t) => sampleIntro(start + INTRO_LIFT_MS * t, 1, 3, false).pose.rotation,
    );
    expect(Math.max(...shaking)).toBeGreaterThan(0.005);
    expect(Math.min(...shaking)).toBeLessThan(-0.005);
    expect(sampleIntro(start + INTRO_LIFT_MS, 1, 3, false)).toEqual({
      pose: RESTING_POSE,
      alpha: 1,
      idle: 1,
    });
  });

  it("staggers pieces and ends with the resting stage", () => {
    expect(introPieceStartMs(0, 3)).toBe(INTRO_LEAD_MS);
    expect(introPieceStartMs(2, 3)).toBeGreaterThan(introPieceStartMs(1, 3));
    const end = introDurationMs(3);
    for (let index = 0; index < 3; index++)
      expect(sampleIntro(end, index, 3, false).alpha).toBe(1);
    expect(introBackdrop(end, 3)).toEqual({
      backdropAlpha: RESTING_BACKDROP_ALPHA,
      matteAlpha: 1,
    });
  });

  it("keeps busy drawings short", () => {
    expect(introDurationMs(1)).toBeLessThan(2500);
    expect(introDurationMs(60)).toBeLessThanOrEqual(introDurationMs(8) + 1);
    expect(introDurationMs(60)).toBeLessThan(3500);
  });

  it("only fades pieces in under reduced motion", () => {
    const start = introPieceStartMs(0, 2);
    for (const t of [0.1, 0.35, 0.5, 0.9]) {
      const sample = sampleIntro(start + INTRO_LIFT_MS * t, 0, 2, true);
      expect(sample.pose).toEqual(RESTING_POSE);
      expect(sample.alpha).toBeGreaterThan(0);
      expect(sample.alpha).toBeLessThan(1);
    }
  });

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
