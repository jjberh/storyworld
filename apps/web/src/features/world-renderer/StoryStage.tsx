import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { WorldState } from "@storyworld/contracts/model";
import type { StorySequence } from "@storyworld/contracts/story-beat";
import {
  INITIAL_CAPTION,
  StoryStageRenderer,
  type StagePiecePose,
  type StageRestingState,
  type StageSnapshot,
} from "./story-stage-renderer";
import { center, logicalX } from "./story-playback";
import { RevealHandoff } from "./reveal-handoff";

type StageTestWindow = Window & {
  __storyStageTest?: boolean;
  __storyStageDebug?: { poses: () => Record<string, StagePiecePose> };
};

function restingSnapshot(world: WorldState, reveal: boolean): StageSnapshot {
  return {
    caption: INITIAL_CAPTION,
    action: "resting",
    celebrating: false,
    imageStatus: "loading",
    canvasFailed: false,
    intro: reveal ? "playing" : "done",
    entities: world.entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      role: entity.role,
      revealState: reveal ? "flat" : "visible",
      placement: "source",
      logicalX: logicalX(entity, undefined),
      centerX: Math.round(center(entity.bounds).x),
      centerY: Math.round(center(entity.bounds).y),
      reaction: undefined,
      reactionCount: 0,
      cutout: "pending",
    })),
  };
}

/**
 * Thin React host for `StoryStageRenderer`. The canvas draws the theater; the
 * DOM around it mirrors the renderer's semantic state for assistive tech and
 * tests (caption, action, reveal state, and one element per piece).
 *
 * `reveal` plays the live lift-off reveal (`LIVE_INTRO`) when the stage first
 * opens, calling `onRevealStarted` as it starts; the first story sequence
 * waits for it. The value on mount counts: a stage mounted later with
 * `reveal` still true would replay it, so the host clears it on start.
 * Pieces added later get their own short lift-off. Both are presentation
 * only.
 */
export function StoryStage({
  scene,
  world,
  sequence,
  keepCommittedRevealsVisible = false,
  reveal = false,
  onRevealStarted,
}: {
  scene: ConfirmedScene;
  world: WorldState;
  sequence: StorySequence | null;
  keepCommittedRevealsVisible?: boolean;
  reveal?: boolean;
  onRevealStarted?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<StoryStageRenderer | null>(null);
  const latestScene = useRef(scene);
  const latestWorld = useRef(world);
  const latestSequence = useRef(sequence);
  // Handed from a torn-down stage to its replacement so a rebuild keeps the
  // pieces where they stood and does not replay the event again.
  const carried = useRef<StageRestingState | undefined>(undefined);
  // The reveal passes from renderer to renderer until one finishes it
  // (StrictMode mounts twice); after that a rebuild keeps the pieces standing.
  const [handoff] = useState(() => new RevealHandoff(reveal));
  const latestOnRevealStarted = useRef(onRevealStarted);
  useEffect(() => {
    latestScene.current = scene;
    latestWorld.current = world;
    latestSequence.current = sequence;
    latestOnRevealStarted.current = onRevealStarted;
  });

  // Live snapshots re-parse the scene on every update, so the renderer is
  // keyed by the scene's content rather than its object identity.
  const drawing = scene.document.drawing.compositeImage;
  const sceneObjectIds = scene.objects.map((object) => object.id).join(",");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const stage = new StoryStageRenderer({
      scene: latestScene.current,
      world: latestWorld.current,
      keepCommittedRevealsVisible,
      interactive: true,
      liftNewPieces: true,
      resting: carried.current,
      width: element.clientWidth || undefined,
    });
    const stopReveal = handoff.play(stage, () =>
      latestOnRevealStarted.current?.(),
    );
    stage.canvas.className = "story-stage-canvas";
    stage.canvas.setAttribute("aria-hidden", "true");
    element.appendChild(stage.canvas);
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) stage.resize(element.clientWidth);
    });
    observer.observe(element);
    setRenderer(stage);
    return () => {
      stopReveal();
      observer.disconnect();
      carried.current = stage.restingState();
      stage.destroy();
      setRenderer((current) => (current === stage ? null : current));
    };
  }, [drawing, sceneObjectIds, keepCommittedRevealsVisible, handoff]);

  useEffect(() => {
    renderer?.setWorld(world);
  }, [renderer, world]);

  // End-to-end tests read the pieces' drawn poses instead of sampling canvas
  // pixels. Only a page that set `__storyStageTest` before loading gets the
  // hook; nothing else changes either way.
  useEffect(() => {
    const page = window as StageTestWindow;
    if (!renderer || !page.__storyStageTest) return;
    const debug = { poses: () => renderer.piecePoses() };
    page.__storyStageDebug = debug;
    return () => {
      if (page.__storyStageDebug === debug) delete page.__storyStageDebug;
    };
  }, [renderer]);

  // One playback lifetime per renderer. A new sequence is handed to the
  // renderer without aborting the old one, so the beat on stage finishes
  // before the new moment plays (the renderer drops the rest of the old one).
  const playback = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!renderer) return;
    const controller = new AbortController();
    playback.current = controller;
    return () => {
      controller.abort();
      if (playback.current === controller) playback.current = null;
    };
  }, [renderer]);

  // A committed event ID is the playback key. Presence and proposal renders
  // must not restart a sequence whose committed identity has not changed.
  const sourceEventId = sequence?.sourceEventId;
  useEffect(() => {
    if (!renderer || !playback.current) return;
    void renderer.playSequence(latestSequence.current, playback.current.signal);
  }, [renderer, sourceEventId]);

  const fallback = useMemo(
    () => restingSnapshot(world, handoff.pending),
    [world, handoff, renderer],
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      renderer ? renderer.subscribe(listener) : () => undefined,
    [renderer],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    renderer ? renderer.getSnapshot() : fallback,
  );

  // Glow the piece whose tickle button has keyboard focus. Read from the DOM
  // on every change rather than trusting focus/blur alone: a rebuilt renderer
  // needs the glow re-applied, and a button disabled while focused (its piece
  // hidden for a reveal) may never fire blur.
  const pieces = useRef<HTMLUListElement>(null);
  const [focusChanges, setFocusChanges] = useState(0);
  const noteFocus = () => setFocusChanges((count) => count + 1);
  useEffect(() => {
    if (!renderer) return;
    const active = document.activeElement;
    renderer.setFocusedEntity(
      active instanceof HTMLButtonElement &&
        !active.disabled &&
        pieces.current?.contains(active)
        ? active.dataset.tickle
        : undefined,
    );
  }, [renderer, snapshot, focusChanges]);

  return (
    <figure className="paper-theater" data-testid="paper-theater">
      <div
        className="paper-theater-stage"
        role="img"
        aria-label={
          world.pathStatus === "free_play"
            ? "Living paper theater. Free play."
            : `Living paper theater. The route is ${world.pathStatus}.`
        }
        data-action={snapshot.action}
        data-intro={snapshot.intro}
        data-motion={renderer?.reducedMotion ? "reduced" : "full"}
      >
        <div ref={host} className="story-stage-host" />
        <img
          className="visually-hidden"
          src={drawing}
          alt="Your confirmed drawing"
        />
        {snapshot.celebrating && (
          <span className="paper-confetti" aria-hidden="true" />
        )}
        {(snapshot.imageStatus === "failed" || snapshot.canvasFailed) && (
          <p className="paper-theater-fallback">
            {snapshot.canvasFailed
              ? "The paper theater could not start here, but the story still plays below."
              : "The drawing could not be loaded, but its paper pieces are still here."}
          </p>
        )}
      </div>
      <ul
        ref={pieces}
        // Without a canvas there is no glow to show keyboard focus, so the
        // buttons themselves become visible.
        className={
          snapshot.canvasFailed ? "paper-pieces-fallback" : "visually-hidden"
        }
        aria-label="Paper pieces"
        onFocus={noteFocus}
        onBlur={noteFocus}
      >
        {snapshot.entities.map((entity) => (
          <li
            key={entity.id}
            data-entity-id={entity.id}
            data-reveal-state={entity.revealState}
            data-placement={entity.placement}
            data-logical-x={entity.logicalX}
            data-center-x={entity.centerX}
            data-center-y={entity.centerY}
            data-reaction={entity.reaction}
            data-reaction-count={entity.reactionCount}
            data-cutout={entity.cutout}
          >
            <button
              type="button"
              data-tickle={entity.id}
              // A piece reacts once it is showing and has landed.
              disabled={entity.revealState !== "visible"}
              onClick={() => renderer?.react(entity.id)}
            >
              Tickle {entity.name}
            </button>
          </li>
        ))}
      </ul>
      <figcaption className="paper-theater-caption" aria-live="polite">
        {snapshot.caption}
      </figcaption>
    </figure>
  );
}
