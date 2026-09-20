import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { Bounds, Entity, WorldState } from "@storyworld/contracts/model";
import type {
  StoryAction,
  StorySequence,
} from "@storyworld/contracts/story-beat";

type Offset = { x: number; y: number };
type Placement = "source" | "near-obstacle" | "target-side";
type Movement = { offset: Offset; placement: Placement };

function center(bounds: Bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function movementFor(
  entity: Entity,
  target: Entity,
  world: WorldState,
  blockedNext: StoryAction | undefined,
): Movement {
  const from = center(entity.bounds);
  if (blockedNext?.type === "blocked_by" || world.pathStatus === "blocked") {
    const obstacle = world.entities.find(
      (item) =>
        item.id ===
        (blockedNext?.type === "blocked_by"
          ? blockedNext.obstacleId
          : world.entities.find((candidate) => candidate.kind === "river")?.id),
    );
    if (obstacle) {
      const obstacleCenter = center(obstacle.bounds);
      const leftToRight = from.x < obstacleCenter.x;
      const destinationX = leftToRight
        ? obstacle.bounds.x - entity.bounds.width / 2 - 14
        : obstacle.bounds.x +
          obstacle.bounds.width +
          entity.bounds.width / 2 +
          14;
      return {
        offset: {
          x: destinationX - from.x,
          y: Math.max(-80, Math.min(80, obstacleCenter.y - from.y)),
        },
        placement: "near-obstacle",
      };
    }
  }

  const destination = center(target.bounds);
  const direction = destination.x >= from.x ? 1 : -1;
  const destinationX =
    destination.x -
    direction * (target.bounds.width / 2 + entity.bounds.width / 2 + 24);
  return {
    offset: {
      x: destinationX - from.x,
      y: destination.y - from.y,
    },
    placement: "target-side",
  };
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function nextFrame(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      window.cancelAnimationFrame(frame);
      resolve();
    };
    const frame = window.requestAnimationFrame(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cropStyle(image: string, bounds: Bounds): CSSProperties {
  const positionX =
    bounds.width >= 1000 ? 0 : (bounds.x / (1000 - bounds.width)) * 100;
  const positionY =
    bounds.height >= 600 ? 0 : (bounds.y / (600 - bounds.height)) * 100;
  return {
    backgroundImage: `url("${image.replaceAll('"', '\\"')}")`,
    backgroundSize: `${(1000 / bounds.width) * 100}% ${(600 / bounds.height) * 100}%`,
    backgroundPosition: `${positionX}% ${positionY}%`,
  };
}

function pieceStyle(bounds: Bounds, offset?: Offset): CSSProperties {
  return {
    left: `${(bounds.x + (offset?.x ?? 0)) / 10}%`,
    top: `${(bounds.y + (offset?.y ?? 0)) / 6}%`,
    width: `${bounds.width / 10}%`,
    height: `${bounds.height / 6}%`,
  };
}

export function PaperTheaterStage({
  scene,
  world,
  sequence,
}: {
  scene: ConfirmedScene;
  world: WorldState;
  sequence: StorySequence | null;
}) {
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [completedRevealEventId, setCompletedRevealEventId] = useState("");
  const [active, setActive] = useState<StoryAction | null>(null);
  const [caption, setCaption] = useState("The paper theater is ready.");
  const [rain, setRain] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const sceneIds = useMemo(
    () => new Set(scene.objects.map((object) => object.id)),
    [scene],
  );
  const revealEntityId = sequence?.beats.find(
    (item) => item.action.type === "reveal",
  )?.action;
  const pendingRevealId =
    revealEntityId?.type === "reveal" &&
    completedRevealEventId !== sequence?.sourceEventId
      ? revealEntityId.entityId
      : undefined;

  // A committed event ID is the playback key. Presence and proposal renders
  // must not restart a sequence whose committed identity has not changed.
  useEffect(() => {
    const controller = new AbortController();
    const duration = reducedMotion ? 40 : 650;

    setActive(null);
    setRain(
      world.weather === "rain" &&
        !sequence?.beats.some((item) => item.action.type === "weather_shift"),
    );

    async function play() {
      if (!sequence) return;
      for (const [index, storyBeat] of sequence.beats.entries()) {
        if (controller.signal.aborted) return;
        const action = storyBeat.action;
        setCaption(storyBeat.narration);
        setActive(action);
        if (action.type === "reveal") {
          if (!reducedMotion) {
            await nextFrame(controller.signal);
            await nextFrame(controller.signal);
            if (controller.signal.aborted) return;
          }
          setCompletedRevealEventId(sequence.sourceEventId);
        }
        if (action.type === "move_toward") {
          const entity = world.entities.find(
            (item) => item.id === action.entityId,
          );
          const target = world.entities.find(
            (item) => item.id === action.targetId,
          );
          if (entity && target) {
            const nextAction = sequence.beats[index + 1]?.action;
            const movement = movementFor(entity, target, world, nextAction);
            setOffsets((current) => ({
              ...current,
              [entity.id]: movement.offset,
            }));
            setPlacements((current) => ({
              ...current,
              [entity.id]: movement.placement,
            }));
          }
        }
        if (action.type === "blocked_by") {
          const entity = world.entities.find(
            (item) => item.id === action.entityId,
          );
          const obstacle = world.entities.find(
            (item) => item.id === action.obstacleId,
          );
          if (entity && obstacle) {
            const movement = movementFor(entity, obstacle, world, action);
            setOffsets((current) => ({
              ...current,
              [entity.id]: movement.offset,
            }));
            setPlacements((current) => ({
              ...current,
              [entity.id]: movement.placement,
            }));
          }
        }
        if (action.type === "weather_shift") setRain(action.weather === "rain");
        await wait(duration, controller.signal);
        if (!reducedMotion && action.type === "celebrate")
          await wait(280, controller.signal);
      }
      if (!controller.signal.aborted) setActive(null);
    }

    void play();
    return () => controller.abort();
  }, [reducedMotion, sequence?.sourceEventId]);

  return (
    <figure className="paper-theater" data-testid="paper-theater">
      <div
        className="paper-theater-stage"
        role="img"
        aria-label={`Living paper theater. The route is ${world.pathStatus}.`}
        data-action={active?.type ?? "resting"}
      >
        <img
          className="paper-theater-backdrop"
          src={scene.document.drawing.compositeImage}
          alt="Your confirmed drawing"
          onError={() => setImageFailed(true)}
        />
        {!imageFailed &&
          world.entities
            .filter((entity) => sceneIds.has(entity.id))
            .map((entity) => (
              <span
                className="paper-theater-matte"
                key={`matte-${entity.id}`}
                style={pieceStyle(entity.bounds)}
              />
            ))}
        {world.entities.map((entity) => {
          const hasCrop = sceneIds.has(entity.id) && !imageFailed;
          const isActive =
            active && "entityId" in active && active.entityId === entity.id;
          const activeClass = isActive
            ? active.type === "reveal" && pendingRevealId === entity.id
              ? ""
              : `is-${active.type}`
            : "";
          return (
            <span
              className={[
                "paper-piece",
                hasCrop ? "paper-piece-crop" : `paper-token ${entity.kind}`,
                pendingRevealId === entity.id ? "is-hidden" : "",
                activeClass,
              ]
                .filter(Boolean)
                .join(" ")}
              data-entity-id={entity.id}
              data-reveal-state={
                pendingRevealId === entity.id ? "hidden" : "visible"
              }
              data-placement={placements[entity.id] ?? "source"}
              data-logical-x={Math.round(
                entity.bounds.x + (offsets[entity.id]?.x ?? 0),
              )}
              key={entity.id}
              style={{
                ...pieceStyle(entity.bounds, offsets[entity.id]),
                ...(hasCrop
                  ? cropStyle(
                      scene.document.drawing.compositeImage,
                      entity.bounds,
                    )
                  : {}),
              }}
              title={entity.name}
            >
              {!hasCrop && (
                <span className="paper-token-label">{entity.name}</span>
              )}
            </span>
          );
        })}
        {rain && (
          <span className="paper-rain" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
        )}
        {!reducedMotion && active?.type === "celebrate" && (
          <span className="paper-confetti" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
        )}
        {imageFailed && (
          <p className="paper-theater-fallback">
            The drawing could not be loaded, but its paper pieces are still
            here.
          </p>
        )}
      </div>
      <figcaption className="paper-theater-caption" aria-live="polite">
        {caption}
      </figcaption>
    </figure>
  );
}
