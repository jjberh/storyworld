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
    sources: [] as FakeBufferImageSource[],
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
    // Record where each piece is drawn and how big.
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    scale = {
      x: 1,
      y: 1,
      set(x: number, y = x) {
        this.x = x;
        this.y = y;
      },
    };
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
  class FakeBufferImageSource {
    destroyed = false;
    constructor(public options: { width: number; height: number }) {
      state.sources.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class FakeSprite extends FakeContainer {
    width = 0;
    height = 0;
    tint = 0xffffff;
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
      BufferImageSource: FakeBufferImageSource,
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

// The drawing's pixels, as the stage reads them; null (the default, as in a
// browser that cannot read them) leaves every piece a plain rectangle.
const drawingPixels = vi.hoisted(() => ({
  image: null as null | {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  },
  reads: 0,
}));
vi.mock("./cutouts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cutouts")>()),
  readImagePixels: () => {
    drawingPixels.reads++;
    return drawingPixels.image;
  },
}));

const { INITIAL_CAPTION, StoryStageRenderer } =
  await import("./story-stage-renderer");
const {
  DRAWING_LIFT,
  introDurationMs,
  introPieceStartMs,
  KEEPSAKE_INTRO,
  LIVE_INTRO,
} = await import("./intro-motion");
const { BEAT_HOLD_MS, beatTravelMs } = await import("./story-playback");
/** The test sequence's two beats, played through. */
const SEQUENCE_MS = BEAT_HOLD_MS.move_toward + BEAT_HOLD_MS.blocked_by;

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
  pixi.state.sources = [];
  pixi.state.initResult = "resolve";
  drawingPixels.image = null;
  drawingPixels.reads = 0;
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
    vi.useFakeTimers();
    try {
      const stage = new StoryStageRenderer({
        scene,
        world: world(),
        reducedMotion: true,
      });
      await stage.ready;
      expect(stage.getSnapshot().canvasFailed).toBe(true);
      let done = false;
      void stage
        .playSequence(sequence, new AbortController().signal)
        .then(() => (done = true));
      await vi.advanceTimersByTimeAsync(BEAT_HOLD_MS.move_toward + 100);
      expect(stage.getSnapshot().caption).toBe("River stops the way.");
      await vi.advanceTimersByTimeAsync(BEAT_HOLD_MS.blocked_by);
      expect(done).toBe(true);
      stage.destroy();
      await flush();
      expect(pixi.state.apps[0]!.destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

describe("StoryStageRenderer paper cutouts", () => {
  /** White paper with a crayon ring in the fox's box, the rest blank. */
  function drawing() {
    const width = 1000;
    const height = 600;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 150; y < 210; y++)
      for (let x = 150; x < 250; x++) {
        const edge = y < 154 || y >= 206 || x < 154 || x >= 246;
        if (!edge) continue;
        const offset = (y * width + x) * 4;
        data[offset] = 221;
        data[offset + 1] = 133;
        data[offset + 2] = 92;
      }
    return { data, width, height };
  }
  /** Each test uses its own drawing so cuts cached by another never apply. */
  let drawings = 0;
  function cutScene() {
    drawings++;
    return {
      ...scene,
      document: {
        drawing: { compositeImage: `data:image/png;base64,CUT${drawings}` },
      },
    } as unknown as ConfirmedScene;
  }
  const pieceSprites = (stage: InstanceType<typeof StoryStageRenderer>) =>
    stage.entityObject("fox")!.children.filter((child) => "texture" in child);
  /** Loads the drawing and waits until its pieces are cut. */
  async function loadDrawing(
    stage: InstanceType<typeof StoryStageRenderer>,
    image: FakeImage,
  ) {
    image.onload?.();
    await vi.waitFor(() =>
      expect(stage.getSnapshot().imageStatus).toBe("loaded"),
    );
  }
  const cutouts = (stage: InstanceType<typeof StoryStageRenderer>) =>
    Object.fromEntries(
      stage.getSnapshot().entities.map((entity) => [entity.id, entity.cutout]),
    );

  it("cuts a drawn piece along its strokes and leaves a blank one a rectangle", async () => {
    drawingPixels.image = drawing();
    const stage = new StoryStageRenderer({ scene: cutScene(), world: world() });
    await stage.ready;
    expect(cutouts(stage)).toEqual({
      fox: "pending",
      river: "pending",
      castle: "pending",
    });
    await loadDrawing(stage, images[0]!);
    expect(cutouts(stage)).toEqual({
      fox: "mask",
      river: "rect",
      castle: "rect",
    });
    // The drawing is read once for every piece.
    expect(drawingPixels.reads).toBe(1);
    // The fox is its sticker over three shadow layers of the same shape.
    const sprites = pieceSprites(stage) as unknown as { tint: number }[];
    expect(sprites).toHaveLength(4);
    expect(
      sprites.slice(0, 3).every((sprite) => sprite.tint !== 0xffffff),
    ).toBe(true);
    expect(pixi.state.sources).toHaveLength(1);
    stage.destroy();
    await flush();
  });

  it("frees a cut piece's textures when it leaves and when the stage goes", async () => {
    drawingPixels.image = drawing();
    const stage = new StoryStageRenderer({ scene: cutScene(), world: world() });
    await stage.ready;
    await loadDrawing(stage, images[0]!);
    const [source] = pixi.state.sources;
    // Redrawing the same world keeps the upload.
    stage.setWorld(world());
    expect(source!.destroyed).toBe(false);
    expect(pixi.state.sources).toHaveLength(1);
    stage.setWorld(world([river, castle]));
    expect(source!.destroyed).toBe(true);
    stage.setWorld(world());
    stage.destroy();
    await flush();
    expect(pixi.state.sources.every((item) => item.destroyed)).toBe(true);
    expect(pixi.state.textures.every((item) => item.destroyed)).toBe(true);
  });

  it("shares cuts between stages showing the same drawing", async () => {
    drawingPixels.image = drawing();
    const shared = cutScene();
    const first = new StoryStageRenderer({ scene: shared, world: world() });
    await loadDrawing(first, images[0]!);
    const second = new StoryStageRenderer({ scene: shared, world: world() });
    images[1]!.onload?.();
    // Every cut is already made, so the second stage shows them at once.
    expect(second.getSnapshot().imageStatus).toBe("loaded");
    expect(drawingPixels.reads).toBe(1);
    expect(cutouts(second).fox).toBe("mask");
    first.destroy();
    second.destroy();
    await flush();
  });

  it("stays loading until every piece is cut, yielding between pieces", async () => {
    drawingPixels.image = drawing();
    vi.useFakeTimers();
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => {
      now += 10; // Every piece blows the time budget.
      return now;
    });
    try {
      const stage = new StoryStageRenderer({
        scene: cutScene(),
        world: world(),
      });
      images[0]!.onload?.();
      expect(stage.getSnapshot().imageStatus).toBe("loading");
      // One piece per turn of the event loop.
      await vi.advanceTimersByTimeAsync(1);
      expect(stage.getSnapshot().imageStatus).toBe("loading");
      for (let turn = 0; turn < 5; turn++)
        if (stage.getSnapshot().imageStatus === "loading")
          await vi.advanceTimersByTimeAsync(1);
      expect(stage.getSnapshot().imageStatus).toBe("loaded");
      expect(cutouts(stage).fox).toBe("mask");
      // A stage destroyed mid-cut stops cutting.
      const stopped = new StoryStageRenderer({
        scene: cutScene(),
        world: world(),
      });
      images[1]!.onload?.();
      stopped.destroy();
      await vi.advanceTimersByTimeAsync(10);
      expect(stopped.getSnapshot().imageStatus).toBe("loading");
      stage.destroy();
    } finally {
      clock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows every piece as a rectangle when the drawing cannot be read", async () => {
    const stage = new StoryStageRenderer({ scene: cutScene(), world: world() });
    await stage.ready;
    images[0]!.onload?.();
    expect(cutouts(stage)).toEqual({
      fox: "rect",
      river: "rect",
      castle: "rect",
    });
    expect(pixi.state.sources).toHaveLength(0);
    stage.destroy();
    await flush();
  });
});

describe("StoryStageRenderer playback hand-over", () => {
  async function playThrough(stage: InstanceType<typeof StoryStageRenderer>) {
    const app = pixi.state.apps.at(-1)!;
    const done = stage.playSequence(sequence, new AbortController().signal);
    for (let elapsed = 0; elapsed < SEQUENCE_MS + 200; elapsed += 16) {
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
      .playIntro(new AbortController().signal, {
        timing: KEEPSAKE_INTRO,
        caption: "Fox explores.",
      })
      .then(() => (done = true));
    expect(stage.getSnapshot().caption).toBe("Fox explores.");
    await run(16);
    expect(piece(stage, "fox").alpha).toBe(0);
    expect(layers()[1]!.alpha).toBe(0); // the mattes
    await run(introDurationMs(3, KEEPSAKE_INTRO) + 32);
    expect(done).toBe(true);
    expect(piece(stage, "fox").alpha).toBe(1);
    expect(layers()[1]!.alpha).toBe(1);
    stage.destroy();
  });

  it("holds beats for at least minBeatHoldMs", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      minBeatHoldMs: BEAT_HOLD_MS.move_toward + 1000,
    });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    // Past the live hold, the longer minimum still holds the first beat.
    await run(BEAT_HOLD_MS.move_toward + 500);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(600);
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
    // Still the first beat: it is never cut mid-way, however long it holds.
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(BEAT_HOLD_MS.move_toward - 500);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(200);
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
    await run(BEAT_HOLD_MS.move_toward);
    expect(stage.getSnapshot().caption).toBe("Newest moment.");
    expect(captions.has("Older moment.")).toBe(false);
    stage.destroy();
  });
});

describe("StoryStageRenderer live lift-off", () => {
  type Stage = InstanceType<typeof StoryStageRenderer>;
  type Shown = {
    alpha: number;
    rotation: number;
    position: { x: number; y: number };
    scale: { x: number; y: number };
  };
  const piece = (stage: Stage, id: string) =>
    stage.entityObject(id) as unknown as Shown;
  /** Where a piece rests: the centre of its bounds. */
  const home = (entity: Entity) => ({
    x: entity.bounds.x + entity.bounds.width / 2,
    y: entity.bounds.y + entity.bounds.height / 2,
  });
  const states = (stage: Stage) =>
    Object.fromEntries(
      stage.getSnapshot().entities.map((item) => [item.id, item.revealState]),
    );
  async function run(milliseconds: number) {
    const app = pixi.state.apps.at(-1)!;
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
      app.tick(16);
      await flush();
    }
  }
  const opening: StorySequence = {
    ...sequence,
    sourceEventId: "event-opening",
    beats: [
      {
        id: "beat-1",
        narration: "Fox wakes up.",
        mood: "curious",
        action: { type: "focus", entityId: "fox" },
      },
    ],
  };

  it("lifts every piece from flat to landed, then reports the reveal done", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      interactive: true,
    });
    await stage.ready;
    expect(stage.getSnapshot().intro).toBe("done");
    let done = false;
    void stage
      .playIntro(new AbortController().signal, { timing: LIVE_INTRO })
      .then(() => (done = true));
    expect(stage.getSnapshot().intro).toBe("playing");
    expect(states(stage)).toEqual({
      fox: "flat",
      river: "flat",
      castle: "flat",
    });
    // Flat pieces and pieces in the air ignore taps.
    expect(stage.react("fox")).toBeUndefined();
    await run(LIVE_INTRO.leadMs + 300);
    expect(states(stage)).toEqual({
      fox: "lifting",
      river: "lifting",
      castle: "lifting",
    });
    expect(stage.react("castle")).toBeUndefined();
    const lastLanding = introPieceStartMs(2, 3, LIVE_INTRO) + LIVE_INTRO.liftMs;
    await run(lastLanding - (LIVE_INTRO.leadMs + 300) + 32);
    expect(states(stage)).toEqual({
      fox: "visible",
      river: "visible",
      castle: "visible",
    });
    expect(stage.react("fox")).toBeDefined();
    expect(done).toBe(false);
    await run(LIVE_INTRO.settleMs + 32);
    expect(done).toBe(true);
    expect(stage.getSnapshot().intro).toBe("done");
    stage.destroy();
  });

  it("plays the first sequence after the reveal, whole", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    void stage.playIntro(new AbortController().signal, { timing: LIVE_INTRO });
    void stage.playSequence(opening, new AbortController().signal);
    const seen: string[] = [];
    stage.subscribe(() => {
      const { caption, intro } = stage.getSnapshot();
      if (seen.at(-1) !== caption + "|" + intro)
        seen.push(caption + "|" + intro);
    });
    await run(introDurationMs(3, LIVE_INTRO) - 100);
    expect(stage.getSnapshot().caption).toBe(INITIAL_CAPTION);
    expect(stage.getSnapshot().intro).toBe("playing");
    await run(200);
    expect(stage.getSnapshot().caption).toBe("Fox wakes up.");
    // The opening narration never shared the stage with the reveal.
    expect(seen.filter((item) => item.startsWith("Fox wakes up."))).toEqual([
      "Fox wakes up.|done",
    ]);
    stage.destroy();
  });

  it("gives the first sequence its beat when a newer one arrives mid-reveal", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    void stage.playIntro(new AbortController().signal, { timing: LIVE_INTRO });
    void stage.playSequence(opening, new AbortController().signal);
    await run(500);
    void stage.playSequence(
      {
        ...opening,
        sourceEventId: "event-bridge",
        beats: [
          {
            id: "beat-1",
            narration: "A bridge appears.",
            mood: "delighted",
            action: { type: "focus", entityId: "castle" },
          },
        ],
      },
      new AbortController().signal,
    );
    await run(introDurationMs(3, LIVE_INTRO) - 500 + 64);
    expect(stage.getSnapshot().caption).toBe("Fox wakes up.");
    await run(BEAT_HOLD_MS.focus - 200);
    expect(stage.getSnapshot().caption).toBe("Fox wakes up.");
    await run(300);
    expect(stage.getSnapshot().caption).toBe("A bridge appears.");
    stage.destroy();
  });

  it("only fades pieces in under reduced motion", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      reducedMotion: true,
    });
    await stage.ready;
    void stage.playIntro(new AbortController().signal, { timing: LIVE_INTRO });
    const alphas: number[] = [];
    for (let at = 0; at < introDurationMs(3, LIVE_INTRO); at += 64) {
      await run(64);
      alphas.push(piece(stage, "fox").alpha);
      // No rise, no swell, no shake: every piece stays exactly at rest.
      for (const entity of [fox, river, castle]) {
        const shown = piece(stage, entity.id);
        expect(shown.rotation).toBe(0);
        expect(shown.position).toMatchObject(home(entity));
        expect(shown.scale).toMatchObject({ x: 1, y: 1 });
      }
    }
    expect(alphas[0]).toBe(0);
    expect(alphas.some((alpha) => alpha > 0.2 && alpha < 0.8)).toBe(true);
    expect(alphas.at(-1)).toBe(1);
    stage.destroy();
  });

  it("shakes pieces as they lift with full motion", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    void stage.playIntro(new AbortController().signal, { timing: LIVE_INTRO });
    await run(LIVE_INTRO.leadMs + LIVE_INTRO.liftMs * 0.3);
    const turns: number[] = [];
    const heights: number[] = [];
    for (let frame = 0; frame < 20; frame++) {
      await run(16);
      turns.push(piece(stage, "river").rotation);
      heights.push(piece(stage, "river").position.y);
    }
    expect(Math.max(...turns)).toBeGreaterThan(0.005);
    expect(Math.min(...turns)).toBeLessThan(-0.005);
    // It is up off the paper and a little bigger while it hangs there.
    expect(Math.min(...heights)).toBeLessThan(home(river).y - 15);
    expect(piece(stage, "river").scale.x).toBeGreaterThan(1);
    stage.destroy();
  });

  it("gives a new drawing its own short lift-off without cutting the beat", async () => {
    const bridge: Entity = {
      id: "bridge",
      role: "helper",
      description: "",
      properties: ["carries"],
      name: "Bridge",
      bounds: { x: 420, y: 300, width: 160, height: 60 },
      sketch: { strokes: [[425, 330, 575, 330]] },
    };
    // Two stages play the same sequence; one gets the new drawing mid-beat.
    const make = async () => {
      const stage = new StoryStageRenderer({
        scene,
        world: world(),
        interactive: true,
        liftNewPieces: true,
      });
      await stage.ready;
      void stage.playSequence(sequence, new AbortController().signal);
      return { stage, app: pixi.state.apps.at(-1)! };
    };
    const plain = await make();
    const drawn = await make();
    const captions = { plain: [] as string[], drawn: [] as string[] };
    const frame = async () => {
      plain.app.tick(16);
      drawn.app.tick(16);
      await flush();
      captions.plain.push(plain.stage.getSnapshot().caption);
      captions.drawn.push(drawn.stage.getSnapshot().caption);
    };
    for (let index = 0; index < 6; index++) await frame();
    drawn.stage.setWorld(world([fox, river, castle, bridge]));
    expect(states(drawn.stage).bridge).toBe("lifting");
    expect(drawn.stage.getSnapshot().intro).toBe("done");
    await frame();
    // Shown at once: its paper cutout hands straight over.
    expect(piece(drawn.stage, "bridge").alpha).toBe(1);
    expect(drawn.stage.react("bridge")).toBeUndefined();
    for (let at = 0; at < DRAWING_LIFT.liftMs; at += 16) await frame();
    expect(states(drawn.stage).bridge).toBe("visible");
    expect(drawn.stage.react("bridge")).toBeDefined();
    for (let at = 0; at < BEAT_HOLD_MS.move_toward; at += 16) await frame();
    // The story on stage kept exactly its pace through the lift.
    expect(captions.drawn).toEqual(captions.plain);
    expect(captions.drawn).toContain("River stops the way.");
    plain.stage.destroy();
    drawn.stage.destroy();
  });

  it("lifts a drawing committed mid-reveal on its own, straight away", async () => {
    const bridge: Entity = {
      id: "bridge",
      role: "helper",
      description: "",
      properties: ["carries"],
      name: "Bridge",
      bounds: { x: 420, y: 300, width: 160, height: 60 },
      sketch: { strokes: [[425, 330, 575, 330]] },
    };
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      interactive: true,
      liftNewPieces: true,
    });
    await stage.ready;
    void stage.playIntro(new AbortController().signal, { timing: LIVE_INTRO });
    await run(300);
    // Still before any scene piece lifts.
    stage.setWorld(world([fox, river, castle, bridge]));
    expect(states(stage)).toMatchObject({ fox: "flat", bridge: "lifting" });
    await run(16);
    // Shown at once, as its cutout hands over, and up off the paper soon.
    expect(piece(stage, "bridge").alpha).toBe(1);
    const heights: number[] = [];
    for (let at = 0; at < DRAWING_LIFT.liftMs; at += 16) {
      await run(16);
      heights.push(piece(stage, "bridge").position.y);
      expect(piece(stage, "bridge").alpha).toBe(1);
    }
    expect(Math.min(...heights)).toBeLessThan(home(bridge).y - 15);
    // Landed while the reveal is still playing, and stays shown.
    expect(stage.getSnapshot().intro).toBe("playing");
    expect(states(stage).bridge).toBe("visible");
    expect(stage.react("bridge")).toBeDefined();
    await run(introDurationMs(3, LIVE_INTRO));
    expect(stage.getSnapshot().intro).toBe("done");
    expect(piece(stage, "bridge").alpha).toBe(1);
    expect(states(stage).bridge).toBe("visible");
    stage.destroy();
  });

  it("lifts only pieces added later, and only when asked", async () => {
    const plain = new StoryStageRenderer({ scene, world: world([fox]) });
    await plain.ready;
    plain.setWorld(world([fox, river]));
    expect(states(plain)).toEqual({ fox: "visible", river: "visible" });
    plain.destroy();
    const lifting = new StoryStageRenderer({
      scene,
      world: world([fox]),
      liftNewPieces: true,
    });
    await lifting.ready;
    lifting.setWorld(world([fox, river]));
    expect(states(lifting)).toEqual({ fox: "visible", river: "lifting" });
    lifting.destroy();
  });
});

describe("StoryStageRenderer beat pacing", () => {
  type Stage = InstanceType<typeof StoryStageRenderer>;
  const foxX = (stage: Stage) =>
    (stage.entityObject("fox") as unknown as { position: { x: number } })
      .position.x;
  async function run(milliseconds: number) {
    const app = pixi.state.apps.at(-1)!;
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
      app.tick(16);
      await flush();
    }
  }
  const homeX = fox.bounds.x + fox.bounds.width / 2;

  it("walks a moving piece across most of its beat, then lets it stand", async () => {
    const stage = new StoryStageRenderer({ scene, world: world() });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await run(16);
    const targetX = stage
      .getSnapshot()
      .entities.find((item) => item.id === "fox")!.centerX;
    expect(targetX - homeX).toBeGreaterThan(50);
    const progress = () => (foxX(stage) - homeX) / (targetX - homeX);
    const travelMs = beatTravelMs(
      "move_toward",
      BEAT_HOLD_MS.move_toward,
      false,
    );
    // Idle motion sways a piece by a few world units; allow for it.
    const sway = 8 / (targetX - homeX);
    await run(travelMs / 4 - 16);
    expect(progress()).toBeGreaterThan(0);
    expect(progress()).toBeLessThan(0.3 + sway);
    await run(travelMs / 4);
    expect(progress()).toBeGreaterThan(0.3 - sway);
    expect(progress()).toBeLessThan(0.7 + sway);
    // Arrived before the beat ends, with the caption still on stage.
    await run(travelMs / 2 + 32);
    expect(Math.abs(progress() - 1)).toBeLessThan(sway);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(BEAT_HOLD_MS.move_toward - travelMs);
    expect(stage.getSnapshot().caption).toBe("River stops the way.");
    stage.destroy();
  });

  it("keeps the same holds under reduced motion, without any walking", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      reducedMotion: true,
    });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await run(16);
    const targetX = stage
      .getSnapshot()
      .entities.find((item) => item.id === "fox")!.centerX;
    // Straight to its place, no tween.
    expect(foxX(stage)).toBe(targetX);
    await run(BEAT_HOLD_MS.move_toward - 100);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    await run(200);
    expect(stage.getSnapshot().caption).toBe("River stops the way.");
    stage.destroy();
  });

  it("walks the whole way within a recording's shorter beats", async () => {
    const stage = new StoryStageRenderer({
      scene,
      world: world(),
      maxBeatHoldMs: 1400,
    });
    await stage.ready;
    void stage.playSequence(sequence, new AbortController().signal);
    await run(16);
    const targetX = stage
      .getSnapshot()
      .entities.find((item) => item.id === "fox")!.centerX;
    await run(1400 - 64);
    expect(stage.getSnapshot().caption).toBe("Fox sets off.");
    expect(Math.abs(foxX(stage) - targetX)).toBeLessThan(8);
    stage.destroy();
  });

  it("keeps a flyer up in the air for its whole crossing", async () => {
    const stage = new StoryStageRenderer({
      scene,
      // An open route, so nothing holds the flyer back.
      world: { ...world(), pathStatus: "available" },
    });
    await stage.ready;
    const flight: StorySequence = {
      ...sequence,
      beats: [
        {
          id: "beat-1",
          narration: "Fox swoops over River.",
          mood: "delighted",
          action: { type: "fly_over", entityId: "fox", obstacleId: "river" },
        },
      ],
    };
    void stage.playSequence(flight, new AbortController().signal);
    const foxY = () =>
      (stage.entityObject("fox") as unknown as { position: { y: number } })
        .position.y;
    const homeY = fox.bounds.y + fox.bounds.height / 2;
    const travelMs = beatTravelMs("fly_over", BEAT_HOLD_MS.fly_over, false);
    await run(16);
    const target = stage
      .getSnapshot()
      .entities.find((item) => item.id === "fox")!;
    // Half way across, long after a one-off flourish would have ended, the
    // flyer is over the river at the top of its arc: 30% of its height above
    // the straight line from where it started to where it lands.
    await run(travelMs / 2 - 16);
    const x = foxX(stage);
    expect(x).toBeGreaterThan(river.bounds.x - fox.bounds.width / 2);
    expect(x).toBeLessThan(
      river.bounds.x + river.bounds.width + fox.bounds.width / 2,
    );
    const along = (x - homeX) / (target.centerX - homeX);
    const lineY = homeY + (target.centerY - homeY) * along;
    expect(foxY()).toBeLessThan(lineY - 0.25 * fox.bounds.height);
    // And it lands with the crossing.
    await run(travelMs / 2 + 32);
    expect(Math.abs(foxY() - target.centerY)).toBeLessThan(8);
    stage.destroy();
  });

  it("carries on from where a piece is when its walk is cut short", async () => {
    const stage = new StoryStageRenderer({
      scene,
      // An open route, so nothing holds the flyer back.
      world: { ...world(), pathStatus: "available" },
    });
    await stage.ready;
    const first = new AbortController();
    void stage.playSequence(sequence, first.signal);
    const travelMs = beatTravelMs(
      "move_toward",
      BEAT_HOLD_MS.move_toward,
      false,
    );
    await run(travelMs / 2);
    const before = foxX(stage);
    expect(before - homeX).toBeGreaterThan(20);
    first.abort();
    // A new moment sends the piece somewhere else: it sets off from where it
    // stood, without a jump.
    void stage.playSequence(
      {
        ...sequence,
        sourceEventId: "event-2",
        beats: [
          {
            id: "beat-1",
            narration: "Fox swoops over River.",
            mood: "delighted",
            action: { type: "fly_over", entityId: "fox", obstacleId: "river" },
          },
        ],
      },
      new AbortController().signal,
    );
    await run(16);
    // One frame of walking, a couple of world units at most.
    expect(Math.abs(foxX(stage) - before)).toBeLessThan(4);
    stage.destroy();
  });
});
