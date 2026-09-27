export const SCHEMA_VERSION = 2;
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
};
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
  characterCandidateId: string;
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
  | { type: "REMOVE_ENTITY"; entityId: string };
export type WorldState = {
  id: string;
  revision: number;
  schemaVersion: number;
  entities: Entity[];
  rules: WorldRule[];
  goal: { characterId: string; targetId: string } | null;
  pathStatus: "idle" | "blocked" | "available";
  weather: "clear" | "rain";
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
