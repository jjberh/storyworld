import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldOperation } from "@storyworld/contracts/model";
import { FixtureWorldClient } from "@storyworld/world-fixtures";
import {
  StoryDrawingSession,
  type StoryDrawingDeps,
} from "./story-drawing-session";

const stroke = [400, 330, 480, 340, 560, 335];

const reading = (id = "bridge-1"): WorldOperation => ({
  type: "CREATE_ENTITY",
  entity: {
    id,
    role: "helper",
    name: "Bridge",
    description: "",
    properties: ["carries"],
    bounds: { x: 394, y: 324, width: 172, height: 22 },
  },
});

async function flush() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

function session(
  client: FixtureWorldClient,
  overrides: Partial<StoryDrawingDeps> = {},
) {
  const deps: StoryDrawingDeps = {
    client: () => client,
    guest: () => false,
    picture: () => "data:image/png;base64,AAAA",
    read: vi.fn(async () => reading()),
    resolve: vi.fn(async () => ({ kind: "needs-jev" as const })),
    settleMs: 900,
    ...overrides,
  };
  return { drawing: new StoryDrawingSession(deps), deps };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StoryDrawingSession", () => {
  it("still reads the drawing after a tap between strokes", async () => {
    const client = new FixtureWorldClient();
    const { drawing, deps } = session(client);
    drawing.startStroke();
    drawing.addStrokes([stroke]);
    // A tap: the stroke starts (pausing the timer) but leaves no line.
    drawing.startStroke();
    drawing.cancelStroke();
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(
      client.getSnapshot().world!.entities.some((e) => e.id === "bridge-1"),
    ).toBe(true);
  });

  it("keeps strokes together while one is still being drawn", async () => {
    const client = new FixtureWorldClient();
    const { drawing, deps } = session(client);
    drawing.addStrokes([stroke]);
    drawing.startStroke();
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.read).not.toHaveBeenCalled();
    drawing.addStrokes([[400, 360, 560, 365]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(drawing.getSnapshot().pending).toEqual([]);
  });

  it("retries a drawing that did commit without adding it twice", async () => {
    const client = new FixtureWorldClient();
    // The commit lands, but its acknowledgement is lost.
    const apply = client.apply.bind(client);
    let lost = true;
    vi.spyOn(client, "apply").mockImplementation(async (operation) => {
      await apply(operation);
      if (lost) {
        lost = false;
        throw new Error("connection lost");
      }
    });
    const { drawing, deps } = session(client);
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    const [failed] = drawing.getSnapshot().pending;
    expect(failed?.state).toBe("failed");
    // Two quick taps on "try again" queue one retry.
    drawing.retry(failed!.id);
    drawing.retry(failed!.id);
    await flush();
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(client.apply).toHaveBeenCalledTimes(1);
    expect(deps.resolve).toHaveBeenCalledTimes(1);
    expect(
      client
        .getSnapshot()
        .world!.entities.filter((entity) => entity.id === "bridge-1"),
    ).toHaveLength(1);
    expect(drawing.getSnapshot().pending).toEqual([]);
  });

  it("does not propose a guest's drawing twice on retry", async () => {
    const client = new FixtureWorldClient();
    const propose = client.propose.bind(client);
    let lost = true;
    vi.spyOn(client, "propose").mockImplementation(async (operation) => {
      await propose(operation);
      if (lost) {
        lost = false;
        throw new Error("connection lost");
      }
    });
    const { drawing } = session(client, { guest: () => true });
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    drawing.retry(drawing.getSnapshot().pending[0]!.id);
    await flush();
    expect(client.getSnapshot().proposals).toHaveLength(1);
    expect(drawing.getSnapshot().note).toMatch(/waiting for the director/);
  });

  it("accepts a proposal only after the drawing ahead of it is resolved", async () => {
    const client = new FixtureWorldClient();
    let releaseRead!: () => void;
    const order: string[] = [];
    const { drawing } = session(client, {
      read: async () => {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        return reading("bridge-1");
      },
      resolve: async (_client, entityId) => {
        order.push("resolve " + entityId);
        return { kind: "needs-jev" };
      },
    });
    await client.propose(reading("guest-boat"));
    const proposal = client.getSnapshot().proposals[0]!;
    const resolveProposal = client.resolveProposal.bind(client);
    vi.spyOn(client, "resolveProposal").mockImplementation(async (...args) => {
      order.push("accept");
      await resolveProposal(...args);
    });
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    const accepted = drawing.acceptProposal(proposal.id, proposal.operation);
    await flush();
    expect(order).toEqual([]);
    releaseRead();
    await accepted;
    expect(order).toEqual(["resolve bridge-1", "accept", "resolve guest-boat"]);
  });

  it("treats a guest retry as done once the director accepted it", async () => {
    const client = new FixtureWorldClient();
    const propose = client.propose.bind(client);
    vi.spyOn(client, "propose").mockImplementation(async (operation) => {
      await propose(operation);
      // The acknowledgement is lost, then the director accepts it.
      const proposal = client.getSnapshot().proposals.at(-1)!;
      await client.resolveProposal(proposal.id, true);
      throw new Error("connection lost");
    });
    const { drawing } = session(client, { guest: () => true });
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    drawing.retry(drawing.getSnapshot().pending[0]!.id);
    await flush();
    expect(client.propose).toHaveBeenCalledTimes(1);
    expect(drawing.getSnapshot().pending).toEqual([]);
    expect(drawing.getSnapshot().note).toMatch(/in the story/);
  });

  it("lets the child ask Jev again after a failure", async () => {
    const client = new FixtureWorldClient();
    const resolve = vi
      .fn<NonNullable<StoryDrawingDeps["resolve"]>>()
      .mockResolvedValueOnce({ kind: "failed", message: "Jev is busy." })
      .mockResolvedValueOnce({ kind: "resolved", outcome: "crosses" });
    const { drawing } = session(client, { resolve });
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    expect(drawing.getSnapshot().note).toBe("Jev is busy.");
    expect(drawing.getSnapshot().unresolved).toEqual({
      entityId: "bridge-1",
      name: "Bridge",
    });
    await drawing.retryInteraction();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith(client, "bridge-1");
    expect(drawing.getSnapshot().unresolved).toBeNull();
    expect(drawing.getSnapshot().note).toMatch(/has a way through/);
    // Nothing to ask once the moment is decided.
    await drawing.retryInteraction();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does not offer to ask again when Jev is simply not set up", async () => {
    const client = new FixtureWorldClient();
    const { drawing } = session(client);
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    expect(drawing.getSnapshot().note).toMatch(/needs Jev/);
    expect(drawing.getSnapshot().unresolved).toBeNull();
  });

  it("keeps drawing after a queued step fails", async () => {
    const client = new FixtureWorldClient();
    const { drawing, deps } = session(client);
    await expect(
      drawing.acceptProposal("missing", reading("ghost")),
    ).rejects.toThrow("no longer pending");
    drawing.addStrokes([stroke]);
    drawing.finish();
    await flush();
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.resolve).toHaveBeenCalledTimes(1);
  });
});
