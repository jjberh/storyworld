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
export function App() {
  const params = new URLSearchParams(location.search);
  const mode =
    params.get("mode") ?? import.meta.env.VITE_WORLD_MODE ?? "fixture";
  const room = params.get("world") ?? "nova";
  const guest = location.pathname.startsWith("/join");
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
        if (guest) await client.propose(candidate.operation);
        else await client.apply(candidate.operation);
      }
      const committed = client.getSnapshot().world;
      setNote(
        guest
          ? "Your proposal is ready for the director."
          : committed?.pathStatus === "available"
            ? "The bridge holds. Nova has a way through."
            : committed?.entities.some((entity) => entity.kind === "bridge")
              ? "Almost there — the bridge needs to reach both riverbanks."
              : result.message,
      );
    });
  }
  const world = snapshot.world;
  return (
    <main className="shell">
      <header>
        <a className="brand" href="/">
          ✳ Storyworld<span>A LITTLE DRAWING. A WHOLE WORLD.</span>
        </a>
        <div className="status">
          <i />
          {mode === "live" ? "Live database" : "Local fixture"}
          <span>Foundation preview</span>
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
            Help Nova reach the castle. Draw a bridge, change the sky,
            <br className="desktop" /> and watch your little world respond.
          </p>
        </div>
        <div className="room-card">
          <span>YOUR STORY ROOM</span>
          <strong>{world?.id ?? room}</strong>
          <small>
            {guest
              ? "Guest contribution view"
              : snapshot.isDirector
                ? "You are the director"
                : "Join or create a world"}
          </small>
          <button
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(
                  location.origin +
                    "/join?mode=" +
                    mode +
                    "&world=" +
                    (world?.id ?? room),
                );
                setNote(
                  mode === "fixture"
                    ? "Link copied. Use live mode for shared worlds."
                    : "Guest link copied.",
                );
              })
            }
          >
            Copy guest link ↗
          </button>
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
                guest ? client.joinWorld(room) : client.createWorld(room),
              )
            }
            disabled={busy || snapshot.status !== "ready"}
          >
            {guest ? "Join" : "Create"} {room}
          </button>
          <a href="/?mode=fixture">Use local fixture</a>
        </section>
      ) : (
        <section className="workspace">
          <div className="paper-column">
            <div className="canvas-tools">
              <div>
                <button
                  aria-pressed={kind === "bridge"}
                  onClick={() => setKind("bridge")}
                >
                  〰 Bridge
                </button>
                <button
                  aria-pressed={kind === "cloud"}
                  onClick={() => setKind("cloud")}
                >
                  ☁ Cloud
                </button>
              </div>
              <span>
                {world.pathStatus === "available"
                  ? "✦ Route opened"
                  : world.pathStatus === "blocked"
                    ? "River blocks the route"
                    : "No goal"}{" "}
                · r{world.revision}
              </span>
            </div>
            <div className="paper" ref={container}>
              <WorldStage world={world} latestEvent={snapshot.events.at(-1)} />
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
              <label htmlFor="narration">The story so far</label>
              <textarea
                id="narration"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={2}
              />
              <small>
                Text input is ready. Live microphone and character audio arrive
                in the intelligence implementation.
              </small>
            </div>
          </div>
          <aside>
            <p className="eyebrow">THE WORLD LISTENS</p>
            <h2>
              A small change.
              <br />A new adventure.
            </h2>
            <motion.p
              key={note}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="note"
              aria-live="polite"
            >
              {note}
            </motion.p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    guest
                      ? client.propose(bridgeOperation())
                      : client.apply(bridgeOperation()),
                  )
                }
              >
                {guest ? "Propose" : "Add"} sample bridge
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    guest
                      ? client.propose(cloudOperation())
                      : client.apply(cloudOperation()),
                  )
                }
              >
                {guest ? "Propose" : "Add"} storm cloud
              </button>
              {snapshot.isDirector && !guest && (
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => void run(() => client.reset())}
                >
                  Reset world
                </button>
              )}
            </div>
            <div className="divider" />
            <p className="eyebrow">STORY MOMENTS</p>
            <button
              className="timeline-item"
              disabled={busy || !snapshot.isDirector || guest}
              onClick={() => void run(() => client.rewind(0))}
            >
              00 · The adventure begins
            </button>
            {snapshot.events.slice(-6).map((e) => (
              <button
                className="timeline-item"
                key={e.id}
                disabled={busy || !snapshot.isDirector || guest}
                onClick={() => void run(() => client.rewind(e.revision))}
              >
                {String(e.revision).padStart(2, "0")} · {e.summary}
              </button>
            ))}
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
