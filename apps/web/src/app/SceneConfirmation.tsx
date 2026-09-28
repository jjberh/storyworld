import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  confirmedSceneSchema,
  defaultPropertiesFor,
  entityRoleSchema,
  type EntityRole,
  type SceneInterpretationResponse,
  type StoryDocument,
  type WorldClient,
} from "@storyworld/contracts";
import { FixtureWorldClient } from "@storyworld/world-fixtures";
import { LiveWorldClient } from "../services/world-client";
import {
  enterWorldRoom,
  holdWorldClient,
  peekWorldClient,
  type RoomMode,
} from "../services/world-session";
import {
  creationReducer,
  initialCreation,
  type CreationAttempt,
} from "./scene-creation";
import {
  nextQuestion,
  placeQuestion,
  reviewBlocker,
  sceneReviewReducer,
  startReview,
  type ReviewBlocker,
} from "./scene-review";
import {
  RoleIcon,
  roleLabels,
  roleShortLabels,
  type RoleChoice,
} from "./RoleIcon";

const choices: RoleChoice[] = [...entityRoleSchema.options, "remove"];

/** Why "Start my story" is waiting, for the hint under the button. */
const blockerHints: Record<ReviewBlocker, string> = {
  "no-character": "Tap your main character on the picture first.",
  unsure: "Answer the quick question on your picture first.",
  "many-characters": "Choose just one main character.",
  unnamed: "Give every picture part a name.",
};

/** What a box the child draws becomes. */
type Drawing = "missed" | "character" | "move";

export function SceneConfirmation({
  document,
  interpretation,
  stale,
  onLocked,
  onWorldReady,
}: {
  document: StoryDocument;
  interpretation: SceneInterpretationResponse;
  stale: boolean;
  onLocked: (locked: boolean) => void;
  onWorldReady: (id: string, roomMode: RoomMode) => void;
}) {
  // Objects the model was sure of are accepted from the start; only unsure
  // ones are asked about, on the picture.
  const [review, send] = useReducer(
    sceneReviewReducer,
    interpretation.candidates,
    startReview,
  );
  const { objects } = review;
  // The object the child tapped to change, if any.
  const [editing, setEditing] = useState<string>();
  const [drawing, setDrawing] = useState<Drawing>();
  const [fixtureConsent, setFixtureConsent] = useState(false);
  // A validation message shown while reviewing; creation failures live in the
  // creation state so they survive alongside the frozen attempt.
  const [error, setError] = useState("");
  const [creation, dispatch] = useReducer(creationReducer, initialCreation);
  const { status } = creation;
  const client = useRef<WorldClient | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const picture = useRef<HTMLDivElement>(null);
  const question = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  // Set when the child answers with the keyboard, so focus follows the next
  // question instead of falling back to the page.
  const refocus = useRef(false);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const locked = status !== "review";
  const shownError = creation.error || error;
  const blocker = reviewBlocker(review);
  const editingObject = objects.find(({ id }) => id === editing);
  const choosingCharacter =
    blocker === "no-character" && !editingObject && !drawing;
  const target =
    locked || stale || drawing || choosingCharacter
      ? undefined
      : (editingObject ?? nextQuestion(review));
  const asking = Boolean(target && !editingObject);

  useEffect(
    () => () => {
      const worldClient = client.current;
      if (!worldClient) return;
      const worldId = worldClient.getSnapshot().world?.id;
      if (!worldId || peekWorldClient(worldId) !== worldClient)
        worldClient.dispose();
    },
    [],
  );

  // Anchor the question card next to its object, inside the picture.
  const targetBounds = target?.imageBounds;
  useLayoutEffect(() => {
    const host = picture.current;
    const card = question.current;
    if (!host || !card || !targetBounds) {
      setPlace(undefined);
      return;
    }
    const measure = () =>
      setPlace(
        placeQuestion(
          { width: host.clientWidth, height: host.clientHeight },
          targetBounds,
          { width: card.offsetWidth, height: card.offsetHeight },
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(card);
    return () => observer.disconnect();
  }, [targetBounds]);

  // The card is hidden until it is placed, and hidden buttons cannot take
  // focus, so this waits for the placement.
  const targetId = target?.id;
  useEffect(() => {
    if (!refocus.current || (targetId && !place)) return;
    refocus.current = false;
    const card = question.current;
    const startReady = startButton.current && !startButton.current.disabled;
    // With no question left, focus goes to Start, or to the first box when
    // Start still waits for something on the picture.
    (
      card?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      (startReady
        ? startButton.current
        : picture.current?.querySelector<HTMLButtonElement>(".object-region"))
    )?.focus();
  }, [targetId, place]);

  function answer(id: string, choice: RoleChoice) {
    // Changing the object being edited keeps this card, so focus stays put.
    refocus.current =
      (choice === "remove" || editing !== id) &&
      Boolean(question.current?.contains(globalThis.document.activeElement));
    setError("");
    if (choice === "remove") {
      send({ type: "remove", id });
      if (editing === id) setEditing(undefined);
    } else send({ type: "answer", id, role: choice });
  }

  function point(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  }

  function addObject(
    kind: "missed" | "character",
    imageBounds: { x: number; y: number; width: number; height: number },
  ) {
    const role: EntityRole = kind === "character" ? "character" : "scenery";
    const id = "object-" + crypto.randomUUID();
    send({
      type: "add",
      object: {
        id,
        name: kind === "character" ? "My hero" : "Something new",
        role,
        description: "",
        properties: defaultPropertiesFor(role),
        confidence: 1,
        imageBounds,
      },
      // A missed object still needs the child to say what it is.
      unsure: kind === "missed",
    });
    setEditing(id);
  }

  // No relationship is inferred from a detected river: the child never
  // confirmed that the character fears it, so no `fearedObstacleId` is sent.
  function freezeAttempt(): CreationAttempt | undefined {
    if (blocker) {
      setError(blockerHints[blocker]);
      return undefined;
    }
    if (interpretation.mode === "fixture" && !fixtureConsent) {
      setError("Choose the practice reading before starting this test story.");
      return undefined;
    }
    const result = confirmedSceneSchema.safeParse({
      document,
      mode: interpretation.mode,
      objects,
      characterId:
        objects.find((object) => object.role === "character")?.id ?? "",
      // The detected goal if it is still a place to reach, else the first
      // object the child marked as one.
      goalId: (
        objects.find(
          (object) =>
            object.id === interpretation.goalCandidateId &&
            object.role === "goal",
        ) ?? objects.find((object) => object.role === "goal")
      )?.id,
      openingNarration: interpretation.openingNarration,
      moodHints: interpretation.moodHints,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Choose one main character.");
      return undefined;
    }
    return {
      id: "story-" + crypto.randomUUID().slice(0, 30),
      requestId: crypto.randomUUID(),
      scene: result.data,
    };
  }

  async function create() {
    if (stale || status === "creating" || status === "committed") return;
    setError("");
    // After a failure the frozen attempt is reused as is, so a retry after a
    // lost response cannot create a second world.
    const attempt = creation.attempt ?? freezeAttempt();
    if (!attempt) return;
    if (!client.current) {
      const mode =
        new URLSearchParams(location.search).get("mode") ??
        import.meta.env.VITE_WORLD_MODE ??
        "fixture";
      client.current =
        interpretation.mode === "fixture" || mode !== "live"
          ? new FixtureWorldClient(true)
          : new LiveWorldClient(attempt.id);
    }
    const worldClient = client.current;
    onLocked(true);
    dispatch({ type: "start", attempt });
    try {
      await worldClient.connect();
      await worldClient.initializeScene(
        attempt.id,
        attempt.requestId,
        attempt.scene,
      );
      if (worldClient.getSnapshot().world?.id !== attempt.id)
        throw new Error("Your story is taking a moment. Try again safely.");
      const roomMode: RoomMode =
        worldClient.getSnapshot().mode === "live" ? "live" : "fixture";
      // The room opens with the lift-off reveal, once (see world-session).
      holdWorldClient(attempt.id, worldClient, { reveal: true });
      enterWorldRoom(attempt.id, roomMode);
      dispatch({ type: "committed" });
      onWorldReady(attempt.id, roomMode);
    } catch (reason) {
      dispatch({
        type: "failed",
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  // Explicitly abandons the frozen attempt; a retry never goes through here.
  function reviewAgain() {
    client.current?.dispose();
    client.current = undefined;
    setError("");
    dispatch({ type: "review" });
    onLocked(false);
  }

  const drawingHints: Record<Drawing, string> = {
    missed: "Draw a box around the part we missed.",
    character: "Draw a box around your main character.",
    move: "Draw a new box around the picture part.",
  };
  const waiting =
    status === "review" && (blocker !== undefined || drawing !== undefined);

  return (
    <section
      className="picture-check"
      aria-label="Check your picture"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Escape cancels a box being drawn, or closes the change card and
        // returns to the object's box.
        if (drawing) {
          start.current = undefined;
          setDrawing(undefined);
          return;
        }
        if (!editingObject) return;
        setEditing(undefined);
        picture.current
          ?.querySelector<HTMLButtonElement>(
            `[data-object-id="${CSS.escape(editingObject.id)}"]`,
          )
          ?.focus();
      }}
    >
      <div className="paper picture-check-paper">
        <div
          ref={picture}
          className="confirmation-picture"
          aria-label="Your picture with detected objects"
          onPointerDown={(event) => {
            if (locked || stale) return;
            // While choosing a character, a press on empty paper starts a box
            // around them; presses on existing boxes stay taps.
            const onEmptyPaper = !(event.target as Element).closest(
              ".object-region, .picture-question",
            );
            const canAdd = objects.length < 20;
            if (!drawing && !(choosingCharacter && onEmptyPaper && canAdd))
              return;
            start.current = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            start.current = undefined;
          }}
          onPointerUp={(event) => {
            if (!start.current || locked || stale) return;
            const end = point(event);
            const begin = start.current;
            start.current = undefined;
            const imageBounds = {
              x: Math.min(begin.x, end.x),
              y: Math.min(begin.y, end.y),
              width: Math.abs(end.x - begin.x),
              height: Math.abs(end.y - begin.y),
            };
            const kind = drawing ?? "character";
            if (imageBounds.width < 0.005 || imageBounds.height < 0.005) {
              // A tap on empty paper asks the child to draw their character.
              if (!drawing) setDrawing("character");
              return;
            }
            setDrawing(undefined);
            if (kind !== "move") addObject(kind, imageBounds);
            else if (editingObject)
              send({ type: "reshape", id: editingObject.id, imageBounds });
          }}
        >
          <img
            src={document.drawing.compositeImage}
            alt="Your drawing"
            draggable={false}
          />
          {objects.map((object) => {
            const name = object.name || "new object";
            return (
              <button
                key={object.id}
                data-object-id={object.id}
                className={
                  "object-region" +
                  (review.unsure.includes(object.id) ? " is-unsure" : "") +
                  (object.role === "character" ? " is-character" : "")
                }
                aria-label={
                  choosingCharacter
                    ? `Make ${name} my main character`
                    : `Change ${name}`
                }
                aria-pressed={target?.id === object.id}
                disabled={locked || stale}
                onClick={() => {
                  setError("");
                  if (choosingCharacter) {
                    send({ type: "answer", id: object.id, role: "character" });
                    return;
                  }
                  setDrawing(undefined);
                  // Focus moves into the card only when it changes object.
                  refocus.current =
                    editing !== object.id && target?.id !== object.id;
                  setEditing(editing === object.id ? undefined : object.id);
                }}
                style={{
                  left: `${object.imageBounds.x * 100}%`,
                  top: `${object.imageBounds.y * 100}%`,
                  width: `${object.imageBounds.width * 100}%`,
                  height: `${object.imageBounds.height * 100}%`,
                }}
              >
                <RoleIcon role={object.role} />
                <span>{object.name || "?"}</span>
              </button>
            );
          })}
          {target && (
            <div
              ref={question}
              className="picture-question"
              role="group"
              aria-label={`What is ${target.name || "this"}?`}
              style={
                place
                  ? { left: place.left, top: place.top }
                  : { visibility: "hidden" }
              }
            >
              <p className="picture-question-title" aria-hidden="true">
                {target.name || "This"}?
              </p>
              <div className="picture-question-choices">
                {choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={"role-choice role-choice-" + choice}
                    aria-label={roleLabels[choice]}
                    aria-pressed={
                      choice === "remove" ? undefined : target.role === choice
                    }
                    onClick={() => answer(target.id, choice)}
                  >
                    <RoleIcon role={choice} />
                    <span aria-hidden="true">{roleShortLabels[choice]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {choosingCharacter && !locked && !stale && (
            <p className="draw-a-circle picture-prompt" aria-hidden="true">
              <RoleIcon role="character" /> Tap your main character
            </p>
          )}
          {drawing && (
            <p className="draw-a-circle">
              {drawing === "character"
                ? "Draw a box around your main character"
                : drawing === "missed"
                  ? "Draw a box around what we missed"
                  : "Draw a new box around it"}
            </p>
          )}
        </div>
      </div>

      <div className="picture-check-card">
        {stale ? (
          <p role="alert">
            Your picture changed. Bring it to life again, then check it here.
          </p>
        ) : status === "committed" ? (
          <p role="status">
            Your story is ready. Your drawing and words are safely attached.
          </p>
        ) : drawing ? (
          <>
            <p>{drawingHints[drawing]}</p>
            <button
              className="quiet-action"
              onClick={() => setDrawing(undefined)}
            >
              Never mind
            </button>
          </>
        ) : choosingCharacter ? (
          <>
            <h2 className="with-icon">
              <RoleIcon role="character" /> Tap your main character
            </h2>
            <p>
              Tap them on your picture. If we missed them, draw a box around
              them.
            </p>
          </>
        ) : editingObject ? (
          <>
            <h2>Change {editingObject.name || "this"}</h2>
            <p>Tap a picture on your drawing to say what it is.</p>
            <div className="change-object">
              <label>
                What should we call it?
                <input
                  aria-label="What should we call it?"
                  value={editingObject.name}
                  disabled={locked}
                  maxLength={80}
                  onChange={(event) =>
                    send({
                      type: "rename",
                      id: editingObject.id,
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <button
                className="quiet-action redraw-region"
                disabled={locked}
                onClick={() => setDrawing("move")}
              >
                Draw a new box around it
              </button>
            </div>
            <button
              className="secondary-action done-changing"
              disabled={locked}
              onClick={() => setEditing(undefined)}
            >
              Done
            </button>
          </>
        ) : asking && target ? (
          <>
            <p className="check-progress" role="status">
              {review.unsure.length === 1
                ? "One quick question"
                : `${review.unsure.length} quick questions`}
            </p>
            <h2>Is this {target.name || "something"}?</h2>
            <p>Tap a picture on your drawing to tell us what it is.</p>
            <button
              className="quiet-action"
              onClick={() => setEditing(target.id)}
            >
              Change its name
            </button>
          </>
        ) : blocker === "many-characters" ? (
          <>
            <h2>Pick just one main character</h2>
            <p>Tap the extra one on your picture to change it.</p>
          </>
        ) : blocker === "unnamed" ? (
          <>
            <h2>Give it a name</h2>
            <p>Tap the picture part without a name to name it.</p>
          </>
        ) : (
          <>
            <h2>Your picture is ready!</h2>
            <p>Tap anything on your picture to change it.</p>
          </>
        )}

        {status !== "committed" && !stale && (
          <button
            className="add-missed"
            disabled={locked || objects.length >= 20}
            onClick={() => {
              setDrawing("missed");
              setEditing(undefined);
            }}
          >
            I missed something
          </button>
        )}
        {interpretation.mode === "fixture" && status !== "committed" && (
          <label className="fixture-consent">
            <input
              type="checkbox"
              checked={fixtureConsent}
              disabled={locked}
              onChange={(event) => setFixtureConsent(event.target.checked)}
            />{" "}
            Use this practice reading
          </label>
        )}
        {shownError && (
          <p className="authoring-error" role="alert">
            {shownError}
          </p>
        )}
        {status !== "committed" && !stale && (
          <>
            <button
              ref={startButton}
              className="start-story"
              disabled={waiting || status === "creating"}
              aria-describedby={waiting ? "start-story-hint" : undefined}
              onClick={() => void create()}
            >
              {status === "creating"
                ? "Starting your story…"
                : status === "failed"
                  ? "Try starting my story again"
                  : "Start my story"}
            </button>
            {waiting && (
              <p id="start-story-hint" className="start-story-hint">
                {blocker ? blockerHints[blocker] : drawingHints[drawing!]}
              </p>
            )}
          </>
        )}
        {status === "failed" && (
          <button className="quiet-action review-again" onClick={reviewAgain}>
            Review my picture again
          </button>
        )}
      </div>
    </section>
  );
}
