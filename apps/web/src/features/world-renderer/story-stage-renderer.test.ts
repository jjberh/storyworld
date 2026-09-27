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
    renderer = { resize: () => undefined };
    destroy = vi.fn();
    finishInit: () => void = () => undefined;
    constructor() {
      state.apps.push(this);
    }
    init() {
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
      Rectangle: class {},
      Sprite: FakeSprite,
      Text: FakeText,
      Texture: FakeTexture,
    },
  };
});

vi.mock("pixi.js", () => pixi.module);

const { StoryStageRenderer } = await import("./story-stage-renderer");

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
    createElement: () => ({ remove: vi.fn() }),
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
  kind: "character",
  name: "Fox",
  bounds: { x: 100, y: 120, width: 200, height: 120 },
};
const river: Entity = {
  id: "river",
  kind: "river",
  name: "River",
  bounds: { x: 450, y: 30, width: 120, height: 540 },
};
const castle: Entity = {
  id: "castle",
  kind: "castle",
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
