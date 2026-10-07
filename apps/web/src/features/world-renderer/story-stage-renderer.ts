import {
  Application,
  Container,
  type FederatedPointerEvent,
  Graphics,
  ImageSource,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { Entity, WorldState } from "@storyworld/contracts/model";
import type {
  StoryAction,
  StorySequence,
} from "@storyworld/contracts/story-beat";
import {
  approach,
  beatPulse,
  combinePoses,
  idleMotionFor,
  RESTING_POSE,
  sampleMotion,
  seedFor,
  tweenOffset,
  type IdleMotion,
} from "./stage-motion";
import {
  DRAWING_LIFT,
  introBackdrop,
  introDurationMs,
  introPieceStartMs,
  liftOrder,
  RESTING_BACKDROP_ALPHA,
  sampleIntro,
  weightPose,
  type IntroTiming,
} from "./intro-motion";
import {
  beatHoldMs,
  beatMovement,
  center,
  logicalX,
  pendingRevealId,
  restingRain,
  type Offset,
  type Placement,
} from "./story-playback";
import {
  IDLE_REACTIONS,
  sampleReaction,
  settleReaction,
  tapReaction,
  touchTarget,
  type ReactionKind,
  type ReactionState,
} from "./touch-reactions";
import { entityLook, paintLayerFor, type EntityLook } from "./entity-look";

// The Story Room "paper theater" drawn on one Pixi canvas. Framework-agnostic:
// it owns its Application, advances every animation from its own ticker clock,
// and reports semantic state through `subscribe`/`getSnapshot` so a host can
// mirror it for assistive tech. Several instances can live on one page.

export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 600;

export type StageImageStatus = "loading" | "loaded" | "failed";

export type StageEntitySnapshot = {
  id: string;
  name: string;
  role: Entity["role"];
  /**
   * `hidden` waits for its reveal beat; `flat` still lies on the paper
   * before its lift-off; `lifting` is on its way up (fading in under reduced
   * motion); `visible` has landed. Only a landed piece reacts to taps.
   */
  revealState: "hidden" | "flat" | "lifting" | "visible";
  placement: Placement;
  logicalX: number;
  /** Resting centre in the 1000x600 world, including story movement. */
  centerX: number;
  centerY: number;
  /** The tap reaction playing now, if any. */
  reaction: ReactionKind | undefined;
  /** Tap reactions this piece has started. */
  reactionCount: number;
};

export type StageSnapshot = {
  caption: string;
  action: StoryAction["type"] | "resting";
  /** Confetti is playing (never true under reduced motion). */
  celebrating: boolean;
  imageStatus: StageImageStatus;
  /** Pixi could not start; the canvas stays blank but playback continues. */
  canvasFailed: boolean;
  /** The lift-off reveal (`playIntro`) is playing. */
  intro: "playing" | "done";
  entities: StageEntitySnapshot[];
};

export type StoryStageOptions = {
  scene: ConfirmedScene;
  world: WorldState;
  /** Defaults to the `prefers-reduced-motion` media query. */
  reducedMotion?: boolean;
  /** Keep a revealed piece visible before its reveal beat plays. */
  keepCommittedRevealsVisible?: boolean;
  /**
   * Pieces react to pointer taps. Off by default so an offscreen instance
   * (for example one recording a story) ignores input.
   */
  interactive?: boolean;
  /**
   * A piece that joins the world after the stage opened (a new drawing) gets
   * its own short lift-off (`DRAWING_LIFT`). Presentation only.
   */
  liftNewPieces?: boolean;
  /** Defaults to `window.devicePixelRatio`. */
  resolution?: number;
  /** Initial CSS size of the canvas; defaults to 1000x600. */
  width?: number;
  height?: number;
  /**
   * State carried over from a previous instance (see `restingState()`), so a
   * rebuilt stage keeps its pieces where they were and does not replay the
   * event it had already started.
   */
  resting?: StageRestingState;
  /**
   * Draw the current beat's narration on the canvas itself, as a paper strip
   * along the bottom. Off by default: the live stage shows its caption in the
   * DOM. A recording turns it on so the movie carries its captions.
   */
  canvasCaptions?: boolean;
  /**
   * The shortest time a beat holds, in milliseconds. A recording lengthens
   * beats so their captions stay readable; the live stage leaves this at 0.
   */
  minBeatHoldMs?: number;
  /**
   * The longest time a beat holds, in milliseconds (never below
   * `minBeatHoldMs`). A recording caps beats to fit its length budget; the
   * live stage leaves this unset.
   */
  maxBeatHoldMs?: number;
  /**
   * Advance the stage clock by the real time between frames, however long.
   * By default a slow frame advances it at most 100 ms (Pixi's ticker cap) so
   * a stall never skips animation; a recording turns this on so its beats
   * keep pace with the video, which runs in real time.
   */
  realTimeClock?: boolean;
};

/** A centred paper card drawn over the stage, e.g. a movie's end card. */
export type StageTitleCard = { title: string; subtitle?: string };

/** Where a stage's story stands, for handing over to a new instance. */
export type StageRestingState = {
  caption: string;
  rain: boolean;
  offsets: Record<string, Offset>;
  placements: Record<string, Placement>;
  completedRevealEventId: string;
  /** The last event this stage started playing ("" for none). */
  playedEventId: string;
  /** How many of that event's beats have been applied. */
  playedBeats: number;
};

export const INITIAL_CAPTION = "The paper theater is ready.";

const PAPER = 0xfffaf0;
const PAPER_EDGE = 0xfffdf5;
const INK = 0x3a1b6b;
const REVEAL_FADE_MS = 240;
const TITLE_FADE_MS = 450;
const CAPTION_FONT = "Georgia, 'Times New Roman', serif";
/** The drawing canvas's crayon, so a sketched piece matches its strokes. */
const SKETCH_COLOR = 0xdd855c;
const SKETCH_STROKE_WIDTH = 5;

const tokenColors: Record<EntityLook, number> = {
  span: 0xbd765c,
  cloud: 0xa7a4b6,
  shelter: 0xf0b36d,
  water: 0x89bfcb,
  barrier: 0xb7a99a,
  goal: 0xc5abd8,
  character: 0xf3c75f,
  thing: 0xe9c9a8,
};

type EntityView = {
  entity: Entity;
  motion: IdleMotion;
  seed: number;
  container: Container;
  glow: Graphics | undefined;
  /** How the piece was last drawn, so it is only redrawn when that changes. */
  drawnAs: string;
  moveFrom: Offset;
  moveTo: Offset;
  moveStartMs: number;
  hidden: number;
  reactions: ReactionState;
};

type Waiter = { atMs: number; resolve: () => void };

type IntroRun = {
  startMs: number;
  timing: IntroTiming;
  /** Lift order by entity ID, for the pieces the intro opened with. */
  order: Map<string, number>;
  count: number;
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Shape outline used for a token (and its paper edge and shadow). */
function tokenShape(
  graphics: Graphics,
  look: EntityLook,
  width: number,
  height: number,
  inflate: number,
  dy = 0,
) {
  const w = width + inflate * 2;
  const h = height + inflate * 2;
  const x = -w / 2;
  const y = -h / 2 + dy;
  switch (look) {
    case "cloud":
      return graphics.ellipse(0, dy, w / 2, h / 2);
    case "character":
      return graphics.roundRect(x, y, w, h, Math.min(w, h) / 2);
    case "shelter":
      return graphics.poly([
        0,
        y,
        x + w,
        y + h * 0.42,
        x + w * 0.88,
        y + h,
        x + w * 0.12,
        y + h,
        x,
        y + h * 0.42,
      ]);
    default:
      return graphics.roundRect(x, y, w, h, 5);
  }
}

export class StoryStageRenderer {
  /** The stage's canvas; append it anywhere. It exists before `ready`. */
  readonly canvas: HTMLCanvasElement;
  /** Resolves once Pixi has started (or failed to start). Never rejects. */
  readonly ready: Promise<void>;
  readonly reducedMotion: boolean;
  readonly interactive: boolean;

  private readonly app = new Application();
  private readonly scene: ConfirmedScene;
  private readonly sceneIds: Set<string>;
  private readonly keepCommittedRevealsVisible: boolean;
  private world: WorldState;
  /** The stage is built and drawing. */
  private initialized = false;
  /** `app.init` succeeded, so the app holds a renderer that must be freed. */
  private appStarted = false;
  private destroyed = false;
  private canvasFailed = false;
  private fallbackClock: ReturnType<typeof setInterval> | undefined;
  private size: { width: number; height: number };

  private clockMs = 0;
  private waiters: Waiter[] = [];

  private image: HTMLImageElement | undefined;
  private imageStatus: StageImageStatus = "loading";
  private imageSource: ImageSource | undefined;
  private textures: Texture[] = [];

  private readonly backdrop = new Container();
  private backdropSprite: Sprite | undefined;
  private readonly captionLayer = new Container();
  private readonly titleLayer = new Container();
  private readonly canvasCaptions: boolean;
  private readonly minBeatHoldMs: number;
  private readonly maxBeatHoldMs: number;
  private readonly realTimeClock: boolean;
  /** What the canvas caption and title card were last drawn as. */
  private drawnCaption: string | undefined;
  private drawnTitle: StageTitleCard | null = null;
  private titleCard: StageTitleCard | null = null;
  private titleStartMs = 0;
  private intro: IntroRun | undefined;
  private readonly liftNewPieces: boolean;
  /** Every entity ID this stage has shown, to spot new drawings. */
  private readonly knownIds = new Set<string>();
  /** New drawings lifting off, by entity ID: when their lift started. */
  private readonly lifts = new Map<string, number>();
  /** Lift states last reported, so each change is emitted once. */
  private reportedLifts = "";
  private readonly mattes = new Graphics();
  private readonly entityLayer = new Container();
  private readonly rainLayer = new Graphics();
  private readonly confettiLayer = new Graphics();
  private readonly views = new Map<string, EntityView>();
  /** Reactions for pieces without a view (the canvas failed or is starting). */
  private readonly detachedReactions = new Map<string, ReactionState>();

  private focusedId: string | undefined;

  private caption = INITIAL_CAPTION;
  private action: StoryAction | null = null;
  private actionStartMs = 0;
  private rain = false;
  private confettiStartMs: number | undefined;
  private sequence: StorySequence | null = null;
  private completedRevealEventId = "";
  private readonly offsets = new Map<string, Offset>();
  private readonly placements = new Map<string, Placement>();
  private playback: AbortController | undefined;
  /** When the beat on stage finishes, on the stage clock. */
  private beatEndsAtMs = 0;
  /** A playback told to stop at its current beat's end (see playSequence). */
  private yieldingPlayback: AbortController | undefined;
  /** Bumped by every playSequence call; a waiting call gives way to newer. */
  private playRequests = 0;
  private playedEventId = "";
  private playedBeats = 0;
  private resumeFrom: { eventId: string; beats: number } | undefined;

  private snapshot: StageSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(options: StoryStageOptions) {
    this.scene = options.scene;
    this.world = options.world;
    this.sceneIds = new Set(options.scene.objects.map((object) => object.id));
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion();
    this.interactive = options.interactive ?? false;
    this.liftNewPieces = options.liftNewPieces ?? false;
    for (const entity of options.world.entities) this.knownIds.add(entity.id);
    this.keepCommittedRevealsVisible =
      options.keepCommittedRevealsVisible ?? false;
    this.canvasCaptions = options.canvasCaptions ?? false;
    this.minBeatHoldMs = Math.max(0, options.minBeatHoldMs ?? 0);
    this.maxBeatHoldMs = Math.max(
      this.minBeatHoldMs,
      options.maxBeatHoldMs ?? Infinity,
    );
    this.realTimeClock = options.realTimeClock ?? false;
    this.size = {
      width: options.width ?? STAGE_WIDTH,
      height: options.height ?? STAGE_HEIGHT,
    };
    if (options.resting) this.restore(options.resting);
    this.canvas = document.createElement("canvas");
    this.snapshot = this.buildSnapshot();
    this.loadImage();
    this.ready = this.app
      .init({
        canvas: this.canvas,
        width: this.size.width,
        height: this.size.height,
        resolution: options.resolution ?? window.devicePixelRatio ?? 1,
        autoDensity: true,
        antialias: true,
        backgroundColor: PAPER,
        eventFeatures: {
          move: this.interactive,
          globalMove: false,
          click: this.interactive,
          wheel: false,
        },
      })
      .then(
        () => {
          this.appStarted = true;
          this.start();
        },
        () => this.failCanvas(),
      );
  }

  // ---- public API --------------------------------------------------------

  /** Shows a newly committed world. Offsets persist by entity ID. */
  setWorld(world: WorldState) {
    if (this.destroyed) return;
    this.adoptWorld(world);
    if (this.initialized) this.syncViews();
    this.emit();
  }

  /**
   * Plays one directed sequence beat by beat on the stage clock. Passing
   * `null` resets the stage to rest. A sequence already playing is never cut
   * mid-beat: it finishes the beat on stage, then stops, and the new sequence
   * (or rest) starts. If several arrive while a beat finishes, only the
   * newest plays. Resolves when the sequence ends or `signal` aborts.
   *
   * `nextWorld`, when given, is shown together with the sequence, so a piece the
   * sequence reveals stays hidden from its first frame instead of flashing in
   * between a separate `setWorld` and this call.
   */
  async playSequence(
    sequence: StorySequence | null,
    signal: AbortSignal,
    nextWorld?: WorldState,
  ): Promise<void> {
    if (this.destroyed) return;
    const request = ++this.playRequests;
    // The lift-off reveal is never cut: a sequence waits for it to finish.
    // The first sequence to arrive then plays first, like one already on
    // stage, and a newer one takes over at the end of its beat.
    while (this.intro && !this.destroyed) {
      const intro = this.intro;
      await this.wait(
        intro.startMs +
          introDurationMs(intro.count, intro.timing) -
          this.clockMs,
        signal,
      );
      if (signal.aborted || this.destroyed) return;
    }
    const running = this.playback;
    // Wait for the beat on stage to end; a reveal may extend it by a frame
    // or two while it waits to draw, so check again after each wait.
    while (
      running &&
      this.playback === running &&
      !running.signal.aborted &&
      this.beatEndsAtMs > this.clockMs
    ) {
      this.yieldingPlayback = running;
      await this.wait(this.beatEndsAtMs - this.clockMs, signal);
      if (signal.aborted || this.destroyed || request !== this.playRequests)
        return;
    }
    this.yieldingPlayback = undefined;
    this.playback?.abort();
    const playback = new AbortController();
    this.playback = playback;
    const stop = () => playback.abort();
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) playback.abort();
    const aborted = () => playback.signal.aborted || this.destroyed;

    try {
      const resume = this.resumeFrom;
      this.resumeFrom = undefined;
      this.sequence = sequence;
      if (nextWorld && !this.destroyed) {
        this.adoptWorld(nextWorld);
        if (this.initialized) this.syncViews();
      }
      const world = this.world;
      this.setAction(null);
      if (sequence && resume?.eventId === sequence.sourceEventId) {
        this.settle(sequence, resume.beats, world);
        return;
      }
      this.rain = restingRain(world, sequence);
      this.emit();
      if (!sequence) return;
      this.playedEventId = sequence.sourceEventId;
      this.playedBeats = 0;

      for (const [index, storyBeat] of sequence.beats.entries()) {
        if (aborted()) return;
        const action = storyBeat.action;
        const hold = Math.min(
          Math.max(beatHoldMs(action, this.reducedMotion), this.minBeatHoldMs),
          this.maxBeatHoldMs,
        );
        // Claim the stage for this beat before any await, so a sequence that
        // arrives while a reveal waits for its frames still lets it finish.
        this.beatEndsAtMs = this.clockMs + hold;
        this.caption = storyBeat.narration;
        this.setAction(action);
        this.emit();
        if (action.type === "reveal") {
          if (!this.reducedMotion) {
            await this.nextFrame(playback.signal);
            await this.nextFrame(playback.signal);
            if (aborted()) return;
          }
          this.completedRevealEventId = sequence.sourceEventId;
        }
        this.applyBeatEffects(sequence, index, world);
        this.playedBeats = index + 1;
        this.emit();
        this.beatEndsAtMs = this.clockMs + hold;
        await this.wait(hold, playback.signal);
        // A newer sequence takes the stage at this beat boundary.
        if (this.yieldingPlayback === playback) return;
      }
      if (!aborted()) {
        this.setAction(null);
        this.emit();
      }
    } finally {
      signal.removeEventListener("abort", stop);
      if (this.playback === playback) this.playback = undefined;
    }
  }

  /**
   * The reveal where pieces lift off the paper: the drawing starts flat, then
   * the pieces peel up together a small stagger apart (`liftOrder`), rise
   * with a small shake and settle into their idle loops (under reduced motion
   * they only fade in). `caption` replaces the caption for the intro.
   * Resolves when the intro ends or `signal` aborts. A sequence handed over
   * meanwhile waits for it, and a piece reacts to taps once it has landed.
   */
  async playIntro(
    signal: AbortSignal,
    options: { timing: IntroTiming; caption?: string },
  ): Promise<void> {
    if (this.destroyed || signal.aborted) return;
    const order = liftOrder(this.world.entities);
    const intro: IntroRun = {
      startMs: this.clockMs,
      timing: options.timing,
      order: new Map(order.map((id, index) => [id, index])),
      count: order.length,
    };
    this.intro = intro;
    if (options.caption) this.caption = options.caption;
    this.emit();
    try {
      await this.wait(introDurationMs(intro.count, intro.timing), signal);
    } finally {
      if (this.intro === intro) {
        this.intro = undefined;
        this.emit();
      }
    }
  }

  /** Resolves after `milliseconds` on the stage clock, or when `signal` aborts. */
  hold(milliseconds: number, signal: AbortSignal): Promise<void> {
    return this.wait(Math.max(0, milliseconds), signal);
  }

  /**
   * Shows a centred paper card (fading in) over the stage and hides the
   * canvas caption while it is up; `null` removes it.
   */
  showTitleCard(card: StageTitleCard | null) {
    if (this.destroyed) return;
    if (card && !this.titleCard) this.titleStartMs = this.clockMs;
    this.titleCard = card;
  }

  /** Resizes the canvas (CSS pixels). The 1000x600 world scales to fit. */
  resize(width: number, height = (width * STAGE_HEIGHT) / STAGE_WIDTH) {
    if (this.destroyed || width <= 0 || height <= 0) return;
    this.size = { width, height };
    if (!this.initialized) return;
    this.app.renderer.resize(width, height);
    this.app.stage.scale.set(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    for (const view of this.views.values()) this.updateHitArea(view);
  }

  /** Where the story stands now, to seed a replacement instance. */
  restingState(): StageRestingState {
    return {
      caption: this.caption,
      rain: this.rain,
      offsets: Object.fromEntries(this.offsets),
      placements: Object.fromEntries(this.placements),
      completedRevealEventId: this.completedRevealEventId,
      playedEventId: this.playedEventId,
      playedBeats: this.playedBeats,
    };
  }

  /** The display object for one entity, e.g. to attach pointer events. */
  entityObject(id: string): Container | undefined {
    return this.views.get(id)?.container;
  }

  /**
   * Plays a tap reaction on one piece, as a tap on the canvas does. Purely
   * local: the world is not touched. Returns the reaction started, or
   * undefined when the piece is hidden, unknown, or still in its cooldown.
   */
  react(entityId: string): ReactionKind | undefined {
    if (this.destroyed) return undefined;
    const view = this.views.get(entityId);
    const entity =
      view?.entity ?? this.world.entities.find((item) => item.id === entityId);
    if (
      !entity ||
      this.pendingReveal() === entityId ||
      this.liftState(entityId) !== undefined
    )
      return undefined;
    const { state, started } = tapReaction(
      this.reactionState(entityId),
      entity,
      view?.seed ?? seedFor(entityId),
      this.clockMs,
      this.reducedMotion,
    );
    if (!started) return undefined;
    if (view) view.reactions = state;
    else this.detachedReactions.set(entityId, state);
    this.emit();
    return started;
  }

  /**
   * Softly highlights the piece a keyboard user has focused in the host's
   * accessible mirror (undefined clears it).
   */
  setFocusedEntity(entityId: string | undefined) {
    this.focusedId = entityId;
  }

  /** Current time on the stage clock, in milliseconds. */
  get timeMs() {
    return this.clockMs;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): StageSnapshot {
    return this.snapshot;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playback?.abort();
    this.listeners.clear();
    for (const waiter of this.waiters) waiter.resolve();
    this.waiters = [];
    if (this.fallbackClock) clearInterval(this.fallbackClock);
    if (this.image) {
      this.image.onload = null;
      this.image.onerror = null;
    }
    this.canvas.remove();
    // `init` cannot be interrupted; finish tearing down once it settles.
    void this.ready.then(() => this.teardown());
  }

  // ---- lifecycle ---------------------------------------------------------

  private start() {
    if (this.destroyed) return;
    this.initialized = true;
    const stage = this.app.stage;
    stage.addChild(
      this.backdrop,
      this.mattes,
      this.entityLayer,
      this.rainLayer,
      this.confettiLayer,
      this.captionLayer,
      this.titleLayer,
    );
    if (this.interactive) {
      // Pixi claims every touch gesture on its canvas by default. Let the
      // browser keep scrolling and pinch-zooming the page instead: a swipe
      // becomes a scroll (and never a tap), a quick touch still taps.
      this.canvas.style.touchAction = "manipulation";
      this.app.renderer.events.autoPreventDefault = false;
    } else {
      stage.eventMode = "none";
      stage.interactiveChildren = false;
    }
    this.resize(this.size.width, this.size.height);
    this.drawBackdrop();
    this.syncViews();
    // A stall longer than a second still advances the clock by only 1 s.
    if (this.realTimeClock) this.app.ticker.minFPS = 1;
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS));
  }

  private failCanvas() {
    if (this.destroyed) return;
    this.canvasFailed = true;
    // Keep beats moving without a ticker so captions and state still play.
    let last = performance.now();
    this.fallbackClock = setInterval(() => {
      const now = performance.now();
      this.advanceClock(now - last);
      last = now;
    }, 16);
    this.emit();
  }

  private teardown() {
    // Destroy any app whose init finished, even if `start` never ran because
    // the stage was destroyed first: its ticker would otherwise keep rendering
    // to a detached canvas and hold a WebGL context.
    if (this.appStarted) {
      this.app.destroy({ removeView: true }, { children: true });
    }
    for (const texture of this.textures) texture.destroy(false);
    this.textures = [];
    this.imageSource?.destroy();
    this.imageSource = undefined;
    this.image = undefined;
  }

  private loadImage() {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (this.destroyed) return;
      this.imageStatus = "loaded";
      if (this.initialized) this.refreshArt();
      this.emit();
    };
    image.onerror = () => {
      if (this.destroyed) return;
      this.imageStatus = "failed";
      if (this.initialized) this.refreshArt();
      this.emit();
    };
    this.image = image;
    image.src = this.scene.document.drawing.compositeImage;
  }

  private refreshArt() {
    this.drawBackdrop();
    this.syncViews();
  }

  // ---- clock -------------------------------------------------------------

  private advanceClock(deltaMs: number) {
    this.clockMs += deltaMs;
    this.settleReactions();
    this.settleLifts();
    if (!this.waiters.length) return;
    const due = this.waiters.filter((waiter) => waiter.atMs <= this.clockMs);
    if (!due.length) return;
    this.waiters = this.waiters.filter((waiter) => waiter.atMs > this.clockMs);
    for (const waiter of due) waiter.resolve();
  }

  private wait(milliseconds: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted || this.destroyed) return resolve();
      const waiter: Waiter = {
        atMs: this.clockMs + milliseconds,
        resolve: () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** Resolves on the next clock tick. */
  private nextFrame(signal: AbortSignal) {
    return this.wait(Number.MIN_VALUE, signal);
  }

  private reactionState(entityId: string) {
    return (
      this.views.get(entityId)?.reactions ??
      this.detachedReactions.get(entityId) ??
      IDLE_REACTIONS
    );
  }

  /** Ends finished tap reactions and tells the host. */
  private settleReactions() {
    let changed = false;
    const settle = (state: ReactionState) => {
      const next = settleReaction(state, this.clockMs);
      if (next !== state) changed = true;
      return next;
    };
    for (const view of this.views.values())
      view.reactions = settle(view.reactions);
    for (const [id, state] of this.detachedReactions)
      this.detachedReactions.set(id, settle(state));
    if (changed) this.emit();
  }

  // ---- lift-off ----------------------------------------------------------

  /** Takes a new world, starting a lift-off for any piece that is new. */
  private adoptWorld(world: WorldState) {
    this.world = world;
    for (const entity of world.entities) {
      if (this.knownIds.has(entity.id)) continue;
      this.knownIds.add(entity.id);
      // Even mid-intro a new drawing lifts on its own, straight away.
      if (this.liftNewPieces) this.lifts.set(entity.id, this.clockMs);
    }
  }

  /**
   * A piece's slot in the running intro, or undefined when it has none. A
   * piece that joins mid-intro lifts on its own when new pieces lift (the
   * live stage); otherwise it lifts last with the intro.
   */
  private introIndex(entityId: string) {
    const intro = this.intro;
    if (!intro) return undefined;
    const index = intro.order.get(entityId);
    if (index !== undefined || this.liftNewPieces) return index;
    return intro.count - 1;
  }

  /** Where a piece is in its lift-off, or undefined once it has landed. */
  private liftState(entityId: string): "flat" | "lifting" | undefined {
    const now = this.clockMs;
    const lift = this.lifts.get(entityId);
    if (lift !== undefined)
      return now < lift + DRAWING_LIFT.liftMs ? "lifting" : undefined;
    const intro = this.intro;
    const index = this.introIndex(entityId);
    if (intro && index !== undefined) {
      const start =
        intro.startMs + introPieceStartMs(index, intro.count, intro.timing);
      if (now < start) return "flat";
      if (now < start + intro.timing.liftMs) return "lifting";
    }
    return undefined;
  }

  /** Ends finished lifts and tells the host when a piece's state changed. */
  private settleLifts() {
    if (!this.intro && !this.lifts.size && !this.reportedLifts) return;
    for (const [id, startMs] of this.lifts)
      if (this.clockMs >= startMs + DRAWING_LIFT.liftMs) this.lifts.delete(id);
    const states = this.world.entities.map((entity) =>
      this.liftState(entity.id),
    );
    const report = states.some(Boolean) ? states.join(",") : "";
    if (report === this.reportedLifts) return;
    this.reportedLifts = report;
    this.emit();
  }

  // ---- state -------------------------------------------------------------

  private restore(resting: StageRestingState) {
    this.caption = resting.caption;
    this.rain = resting.rain;
    for (const [id, offset] of Object.entries(resting.offsets))
      this.offsets.set(id, offset);
    for (const [id, placement] of Object.entries(resting.placements))
      this.placements.set(id, placement);
    this.completedRevealEventId = resting.completedRevealEventId;
    this.playedEventId = resting.playedEventId;
    this.playedBeats = resting.playedBeats;
    if (resting.playedEventId)
      this.resumeFrom = {
        eventId: resting.playedEventId,
        beats: resting.playedBeats,
      };
  }

  /** Moves, parks and weather for one beat, without any timing. */
  private applyBeatEffects(
    sequence: StorySequence,
    index: number,
    world: WorldState,
  ) {
    const action = sequence.beats[index].action;
    const moved = beatMovement(
      action,
      sequence.beats[index + 1]?.action,
      world,
    );
    if (moved) {
      this.moveTo(moved.entityId, moved.movement.offset);
      this.placements.set(moved.entityId, moved.movement.placement);
    }
    if (action.type === "weather_shift") this.rain = action.weather === "rain";
  }

  /**
   * Finishes an event a previous instance had started: applies its remaining
   * beats instantly instead of replaying the whole sequence.
   */
  private settle(sequence: StorySequence, fromBeat: number, world: WorldState) {
    this.playedEventId = sequence.sourceEventId;
    for (let index = fromBeat; index < sequence.beats.length; index++) {
      const storyBeat = sequence.beats[index];
      this.caption = storyBeat.narration;
      if (storyBeat.action.type === "reveal")
        this.completedRevealEventId = sequence.sourceEventId;
      this.applyBeatEffects(sequence, index, world);
      this.playedBeats = index + 1;
    }
    this.emit();
  }

  private setAction(action: StoryAction | null) {
    this.action = action;
    this.actionStartMs = this.clockMs;
    this.confettiStartMs =
      action?.type === "celebrate" && !this.reducedMotion
        ? this.clockMs
        : undefined;
  }

  private moveTo(entityId: string, offset: Offset) {
    this.offsets.set(entityId, offset);
    const view = this.views.get(entityId);
    if (!view) return;
    view.moveFrom = this.reducedMotion
      ? offset
      : tweenOffset(
          view.moveFrom,
          view.moveTo,
          this.clockMs - view.moveStartMs,
        );
    view.moveTo = offset;
    view.moveStartMs = this.clockMs;
  }

  private pendingReveal() {
    return pendingRevealId(
      this.sequence,
      this.keepCommittedRevealsVisible,
      this.completedRevealEventId,
    );
  }

  private buildSnapshot(): StageSnapshot {
    const pending = this.pendingReveal();
    return {
      caption: this.caption,
      action: this.action?.type ?? "resting",
      celebrating: !this.reducedMotion && this.action?.type === "celebrate",
      imageStatus: this.imageStatus,
      canvasFailed: this.canvasFailed,
      intro: this.intro ? "playing" : "done",
      entities: this.world.entities.map((entity) => {
        const offset = this.offsets.get(entity.id);
        const home = center(entity.bounds);
        const reactions = this.reactionState(entity.id);
        return {
          id: entity.id,
          name: entity.name,
          role: entity.role,
          revealState:
            pending === entity.id
              ? "hidden"
              : (this.liftState(entity.id) ?? "visible"),
          placement: this.placements.get(entity.id) ?? "source",
          logicalX: logicalX(entity, offset),
          centerX: Math.round(home.x + (offset?.x ?? 0)),
          centerY: Math.round(home.y + (offset?.y ?? 0)),
          reaction: reactions.active?.reaction,
          reactionCount: reactions.taps,
        };
      }),
    };
  }

  private emit() {
    if (this.destroyed) return;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  // ---- drawing -----------------------------------------------------------

  private hasCrop(entity: Entity) {
    return this.sceneIds.has(entity.id) && this.imageStatus !== "failed";
  }

  /** Removes and destroys a container's children, freeing sprite textures. */
  private clearChildren(container: Container) {
    for (const child of container.removeChildren()) {
      if (child instanceof Sprite) {
        this.textures = this.textures.filter((item) => item !== child.texture);
        child.texture.destroy(false);
      }
      child.destroy({ children: true });
    }
  }

  private drawBackdrop() {
    this.clearChildren(this.backdrop);
    this.backdropSprite = undefined;
    if (this.imageStatus === "loaded" && this.image) {
      this.imageSource ??= new ImageSource({ resource: this.image });
      const sprite = new Sprite(new Texture({ source: this.imageSource }));
      this.textures.push(sprite.texture);
      sprite.width = STAGE_WIDTH;
      sprite.height = STAGE_HEIGHT;
      sprite.alpha = RESTING_BACKDROP_ALPHA;
      this.backdrop.addChild(sprite);
      this.backdropSprite = sprite;
    }
  }

  private drawMattes() {
    this.mattes.clear();
    if (this.imageStatus === "failed") return;
    for (const entity of this.world.entities) {
      if (!this.sceneIds.has(entity.id)) continue;
      const { x, y, width, height } = entity.bounds;
      this.mattes.roundRect(x, y, width, height, 6);
    }
    this.mattes.fill({ color: PAPER, alpha: 0.74 });
  }

  private cropTexture(entity: Entity) {
    if (!this.image || !this.imageSource) return undefined;
    const scaleX = this.image.naturalWidth / STAGE_WIDTH;
    const scaleY = this.image.naturalHeight / STAGE_HEIGHT;
    const { x, y, width, height } = entity.bounds;
    const left = Math.max(0, x * scaleX);
    const top = Math.max(0, y * scaleY);
    const right = Math.min(this.image.naturalWidth, (x + width) * scaleX);
    const bottom = Math.min(this.image.naturalHeight, (y + height) * scaleY);
    if (right - left < 1 || bottom - top < 1) return undefined;
    const texture = new Texture({
      source: this.imageSource,
      frame: new Rectangle(left, top, right - left, bottom - top),
    });
    this.textures.push(texture);
    return texture;
  }

  private drawPiece(view: EntityView) {
    const { entity, container } = view;
    const { width, height } = entity.bounds;
    const crop = this.hasCrop(entity);
    // A drawing added mid-story is cut from the child's own strokes.
    const sketch = crop ? undefined : entity.sketch;
    const look = entityLook(entity);
    const drawnAs = [
      crop ? `crop:${this.imageStatus}` : sketch ? "sketch" : "token",
      look,
      entity.name,
      width,
      height,
    ].join("|");
    if (view.drawnAs === drawnAs) return;
    view.drawnAs = drawnAs;
    this.clearChildren(container);

    view.glow = new Graphics()
      .roundRect(-width / 2 - 8, -height / 2 - 8, width + 16, height + 16, 10)
      .stroke({ width: 8, color: 0xffd653, alpha: 0.46 });
    view.glow.alpha = 0;
    container.addChild(view.glow);

    const shape: EntityLook = crop || sketch ? "thing" : look;
    const shadow = new Graphics();
    tokenShape(shadow, shape, width, height, 2, 6).fill({
      color: INK,
      alpha: 0.08,
    });
    tokenShape(shadow, shape, width, height, 1, 4).fill({
      color: INK,
      alpha: 0.1,
    });
    tokenShape(shadow, shape, width, height, 1, 1).fill({
      color: INK,
      alpha: 0.14,
    });
    const edge = new Graphics();
    tokenShape(edge, shape, width, height, 3).fill(
      look === "span" && !crop && !sketch ? 0xf8deb8 : PAPER_EDGE,
    );
    container.addChild(shadow, edge);

    if (sketch) {
      const left = entity.bounds.x + width / 2;
      const top = entity.bounds.y + height / 2;
      const lines = new Graphics();
      for (const stroke of sketch.strokes) {
        lines.moveTo(stroke[0]! - left, stroke[1]! - top);
        for (let index = 2; index < stroke.length; index += 2)
          lines.lineTo(stroke[index]! - left, stroke[index + 1]! - top);
      }
      lines.stroke({
        width: SKETCH_STROKE_WIDTH,
        color: SKETCH_COLOR,
        cap: "round",
        join: "round",
      });
      container.addChild(lines);
      return;
    }

    const texture =
      crop && this.imageStatus === "loaded"
        ? this.cropTexture(entity)
        : undefined;
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.width = width;
      sprite.height = height;
      container.addChild(sprite);
      return;
    }
    if (crop) return; // Still loading: a blank paper piece for now.

    const body = new Graphics();
    tokenShape(body, look, width, height, 0).fill(tokenColors[look]);
    if (look === "span") {
      for (let plank = 0.12; plank < 1; plank += 0.15)
        body
          .rect(-width / 2 + width * plank, -height / 2, width * 0.03, height)
          .fill({ color: 0x5a2f23, alpha: 0.42 });
      body
        .rect(-width / 2, -height / 2 + height * 0.17, width, 3)
        .rect(-width / 2, height / 2 - height * 0.17 - 3, width, 3)
        .fill(0x754536);
    }
    const label = new Text({
      text: entity.name,
      style: {
        fontFamily: '"Trebuchet MS", Arial, sans-serif',
        fontSize: 18,
        fontWeight: "900",
        fill: INK,
        align: "center",
        wordWrap: true,
        wordWrapWidth: Math.max(40, width * 0.9),
      },
    });
    label.anchor.set(0.5);
    const fit = Math.min(
      1,
      (width * 0.9) / label.width,
      (height * 0.9) / label.height,
    );
    label.scale.set(Math.max(0.45, fit));
    container.addChild(body, label);
  }

  private syncViews() {
    const seen = new Set<string>();
    for (const entity of this.world.entities) {
      seen.add(entity.id);
      let view = this.views.get(entity.id);
      if (!view) {
        const offset = this.offsets.get(entity.id) ?? { x: 0, y: 0 };
        const container = new Container({ label: entity.id });
        view = {
          entity,
          motion: idleMotionFor(entity),
          seed: seedFor(entity.id),
          container,
          glow: undefined,
          drawnAs: "",
          moveFrom: offset,
          moveTo: offset,
          moveStartMs: this.clockMs,
          hidden: this.pendingReveal() === entity.id ? 1 : 0,
          reactions: this.detachedReactions.get(entity.id) ?? IDLE_REACTIONS,
        };
        this.detachedReactions.delete(entity.id);
        this.views.set(entity.id, view);
        this.makeTappable(view);
      }
      view.entity = entity;
      view.motion = idleMotionFor(entity);
      this.drawPiece(view);
      this.updateHitArea(view);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.clearChildren(view.container);
      view.container.destroy();
      this.views.delete(id);
    }
    for (const id of this.detachedReactions.keys())
      if (!seen.has(id)) this.detachedReactions.delete(id);
    // Scenery below, travellers above; world order within each layer.
    this.entityLayer.removeChildren();
    const ordered = [...this.world.entities].sort(
      (a, b) => paintLayerFor(a) - paintLayerFor(b),
    );
    for (const entity of ordered) {
      const view = this.views.get(entity.id);
      if (view) this.entityLayer.addChild(view.container);
    }
    this.drawMattes();
  }

  // ---- input -------------------------------------------------------------

  private makeTappable(view: EntityView) {
    if (!this.interactive) return;
    const { container } = view;
    container.eventMode = "static";
    container.cursor = "pointer";
    // Only the padded hit area counts; the glow and paper edge do not.
    container.interactiveChildren = false;
    const id = view.entity.id;
    container.on("pointertap", (event: FederatedPointerEvent) => {
      if (event.button > 0) return;
      this.react(id);
    });
  }

  /** A padded rectangle so thin drawings are still easy to tap. */
  private updateHitArea(view: EntityView) {
    if (!this.interactive) return;
    const rect = touchTarget(view.entity.bounds, this.size.width / STAGE_WIDTH);
    view.container.hitArea = new Rectangle(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
  }

  // ---- per-frame ---------------------------------------------------------

  private tick(deltaMs: number) {
    if (this.destroyed) return;
    this.advanceClock(deltaMs);
    const now = this.clockMs;
    const pending = this.pendingReveal();
    const action = this.action;
    const activeId = action && "entityId" in action ? action.entityId : "";
    const introRun = this.intro;
    const introMs = introRun ? now - introRun.startMs : 0;

    for (const view of this.views.values()) {
      const { entity, container } = view;
      const home = center(entity.bounds);
      const offset = this.reducedMotion
        ? view.moveTo
        : tweenOffset(view.moveFrom, view.moveTo, now - view.moveStartMs);
      // A new drawing has its own lift, even mid-intro (see introIndex).
      const liftStart = this.lifts.get(entity.id);
      const introIndex = this.introIndex(entity.id);
      const intro =
        liftStart !== undefined
          ? sampleIntro(now - liftStart, 0, 1, this.reducedMotion, DRAWING_LIFT)
          : introRun && introIndex !== undefined
            ? sampleIntro(
                introMs,
                introIndex,
                introRun.count,
                this.reducedMotion,
                introRun.timing,
              )
            : undefined;
      const idle = weightPose(
        this.reducedMotion
          ? RESTING_POSE
          : sampleMotion(view.motion, now, view.seed),
        intro?.idle ?? 1,
      );
      const pulsing =
        !this.reducedMotion &&
        activeId === entity.id &&
        !(action?.type === "reveal" && pending === entity.id);
      const pulse = pulsing
        ? beatPulse(
            action!.type,
            now - this.actionStartMs,
            entity.bounds.height,
          )
        : undefined;
      view.hidden = approach(
        view.hidden,
        pending === entity.id ? 1 : 0,
        deltaMs,
        this.reducedMotion ? 0 : REVEAL_FADE_MS,
      );
      const hiddenScale = 1 - 0.18 * view.hidden;
      // A piece waiting for its reveal must not swallow taps meant for the
      // pieces drawn beneath it.
      if (this.interactive)
        container.eventMode = pending === entity.id ? "none" : "static";
      const active = view.reactions.active;
      const reaction = active
        ? sampleReaction(active.reaction, now - active.startMs, entity.bounds)
        : undefined;
      const pose = combinePoses(
        idle,
        intro?.pose ?? RESTING_POSE,
        pulse?.pose ?? RESTING_POSE,
        reaction?.pose ?? RESTING_POSE,
      );
      container.position.set(
        home.x + offset.x + pose.dx,
        home.y + offset.y + pose.dy,
      );
      container.scale.set(pose.scaleX * hiddenScale, pose.scaleY * hiddenScale);
      container.rotation = pose.rotation;
      container.alpha =
        (1 - view.hidden) * (pulse?.alpha ?? 1) * (intro?.alpha ?? 1);
      if (view.glow)
        view.glow.alpha = Math.max(
          pulse?.glow ?? 0,
          reaction?.glow ?? 0,
          this.focusedId === entity.id ? 0.55 : 0,
        );
    }

    const paper = introRun
      ? introBackdrop(introMs, introRun.count, introRun.timing)
      : { backdropAlpha: RESTING_BACKDROP_ALPHA, matteAlpha: 1 };
    if (this.backdropSprite) this.backdropSprite.alpha = paper.backdropAlpha;
    this.mattes.alpha = paper.matteAlpha;

    this.drawRain(now);
    this.drawConfetti(now);
    this.drawCanvasCaption();
    this.drawTitleCard(now);
  }

  /** The caption as a paper strip along the bottom, like the DOM caption. */
  private drawCanvasCaption() {
    const text =
      this.canvasCaptions && !this.titleCard && this.caption !== INITIAL_CAPTION
        ? this.caption
        : "";
    if (text === this.drawnCaption) return;
    this.drawnCaption = text;
    this.clearChildren(this.captionLayer);
    if (!text) return;
    const maxWidth = STAGE_WIDTH * 0.88;
    const label = new Text({
      text,
      style: {
        fontFamily: CAPTION_FONT,
        fontSize: 26,
        fontWeight: "700",
        lineHeight: 32,
        fill: INK,
        align: "center",
        wordWrap: true,
        wordWrapWidth: maxWidth - 36,
      },
    });
    label.anchor.set(0.5);
    const width = Math.min(maxWidth, label.width + 36);
    const height = label.height + 20;
    const x = STAGE_WIDTH / 2;
    const y = STAGE_HEIGHT * 0.96 - height / 2;
    label.position.set(x, y);
    const strip = new Graphics()
      .roundRect(x - width / 2, y - height / 2 + 3, width, height, 5)
      .fill({ color: INK, alpha: 0.12 })
      .roundRect(x - width / 2, y - height / 2, width, height, 5)
      .fill({ color: PAPER_EDGE, alpha: 0.94 })
      .stroke({ width: 1.5, color: INK, alpha: 0.24 });
    this.captionLayer.addChild(strip, label);
  }

  private drawTitleCard(now: number) {
    const card = this.titleCard;
    if (card !== this.drawnTitle) {
      this.drawnTitle = card;
      this.clearChildren(this.titleLayer);
      if (card) this.buildTitleCard(card);
    }
    this.titleLayer.alpha = card
      ? Math.min(1, (now - this.titleStartMs) / TITLE_FADE_MS)
      : 0;
  }

  private buildTitleCard(card: StageTitleCard) {
    const wash = new Graphics()
      .rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
      .fill({ color: PAPER, alpha: 0.6 });
    const title = new Text({
      text: card.title,
      style: {
        fontFamily: CAPTION_FONT,
        fontSize: 54,
        fontWeight: "700",
        fill: INK,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 620,
      },
    });
    title.anchor.set(0.5);
    const subtitle = card.subtitle
      ? new Text({
          text: card.subtitle,
          style: {
            fontFamily: '"Trebuchet MS", Arial, sans-serif',
            fontSize: 24,
            fontWeight: "900",
            fill: 0x6c30a3,
            align: "center",
          },
        })
      : undefined;
    subtitle?.anchor.set(0.5);
    const inner = title.height + (subtitle ? 16 + subtitle.height : 0);
    const width = Math.max(420, title.width + 96, (subtitle?.width ?? 0) + 96);
    const height = inner + 72;
    const cx = STAGE_WIDTH / 2;
    const cy = STAGE_HEIGHT / 2;
    const paper = new Graphics()
      .roundRect(cx - width / 2 + 2, cy - height / 2 + 8, width, height, 10)
      .fill({ color: INK, alpha: 0.14 })
      .roundRect(cx - width / 2, cy - height / 2, width, height, 10)
      .fill(PAPER_EDGE)
      .stroke({ width: 3, color: INK });
    title.position.set(cx, cy - inner / 2 + title.height / 2);
    subtitle?.position.set(cx, cy + inner / 2 - subtitle.height / 2);
    this.titleLayer.addChild(wash, paper, title);
    if (subtitle) this.titleLayer.addChild(subtitle);
  }

  private drawRain(now: number) {
    const rain = this.rainLayer.clear();
    if (!this.rain) return;
    const slant = Math.tan((8 * Math.PI) / 180);
    const length = 48;
    for (let index = 0; index < 10; index++) {
      const x = STAGE_WIDTH * (0.07 + index * 0.09);
      const fall = this.reducedMotion
        ? 0
        : (now * 0.32 + index * 97) % (STAGE_HEIGHT + length);
      const top = this.reducedMotion ? 84 : fall - length;
      const shift = this.reducedMotion ? 0 : -fall * slant * 0.5;
      rain
        .moveTo(x + shift + (length / 2) * slant, top)
        .lineTo(x + shift - (length / 2) * slant, top + length);
    }
    rain.stroke({ width: 3, color: 0x628ea7, alpha: 0.58, cap: "round" });
  }

  private drawConfetti(now: number) {
    const confetti = this.confettiLayer.clear();
    if (this.confettiStartMs === undefined) return;
    const t = (now - this.confettiStartMs) / 650;
    if (t >= 1) return;
    const eased = 1 - (1 - t) ** 2;
    for (let index = 0; index < 7; index++) {
      const spread = (index - 3) * 20;
      const angle = eased * (Math.PI * 0.9) * (index % 2 ? -1 : 1);
      const cx = STAGE_WIDTH / 2 + spread * eased;
      const cy = STAGE_HEIGHT * 0.42 + 120 * eased;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const w = 5;
      const h = 8;
      const corners = [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ].flatMap(([px, py]) => [
        cx + px * cos - py * sin,
        cy + px * sin + py * cos,
      ]);
      confetti
        .poly(corners)
        .fill({ color: index % 2 ? 0x6c30a3 : 0xff7a00, alpha: 1 - t });
    }
  }
}
