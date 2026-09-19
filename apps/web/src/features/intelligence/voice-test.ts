// Development-only page (voice-test.html) for trying speech in and speech out
// without the app UI. It is not part of the production build.
import type { Entity, WorldEvent, WorldState } from "@storyworld/contracts";
import { createBrowserReactionPlayer } from "./reaction-player";
import { createTranscriber, isVoiceInputSupported } from "./transcriber";

function element<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
const logBox = element<HTMLPreElement>("log");
function log(line: string) {
  logBox.textContent =
    new Date().toLocaleTimeString() + "  " + line + "\n" + logBox.textContent;
}

// --- Health --------------------------------------------------------------
void fetch("/api/health")
  .then((response) => response.json())
  .then((health: { audioMode?: string }) => {
    element("health").textContent =
      "Voice: " +
      (health.audioMode === "live"
        ? "ready"
        : "not set up (no ELEVENLABS_API_KEY); captions only") +
      " · Microphone in this browser: " +
      (isVoiceInputSupported() ? "supported" : "not supported");
  })
  .catch(() => {
    element("health").textContent = "The API is not reachable.";
  });

// --- Speech in -----------------------------------------------------------
const talk = element<HTMLButtonElement>("talk");
const partial = element<HTMLParagraphElement>("partial");
const listening = element<HTMLSpanElement>("listening");
const transcript = element<HTMLTextAreaElement>("transcript");
let transcriber: ReturnType<typeof createTranscriber> | null = null;

talk.addEventListener("click", async () => {
  if (transcriber) {
    const active = transcriber;
    transcriber = null;
    talk.disabled = true;
    listening.textContent = "Finishing…";
    const text = await active.stop();
    transcript.value = text;
    partial.textContent = "";
    listening.textContent = text ? "" : "Nothing was heard.";
    talk.textContent = "Start listening";
    talk.disabled = false;
    log("heard: " + JSON.stringify(text));
    return;
  }
  const next = createTranscriber({
    onPartial: (text) => (partial.textContent = text),
    onError: (error) => {
      listening.textContent = error.message;
      log("transcription error: " + error.code);
    },
  });
  try {
    listening.textContent = "Starting…";
    await next.start();
    transcriber = next;
    talk.textContent = "Stop";
    listening.textContent = "Listening…";
  } catch (error) {
    const known = error as { code?: string; message?: string };
    listening.textContent =
      known.message ?? "Voice input could not start. You can type instead.";
    log("could not start: " + (known.code ?? "unknown"));
  }
});

// --- Speech out ----------------------------------------------------------
const nova: Entity = {
  id: "nova",
  kind: "character",
  name: "Nova",
  bounds: { x: 150, y: 300, width: 80, height: 70 },
};
const river: Entity = {
  id: "river",
  kind: "river",
  name: "River",
  bounds: { x: 420, y: 0, width: 120, height: 600 },
};
const castle: Entity = {
  id: "castle",
  kind: "castle",
  name: "Castle",
  bounds: { x: 740, y: 230, width: 140, height: 150 },
};
const base: WorldState = {
  id: "voice-test",
  revision: 0,
  schemaVersion: 1,
  entities: [nova, river, castle],
  rules: [],
  goal: { characterId: "nova", targetId: "castle" },
  pathStatus: "blocked",
  weather: "clear",
};

let revision = 0;
const events: WorldEvent[] = [];
function commit(
  summary: string,
  extra: Entity[],
  overrides: Partial<WorldState>,
) {
  revision += 1;
  const event: WorldEvent = {
    id: crypto.randomUUID(),
    revision,
    actor: "You",
    summary,
    state: {
      ...base,
      revision,
      entities: [...base.entities, ...extra],
      ...overrides,
    },
  };
  events.push(event);
  return event;
}

const caption = element<HTMLParagraphElement>("caption");
const audioState = element<HTMLParagraphElement>("audio");
const player = createBrowserReactionPlayer({
  onCaption: (cue) => {
    caption.textContent = cue.text;
    log("caption (" + cue.emotion + "): " + cue.text);
  },
  onAudio: (state) => {
    audioState.textContent = "Voice: " + state;
    log("voice: " + state);
  },
});
// Connecting: record the (empty) history so only new events are reacted to.
void player.observe(events);

const scenarios: Record<string, () => void> = {
  // Each scenario starts from the plain world, then commits one change.
  open: () => {
    commit("World reset", [], {});
    commit(
      "Bridge added · route opened",
      [
        {
          id: "bridge-" + revision,
          kind: "bridge",
          name: "Bridge",
          bounds: { x: 385, y: 330, width: 190, height: 55 },
        },
      ],
      { pathStatus: "available" },
    );
  },
  short: () => {
    commit("World reset", [], {});
    commit(
      "Bridge added · river still blocks the route",
      [
        {
          id: "bridge-" + revision,
          kind: "bridge",
          name: "Bridge",
          bounds: { x: 385, y: 330, width: 100, height: 55 },
        },
      ],
      { pathStatus: "blocked" },
    );
  },
  rain: () => {
    commit("World reset", [], {});
    commit(
      "Storm cloud added",
      [
        {
          id: "cloud-" + revision,
          kind: "cloud",
          name: "Storm cloud",
          bounds: { x: 580, y: 80, width: 150, height: 75 },
        },
      ],
      { weather: "rain" },
    );
  },
  reset: () => {
    commit("World reset", [], {});
  },
};

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-scenario]",
)) {
  button.addEventListener("click", () => {
    scenarios[button.dataset.scenario!]!();
    log("committed: " + events.at(-1)!.summary);
    void player.observe(events);
  });
}
element("again").addEventListener("click", () => {
  const last = events.at(-1);
  if (!last) return log("Send an event first.");
  log(
    "re-sent " +
      last.id.slice(0, 8) +
      " (already played: " +
      player.hasPlayed(last.id) +
      ")",
  );
  void player.observe(events);
});
