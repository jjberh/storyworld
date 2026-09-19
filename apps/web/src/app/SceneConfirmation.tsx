import { useEffect, useRef, useState } from "react";
import {
  confirmedSceneSchema,
  entitySchema,
  type ConfirmedScene,
  type SceneCandidate,
  type SceneInterpretationResponse,
  type StoryDocument,
  type WorldClient,
} from "@storyworld/contracts";
import { FixtureWorldClient } from "@storyworld/world-fixtures";
import { LiveWorldClient } from "../services/world-client";

const kindLabels: Record<SceneCandidate["kind"], string> = {
  character: "Main character",
  castle: "A place to visit",
  river: "A river",
  bridge: "A bridge",
  cloud: "A cloud",
  shelter: "A cozy place",
};

export function SceneConfirmation({
  document,
  interpretation,
  stale,
  onLocked,
}: {
  document: StoryDocument;
  interpretation: SceneInterpretationResponse;
  stale: boolean;
  onLocked: (locked: boolean) => void;
}) {
  const [objects, setObjects] = useState(interpretation.candidates);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [selected, setSelected] = useState(interpretation.characterCandidateId);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [fixtureConsent, setFixtureConsent] = useState(false);
  const [status, setStatus] = useState<
    "review" | "creating" | "failed" | "committed"
  >("review");
  const [error, setError] = useState("");
  const client = useRef<WorldClient | undefined>(undefined);
  const pending = useRef<
    { id: string; requestId: string; scene: ConfirmedScene } | undefined
  >(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const locked = status !== "review";
  const selectedObject =
    objects.find((object) => object.id === selected) ?? objects[0];
  const allChecked =
    objects.length > 0 &&
    objects.every((object) => accepted.includes(object.id));

  useEffect(() => () => client.current?.dispose(), []);

  function update(id: string, patch: Partial<SceneCandidate>) {
    setObjects((current) =>
      current.map((object) =>
        object.id === id ? { ...object, ...patch } : object,
      ),
    );
    setAccepted((current) => current.filter((value) => value !== id));
  }

  function point(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  }

  function chooseNext(currentId: string) {
    const next = objects.find(
      (object) => object.id !== currentId && !accepted.includes(object.id),
    );
    if (next) setSelected(next.id);
  }

  function sayYes() {
    if (!selectedObject) return;
    setAccepted((current) =>
      current.includes(selectedObject.id)
        ? current
        : [...current, selectedObject.id],
    );
    setChanging(false);
    chooseNext(selectedObject.id);
  }

  function removeSelected() {
    if (!selectedObject) return;
    const remaining = objects.filter((object) => object.id !== selectedObject.id);
    setObjects(remaining);
    setAccepted((current) => current.filter((id) => id !== selectedObject.id));
    setSelected(remaining[0]?.id ?? "");
    setChanging(false);
  }

  async function create() {
    if (stale || status === "creating" || status === "committed") return;
    setError("");
    if (!pending.current) {
      if (!allChecked) {
        setError("Give every picture part a quick check first.");
        return;
      }
      if (interpretation.mode === "fixture" && !fixtureConsent) {
        setError("Choose the practice reading before starting this test story.");
        return;
      }
      const result = confirmedSceneSchema.safeParse({
        document,
        mode: interpretation.mode,
        objects,
        characterId:
          objects.find((object) => object.kind === "character")?.id ?? "",
        goalId: objects.some(
          (object) => object.id === interpretation.goalCandidateId,
        )
          ? interpretation.goalCandidateId
          : undefined,
        fearedRiverId: objects.find((object) => object.kind === "river")?.id,
        openingNarration: interpretation.openingNarration,
        moodHints: interpretation.moodHints,
      });
      if (!result.success) {
        setError(
          result.error.issues[0]?.message ?? "Choose one main character.",
        );
        return;
      }
      pending.current = {
        id: "story-" + crypto.randomUUID().slice(0, 30),
        requestId: crypto.randomUUID(),
        scene: result.data,
      };
      const mode =
        new URLSearchParams(location.search).get("mode") ??
        import.meta.env.VITE_WORLD_MODE ??
        "fixture";
      client.current =
        interpretation.mode === "fixture" || mode !== "live"
          ? new FixtureWorldClient(true)
          : new LiveWorldClient(pending.current.id);
    }
    onLocked(true);
    setStatus("creating");
    try {
      await client.current!.connect();
      await client.current!.initializeScene(
        pending.current.id,
        pending.current.requestId,
        pending.current.scene,
      );
      if (client.current!.getSnapshot().world?.id !== pending.current.id)
        throw new Error("Your story is taking a moment. Try again safely.");
      setStatus("committed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("failed");
    }
  }

  return (
    <section className="picture-check" aria-label="Check your picture">
      <div className="paper picture-check-paper">
        <div
          className="confirmation-picture"
          aria-label="Your picture with detected objects"
          onPointerDown={(event) => {
            if (locked || stale || (!adding && !moving)) return;
            start.current = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            start.current = undefined;
          }}
          onPointerUp={(event) => {
            if (!start.current || locked || stale || (!adding && !moving)) return;
            const end = point(event);
            const begin = start.current;
            start.current = undefined;
            const imageBounds = {
              x: Math.min(begin.x, end.x),
              y: Math.min(begin.y, end.y),
              width: Math.abs(end.x - begin.x),
              height: Math.abs(end.y - begin.y),
            };
            if (imageBounds.width < 0.005 || imageBounds.height < 0.005)
              return;
            if (adding) {
              const id = "object-" + crypto.randomUUID();
              setObjects((current) => [
                ...current,
                { id, name: "", kind: "shelter", confidence: 1, imageBounds },
              ]);
              setSelected(id);
              setAdding(false);
              setChanging(true);
            } else if (selectedObject) {
              update(selectedObject.id, { imageBounds });
              setMoving(false);
            }
          }}
        >
          <img
            src={document.drawing.compositeImage}
            alt="Your drawing"
            draggable={false}
          />
          {objects.map((object) => (
            <button
              key={object.id}
              className="object-region"
              aria-label={`Check ${object.name || "new object"}`}
              aria-pressed={selected === object.id}
              disabled={locked || stale}
              onClick={() => {
                setSelected(object.id);
                setAdding(false);
                setMoving(false);
                setChanging(false);
              }}
              style={{
                left: `${object.imageBounds.x * 100}%`,
                top: `${object.imageBounds.y * 100}%`,
                width: `${object.imageBounds.width * 100}%`,
                height: `${object.imageBounds.height * 100}%`,
              }}
            >
              {object.name || "?"}
            </button>
          ))}
          {(adding || moving) && (
            <p className="draw-a-circle">
              {adding
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
        ) : adding || moving ? (
          <p>
            {adding
              ? "Draw a box around the part we missed."
              : "Draw a new box around the picture part."}
          </p>
        ) : selectedObject ? (
          <>
            <p className="check-progress">
              Picture part {objects.findIndex((object) => object.id === selectedObject.id) + 1} of {objects.length}
            </p>
            <h2>
              {accepted.includes(selectedObject.id)
                ? "Nice catch!"
                : `Is this ${selectedObject.name || "something"}?`}
            </h2>
            {changing && (
              <div className="change-object">
                <label>
                  What should we call it?
                  <input
                    aria-label="What should we call it?"
                    value={selectedObject.name}
                    maxLength={80}
                    autoFocus
                    onChange={(event) =>
                      update(selectedObject.id, { name: event.target.value })
                    }
                  />
                </label>
                <button
                  className="quiet-action redraw-region"
                  disabled={locked}
                  onClick={() => {
                    setMoving(true);
                    setAdding(false);
                  }}
                >
                  Draw a new box around it
                </button>
                <label>
                  What kind of thing is it?
                  <select
                    aria-label="What kind of thing is it?"
                    value={selectedObject.kind}
                    onChange={(event) =>
                      update(selectedObject.id, {
                        kind: entitySchema.shape.kind.parse(event.target.value),
                      })
                    }
                  >
                    {entitySchema.shape.kind.options.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabels[kind]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="picture-check-actions">
              <button
                className="primary-action"
                disabled={locked}
                onClick={sayYes}
              >
                Yes, that&apos;s right!
              </button>
              <button
                className="secondary-action"
                disabled={locked}
                onClick={() => setChanging(true)}
              >
                Change it
              </button>
              <button
                className="quiet-action"
                disabled={locked}
                onClick={removeSelected}
              >
                That is not in my picture
              </button>
            </div>
          </>
        ) : (
          <p>Add your main character by drawing a box around them.</p>
        )}

        {status !== "committed" && (
          <button
            className="add-missed"
            disabled={locked || stale || objects.length >= 20}
              onClick={() => {
                setAdding(true);
                setMoving(false);
                setChanging(false);
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
        {error && (
          <p className="authoring-error" role="alert">
            {error}
          </p>
        )}
        {status !== "committed" && allChecked && !adding && !moving && (
          <button
            className="start-story"
            disabled={stale || status === "creating"}
            onClick={() => void create()}
          >
            {status === "creating"
              ? "Starting your story…"
              : status === "failed"
                ? "Try starting my story again"
                : "Start my story"}
          </button>
        )}
      </div>
    </section>
  );
}
