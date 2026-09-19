import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { motion } from "framer-motion";
import {
  FixtureWorldClient,
  bridgeOperation,
  cloudOperation,
} from "@storyworld/world-fixtures";
import type {
  Bounds,
  ClientSnapshot,
  WorldClient,
} from "@storyworld/contracts/model";
import type {
  InterpretationInput,
  InterpretationOutput,
} from "@storyworld/contracts";
import { readDrawing } from "../features/canvas/drawing-image";
import { WorldStage } from "../features/world-renderer/WorldStage";
import { DrawingCanvas } from "../features/canvas/DrawingCanvas";
import { interpretEdit } from "../services/intelligence-client";
import { LiveWorldClient } from "../services/world-client";
import paintbrushIcon from "../assets/figma/paintbrush.svg";
import circleXIcon from "../assets/figma/circle-x.svg";
import cloudIcon from "../assets/figma/cloud.svg";
import castleImage from "../assets/figma/castle.png";
import sunIcon from "../assets/figma/sun.svg";
import scribblesImage from "../assets/figma/scribbles.svg";
import { InitialAuthoring } from "./InitialAuthoring";

function drawingVersion(snapshot: ClientSnapshot) {
  return (
    (snapshot.world?.id ?? "") +
    ":" +
    snapshot.events.filter(
      (event) =>
        event.summary.includes("reset") || event.summary.includes("Restored"),
    ).length
  );
}

export function FixtureExperience() {
  const params = new URLSearchParams(location.search);
  const mode =
    params.get("mode") ?? import.meta.env.VITE_WORLD_MODE ?? "fixture";
  const room = params.get("world") ?? "nova";
  const requestedGuest = location.pathname.startsWith("/join");
  const client = useMemo<WorldClient>(
    () =>
      mode === "live" ? new LiveWorldClient(room) : new FixtureWorldClient(),
    [mode, room],
  );
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string>();
  const [phase, setPhase] = useState<
    "ready" | "reading" | "preview" | "confirming" | "retry"
  >("ready");
  const [preview, setPreview] = useState<InterpretationOutput>();
  const [lastDrawing, setLastDrawing] = useState<InterpretationInput>();
  const interpreting = useRef(false);
  const drawingBusy =
    busy ||
    phase === "reading" ||
    phase === "preview" ||
    phase === "confirming";
  const [kind, setKind] = useState<"bridge" | "cloud">("bridge");
  const [note, setNote] = useState(
    "Draw across both riverbanks to give Nova a way through.",
  );
  const [transcript, setTranscript] = useState(
    "Nova wants to reach the castle, but she is afraid of water.",
  );
  const container = useRef<HTMLDivElement>(null);
  const pendingFeedback = useRef<{
    revision: number;
    fallback: string;
    entityId?: string;
    bridge: boolean;
  } | null>(null);
  const [width, setWidth] = useState(800);
  const version = drawingVersion(snapshot);
  const previousVersion = useRef(version);
  useEffect(() => {
    if (previousVersion.current === version) return;
    previousVersion.current = version;
    // World restores also invalidate in-flight interpretations and retry images.
    interpreting.current = false;
    pendingFeedback.current = null;
    setReference(undefined);
    setLastDrawing(undefined);
    setPreview(undefined);
    setPhase("ready");
    setNote("Draw across both riverbanks to give Nova a way through.");
  }, [version]);
  useEffect(() => {
    void client.connect().catch((e) => setError(String(e)));
    return () => client.dispose();
  }, [client]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry!.contentRect.width),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [snapshot.world]);
  useEffect(() => {
    const pending = pendingFeedback.current;
    const confirmed = snapshot.world;
    if (!pending || !confirmed || confirmed.revision <= pending.revision)
      return;
    if (
      pending.entityId &&
      !confirmed.entities.some((entity) => entity.id === pending.entityId)
    )
      return;
    pendingFeedback.current = null;
    setPhase("ready");
    setNote(
      !pending.bridge
        ? pending.fallback
        : confirmed.pathStatus === "available"
          ? "The bridge holds. Nova has a way through."
          : confirmed.entities.some((entity) => entity.kind === "bridge")
            ? "Almost there — the bridge needs to reach both riverbanks."
            : pending.fallback,
    );
  }, [snapshot.world]);
  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function commitCandidate(result: InterpretationOutput, index: number) {
    const candidate = result.candidates[index];
    if (!candidate) return;
    setPhase("confirming");
    setPreview(undefined);
    setNote(
      contributor
        ? "Sending your idea to the director…"
        : "Waiting for your world…",
    );
    await run(async () => {
      try {
        if (contributor) {
          await client.propose(candidate.operation);
          setPhase("ready");
          setNote("Your proposal is ready for the director.");
        } else {
          pendingFeedback.current = {
            revision: client.getSnapshot().world?.revision ?? -1,
            fallback: result.message,
            entityId:
              candidate.operation.type === "CREATE_ENTITY"
                ? candidate.operation.entity.id
                : undefined,
            bridge:
              candidate.operation.type === "CREATE_ENTITY" &&
              candidate.operation.entity.kind === "bridge",
          };
          await client.apply(candidate.operation);
        }
      } catch (error) {
        pendingFeedback.current = null;
        setPhase("ready");
        setNote(
          "Your drawing is still here. Check your connection before trying another change.",
        );
        throw error;
      }
    });
  }
  async function interpretDrawing(input: InterpretationInput) {
    if (interpreting.current) return;
    const requestVersion = drawingVersion(client.getSnapshot());
    interpreting.current = true;
    setLastDrawing(input);
    setError("");
    setPreview(undefined);
    setPhase("reading");
    try {
      setNote("Reading your drawing…");
      const result = await interpretEdit(input);
      if (requestVersion !== drawingVersion(client.getSnapshot())) return;
      const candidate = result.candidates[0];
      if (!candidate) {
        setPhase("retry");
        setNote("Tell us a little more about your drawing, then try again.");
      } else if (result.candidates.length > 1 || candidate.confidence < 0.8) {
        setPreview(result);
        setPhase("preview");
        setNote("What would you like your drawing to become?");
      } else {
        await commitCandidate(result, 0);
      }
    } catch {
      if (requestVersion !== drawingVersion(client.getSnapshot())) return;
      setPhase("retry");
      setNote(
        "We couldn't read your drawing this time. It is safe here. Try again when you're ready.",
      );
    } finally {
      if (requestVersion === drawingVersion(client.getSnapshot()))
        interpreting.current = false;
    }
  }
  async function onDrawing(bounds: Bounds, image: string) {
    await interpretDrawing({
      changedRegion: bounds,
      image,
      entityKind: kind,
      transcript,
    });
  }
  const world = snapshot.world;
  // The route chooses the initial flow; confirmed room ownership determines
  // whether this browser can make a direct change after the room loads.
  const contributor = requestedGuest || (!!world && !snapshot.isDirector);
  return (
    <main className="shell">
      <header>
        <a className="brand" href="/">
          <span className="brand-mark">
            <img src={paintbrushIcon} alt="" />
          </span>
          <span className="brand-name">Storyworld</span>
          <span>A little drawing. A whole world.</span>
        </a>
        <div className="status">
          <span className="live-badge">
            {mode === "live" ? "LIVE WORLD" : "FIXTURE MODE"}
          </span>
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">CHAPTER 01 / A WAY ACROSS</p>
          <h1>
            Every line opens
            <br />
            <em>a possibility.</em>
          </h1>
          <p>
            Help Nova reach the castle. Draw a bridge, change the sky, and watch
            your little world respond.
          </p>
        </div>
      </section>
      {(error || snapshot.error) && (
        <div role="alert" className="error">
          {error || snapshot.error}
        </div>
      )}
      {!world ? (
        <section className="empty">
          <h2>
            {snapshot.status === "connecting"
              ? "Connecting to your world…"
              : "Open a world"}
          </h2>
          <p>
            Live mode requires the matching foundation module. Fixture mode
            works immediately.
          </p>
          <button
            onClick={() =>
              void run(() =>
                requestedGuest
                  ? client.joinWorld(room)
                  : client.createWorld(room),
              )
            }
            disabled={busy || snapshot.status !== "ready"}
          >
            {requestedGuest ? "Join" : "Create"} {room}
          </button>
          <a href="/?mode=fixture&fixture=nova">Use local fixture</a>
        </section>
      ) : (
        <section className="workspace">
          <div className="paper-column">
            <div className="drawing-intro">
              <h2>Tell Nova what happens next.</h2>
              <p>
                Draw on the page, or upload a drawing and trace the part you
                want to bring to life. Add your words below.
              </p>
              <label className="upload-drawing">
                Upload a drawing
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={drawingBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void run(async () => {
                      setReference(await readDrawing(file));
                      setPreview(undefined);
                      setLastDrawing(undefined);
                      setPhase("ready");
                      setNote(
                        "Your drawing is on the page. Trace the part you want to bring to life.",
                      );
                    });
                  }}
                />
              </label>
              {reference && (
                <button
                  className="quiet"
                  disabled={drawingBusy}
                  onClick={() => setReference(undefined)}
                >
                  Hide uploaded drawing
                </button>
              )}
            </div>
            <div className="canvas-tools">
              <div>
                <button
                  className="tool-chip"
                  aria-pressed={kind === "bridge"}
                  onClick={() => setKind("bridge")}
                >
                  <img src={circleXIcon} alt="" /> Bridge
                </button>
                <button
                  className="tool-chip"
                  aria-pressed={kind === "cloud"}
                  onClick={() => setKind("cloud")}
                >
                  <img src={cloudIcon} alt="" /> Cloud
                </button>
              </div>
              <span className="world-status">
                {world.pathStatus === "available"
                  ? "Route opened"
                  : world.pathStatus === "blocked"
                    ? "River blocks the route"
                    : "No route yet"}
              </span>
            </div>
            <div className="paper" ref={container}>
              <WorldStage world={world} latestEvent={snapshot.events.at(-1)} />
              <div className="canvas-art" aria-hidden="true">
                <img className="scribble-art" src={scribblesImage} alt="" />
                <img className="sun-art" src={sunIcon} alt="" />
                <img className="castle-art" src={castleImage} alt="" />
              </div>
              <div className="drawing-layer">
                <DrawingCanvas
                  key={version}
                  width={width}
                  disabled={drawingBusy}
                  reference={reference}
                  onFinish={(b, image) => void onDrawing(b, image)}
                />
              </div>
              <span className="paper-caption">YOUR IMAGINATION GOES HERE</span>
            </div>
            <div className="narration">
              <label htmlFor="narration">The Story So Far</label>
              <textarea
                id="narration"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={2}
                maxLength={2000}
              />
              <small>
                Tell us what you drew. You can always follow Nova’s story in
                words, without sound.
              </small>
            </div>
          </div>
          <aside>
            <div className="room-card">
              <h2>Your Story Room</h2>
              <strong>Code: {world.id}</strong>
              <button
                className="primary-action"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(
                      location.origin +
                        "/join?mode=" +
                        mode +
                        "&world=" +
                        world.id +
                        "&fixture=nova",
                    );
                    setNote(
                      mode === "fixture"
                        ? "Link copied. Use live mode for shared worlds."
                        : "Guest link copied.",
                    );
                  })
                }
              >
                Copy guest link
              </button>
            </div>
            <div className="proposals-card">
              <h2>The World Listens</h2>
              <p className="card-help">
                Click to propose live doodles to the director
              </p>
              <motion.p
                key={note}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="note"
                aria-live="polite"
              >
                {note}
              </motion.p>
              {phase === "reading" && (
                <p className="drawing-status" role="status">
                  Looking at your lines and words…
                </p>
              )}
              {phase === "confirming" && (
                <p className="drawing-status" role="status">
                  Your idea is on its way…
                </p>
              )}
              {preview && (
                <div
                  className="interpretation-preview"
                  role="group"
                  aria-label="Choose what your drawing becomes"
                >
                  {preview.candidates.map((candidate, index) => (
                    <button
                      key={index}
                      disabled={busy}
                      onClick={() => void commitCandidate(preview, index)}
                    >
                      {candidate.operation.type === "CREATE_ENTITY"
                        ? `Make it a ${candidate.operation.entity.name}`
                        : "Use this idea"}
                    </button>
                  ))}
                  <button
                    className="quiet"
                    onClick={() => {
                      setPreview(undefined);
                      setPhase("retry");
                      setNote(
                        "Keep drawing, or change your words and try again.",
                      );
                    }}
                  >
                    Keep drawing
                  </button>
                </div>
              )}
              {phase === "retry" && lastDrawing && (
                <button
                  className="retry-drawing"
                  onClick={() =>
                    void interpretDrawing({ ...lastDrawing, transcript })
                  }
                >
                  Try my drawing again
                </button>
              )}
              <div className="actions">
                <button
                  className="primary-action"
                  disabled={drawingBusy}
                  onClick={() =>
                    void run(() =>
                      contributor
                        ? client.propose(bridgeOperation())
                        : client.apply(bridgeOperation()),
                    )
                  }
                >
                  {contributor ? "Propose" : "Add"} sample bridge
                </button>
                <button
                  className="secondary-action"
                  disabled={drawingBusy}
                  onClick={() =>
                    void run(() =>
                      contributor
                        ? client.propose(cloudOperation())
                        : client.apply(cloudOperation()),
                    )
                  }
                >
                  {contributor ? "Propose" : "Add"} storm cloud
                </button>
                {snapshot.isDirector && !requestedGuest && (
                  <button
                    className="quiet"
                    disabled={drawingBusy}
                    onClick={() =>
                      void run(async () => {
                        await client.reset();
                        setReference(undefined);
                        setLastDrawing(undefined);
                        setPhase("ready");
                        setNote(
                          "Draw across both riverbanks to give Nova a way through.",
                        );
                      })
                    }
                  >
                    Reset world
                  </button>
                )}
              </div>
            </div>
            <div className="divider" />
            <div className="moments-card">
              <h2>Story Moments</h2>
              <button
                className="timeline-item"
                disabled={drawingBusy || !snapshot.isDirector || requestedGuest}
                onClick={() => void run(() => client.rewind(0))}
              >
                <i />
                <span>
                  <strong>The adventure begins</strong>
                  <small>Restore the opening world</small>
                </span>
              </button>
              {snapshot.events.slice(-6).map((e) => (
                <button
                  className="timeline-item"
                  key={e.id}
                  disabled={
                    drawingBusy || !snapshot.isDirector || requestedGuest
                  }
                  onClick={() => void run(() => client.rewind(e.revision))}
                >
                  <i />
                  <span>
                    <strong>
                      {String(e.revision).padStart(2, "0")} · {e.summary}
                    </strong>
                  </span>
                </button>
              ))}
            </div>
            {snapshot.proposals
              .filter((p) => p.status === "pending")
              .map((p) => (
                <div className="proposal" key={p.id}>
                  <strong>New guest contribution</strong>
                  <p>
                    {p.operation.type === "CREATE_ENTITY"
                      ? p.operation.entity.name
                      : p.operation.type}
                  </p>
                  {snapshot.isDirector && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() => client.resolveProposal(p.id, true))
                        }
                      >
                        Accept
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() => client.resolveProposal(p.id, false))
                        }
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              ))}
          </aside>
        </section>
      )}
      <footer>
        <span>Built for small imaginations with big ideas.</span>
        <span>
          {mode === "fixture"
            ? "Fixture interpretation · no AI calls · not synchronized"
            : "SpacetimeDB synchronized · fixture interpretation"}
        </span>
      </footer>
    </main>
  );
}

/** Nova is retained only for fixture demos and legacy browser coverage. */
export function App() {
  const params = new URLSearchParams(location.search);
  return params.get("fixture") === "nova" ? (
    <FixtureExperience />
  ) : (
    <InitialAuthoring />
  );
}
