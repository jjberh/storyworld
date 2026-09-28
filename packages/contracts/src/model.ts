export const SCHEMA_VERSION = 3;
export type Bounds = { x: number; y: number; width: number; height: number };
export type ImageBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
/** What the engine needs an entity for. Behaviour comes from `properties`. */
export type EntityRole =
  "character" | "goal" | "obstacle" | "helper" | "scenery";
/** A closed list of things an entity can do in the world. */
export type EntityProperty =
  | "moves"
  | "flies"
  | "swims"
  | "floats"
  | "carries"
  | "launches"
  | "blocks"
  | "burns"
  | "scares"
  | "shelters"
  | "weather"
  | "goal";
export type Entity = {
  id: string;
  role: EntityRole;
  /** Friendly name for narration, e.g. "Sparkle the dragon". */
  name: string;
  /** Short model-written description. Untrusted text: narration only. */
  description: string;
  properties: EntityProperty[];
  bounds: Bounds;
  /** The child's own strokes for a piece drawn after the scene was confirmed. */
  sketch?: EntitySketch;
  /**
   * The committed outcome of this drawing's interaction. Each drawing is
   * resolved at most once; set only by RESOLVE_INTERACTION.
   */
  outcome?: InteractionOutcome;
};
/**
 * Crayon strokes in world coordinates (1000x600), each a flat list of x, y
 * pairs. The stage draws a piece's cutout from them, so a drawing added
 * mid-story looks like the child's own lines rather than a token.
 */
export type EntitySketch = { strokes: number[][] };
/** What happened when a new drawing met the story, as decided by Jev. */
export type InteractionOutcome =
  | "crosses"
  | "flies_over"
  | "rides_across"
  | "launched_across"
  | "almost"
  | "splash"
  | "blocked"
  | "scared"
  | "sheltered"
  | "nothing_happens";
/** The last committed interaction outcome. */
export type Interaction = {
  /** The drawing that acted. */
  entityId: string;
  outcome: InteractionOutcome;
  /** How likely the drawing was to get the character to its goal, 0 to 1. */
  odds: number;
  /** The resolver's confidence in the outcome, 0 to 1. */
  confidence: number;
  /** The route obstacle the outcome was about, if there was one. */
  obstacleId: string | null;
  /** The revision that committed it. */
  revision: number;
};
/** A committed success: `helperId` got the character past `obstacleId`. */
export type RouteCrossing = { obstacleId: string; helperId: string };
export type StoryMood = "curious" | "worried" | "delighted";
export type CharacterIdentity = Pick<Entity, "id" | "name">;
export type InitialSceneResponse = {
  operations: WorldOperation[];
  openingNarration: string;
  character: CharacterIdentity;
  moodHints: StoryMood[];
};
export type SceneCandidate = {
  id: string;
  role: EntityRole;
  name: string;
  description: string;
  properties: EntityProperty[];
  confidence: number;
  imageBounds: ImageBounds;
};
export type SceneInterpretationResponse = {
  mode: "fixture" | "live";
  message: string;
  candidates: SceneCandidate[];
  openingNarration: string;
  /** Absent when the picture has no clear character. */
  characterCandidateId?: string;
  goalCandidateId?: string;
  moodHints: StoryMood[];
};
export type WorldRule = {
  id: string;
  subjectId: string;
  predicate: "afraid_of";
  objectId: string;
};
export type WorldOperation =
  | { type: "CREATE_ENTITY"; entity: Entity }
  | { type: "ADD_RULE"; rule: WorldRule }
  | { type: "SET_GOAL"; characterId: string; targetId: string }
  | { type: "REMOVE_ENTITY"; entityId: string }
  | {
      type: "RESOLVE_INTERACTION";
      entityId: string;
      outcome: InteractionOutcome;
      odds: number;
      confidence: number;
      /**
       * The route obstacle Jev judged against (null when none). The reducer
       * refuses the outcome if the world's obstacle has changed since.
       */
      obstacleId: string | null;
    };
export type WorldState = {
  id: string;
  revision: number;
  schemaVersion: number;
  entities: Entity[];
  rules: WorldRule[];
  goal: { characterId: string; targetId: string } | null;
  pathStatus: "idle" | "blocked" | "available";
  weather: "clear" | "rain";
  interaction: Interaction | null;
  crossings: RouteCrossing[];
};
export type CandidateWorldOperation = {
  operation: WorldOperation;
  confidence: number;
};
export type WorldEvent = {
  id: string;
  revision: number;
  actor: string;
  summary: string;
  state: WorldState;
};
export type Proposal = {
  id: string;
  actor: string;
  operation: WorldOperation;
  status: "pending" | "approved" | "rejected";
};
export type ReactionCue = {
  eventId: string;
  text: string;
  emotion: StoryMood;
};
export interface WorldClient {
  initializeScene(
    id: string,
    requestId: string,
    scene: import("./index").ConfirmedScene,
  ): Promise<void>;
  connect(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClientSnapshot;
  createWorld(id: string): Promise<void>;
  joinWorld(id: string): Promise<void>;
  apply(operation: WorldOperation): Promise<void>;
  propose(operation: WorldOperation): Promise<void>;
  resolveProposal(id: string, approve: boolean): Promise<void>;
  reset(): Promise<void>;
  rewind(revision: number): Promise<void>;
  dispose(): void;
}
export type RoomParticipant = {
  id: string;
  identity: string;
  role: "director" | "guest";
  isYou: boolean;
};
export type ClientSnapshot = {
  scene?: import("./index").ConfirmedScene;
  status: "connecting" | "ready" | "error";
  error?: string;
  world: WorldState | null;
  events: WorldEvent[];
  proposals: Proposal[];
  participants: RoomParticipant[];
  isDirector: boolean;
  mode: "fixture" | "live";
};
