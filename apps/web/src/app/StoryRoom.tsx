import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cloudOperation } from "@storyworld/world-fixtures";
import type {
  ClientSnapshot,
  RoomParticipant,
  WorldClient,
} from "@storyworld/contracts/model";
import { LiveWorldClient } from "../services/world-client";
import { peekWorldClient, type RoomMode } from "../services/world-session";
import paintbrushIcon from "../assets/figma/paintbrush.svg";
import { PaperTheaterStage } from "../features/world-renderer/PaperTheaterStage";
import { sequenceFromCommittedEvents } from "../features/world-renderer/committed-story-sequence";
import { bridgeOperationForWorld } from "./story-room-operations";

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
  const client = session.client;
  const snapshot = useSyncExternalStore(
    client?.subscribe ?? ignoreSubscribe,
    client?.getSnapshot ?? (() => emptySnapshot),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(
    requestedGuest
      ? "Join this room to add an idea."
      : "This room is the committed story.",
  );

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

  const world = snapshot.world;
  const scene = snapshot.scene;
  const contributor = requestedGuest || (!!world && !snapshot.isDirector);
  const latestEvent = snapshot.events.at(-1);
  const previousEvent = snapshot.events.at(-2);
  const sequence = useMemo(
    () =>
      latestEvent
        ? sequenceFromCommittedEvents(latestEvent, previousEvent)
        : null,
    [latestEvent?.id, previousEvent?.id],
  );

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
              <span className="world-status">
                {world.pathStatus === "available"
                  ? "Route opened"
                  : world.pathStatus === "blocked"
                    ? "River blocks the route"
                    : "No route yet"}
              </span>
            </div>
            <div className="paper room-paper">
              {scene ? (
                <PaperTheaterStage
                  scene={scene}
                  world={world}
                  sequence={sequence}
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
            </div>
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
              <div className="actions">
                <button
                  className="primary-action"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      contributor
                        ? client!.propose(bridgeOperationForWorld(world))
                        : client!.apply(bridgeOperationForWorld(world)),
                    )
                  }
                >
                  {contributor ? "Propose" : "Add"} sample bridge
                </button>
                <button
                  className="secondary-action"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      contributor
                        ? client!.propose(cloudOperation())
                        : client!.apply(cloudOperation()),
                    )
                  }
                >
                  {contributor ? "Propose" : "Add"} storm cloud
                </button>
              </div>
            </div>
            <div className="moments-card">
              <h2>Story Moments</h2>
              {snapshot.events.map((event) => (
                <button
                  className="timeline-item"
                  key={event.id}
                  disabled={busy || contributor}
                  onClick={() => void run(() => client!.rewind(event.revision))}
                >
                  <i />
                  <span>
                    <strong>
                      {String(event.revision).padStart(2, "0")} ·{" "}
                      {event.summary}
                    </strong>
                  </span>
                </button>
              ))}
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
                            client!.resolveProposal(proposal.id, true),
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
