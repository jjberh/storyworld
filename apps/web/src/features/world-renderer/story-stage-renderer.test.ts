import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { Entity, WorldState } from "@storyworld/contracts/model";
import type { StorySequence } from "@storyworld/contracts/story-beat";

// Pixi needs a real WebGL context, so these lifecycle tests swap in a small
// stand-in that records what the renderer creates and destroys.
const pixi = vi.hoisted(() => {
  const state = {
    apps: [] as FakeApplication[],
    textures: [] as FakeTexture[],
    initResult: "resolve" as "resolve" | "reject" | "defer",
  };

  class FakeContainer {
    children: FakeContainer[] = [];
    destroyed = false;
    alpha = 1;
    rotation = 0;
    label: string | undefined;
    eventMode: string | undefined;
    cursor: string | undefined;
    hitArea: unknown;
    interactiveChildren = true;
    handlers: Record<string, ((event: { button: number }) => void)[]> = {};
    position = { set: () => undefined };
    scale = { set: () => undefined };
    anchor = { set: () => undefined };
    constructor(options?: { label?: string }) {
      this.label = options?.label;
    }
    addChild(...children: FakeContainer[]) {
      this.children.push(...children);
      return children[0];
    }
    on(name: string, handler: (event: { button: number }) => void) {
      (this.handlers[name] ??= []).push(handler);
      return this;
    }
    emit(name: string, event = { button: 0 }) {
      for (const handler of this.handlers[name] ?? []) handler(event);
    }
    removeChildren() {
      const removed = this.children;
      this.children = [];
      return removed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class FakeGraphics extends FakeContainer {}
  for (const method of [
    "roundRect",
    "rect",
    "ellipse",
    "poly",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "clear",
  ])
    Object.defineProperty(FakeGraphics.prototype, method, {
      value(this: FakeGraphics) {
        return this;
      },
    });
  class FakeTexture {
    destroyed = false;
    constructor() {
      state.textures.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class FakeSprite extends FakeContainer {
    width = 0;
    height = 0;
    constructor(public texture: FakeTexture) {
      super();
    }
  }
  class FakeText extends FakeContainer {
    width = 40;
    height = 20;
  }
  class FakeApplication {
    stage = new FakeContainer();
    tickers: ((ticker: { deltaMS: number }) => void)[] = [];
    ticker = {
      add: (listener: (ticker: { deltaMS: number }) => void) =>
        this.tickers.push(listener),
    };
    renderer = {
      resize: () => undefined,
      events: { autoPreventDefault: true },
    };
    options: Record<string, unknown> = {};
    destroy = vi.fn();
    finishInit: () => void = () => undefined;
    constructor() {
      state.apps.push(this);
    }
    init(options: Record<string, unknown>) {
      this.options = options;
      if (state.initResult === "reject")
        return Promise.reject(new Error("no WebGL"));
      if (state.initResult === "resolve") return Promise.resolve();
      return new Promise<void>((resolve) => {
        this.finishInit = resolve;
      });
    }
    tick(deltaMS: number) {
      for (const listener of this.tickers) listener({ deltaMS });
    }
  }
  return {
    state,
    module: {
      Application: FakeApplication,
      Container: FakeContainer,
      Graphics: FakeGraphics,
      ImageSource: class {
        destroy() {}
      },
      Rectangle: class {
        constructor(
          public x: number,
          public y: number,
          public width: number,
          public height: number,
        ) {}
      },
      Sprite: FakeSprite,
      Text: FakeText,
      Texture: FakeTexture,
    },
  };
});

vi.mock("pixi.js", () => pixi.module);

const { StoryStageRenderer } = await import("./story-stage-renderer");
const { introDurationMs } = await import("./intro-motion");

type FakeImage = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};
let images: FakeImage[] = [];

beforeEach(() => {
  pixi.state.apps = [];
  pixi.state.textures = [];
  pixi.state.initResult = "resolve";
  images = [];
  vi.stubGlobal("window", {
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal("document", {
    createElement: () => ({ remove: vi.fn(), style: {} }),
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 1000;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        images.push(this);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

const scene = {
  document: { drawing: { compositeImage: "data:image/png;base64,AAAA" } },
  objects: [{ id: "fox" }, { id: "river" }, { id: "castle" }],
} as unknown as ConfirmedScene;

function world(entities: Entity[] = [fox, river, castle]): WorldState {
  return {
    id: "world",
    revision: 1,
    schemaVersion: 1,
    entities,
    rules: [],
    goal: { characterId: "fox", targetId: "castle" },
    pathStatus: "blocked",
    weather: "clear",
    interaction: null,
    crossings: [],
  };
}

const sequence: StorySequence = {
  mode: "fixture",
  requestId: "request",
  sourceRevision: 1,
  sourceEventId: "event-1",
  beats: [
    {
      id: "beat-1",
      narration: "Fox sets off.",
      mood: "curious",
      action: { type: "move_toward", entityId: "fox", targetId: "castle" },
    },
    {
      id: "beat-2",
      narration: "River stops the way.",
      mood: "worried",
      action: { type: "blocked_by", entityId: "fox", obstacleId: "river" },
    },
  ],
};

async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe("StoryStageRenderer lifecycle", () => {
  it("destroys an app whose init finishes after the stage was destroyed", async () => {
    pixi.state.initResult = "defer";
    const stage = new StoryStageRenderer({ scene, world: world() });
    const app = pixi.state.apps[0]!;
    stage.destroy();
    expect(stage.canvas.remove).toHaveBeenCalled();
    expect(app.destroy).not.toHaveBeenCalled();
    app.finishInit();
    await stage.ready;
    await flush();
    expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(app.tickers).toHaveLength(0);
  });

  it("destroys a started app exactly once", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    stage.destroy();
    stage.destroy();
    await flush();
    expect(pixi.state.apps[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps playing without a canvas when Pixi cannot start", async () => {
    pixi.state.initResult = "reject";
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      reducedMotion: true,
    });
    await stage.ready;
    expect(stage.getSnapshot().canvasFailed).toBe(true);
    await stage.playSequence(sequence, new AbortController().signal);
    expect(stage.getSnapshot().caption).toBe("River stops the way.");
    stage.destroy();
    await flush();
    expect(pixi.state.apps[0]!.destroy).not.toHaveBeenCalled();
  });

  it("frees every texture it created", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    images[0]!.onload?.();
    // Backdrop plus one crop per scene piece.
    expect(pixi.state.textures).toHaveLength(4);
    // Removing a piece frees its crop straight away.
    stage.setWorld(world([fox, castle]));
    expect(pixi.state.textures.filter((item) => item.destroyed)).toHaveLength(
      1,
    );
    stage.destroy();
    await flush();
    expect(pixi.state.textures.every((item) => item.destroyed)).toBe(true);
  });
});

describe("StoryStageRenderer playback hand-over", () => {
  async function playThrough(stage: InstanceType<typeof StoryStageRenderer>) {
    const app = pixi.state.apps.at(-1)!;
    const done = stage.playSequence(sequence, new AbortController().signal);
    for (let frame = 0; frame < 200; frame++) {
      app.tick(16);
      await flush();
    }
    await done;
  }

  it("keeps resting positions and does not replay a finished event", async () => {
    const first = new StoryStageRenderer({ scene, world: world() });
    await first.ready;
    await playThrough(first);
    const played = first.getSnapshot();
    expect(played.caption).toBe("River stops the way.");
    const foxAfter = played.entities.find((item) => item.id === "fox")!;
    expect(foxAfter.placement).toBe("near-obstacle");
    const resting = first.restingState();
    first.destroy();

    const second = new StoryStageRenderer({
      scene,
      world: world(),
      resting,
    });
    await second.ready;
    // Resolves without any ticks: nothing is replayed.
    await second.playSequence(sequence, new AbortController().signal);
    const snapshot = second.getSnapshot();
    expect(snapshot.caption).toBe("River stops the way.");
    expect(snapshot.action).toBe("resting");
    expect(snapshot.entities.find((item) => item.id === "fox")).toEqual(
      foxAfter,
    );
    second.destroy();
  });

  it("finishes the remaining beats of an interrupted event instantly", async () => {
    const first = new StoryStageRenderer({ scene, world: world() });
    await first.ready;
    const app = pixi.state.apps[0]!;
    void first.playSequence(sequence, new AbortController().signal);
    app.tick(16);
    await flush();
    expect(first.getSnapshot().caption).toBe("Fox sets off.");
    const resting = first.restingState();
    expect(resting.playedBeats).toBe(1);
    first.destroy();

    const second = new StoryStageRenderer({
      scene,
      world: world(),
      resting,
    });
    await second.playSequence(sequence, new AbortController().signal);
    expect(second.getSnapshot().caption).toBe("River stops the way.");
    expect(
      second.getSnapshot().entities.find((item) => item.id === "fox")
        ?.placement,
    ).toBe("near-obstacle");
    second.destroy();
  });

  it("still plays a new event after a hand-over", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      resting: {
        caption: "Earlier.",
        rain: false,
        offsets: {},
        placements: {},
        completedRevealEventId: "",
        playedEventId: "event-0",
        playedBeats: 1,
      },
    });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await flush();
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    expect(stage.getSnapshot().action).toBe("move_toward");
    stage.destroy();
  });
});

describe("StoryStageRenderer tap reactions", () => {
  type Stage = InstanceType<typeof StoryStageRenderer>;
  const foxOf = (stage: Stage) =>
    stage.getSnapshot().entities.find((item) => item.id === "fox")!;
  type Tappable = {
    eventMode?: string;
    cursor?: string;
    hitArea?: { width: number; height: number };
    emit: (name: string, event?: { button: number }) => void;
  };
  const tappable = (stage: Stage, id: string) =>
    stage.entityObject(id) as unknown as Tappable;

  it("ignores pointer input unless it is interactive", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    const app = pixi.state.apps[0]!;
    expect(app.options.eventFeatures).toMatchObject({
      click: false,
      move: false,
    });
    expect(app.stage.eventMode).toBe("none");
    expect(tappable(stage, "fox").eventMode).toBeUndefined();
    tappable(stage, "fox").emit("pointertap");
    expect(foxOf(stage).reaction).toBeUndefined();
    stage.destroy();
  });

  it("reacts to a tap with padded targets, a cooldown and no world change", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world([
        fox,
        river,
        { ...castle, bounds: { ...castle.bounds, height: 8 } },
      ]),
      interactive: true,
      width: 350,
    });
    await stage.ready;
    const app = pixi.state.apps[0]!;
    expect(stage.canvas.style.touchAction).toBe("manipulation");
    expect(app.renderer.events.autoPreventDefault).toBe(false);
    const target = tappable(stage, "fox");
    expect(target.eventMode).toBe("static");
    expect(target.cursor).toBe("pointer");
    // 44 CSS px on a 350 px stage is about 126 world units.
    expect(tappable(stage, "castle").hitArea!.height).toBeCloseTo(
      (44 * 1000) / 350,
      3,
    );
    const before = stage.restingState();

    target.emit("pointertap");
    const started = foxOf(stage).reaction;
    expect(started).toBeDefined();
    expect(foxOf(stage).reactionCount).toBe(1);
    // A second tap straight away is ignored, not queued.
    app.tick(16);
    target.emit("pointertap");
    expect(foxOf(stage).reactionCount).toBe(1);
    // Right-clicks do nothing.
    for (let frame = 0; frame < 80; frame++) app.tick(16);
    expect(foxOf(stage).reaction).toBeUndefined();
    target.emit("pointertap", { button: 2 });
    expect(foxOf(stage).reactionCount).toBe(1);
    // After the cooldown a new, different reaction plays.
    expect(stage.react("fox")).not.toBe(started);
    expect(foxOf(stage).reactionCount).toBe(2);
    expect(stage.restingState()).toEqual(before);
    stage.destroy();
  });

  it("uses a highlight under reduced motion and still reacts without a canvas", async () => {
    pixi.state.initResult = "reject";
    vi.useFakeTimers();
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      reducedMotion: true,
      interactive: true,
    });
    await stage.ready;
    try {
      expect(stage.react("river")).toBe("highlight");
      expect(
        stage.getSnapshot().entities.find((item) => item.id === "river")
          ?.reaction,
      ).toBe("highlight");
      // The fallback clock still ends the reaction.
      await vi.advanceTimersByTimeAsync(1000);
      expect(
        stage.getSnapshot().entities.find((item) => item.id === "river")
          ?.reaction,
      ).toBeUndefined();
    } finally {
      stage.destroy();
      vi.useRealTimers();
    }
  });

  it("does not react to a piece still waiting for its reveal", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      interactive: true,
    });
    await stage.ready;
    const app = pixi.state.apps[0]!;
    void stage.playSequence(
      {
        ...sequence,
        sourceEventId: "event-reveal",
        beats: [
          {
            id: "beat-1",
            narration: "Castle waits.",
            mood: "curious",
            action: { type: "focus", entityId: "fox" },
          },
          {
            id: "beat-2",
            narration: "Castle appears.",
            mood: "delighted",
            action: { type: "reveal", entityId: "castle" },
          },
        ],
      },
      new AbortController().signal,
    );
    await flush();
    app.tick(16);
    expect(stage.react("castle")).toBeUndefined();
    // Its (padded) hit area lets taps through to the pieces beneath.
    expect(tappable(stage, "castle").eventMode).toBe("none");
    expect(tappable(stage, "fox").eventMode).toBe("static");
    expect(stage.react("fox")).toBeDefined();
    // Once revealed it is tappable again.
    for (let frame = 0; frame < 200; frame++) {
      app.tick(16);
      await flush();
    }
    expect(tappable(stage, "castle").eventMode).toBe("static");
    expect(stage.react("castle")).toBeDefined();
    stage.destroy();
  });
});

describe("StoryStageRenderer recording features", () => {
  type Stage = InstanceType<typeof StoryStageRenderer>;
  type Shown = { alpha: number; children: unknown[] };
  const piece = (stage: Stage, id: string) =>
    stage.entityObject(id) as unknown as Shown;
  const layers = () => pixi.state.apps.at(-1)!.stage.children as Shown[];
  async function run(milliseconds: number) {
    const app = pixi.state.apps.at(-1)!;
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
      app.tick(16);
      await flush();
    }
  }

  it("lifts the pieces off the paper in an intro", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    let done = false;
    void stage
      .playIntro(new AbortController().signal, { caption: "Fox explores." })
      .then(() => (done = true));
    expect(stage.getSnapshot().caption).toBe("Fox explores.");
    await run(16);
    expect(piece(stage, "fox").alpha).toBe(0);
    expect(layers()[1]!.alpha).toBe(0); // the mattes
    await run(introDurationMs(3) + 32);
    expect(done).toBe(true);
    expect(piece(stage, "fox").alpha).toBe(1);
    expect(layers()[1]!.alpha).toBe(1);
    stage.destroy();
  });

  it("holds beats for at least minBeatHoldMs", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      minBeatHoldMs: 1400,
    });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await run(1000);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(500);
    expect(stage.getSnapshot().caption).toBe("River stops the way.");
    stage.destroy();
  });

  it("caps beats at maxBeatHoldMs and lets a recording's clock follow real time", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      maxBeatHoldMs: 300,
      realTimeClock: true,
    });
    await stage.ready;
    // Slow frames are not capped at Pixi's default 100 ms.
    expect(pixi.state.apps.at(-1)!.ticker).toMatchObject({ minFPS: 1 });
    void stage.playSequence(sequence, new AbortController().signal);
    await run(250);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(100);
    expect(stage.getSnapshot().caption).toBe("River stops the way.");
    stage.destroy();
  });

  it("shows a sequence's world with its revealed piece hidden from the start", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world([fox, river]),
    });
    await stage.ready;
    void stage.playSequence(
      {
        ...sequence,
        sourceEventId: "event-castle",
        beats: [
          {
            id: "beat-1",
            narration: "Fox looks up.",
            mood: "curious",
            action: { type: "focus", entityId: "fox" },
          },
          {
            id: "beat-2",
            narration: "Castle appears.",
            mood: "delighted",
            action: { type: "reveal", entityId: "castle" },
          },
        ],
      },
      new AbortController().signal,
      world(),
    );
    await run(16);
    expect(piece(stage, "castle").alpha).toBe(0);
    expect(
      stage.getSnapshot().entities.find((item) => item.id === "castle")
        ?.revealState,
    ).toBe("hidden");
    stage.destroy();
  });

  it("draws captions and a title card on the canvas only when asked", async () => {
    const plain = new StoryStageRenderer({ scene, world: world() });
    await plain.ready;
    void plain.playSequence(sequence, new AbortController().signal);
    await run(16);
    const [, , , , , captions, title] = layers();
    expect(captions!.children).toHaveLength(0);
    expect(title!.children).toHaveLength(0);
    plain.destroy();

    const recorded = new StoryStageRenderer({
      scene,
      world: world(),
      canvasCaptions: true,
    });
    await recorded.ready;
    // The initial "ready" caption is never burned in.
    await run(16);
    expect(layers()[5]!.children).toHaveLength(0);
    void recorded.playSequence(sequence, new AbortController().signal);
    await run(16);
    expect(layers()[5]!.children).toHaveLength(2);
    recorded.showTitleCard({ title: "Fox's story", subtitle: "Made here" });
    await run(16);
    expect(layers()[5]!.children).toHaveLength(0);
    expect(layers()[6]!.children).toHaveLength(4);
    expect(layers()[6]!.alpha).toBeGreaterThan(0);
    expect(layers()[6]!.alpha).toBeLessThan(1);
    await run(600);
    expect(layers()[6]!.alpha).toBe(1);
    recorded.showTitleCard(null);
    await run(16);
    expect(layers()[6]!.children).toHaveLength(0);
    expect(layers()[5]!.children).toHaveLength(2);
    recorded.destroy();
  });
});

describe("StoryStageRenderer mid-story drawings", () => {
  async function run(milliseconds: number) {
    const app = pixi.state.apps.at(-1)!;
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
      app.tick(16);
      await flush();
    }
  }

  it("cuts a piece drawn mid-story from the child's own strokes", async () => {
    const boat: Entity = {
      id: "boat",
      role: "helper",
      description: "",
      properties: ["floats", "carries"],
      name: "Boat",
      bounds: { x: 420, y: 300, width: 160, height: 60 },
      sketch: { strokes: [[425, 330, 500, 355, 575, 330]] },
    };
    const token: Entity = { ...boat, id: "raft", sketch: undefined };
    const stage = new StoryStageRenderer({
      scene,
      world: world([fox, river, castle, boat, token]),
    });
    await stage.ready;
    const children = (id: string) =>
      (
        stage.entityObject(id)!.children as { constructor: { name: string } }[]
      ).map((child) => child.constructor.name);
    // Glow, shadow, paper edge and the strokes: no generated label.
    expect(children("boat")).toEqual([
      "FakeGraphics",
      "FakeGraphics",
      "FakeGraphics",
      "FakeGraphics",
    ]);
    expect(children("raft")).toContain("FakeText");
    stage.destroy();
  });

  it("lets the beat on stage finish before a new sequence plays", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await run(200);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    const captions = new Set<string>();
    stage.subscribe(() => captions.add(stage.getSnapshot().caption));
    void stage.playSequence(
      {
        ...sequence,
        sourceEventId: "event-2",
        beats: [
          {
            id: "beat-1",
            narration: "A new drawing arrives.",
            mood: "curious",
            action: { type: "focus", entityId: "castle" },
          },
        ],
      },
      new AbortController().signal,
    );
    await run(200);
    // Still the first beat: it is never cut mid-way.
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(600);
    expect(stage.getSnapshot().caption).toBe("A new drawing arrives.");
    // The stale sequence's remaining beat never played.
    expect(captions.has("River stops the way.")).toBe(false);
    stage.destroy();
  });

  it("plays only the newest of several sequences that arrive mid-beat", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await run(100);
    const next = (id: string, narration: string): StorySequence => ({
      ...sequence,
      sourceEventId: id,
      beats: [
        {
          id: "beat-1",
          narration,
          mood: "curious",
          action: { type: "focus", entityId: "fox" },
        },
      ],
    });
    const captions = new Set<string>();
    stage.subscribe(() => captions.add(stage.getSnapshot().caption));
    void stage.playSequence(
      next("event-2", "Older moment."),
      new AbortController().signal,
    );
    void stage.playSequence(
      next("event-3", "Newest moment."),
      new AbortController().signal,
    );
    await run(900);
    expect(stage.getSnapshot().caption).toBe("Newest moment.");
    expect(captions.has("Older moment.")).toBe(false);
    stage.destroy();
  });
});
