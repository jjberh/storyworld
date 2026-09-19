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
  const [goalId, setGoalId] = useState(interpretation.goalCandidateId ?? "");
  const [fearedRiverId, setFearedRiverId] = useState("");
  const [openingNarration, setNarration] = useState(
    interpretation.openingNarration,
  );
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
  useEffect(() => () => client.current?.dispose(), []);
  function update(id: string, patch: Partial<SceneCandidate>) {
    setObjects((current) =>
      current.map((o) => (o.id === id ? { ...o, ...patch } : o)),
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
  async function create() {
    if (stale || status === "creating" || status === "committed") return;
    setError("");
    if (!pending.current) {
      if (objects.some((o) => !accepted.includes(o.id))) {
        setError("Check each object before creating your world.");
        return;
      }
      if (interpretation.mode === "fixture" && !fixtureConsent) {
        setError(
          "Confirm that you want to use the sample detections for a local test.",
        );
        return;
      }
      const result = confirmedSceneSchema.safeParse({
        document,
        mode: interpretation.mode,
        objects,
        characterId: objects.find((o) => o.kind === "character")?.id ?? "",
        goalId: goalId || undefined,
        fearedRiverId: fearedRiverId || undefined,
        openingNarration,
        moodHints: interpretation.moodHints,
      });
      if (!result.success) {
        setError(result.error.issues[0]!.message);
        return;
      }
      pending.current = {
        id: "story-" + crypto.randomUUID().slice(0, 30),
        requestId: crypto.randomUUID(),
        scene: result.data,
      };
      // Fixture candidates can only create a labelled local test world.
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
        throw new Error(
          "The committed world has not arrived yet. Retry safely.",
        );
      setStatus("committed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("failed");
    }
  }
  return (
    <section className="confirmation workspace" aria-label="Confirm your scene">
      <div className="paper-column">
        <h2>Check what is in your picture</h2>
        {stale && (
          <p role="alert">
            Your picture or story words changed. Bring your world to life again
            before confirming.
          </p>
        )}
        {interpretation.mode === "fixture" && (
          <p role="alert">
            These are sample detections, not Gemini’s reading of your picture.
            They can only create a local test world.
          </p>
        )}
        <p>
          Select an object, then drag across the picture to change its region.
          Choose “Add a missed object” to mark a new one.
        </p>
        <div
          className="confirmation-picture"
          aria-label="Object regions"
          onPointerDown={(event) => {
            if (locked || stale) return;
            start.current = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            start.current = undefined;
          }}
          onPointerUp={(event) => {
            if (!start.current || locked || stale) return;
            const end = point(event),
              begin = start.current;
            start.current = undefined;
            const imageBounds = {
              x: Math.min(begin.x, end.x),
              y: Math.min(begin.y, end.y),
              width: Math.abs(end.x - begin.x),
              height: Math.abs(end.y - begin.y),
            };
            if (imageBounds.width < 0.005 || imageBounds.height < 0.005) return;
            if (adding) {
              const id = "object-" + crypto.randomUUID();
              setObjects((current) => [
                ...current,
                { id, name: "", kind: "shelter", confidence: 1, imageBounds },
              ]);
              setSelected(id);
              setAdding(false);
            } else update(selected, { imageBounds });
          }}
        >
          <img
            src={document.drawing.compositeImage}
            alt="Your submitted picture"
            draggable={false}
          />
          {objects.map((o, i) => (
            <span
              key={o.id}
              className="object-region"
              style={{
                left: `${o.imageBounds.x * 100}%`,
                top: `${o.imageBounds.y * 100}%`,
                width: `${o.imageBounds.width * 100}%`,
                height: `${o.imageBounds.height * 100}%`,
                borderColor: selected === o.id ? "#ff7a00" : "#6c30a3",
              }}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <button
          className="secondary-action"
          disabled={locked || stale || objects.length >= 20}
          onClick={() => setAdding(true)}
        >
          {adding ? "Drag a region on the picture" : "Add a missed object"}
        </button>
        <fieldset disabled={locked || stale}>
          <legend>Objects</legend>
          {objects.map((object, i) => (
            <div className="proposal" key={object.id}>
              <button
                aria-pressed={selected === object.id}
                onClick={() => {
                  setSelected(object.id);
                  setAdding(false);
                }}
              >
                Select object {i + 1}
              </button>
              {object.confidence < 0.8 && (
                <p>Please check this uncertain detection.</p>
              )}
              <label>
                Name{" "}
                <input
                  aria-label={`Object ${i + 1} name`}
                  value={object.name}
                  maxLength={80}
                  onChange={(e) => update(object.id, { name: e.target.value })}
                />
              </label>
              <label>
                Type{" "}
                <select
                  aria-label={`Object ${i + 1} type`}
                  value={object.kind}
                  onChange={(e) =>
                    update(object.id, {
                      kind: entitySchema.shape.kind.parse(e.target.value),
                    })
                  }
                >
                  {entitySchema.shape.kind.options.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <details>
                <summary>Adjust region with numbers (0 to 1)</summary>
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={object.imageBounds[key]}
                      onChange={(e) =>
                        update(object.id, {
                          imageBounds: {
                            ...object.imageBounds,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </details>
              <label>
                <input
                  type="checkbox"
                  checked={accepted.includes(object.id)}
                  onChange={(e) =>
                    setAccepted((current) =>
                      e.target.checked
                        ? [...current, object.id]
                        : current.filter((id) => id !== object.id),
                    )
                  }
                />{" "}
                This object is correct
              </label>
              <button
                onClick={() => {
                  setObjects((current) =>
                    current.filter((o) => o.id !== object.id),
                  );
                  if (goalId === object.id) setGoalId("");
                  if (fearedRiverId === object.id) setFearedRiverId("");
                }}
              >
                Remove object {i + 1}
              </button>
            </div>
          ))}
        </fieldset>
      </div>
      <aside>
        <div className="proposals-card">
          <h2>Set the beginning</h2>
          <fieldset disabled={locked || stale}>
            <p>
              Keep exactly one object with the character type as your main
              character.
            </p>
            <label>
              Destination (optional)
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
              >
                <option value="">No destination yet</option>
                {objects
                  .filter((o) => o.kind === "castle")
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Afraid of a river? (optional)
              <select
                value={fearedRiverId}
                onChange={(e) => setFearedRiverId(e.target.value)}
              >
                <option value="">No fear rule</option>
                {objects
                  .filter((o) => o.kind === "river")
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Story opening
              <textarea
                value={openingNarration}
                maxLength={600}
                onChange={(e) => setNarration(e.target.value)}
              />
            </label>
            {interpretation.mode === "fixture" && (
              <label>
                <input
                  type="checkbox"
                  checked={fixtureConsent}
                  onChange={(e) => setFixtureConsent(e.target.checked)}
                />{" "}
                Use sample detections for a local test
              </label>
            )}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          {status === "committed" ? (
            <p role="status">
              {client.current?.getSnapshot().mode === "fixture"
                ? "Local test world created"
                : "World created"}
              : {pending.current?.id}. Your confirmed picture and story are
              attached.
            </p>
          ) : (
            <button
              className="primary-action"
              disabled={stale || status === "creating"}
              onClick={() => void create()}
            >
              {status === "creating"
                ? "Creating your world…"
                : status === "failed"
                  ? "Retry world creation"
                  : "Create confirmed world"}
            </button>
          )}
        </div>
      </aside>
    </section>
  );
}
