import { useEffect, useRef, useState } from "react";
import type { ConfirmedScene } from "@storyworld/contracts";
import type { WorldEvent } from "@storyworld/contracts/model";
import {
  validateStorySequenceForWorld,
  type StorySequence,
} from "@storyworld/contracts/story-beat";
import type { StorySequenceRequest } from "@storyworld/contracts/story-sequence";
import { sequenceFromCommittedEvents } from "../features/world-renderer/committed-story-sequence";
import {
  requestStorySequence,
  type StorySequenceClientOptions,
} from "../services/story-sequence-client";

const unavailableStatus =
  "Story director unavailable; playing the committed moment locally.";

function optionalGuidance(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type DirectedStoryState = {
  sequence: StorySequence | null;
  status: string;
  directing: boolean;
};

type RequestSequence = (
  request: StorySequenceRequest,
  options: StorySequenceClientOptions,
) => Promise<StorySequence>;

export class DirectedStoryController {
  private active:
    | { requestId: string; eventId: string; controller: AbortController }
    | undefined;
  private readonly played = new Set<string>();

  constructor(
    private readonly publish: (state: DirectedStoryState) => void,
    private readonly requestSequence: RequestSequence = requestStorySequence,
    private readonly makeRequestId: () => string = () => crypto.randomUUID(),
  ) {}

  direct(
    latest: WorldEvent | undefined,
    previous: WorldEvent | undefined,
    scene: ConfirmedScene | undefined,
  ) {
    if (
      !latest ||
      !scene ||
      this.played.has(latest.id) ||
      this.active?.eventId === latest.id
    )
      return;

    this.cancel();
    const requestId = this.makeRequestId();
    const controller = new AbortController();
    const active = { requestId, eventId: latest.id, controller };
    this.active = active;
    this.publish({ sequence: null, status: "", directing: true });

    const request: StorySequenceRequest = {
      requestId,
      committedEvent: {
        id: latest.id,
        revision: latest.revision,
        summary: latest.summary,
      },
      committedWorld: latest.state,
      previousCommittedWorld: previous?.state ?? null,
      childDescription: optionalGuidance(scene.document.description),
      openingNarration: optionalGuidance(scene.openingNarration),
    };

    void this.requestSequence(request, { signal: controller.signal }).then(
      (sequence) => {
        if (!this.isCurrent(active)) return;
        const validated = validateStorySequenceForWorld(sequence, latest.state);
        if (
          sequence.requestId !== requestId ||
          sequence.sourceEventId !== latest.id ||
          sequence.sourceRevision !== latest.revision ||
          latest.state.revision !== latest.revision ||
          !validated.ok
        ) {
          this.installFallback(active, latest, previous);
          return;
        }
        this.active = undefined;
        this.played.add(latest.id);
        this.publish({
          sequence: validated.sequence,
          status: "",
          directing: false,
        });
      },
      () => {
        if (!this.isCurrent(active) || controller.signal.aborted) return;
        this.installFallback(active, latest, previous);
      },
    );
  }

  cancel(eventId?: string) {
    if (!this.active || (eventId && this.active.eventId !== eventId)) return;
    this.active.controller.abort();
    this.active = undefined;
  }

  private isCurrent(active: NonNullable<DirectedStoryController["active"]>) {
    return this.active === active && !active.controller.signal.aborted;
  }

  private installFallback(
    active: NonNullable<DirectedStoryController["active"]>,
    latest: WorldEvent,
    previous: WorldEvent | undefined,
  ) {
    if (!this.isCurrent(active)) return;
    this.active = undefined;
    this.played.add(latest.id);
    this.publish({
      sequence: sequenceFromCommittedEvents(latest, previous),
      status: unavailableStatus,
      directing: false,
    });
  }
}

export function useDirectedStorySequence(
  latest: WorldEvent | undefined,
  previous: WorldEvent | undefined,
  scene: ConfirmedScene | undefined,
) {
  const [state, setState] = useState<DirectedStoryState>({
    sequence: null,
    status: "",
    directing: false,
  });
  const controller = useRef<DirectedStoryController | null>(null);
  if (!controller.current)
    controller.current = new DirectedStoryController(setState);

  useEffect(() => {
    const eventId = latest?.id;
    controller.current!.direct(latest, previous, scene);
    return () => {
      if (eventId) controller.current!.cancel(eventId);
    };
  }, [
    latest?.id,
    latest?.revision,
    previous?.id,
    scene?.document.description,
    scene?.openingNarration,
  ]);

  return state;
}
