import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ClientSnapshot,
  RoomParticipant,
  WorldClient,
} from "@storyworld/contracts/model";
import { LiveWorldClient } from "../services/world-client";
import {
  markRoomRevealed,
  peekWorldClient,
  roomOwesReveal,
  type RoomMode,
} from "../services/world-session";
import paintbrushIcon from "../assets/figma/paintbrush.svg";
import type { StorySequence } from "@storyworld/contracts/story-beat";
import { StoryStage } from "../features/world-renderer/StoryStage";
import { KeepsakeButton } from "../features/keepsake/KeepsakeButton";
import { DrawingCanvas } from "../features/canvas/DrawingCanvas";
import { useDirectedStorySequence } from "./use-directed-story-sequence";
import { useStoryDrawing } from "./use-story-drawing";
import { routeLabel } from "./route-label";

const emptySnapshot: ClientSnapshot = {
  status: "ready",
  mode: "fixture",
  world: null,
  events: [],
  proposals: [],
  participants: [],
  isDirector: false,
};

function presenceLabel(participant: RoomParticipant) {
  if (participant.isYou) return "You · " + participant.role;
  return participant.role === "director" ? "Director" : "Guest";
}

function presenceCount(count: number) {
  return count === 1 ? "1 person" : count + " people";
}

function ignoreSubscribe() {
  return () => undefined;
}

function roomMode(): RoomMode {
  const mode =
    new URLSearchParams(location.search).get("mode") ??
    import.meta.env.VITE_WORLD_MODE ??
    "fixture";
  return mode === "live" ? "live" : "fixture";
}

function openRoomClient(worldId: string): {
  client?: WorldClient;
  owns: boolean;
  missingFixture: boolean;
} {
  const held = peekWorldClient(worldId);
  if (held) return { client: held, owns: false, missingFixture: false };
  if (roomMode() === "live")
    return {
      client: new LiveWorldClient(worldId),
      owns: true,
      missingFixture: false,
    };
  return { missingFixture: true, owns: false };
}

export function StoryRoom({ worldId }: { worldId: string }) {
  const requestedGuest = location.pathname.startsWith("/join");
  const mode = roomMode();
  const [session] = useState(() => openRoomClient(worldId));
  // The lift-off reveal, owed only right after "Start my story". Cleared the
  // moment a stage starts it, so a stage mounted later (for example after
  // the world briefly went away) shows the pieces standing instead.
  const [reveal, setReveal] = useState(() => roomOwesReveal(worldId));
  const client = session.client;
  const snapshot = useSyncExternalStore(
    client?.subscribe ?? ignoreSubscribe,
    client?.getSnapshot ?? (() => emptySnapshot),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(
    requestedGuest
      ? "Draw something new on the story to suggest it to the director."
      : "Draw something new on the story and see what happens.",
  );
  const [drawMode, setDrawMode] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  const [paperWidth, setPaperWidth] = useState(1000);

  useEffect(() => {
    if (!client) return;
    void client
      .connect()
      .then(() => (mode === "live" ? client.joinWorld(worldId) : undefined))
      .catch((reason) => setError(String(reason)));
    return () => {
      if (session.owns) client.dispose();
    };
  }, [client, mode, session.owns, worldId]);

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const scene = snapshot.scene;
  const latestEvent = snapshot.events.at(-1);
  const previousEvent = snapshot.events.at(-2);
  const world = latestEvent?.state ?? snapshot.world;
  const contributor = requestedGuest || (!!world && !snapshot.isDirector);
  const directedStory = useDirectedStorySequence(
    latestEvent,
    previousEvent,
    scene,
  );
  const drawing = useStoryDrawing({ client, scene, contributor });
  const lastStrokes = useRef<number[][]>([]);
  const hasWorld = !!world;
  useEffect(() => {
    const element = paper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setPaperWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasWorld]);

  // Every sequence this room has played, by committed event ID, so the
  // keepsake movie can replay them. Presentation history only: the world
  // itself stays in SpacetimeDB.
  const [playedSequences, setPlayedSequences] = useState<
    ReadonlyMap<string, StorySequence>
  >(() => new Map());
  const playedSequence = directedStory.sequence;
  useEffect(() => {
    if (!playedSequence) return;
    setPlayedSequences((current) =>
      current.get(playedSequence.sourceEventId) === playedSequence
        ? current
        : new Map(current).set(playedSequence.sourceEventId, playedSequence),
    );
  }, [playedSequence]);

  if (session.missingFixture)
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
        </header>
        <section className="empty">
          <h2>This local story is only on its first page</h2>
          <p>
            Fixture rooms stay in memory for one page session. Start the drawing
            again, or open a live room to share it.
          </p>
          <a href="/">Start a new drawing</a>
        </section>
      </main>
    );

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
          <p className="eyebrow">YOUR STORY ROOM</p>
          <h1>
            The picture is in
            <br />
            <em>the shared world.</em>
          </h1>
          <p>
            {scene?.openingNarration ??
              "A confirmed drawing becomes a room other people can join."}
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
              : "This room is not open yet"}
          </h2>
          <p>
            Live rooms appear after the director starts the story. Fixture rooms
            cannot be reopened after a reload.
          </p>
        </section>
      ) : (
        <section className="workspace">
          <div className="paper-column">
            <div className="drawing-intro">
              <h2>The story so far</h2>
              <p>
                The confirmed drawing is now a living paper stage. Its pieces
                move only when the shared world commits a new story moment.
              </p>
            </div>
            <div className="canvas-tools">
              <button
                className="tool-chip"
                aria-pressed={drawMode}
                onClick={() => {
                  if (drawMode) drawing.finish();
                  setDrawMode(!drawMode);
                }}
              >
                <img src={paintbrushIcon} alt="" />
                {drawMode ? "Done drawing" : "Draw something new"}
              </button>
              <span className="world-status">
                {routeLabel(world.pathStatus)}
              </span>
            </div>
            <div className="paper room-paper" ref={paper}>
              {scene ? (
                <StoryStage
                  scene={scene}
                  world={world}
                  sequence={directedStory.sequence}
                  keepCommittedRevealsVisible
                  reveal={reveal}
                  onRevealStarted={() => {
                    markRoomRevealed(worldId);
                    setReveal(false);
                  }}
                />
              ) : (
                <div
                  className="room-picture-fallback"
                  role="img"
                  aria-label="The confirmed picture is unavailable."
                >
                  The confirmed picture will appear here.
                </div>
              )}
              <div className="pending-cutouts" aria-hidden="true">
                {drawing.pending.map((cutout) => (
                  <img
                    key={cutout.id}
                    className="pending-cutout"
                    data-testid="pending-cutout"
                    data-state={cutout.state}
                    src={cutout.image}
                    alt=""
                    style={{
                      left: cutout.bounds.x / 10 + "%",
                      top: cutout.bounds.y / 6 + "%",
                      width: cutout.bounds.width / 10 + "%",
                      height: cutout.bounds.height / 6 + "%",
                    }}
                  />
                ))}
              </div>
              {drawMode && (
                <div
                  className="drawing-layer room-drawing-layer"
                  data-testid="story-drawing-layer"
                >
                  <DrawingCanvas
                    key={drawing.canvasKey}
                    width={paperWidth}
                    disabled={false}
                    onChange={(strokes) => {
                      lastStrokes.current = strokes.strokes;
                    }}
                    onStart={drawing.startStroke}
                    onCancel={drawing.cancelStroke}
                    onFinish={() => drawing.addStrokes(lastStrokes.current)}
                  />
                </div>
              )}
            </div>
            {drawing.note && (
              <p className="drawing-note" role="status">
                {drawing.note}
                {drawing.unresolved && !contributor && (
                  <button
                    className="drawing-note-retry"
                    onClick={() => void drawing.retryInteraction()}
                  >
                    Try again
                  </button>
                )}
              </p>
            )}
            {drawing.pending
              .filter((cutout) => cutout.state === "failed")
              .map((cutout) => (
                <button
                  key={cutout.id}
                  className="retry-drawing"
                  onClick={() => drawing.retry(cutout.id)}
                >
                  Try my drawing again
                </button>
              ))}
            {directedStory.status && (
              <p className="director-status" role="status">
                {directedStory.status}
              </p>
            )}
          </div>
          <aside>
            <div className="room-card">
              <h2>Your Story Room</h2>
              <strong>Code: {world.id}</strong>
              <p>Revision {world.revision}</p>
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
                        ? "Link copied. Fixture rooms stay on this page; use live mode to share."
                        : "Guest link copied.",
                    );
                  })
                }
              >
                Copy guest link
              </button>
            </div>
            {scene && (
              <KeepsakeButton
                scene={scene}
                events={snapshot.events}
                sequences={playedSequences}
              />
            )}
            <div className="presence-card" data-testid="room-presence">
              <h2>In this room</h2>
              <strong data-testid="presence-count">
                {presenceCount(snapshot.participants.length)}
              </strong>
              <ul className="presence-list">
                {snapshot.participants.map((participant) => (
                  <li key={participant.id}>{presenceLabel(participant)}</li>
                ))}
              </ul>
            </div>
            <div className="proposals-card">
              <h2>The World Listens</h2>
              <p className="card-help">{note}</p>
            </div>
            <div className="moments-card">
              <h2>Story Moments</h2>
              <ol className="timeline">
                {snapshot.events.map((event) => (
                  <li className="timeline-item" key={event.id}>
                    <i />
                    <span>
                      <strong>
                        {String(event.revision).padStart(2, "0")} ·{" "}
                        {event.summary}
                      </strong>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {snapshot.proposals
              .filter((proposal) => proposal.status === "pending")
              .map((proposal) => (
                <div className="proposal" key={proposal.id}>
                  <strong>New guest contribution</strong>
                  <p>
                    {proposal.operation.type === "CREATE_ENTITY"
                      ? proposal.operation.entity.name
                      : proposal.operation.type}
                  </p>
                  {snapshot.isDirector && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            drawing.acceptProposal(
                              proposal.id,
                              proposal.operation,
                            ),
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            client!.resolveProposal(proposal.id, false),
                          )
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
            ? "Local room · not synchronized"
            : "SpacetimeDB synchronized"}
        </span>
      </footer>
    </main>
  );
}
