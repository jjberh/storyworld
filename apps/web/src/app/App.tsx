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
import type { Bounds, WorldClient } from "@storyworld/contracts/model";
import { WorldStage } from "../features/world-renderer/WorldStage";
import { DrawingCanvas } from "../features/canvas/DrawingCanvas";
import { interpretEdit } from "../services/intelligence-client";
import { LiveWorldClient } from "../services/world-client";
import paintbrushIcon from "../assets/figma/paintbrush.svg";
import circleXIcon from "../assets/figma/circle-x.svg";
import cloudIcon from "../assets/figma/cloud.svg";
import cloudRainIcon from "../assets/figma/cloud-rain.svg";
import castleImage from "../assets/figma/castle.png";
import sunIcon from "../assets/figma/sun.svg";
import scribblesImage from "../assets/figma/scribbles.svg";
export function App() {
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
  } | null>(null);
  const [width, setWidth] = useState(800);
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
    pendingFeedback.current = null;
    setNote(
      confirmed.pathStatus === "available"
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
  async function onDrawing(bounds: Bounds) {
    await run(async () => {
      setNote("Reading your drawing…");
      const result = await interpretEdit({
        changedRegion: bounds,
        entityKind: kind,
        transcript,
      });
      const candidate = result.candidates[0];
      if (candidate) {
        if (contributor) {
          await client.propose(candidate.operation);
          setNote("Your proposal is ready for the director.");
        } else {
          pendingFeedback.current = {
            revision: world?.revision ?? -1,
            fallback: result.message,
          };
          try {
            await client.apply(candidate.operation);
          } catch (error) {
            pendingFeedback.current = null;
            throw error;
          }
        }
      } else {
        setNote(result.message);
      }
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
          <a href="/?mode=fixture">Use local fixture</a>
        </section>
      ) : (
        <section className="workspace">
          <div className="paper-column">
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
                  key={
                    world.id +
                    ":" +
                    snapshot.events.filter(
                      (e) =>
                        e.summary.includes("reset") ||
                        e.summary.includes("Restored"),
                    ).length
                  }
                  width={width}
                  disabled={busy}
                  onFinish={(b) => void onDrawing(b)}
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
              />
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
                        world.id,
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
              <div className="actions">
                <button
                  className="primary-action"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      contributor
                        ? client.propose(bridgeOperation())
                        : client.apply(bridgeOperation()),
                    )
                  }
                >
                  <img src={circleXIcon} alt="" />{" "}
                  {contributor ? "Propose" : "Add"} sample bridge
                </button>
                <button
                  className="secondary-action"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      contributor
                        ? client.propose(cloudOperation())
                        : client.apply(cloudOperation()),
                    )
                  }
                >
                  <img src={cloudRainIcon} alt="" />{" "}
                  {contributor ? "Propose" : "Add"} storm cloud
                </button>
                {snapshot.isDirector && !requestedGuest && (
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => void run(() => client.reset())}
                  >
                    Reset world
                  </button>
                )}
              </div>
              <motion.p
                key={note}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="note"
                aria-live="polite"
              >
                {note}
              </motion.p>
            </div>
            <div className="divider" />
            <div className="moments-card">
              <h2>Story Moments</h2>
              <button
                className="timeline-item"
                disabled={busy || !snapshot.isDirector || requestedGuest}
                onClick={() => void run(() => client.rewind(0))}
              >
                <i />{" "}
                <span>
                  <strong>The adventure begins</strong>
                  <small>Restore the opening world</small>
                </span>
              </button>
              {snapshot.events.slice(-6).map((e) => (
                <button
                  className="timeline-item"
                  key={e.id}
                  disabled={busy || !snapshot.isDirector || requestedGuest}
                  onClick={() => void run(() => client.rewind(e.revision))}
                >
                  <i />{" "}
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
      </footer>
    </main>
  );
}
