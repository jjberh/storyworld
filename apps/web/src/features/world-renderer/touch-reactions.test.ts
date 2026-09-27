import { describe, expect, it } from "vitest";
import type { EntityKind } from "@storyworld/contracts/model";
import {
  IDLE_REACTIONS,
  MIN_TOUCH_TARGET_PX,
  REACTION_COOLDOWN_MS,
  chooseReaction,
  reactionDurationMs,
  reactionsFor,
  sampleReaction,
  settleReaction,
  tapReaction,
  touchTarget,
  type ReactionKind,
  type TouchReaction,
} from "./touch-reactions";

const kinds: EntityKind[] = [
  "character",
  "cloud",
  "castle",
  "shelter",
  "river",
  "bridge",
];
const allReactions: ReactionKind[] = [
  "giggle",
  "jump",
  "spin",
  "wave",
  "highlight",
];
const size = { width: 120, height: 120 };

describe("reactionsFor", () => {
  it("lets characters do everything", () => {
    expect(reactionsFor("character")).toEqual([
      "giggle",
      "jump",
      "spin",
      "wave",
    ]);
  });

  it.each<EntityKind>(["river", "bridge"])(
    "keeps a %s on the ground",
    (kind) => {
      expect(reactionsFor(kind)).not.toContain("jump");
      expect(reactionsFor(kind)).not.toContain("spin");
    },
  );

  it.each(kinds)("gives a %s at least two reactions", (kind) => {
    expect(reactionsFor(kind).length).toBeGreaterThanOrEqual(2);
  });
});

describe("chooseReaction", () => {
  it("is deterministic for a seed and tap count", () => {
    for (let tap = 0; tap < 10; tap++)
      expect(chooseReaction("character", 0.37, tap)).toBe(
        chooseReaction("character", 0.37, tap),
      );
  });

  it("never repeats the previous reaction and uses the whole set", () => {
    for (const kind of kinds) {
      const seen = new Set<TouchReaction>();
      let previous: TouchReaction | undefined;
      for (let tap = 0; tap < 40; tap++) {
        const next = chooseReaction(kind, 0.61, tap, previous);
        expect(reactionsFor(kind)).toContain(next);
        if (previous) expect(next).not.toBe(previous);
        seen.add(next);
        previous = next;
      }
      expect(seen.size).toBe(reactionsFor(kind).length);
    }
  });

  it("differs between pieces with different seeds", () => {
    const first = (seed: number) =>
      Array.from({ length: 6 }, (_, tap) =>
        chooseReaction("character", seed, tap),
      ).join();
    expect(first(0.1)).not.toBe(first(0.7));
  });
});

describe("tapReaction", () => {
  it("starts a reaction straight away", () => {
    const { state, started } = tapReaction(
      IDLE_REACTIONS,
      "character",
      0.2,
      1000,
      false,
    );
    expect(started).toBeDefined();
    expect(state.active).toEqual({ reaction: started, startMs: 1000 });
    expect(state.taps).toBe(1);
  });

  it("ignores taps during a reaction and its cooldown, then accepts one", () => {
    const first = tapReaction(IDLE_REACTIONS, "character", 0.2, 0, false);
    const duration = reactionDurationMs(first.started!);
    const during = tapReaction(first.state, "character", 0.2, 50, false);
    expect(during.started).toBeUndefined();
    expect(during.state).toBe(first.state);
    const cooling = tapReaction(
      first.state,
      "character",
      0.2,
      duration + REACTION_COOLDOWN_MS - 1,
      false,
    );
    expect(cooling.started).toBeUndefined();
    const later = tapReaction(
      settleReaction(first.state, duration + REACTION_COOLDOWN_MS),
      "character",
      0.2,
      duration + REACTION_COOLDOWN_MS,
      false,
    );
    expect(later.started).toBeDefined();
    expect(later.started).not.toBe(first.started);
    expect(later.state.taps).toBe(2);
  });

  it("uses a highlight under reduced motion", () => {
    const { started, state } = tapReaction(
      IDLE_REACTIONS,
      "character",
      0.2,
      0,
      true,
    );
    expect(started).toBe("highlight");
    expect(state.last).toBeUndefined();
  });
});

describe("settleReaction", () => {
  it("keeps a playing reaction and drops a finished one", () => {
    const { state } = tapReaction(IDLE_REACTIONS, "river", 0.5, 100, false);
    const duration = reactionDurationMs(state.active!.reaction);
    expect(settleReaction(state, 100 + duration - 1)).toBe(state);
    expect(settleReaction(state, 100 + duration).active).toBeUndefined();
    expect(settleReaction(IDLE_REACTIONS, 5000)).toBe(IDLE_REACTIONS);
  });
});

describe("sampleReaction", () => {
  it.each(allReactions)("%s lasts under a second", (reaction) => {
    expect(reactionDurationMs(reaction)).toBeGreaterThan(0);
    expect(reactionDurationMs(reaction)).toBeLessThan(1000);
  });

  it.each(allReactions)("%s starts and ends at rest", (reaction) => {
    const duration = reactionDurationMs(reaction);
    for (const elapsed of [-10, 0, duration, duration + 100]) {
      const frame = sampleReaction(reaction, elapsed, size);
      expect(frame.pose.dx).toBeCloseTo(0, 6);
      expect(frame.pose.dy).toBeCloseTo(0, 6);
      expect(frame.pose.scaleX).toBeCloseTo(1, 6);
      expect(frame.pose.scaleY).toBeCloseTo(1, 6);
      expect(frame.glow).toBeCloseTo(0, 6);
    }
    // Spin ends a full turn round, which looks identical to rest.
    const end = sampleReaction(reaction, duration - 0.001, size).pose;
    expect(Math.abs(Math.sin(end.rotation))).toBeLessThan(1e-3);
  });

  it.each<TouchReaction>(["giggle", "jump", "spin", "wave"])(
    "%s visibly moves early and mid-way",
    (reaction) => {
      const moved = (elapsed: number) => {
        const { pose } = sampleReaction(reaction, elapsed, size);
        return Math.max(
          Math.abs(pose.dx),
          Math.abs(pose.dy),
          Math.abs(pose.scaleX - 1) * 100,
          Math.abs(pose.scaleY - 1) * 100,
          Math.abs(pose.rotation) * 100,
        );
      };
      // Something shows within the first 100 ms of the tap.
      expect(
        Math.max(...[40, 60, 80, 100].map((elapsed) => moved(elapsed))),
      ).toBeGreaterThan(2);
      // And keeps moving through the middle (sampled over a window, since
      // oscillating reactions pass through rest).
      const duration = reactionDurationMs(reaction);
      expect(
        Math.max(
          ...[0.3, 0.35, 0.4, 0.45, 0.5].map((t) => moved(duration * t)),
        ),
      ).toBeGreaterThan(2);
    },
  );

  it("changes smoothly frame to frame", () => {
    for (const reaction of allReactions) {
      const duration = reactionDurationMs(reaction);
      let previous = sampleReaction(reaction, 0, size);
      for (let elapsed = 8; elapsed <= duration + 16; elapsed += 8) {
        const frame = sampleReaction(reaction, elapsed, size);
        expect(Math.abs(frame.pose.dy - previous.pose.dy)).toBeLessThan(12);
        // Turning compares on the circle: a full turn back to 0 is no jump.
        const turn = Math.abs(frame.pose.rotation - previous.pose.rotation);
        expect(Math.min(turn, Math.PI * 2 - turn)).toBeLessThan(0.35);
        expect(Math.abs(frame.glow - previous.glow)).toBeLessThan(0.2);
        previous = frame;
      }
    }
  });

  it("keeps a giggling piece's feet on the ground", () => {
    for (let elapsed = 0; elapsed < 520; elapsed += 20) {
      const { pose } = sampleReaction("giggle", elapsed, size);
      const feet = pose.dy + (size.height / 2) * pose.scaleY;
      expect(feet).toBeCloseTo(size.height / 2, 6);
    }
  });

  it("rocks a waving piece about its feet", () => {
    for (let elapsed = 0; elapsed < 640; elapsed += 20) {
      const { pose } = sampleReaction("wave", elapsed, size);
      const half = size.height / 2;
      // Where the bottom centre ends up after rotating about the centre.
      const x = pose.dx - half * Math.sin(pose.rotation);
      const y = pose.dy + half * Math.cos(pose.rotation);
      expect(x).toBeCloseTo(0, 6);
      expect(y).toBeCloseTo(half, 6);
    }
  });

  it("jumps upward and keeps tall pieces modest", () => {
    const peak = (height: number) =>
      Math.min(
        ...Array.from(
          { length: 60 },
          (_, index) =>
            sampleReaction("jump", index * 10, { width: 100, height }).pose.dy,
        ),
      );
    expect(peak(120)).toBeLessThan(-30);
    expect(peak(600)).toBeGreaterThanOrEqual(-75);
    const wave = (height: number) =>
      Math.max(
        ...Array.from({ length: 64 }, (_, index) =>
          Math.abs(
            sampleReaction("wave", index * 10, { width: 100, height }).pose
              .rotation,
          ),
        ),
      );
    expect(wave(540)).toBeLessThan(wave(120) / 2);
  });

  it("only glows for a highlight", () => {
    const mid = sampleReaction("highlight", 300, size);
    expect(mid.glow).toBeGreaterThan(0.5);
    expect(mid.pose).toEqual({
      dx: 0,
      dy: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
    expect(sampleReaction("jump", 300, size).glow).toBe(0);
  });
});

describe("touchTarget", () => {
  it("pads thin pieces to a comfortable touch target", () => {
    // A phone-sized stage: 350 CSS px across a 1000-unit world.
    const scale = 350 / 1000;
    const target = touchTarget({ width: 200, height: 12 }, scale);
    expect(target.width).toBe(200);
    expect(target.height * scale).toBeCloseTo(MIN_TOUCH_TARGET_PX, 6);
    expect(target.y).toBeCloseTo(-target.height / 2, 6);
    expect(target.x).toBe(-100);
  });

  it("keeps large pieces at their own size", () => {
    expect(touchTarget({ width: 200, height: 120 }, 1)).toEqual({
      x: -100,
      y: -60,
      width: 200,
      height: 120,
    });
  });
});
