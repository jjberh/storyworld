import { describe, expect, it } from "vitest";
import type {
  Entity,
  WorldEvent,
  WorldState,
} from "@storyworld/contracts/model";
import {
  storyActionSchema,
  type StoryAction,
  type StorySequence,
} from "@storyworld/contracts/story-beat";
import {
  introDurationMs,
  KEEPSAKE_INTRO,
} from "../world-renderer/intro-motion";
import { BEAT_HOLD_MS } from "../world-renderer/story-playback";
import {
  buildKeepsakeScript,
  END_CARD_MS,
  fitBeats,
  KEEPSAKE_BEAT_MS,
  keepsakeBeatMs,
  MAX_MOVIE_MS,
  MIN_MOVIE_MS,
  momentScore,
  movieTitle,
  openingAfterIntro,
  pickBestMoment,
  PLANNED_MAX_MS,
  sequenceDurationMs,
  type KeepsakeScript,
} from "./keepsake-script";

const fox: Entity = {
  id: "fox",
  role: "character",
  description: "",
  properties: ["moves"],
  name: "Fox",
  bounds: { x: 100, y: 120, width: 200, height: 120 },
};
const river: Entity = {
  id: "river",
  role: "obstacle",
  description: "",
  properties: ["blocks"],
  name: "River",
  bounds: { x: 450, y: 30, width: 120, height: 540 },
};
const castle: Entity = {
  id: "castle",
  role: "goal",
  description: "",
  properties: ["goal"],
  name: "Castle",
  bounds: { x: 700, y: 120, width: 200, height: 120 },
};
const bridge: Entity = {
  id: "bridge",
  role: "helper",
  description: "",
  properties: ["carries"],
  name: "Bridge",
  bounds: { x: 430, y: 270, width: 160, height: 60 },
};
const cloud: Entity = {
  id: "cloud",
  role: "scenery",
  description: "",
  properties: ["weather"],
  name: "Cloud",
  bounds: { x: 600, y: 20, width: 160, height: 80 },
};

function world(revision: number, entities: Entity[]): WorldState {
  return {
    id: "world",
    revision,
    schemaVersion: 1,
    entities,
    rules: [],
    goal: { characterId: "fox", targetId: "castle" },
    pathStatus: entities.includes(bridge) ? "available" : "blocked",
    weather: entities.includes(cloud) ? "rain" : "clear",
    interaction: null,
    crossings: entities.includes(bridge)
      ? [{ obstacleId: "river", helperId: bridge.id }]
      : [],
  };
}

function event(revision: number, entities: Entity[]): WorldEvent {
  return {
    id: `event-${revision}`,
    revision,
    actor: "director",
    summary: `Revision ${revision}`,
    state: world(revision, entities),
  };
}

function sequence(event: WorldEvent, actions: StoryAction[]): StorySequence {
  return {
    mode: "fixture",
    requestId: `request-${event.id}`,
    sourceRevision: event.revision,
    sourceEventId: event.id,
    beats: actions.map((action, index) => ({
      id: `beat-${index}`,
      narration: `Beat ${index} of ${event.id}.`,
      mood: "curious",
      action,
    })),
  };
}

const opening = event(0, [fox, river, castle]);
const withCloud = event(1, [fox, river, castle, cloud]);
const withBridge = event(2, [fox, river, castle, cloud, bridge]);

const openingSequence = sequence(opening, [
  { type: "focus", entityId: "fox" },
  { type: "move_toward", entityId: "fox", targetId: "castle" },
  { type: "blocked_by", entityId: "fox", obstacleId: "river" },
]);
const cloudSequence = sequence(withCloud, [
  { type: "reveal", entityId: "cloud" },
  { type: "weather_shift", weather: "rain", causeEntityId: "cloud" },
]);
const bridgeSequence = sequence(withBridge, [
  { type: "reveal", entityId: "bridge" },
  { type: "move_toward", entityId: "fox", targetId: "castle" },
  { type: "celebrate", entityId: "fox" },
]);

function sequences(...items: StorySequence[]) {
  return new Map(items.map((item) => [item.sourceEventId, item]));
}

/** Steps tile the script end to end and sum to its total. */
function expectContiguous(script: KeepsakeScript) {
  let at = 0;
  for (const step of script.steps) {
    expect(step.startMs).toBe(at);
    expect(step.durationMs).toBeGreaterThan(0);
    at += step.durationMs;
  }
  expect(script.totalMs).toBe(at);
}

describe("momentScore and pickBestMoment", () => {
  it("prefers celebrations and journeys over plain reveals", () => {
    expect(momentScore(bridgeSequence)).toBeGreaterThan(
      momentScore(cloudSequence),
    );
    expect(
      momentScore(sequence(withCloud, [{ type: "focus", entityId: "fox" }])),
    ).toBe(0);
  });

  it("picks the richest later event, not the opening", () => {
    const events = [opening, withCloud, withBridge];
    expect(
      pickBestMoment(
        events,
        sequences(openingSequence, cloudSequence, bridgeSequence),
      ),
    ).toBe(2);
    // An older, richer moment beats a newer plain reveal.
    const reveal = event(3, [fox, river, castle, cloud, bridge]);
    expect(
      pickBestMoment(
        [...events, reveal],
        sequences(
          bridgeSequence,
          sequence(reveal, [{ type: "reveal", entityId: "castle" }]),
        ),
      ),
    ).toBe(2);
  });

  it("breaks a tie with the most recent event", () => {
    const again = event(3, [fox, river, castle, cloud]);
    expect(
      pickBestMoment(
        [opening, withCloud, again],
        sequences(
          cloudSequence,
          sequence(again, [
            { type: "reveal", entityId: "cloud" },
            { type: "weather_shift", weather: "rain" },
          ]),
        ),
      ),
    ).toBe(2);
  });

  it("finds no moment without a scored later sequence", () => {
    expect(
      pickBestMoment([opening, withCloud], sequences(openingSequence)),
    ).toBeUndefined();
    expect(
      pickBestMoment(
        [opening, withCloud],
        sequences(sequence(withCloud, [{ type: "focus", entityId: "fox" }])),
      ),
    ).toBeUndefined();
  });
});

describe("buildKeepsakeScript", () => {
  it("returns null before anything is committed", () => {
    expect(buildKeepsakeScript({ events: [], sequences: new Map() })).toBe(
      null,
    );
  });

  it("plays the reveal, the opening and the best moment, then an end card", () => {
    const script = buildKeepsakeScript({
      events: [opening, withCloud, withBridge],
      sequences: sequences(openingSequence, cloudSequence, bridgeSequence),
      openingNarration: "Fox explores.",
    })!;
    expectContiguous(script);
    expect(script.totalMs).toBeGreaterThanOrEqual(MIN_MOVIE_MS);
    expect(script.totalMs).toBeLessThanOrEqual(MAX_MOVIE_MS);
    expect(script.momentEventId).toBe(withBridge.id);
    expect(script.title).toBe("Fox's story");
    expect(script.steps.map((step) => step.kind)).toEqual([
      "intro",
      "play",
      "play",
      "hold",
    ]);
    const [intro, first, moment, card] = script.steps;
    expect(intro).toMatchObject({
      kind: "intro",
      world: opening.state,
      caption: "Fox explores.",
      durationMs: introDurationMs(3, KEEPSAKE_INTRO),
    });
    expect(first).toMatchObject({ role: "opening", sequence: openingSequence });
    // The moment starts from the world before it, then shows its own world.
    expect(moment).toMatchObject({
      role: "moment",
      sequence: bridgeSequence,
      before: withCloud.state,
      world: withBridge.state,
    });
    expect(card).toMatchObject({
      kind: "hold",
      durationMs: END_CARD_MS,
      titleCard: { title: "Fox's story", subtitle: "Made with Storyworld" },
    });
  });

  it("plays every beat whole at the budget's cap: play steps are never cut", () => {
    const script = buildKeepsakeScript({
      events: [opening, withBridge],
      sequences: sequences(openingSequence, bridgeSequence),
    })!;
    // Two 3-beat sequences at the live 2–4 s holds need the budget's cap.
    expect(script.maxBeatMs).toBeGreaterThanOrEqual(KEEPSAKE_BEAT_MS);
    expect(script.maxBeatMs).toBeLessThan(BEAT_HOLD_MS.celebrate);
    for (const step of script.steps)
      if (step.kind === "play") {
        expect(step.durationMs).toBe(
          sequenceDurationMs(step.sequence, false, script.maxBeatMs),
        );
        expect(step.durationMs).toBeGreaterThanOrEqual(
          step.sequence.beats.length * KEEPSAKE_BEAT_MS,
        );
      }
  });

  it("is reveal plus idle when there is no story moment yet", () => {
    // A long opening already fills the 10 s, so no idle hold is needed.
    const full = buildKeepsakeScript({
      events: [opening],
      sequences: sequences(openingSequence),
    })!;
    expectContiguous(full);
    expect(full.maxBeatMs).toBeUndefined();
    expect(full.totalMs).toBe(
      introDurationMs(3, KEEPSAKE_INTRO) +
        sequenceDurationMs(openingSequence) +
        END_CARD_MS,
    );
    expect(full.totalMs).toBeGreaterThanOrEqual(MIN_MOVIE_MS);
    expect(full.totalMs).toBeLessThanOrEqual(PLANNED_MAX_MS);
    expect(full.steps.map((step) => step.kind)).toEqual([
      "intro",
      "play",
      "hold",
    ]);

    const script = buildKeepsakeScript({
      events: [opening],
      sequences: sequences(
        sequence(opening, [{ type: "focus", entityId: "fox" }]),
      ),
    })!;
    expectContiguous(script);
    expect(script.momentEventId).toBeUndefined();
    expect(script.totalMs).toBe(MIN_MOVIE_MS);
    expect(script.steps.map((step) => step.kind)).toEqual([
      "intro",
      "play",
      "hold",
      "hold",
    ]);
    expect(script.steps[2]).toMatchObject({ titleCard: null });
    expect(script.steps.at(-1)).toMatchObject({ durationMs: END_CARD_MS });

    // Without even an opening sequence it is still at least 10 s.
    const bare = buildKeepsakeScript({
      events: [opening],
      sequences: new Map(),
      openingNarration: "  ",
    })!;
    expectContiguous(bare);
    expect(bare.totalMs).toBe(MIN_MOVIE_MS);
    expect(bare.steps[0]).toMatchObject({
      caption: "A drawing comes to life.",
    });
  });

  it("stays within 10–15 seconds for any drawing size and sequence mix", () => {
    const threeBeats = (item: WorldEvent) =>
      sequence(item, [
        { type: "reveal", entityId: "fox" },
        { type: "move_toward", entityId: "fox", targetId: "castle" },
        { type: "celebrate", entityId: "fox" },
      ]);
    const oneBeat = (item: WorldEvent) =>
      sequence(item, [{ type: "reveal", entityId: "fox" }]);
    for (const pieces of [1, 3, 8, 20, 60])
      for (const reducedMotion of [false, true])
        for (const make of [threeBeats, oneBeat]) {
          const crowd = Array.from({ length: pieces - 1 }, (_, index) => ({
            ...castle,
            id: `piece-${index}`,
          }));
          const first = event(0, [fox, ...crowd]);
          const second = event(1, [fox, castle, ...crowd]);
          for (const history of [[first], [first, second]] as WorldEvent[][]) {
            const script = buildKeepsakeScript({
              events: history,
              sequences: sequences(...history.map(make)),
              reducedMotion,
            })!;
            expectContiguous(script);
            expect(script.totalMs).toBeGreaterThanOrEqual(MIN_MOVIE_MS);
            expect(script.totalMs).toBeLessThanOrEqual(MAX_MOVIE_MS);
            // The end card always closes the movie.
            expect(script.steps.at(-1)).toMatchObject({
              kind: "hold",
              titleCard: { title: "Fox's story" },
            });
          }
        }
  });

  it("names the movie after the hero", () => {
    expect(movieTitle("Nova")).toBe("Nova's story");
    expect(movieTitle(undefined)).toBe("Our Storyworld story");
    const heroless = { ...opening, state: { ...opening.state, goal: null } };
    const script = buildKeepsakeScript({
      events: [heroless],
      sequences: new Map(),
    })!;
    expect(script.heroName).toBe("Fox");
  });
});

describe("fitBeats", () => {
  const long = sequence(opening, [
    { type: "celebrate", entityId: "fox" },
    { type: "focus", entityId: "fox" },
  ]);

  it("leaves holds alone when they fit", () => {
    expect(fitBeats([long], 6500)).toEqual({ maxBeatMs: undefined });
    expect(sequenceDurationMs(long)).toBe(
      BEAT_HOLD_MS.celebrate + BEAT_HOLD_MS.focus,
    );
  });

  it("shortens the longest holds first, never below the keepsake hold", () => {
    // 3500 + 2000 does not fit 5000; capping the celebration at 3000 does.
    const fit = fitBeats([long], 5000)!;
    expect(fit.maxBeatMs).toBe(5000 - BEAT_HOLD_MS.focus);
    expect(sequenceDurationMs(long, false, fit.maxBeatMs)).toBe(5000);
    expect(keepsakeBeatMs(long.beats[1].action, 100)).toBe(KEEPSAKE_BEAT_MS);
    expect(fitBeats([long], 2 * KEEPSAKE_BEAT_MS)).toEqual({
      maxBeatMs: KEEPSAKE_BEAT_MS,
    });
    expect(fitBeats([long], 2 * KEEPSAKE_BEAT_MS - 1)).toBeNull();
  });
});

describe("openingAfterIntro", () => {
  it("turns opening reveals into focus beats so lifted pieces never blink", () => {
    const revealing = sequence(opening, [
      { type: "reveal", entityId: "castle" },
      { type: "move_toward", entityId: "fox", targetId: "castle" },
    ]);
    const script = buildKeepsakeScript({
      events: [opening],
      sequences: sequences(revealing),
    })!;
    const step = script.steps.find((item) => item.kind === "play");
    expect(step?.kind === "play" && step.sequence.beats).toEqual([
      { ...revealing.beats[0], action: { type: "focus", entityId: "castle" } },
      revealing.beats[1],
    ]);
    // Two plain beats: no reveal hold and no frames waiting for a reveal.
    expect(step?.durationMs).toBe(
      BEAT_HOLD_MS.focus + BEAT_HOLD_MS.move_toward,
    );
    // The room's own history is left alone.
    expect(revealing.beats[0].action.type).toBe("reveal");
    expect(openingAfterIntro(revealing).sourceEventId).toBe(opening.id);
  });
});

describe("the 15 second ceiling", () => {
  const crowd = Array.from({ length: 200 }, (_, index) => ({
    ...castle,
    id: `piece-${index}`,
  }));
  const first = event(0, [fox, ...crowd]);
  const second = event(1, [fox, ...crowd, bridge]);
  const threeBeats = (item: WorldEvent) =>
    sequence(item, [
      { type: "reveal", entityId: "fox" },
      { type: "move_toward", entityId: "fox", targetId: "castle" },
      { type: "celebrate", entityId: "fox" },
    ]);

  /** Every play step lasts exactly its beats at the script's beat cap. */
  function expectWholeBeats(script: KeepsakeScript) {
    for (const step of script.steps)
      if (step.kind === "play")
        expect(step.durationMs).toBe(
          sequenceDurationMs(step.sequence, false, script.maxBeatMs),
        );
  }

  it("shortens the live holds to fit a crowded drawing, a 3-beat opening and a 3-beat moment", () => {
    const script = buildKeepsakeScript({
      events: [first, second],
      sequences: sequences(threeBeats(first), threeBeats(second)),
    })!;
    expectContiguous(script);
    expectWholeBeats(script);
    // Both sequences still play, every beat whole and readable.
    expect(script.steps.map((step) => step.kind)).toEqual([
      "intro",
      "play",
      "play",
      "hold",
    ]);
    expect(script.maxBeatMs).toBeGreaterThanOrEqual(KEEPSAKE_BEAT_MS);
    expect(script.maxBeatMs).toBeLessThan(BEAT_HOLD_MS.reveal);
    expect(script.totalMs).toBeLessThanOrEqual(PLANNED_MAX_MS);
    expect(script.totalMs).toBeGreaterThanOrEqual(MIN_MOVIE_MS);
    expect(script.steps.at(-1)).toMatchObject({ durationMs: END_CARD_MS });
  });

  it("keeps the live holds when a small drawing leaves room", () => {
    const small = event(0, [fox, river, castle]);
    const next = event(1, [fox, river, castle, bridge]);
    const script = buildKeepsakeScript({
      events: [small, next],
      sequences: sequences(
        sequence(small, [{ type: "focus", entityId: "fox" }]),
        sequence(next, [{ type: "celebrate", entityId: "fox" }]),
      ),
    })!;
    expect(script.maxBeatMs).toBeUndefined();
    const moment = script.steps.find(
      (step) => step.kind === "play" && step.role === "moment",
    );
    expect(moment?.durationMs).toBe(BEAT_HOLD_MS.celebrate);
  });

  it("drops the opening when even the shortest holds overrun", () => {
    // Longer than the contract allows, to force the fallback.
    const longOpening = sequence(
      first,
      Array.from({ length: 6 }, () => ({
        type: "focus" as const,
        entityId: "fox",
      })),
    );
    const script = buildKeepsakeScript({
      events: [first, second],
      sequences: sequences(longOpening, threeBeats(second)),
    })!;
    expectContiguous(script);
    expectWholeBeats(script);
    expect(script.steps.map((step) => step.kind)).toEqual([
      "intro",
      "play",
      "hold",
    ]);
    expect(script.steps[1]).toMatchObject({ role: "moment" });
    // Without the opening the moment keeps its full live holds.
    expect(script.maxBeatMs).toBeUndefined();
    expect(script.steps[1].durationMs).toBe(
      BEAT_HOLD_MS.reveal +
        50 +
        BEAT_HOLD_MS.move_toward +
        BEAT_HOLD_MS.celebrate,
    );
    expect(script.totalMs).toBeLessThanOrEqual(PLANNED_MAX_MS);
  });

  it("fits three of any beat in both sequences, at any drawing size", () => {
    const types = storyActionSchema.options.map(
      (option) => option.shape.type.value,
    );
    const actionOf = (type: StoryAction["type"]): StoryAction => {
      switch (type) {
        case "move_toward":
          return { type, entityId: "fox", targetId: "castle" };
        case "blocked_by":
        case "fly_over":
        case "splash":
          return { type, entityId: "fox", obstacleId: "river" };
        case "ride":
          return { type, entityId: "fox", carrierId: "bridge" };
        case "launch":
          return { type, entityId: "fox", launcherId: "bridge" };
        case "react":
          return {
            type,
            entityId: "fox",
            causeId: "bridge",
            reaction: "happy",
          };
        case "weather_shift":
          return { type, weather: "rain" };
        default:
          return { type, entityId: "fox" };
      }
    };
    for (const pieces of [1, 3, 20, 200])
      for (const type of types)
        for (const reducedMotion of [false, true]) {
          const crowd = Array.from({ length: pieces - 1 }, (_, index) => ({
            ...castle,
            id: `piece-${index}`,
          }));
          const start = event(0, [fox, ...crowd]);
          const moment = event(1, [fox, ...crowd, bridge]);
          const three = (item: WorldEvent) =>
            sequence(item, [actionOf(type), actionOf(type), actionOf(type)]);
          const script = buildKeepsakeScript({
            events: [start, moment],
            sequences: sequences(three(start), three(moment)),
            reducedMotion,
          })!;
          expectContiguous(script);
          // Both sequences play whole (a focus-only one scores nothing, so
          // it is never the moment), and the end card closes the movie.
          expect(
            script.steps.filter((step) => step.kind === "play"),
          ).toHaveLength(type === "focus" ? 1 : 2);
          expect(script.steps.at(-1)).toMatchObject({
            durationMs: END_CARD_MS,
            titleCard: { title: "Fox's story" },
          });
          for (const step of script.steps)
            if (step.kind === "play")
              expect(step.durationMs).toBe(
                sequenceDurationMs(
                  step.sequence,
                  reducedMotion,
                  script.maxBeatMs,
                ),
              );
          expect(script.totalMs).toBeGreaterThanOrEqual(MIN_MOVIE_MS);
          expect(script.totalMs).toBeLessThanOrEqual(PLANNED_MAX_MS);
        }
  });

  it("holds for the longest script the contract allows", () => {
    // Three beats is the contract's cap; three reveals are the longest beats,
    // and a crowded drawing gives the longest intro.
    const crowd = Array.from({ length: 200 }, (_, index) => ({
      ...castle,
      id: `piece-${index}`,
    }));
    const first = event(0, [fox, ...crowd]);
    const second = event(1, [fox, ...crowd, bridge]);
    const reveals = (item: WorldEvent) =>
      sequence(item, [
        { type: "reveal", entityId: "fox" },
        { type: "reveal", entityId: "piece-0" },
        { type: "reveal", entityId: "piece-1" },
      ]);
    const script = buildKeepsakeScript({
      events: [first, second],
      sequences: sequences(reveals(first), reveals(second)),
    })!;
    expectContiguous(script);
    expect(script.steps.map((step) => step.kind)).toEqual([
      "intro",
      "play",
      "play",
      "hold",
    ]);
    expect(script.totalMs).toBeLessThanOrEqual(MAX_MOVIE_MS);
  });
});
