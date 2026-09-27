import { describe, expect, it } from "vitest";
import type { EntityKind } from "@storyworld/contracts/model";
import {
  RESTING_POSE,
  approach,
  beatPulse,
  beatPulseDurationMs,
  combinePoses,
  idleMotionFor,
  motionPeriodMs,
  sampleMotion,
  seedFor,
  tweenOffset,
  type IdleMotion,
  type Pose,
} from "./stage-motion";

const motions: IdleMotion[] = ["hop", "drift", "shimmer", "breathe"];

function distance(a: Pose, b: Pose) {
  return Math.max(
    Math.abs(a.dx - b.dx),
    Math.abs(a.dy - b.dy),
    Math.abs(a.scaleX - b.scaleX),
    Math.abs(a.scaleY - b.scaleY),
    Math.abs(a.rotation - b.rotation),
  );
}

describe("idleMotionFor", () => {
  it.each<[EntityKind, IdleMotion]>([
    ["character", "hop"],
    ["cloud", "drift"],
    ["river", "shimmer"],
    ["bridge", "breathe"],
    ["castle", "breathe"],
    ["shelter", "breathe"],
  ])("gives a %s the %s loop", (kind, motion) => {
    expect(idleMotionFor({ kind })).toBe(motion);
  });
});

describe("sampleMotion", () => {
  it.each(motions)("%s loops every 1–2 seconds", (motion) => {
    const period = motionPeriodMs(motion);
    expect(period).toBeGreaterThanOrEqual(1000);
    expect(period).toBeLessThanOrEqual(2000);
    for (const time of [0, 137, 480, 999, 1700]) {
      expect(
        distance(
          sampleMotion(motion, time, 0.3),
          sampleMotion(motion, time + period, 0.3),
        ),
      ).toBeLessThan(1e-9);
    }
  });

  it.each(motions)("%s stays small", (motion) => {
    for (let time = 0; time < 2000; time += 10) {
      const pose = sampleMotion(motion, time, 0.1);
      expect(Math.abs(pose.dx)).toBeLessThanOrEqual(8);
      expect(Math.abs(pose.dy)).toBeLessThanOrEqual(8);
      expect(Math.abs(pose.scaleX - 1)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(pose.scaleY - 1)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(pose.rotation)).toBeLessThanOrEqual(0.03);
    }
  });

  it.each(motions)("%s is smooth from frame to frame", (motion) => {
    for (let time = 0; time < 2000; time += 16) {
      const step = distance(
        sampleMotion(motion, time, 0.7),
        sampleMotion(motion, time + 16, 0.7),
      );
      expect(step).toBeLessThan(1);
    }
  });

  it("offsets the phase per seed so pieces do not move in lockstep", () => {
    const a = sampleMotion("hop", 300, seedFor("fox"));
    const b = sampleMotion("hop", 300, seedFor("hare"));
    expect(distance(a, b)).toBeGreaterThan(0.01);
    expect(
      distance(
        sampleMotion("breathe", 250, 0.25),
        sampleMotion("breathe", 250 + 0.25 * 2000, 0),
      ),
    ).toBeLessThan(1e-9);
  });

  it("accepts negative times", () => {
    expect(
      distance(sampleMotion("drift", -500, 0), sampleMotion("drift", 1500, 0)),
    ).toBeLessThan(1e-9);
  });
});

describe("seedFor", () => {
  it("is stable and within [0, 1)", () => {
    expect(seedFor("fox")).toBe(seedFor("fox"));
    for (const id of ["", "fox", "river", "bridge-7"]) {
      expect(seedFor(id)).toBeGreaterThanOrEqual(0);
      expect(seedFor(id)).toBeLessThan(1);
    }
  });
});

describe("beatPulse", () => {
  it("rests outside its duration and for beats without a flourish", () => {
    expect(beatPulse("focus", 700, 100).pose).toEqual(RESTING_POSE);
    expect(beatPulse("move_toward", 100, 100).pose).toEqual(RESTING_POSE);
    expect(beatPulseDurationMs("weather_shift")).toBe(0);
  });

  it("glows and grows at the middle of a focus beat", () => {
    const pulse = beatPulse("focus", 270, 100);
    expect(pulse.glow).toBeCloseTo(1);
    expect(pulse.pose.scaleX).toBeCloseTo(1.04);
  });

  it("pops a reveal in from a smaller transparent piece", () => {
    const start = beatPulse("reveal", 0, 100);
    expect(start.alpha).toBe(0);
    expect(start.pose.scaleX).toBeCloseTo(0.82);
    expect(beatPulse("reveal", 299, 100).alpha).toBeGreaterThan(0.99);
  });

  it("wobbles a blocked piece left then right", () => {
    expect(beatPulse("blocked_by", 120, 100).pose.dx).toBeCloseTo(-5);
    expect(beatPulse("blocked_by", 336, 100).pose.dx).toBeCloseTo(4);
  });

  it("jumps a celebrating piece by 15% of its height", () => {
    expect(beatPulse("celebrate", 324, 200).pose.dy).toBeCloseTo(-30);
  });
});

describe("tweens", () => {
  it("combines poses by adding offsets and multiplying scales", () => {
    const pose = combinePoses(
      { dx: 1, dy: 2, scaleX: 1.1, scaleY: 0.9, rotation: 0.1 },
      { dx: 3, dy: -1, scaleX: 2, scaleY: 2, rotation: 0.2 },
    );
    expect(pose.dx).toBe(4);
    expect(pose.dy).toBe(1);
    expect(pose.scaleX).toBeCloseTo(2.2);
    expect(pose.scaleY).toBeCloseTo(1.8);
    expect(pose.rotation).toBeCloseTo(0.3);
  });

  it("slides an offset from start to end with a soft landing", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: -50 };
    expect(tweenOffset(from, to, 0)).toEqual(from);
    expect(tweenOffset(from, to, 600)).toEqual(to);
    expect(tweenOffset(from, to, 5000)).toEqual(to);
    const half = tweenOffset(from, to, 300);
    expect(half.x).toBeGreaterThan(50);
    expect(half.x).toBeLessThan(100);
    expect(tweenOffset(from, to, 0, 0)).toEqual(to);
  });

  it("approaches a target at a fixed rate without overshooting", () => {
    expect(approach(0, 1, 120, 240)).toBe(0.5);
    expect(approach(0.9, 1, 120, 240)).toBe(1);
    expect(approach(1, 0, 60, 240)).toBe(0.75);
    expect(approach(1, 0, 16, 0)).toBe(0);
  });
});
