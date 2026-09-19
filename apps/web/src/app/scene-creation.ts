import type { ConfirmedScene } from "@storyworld/contracts";

export type CreationStatus = "review" | "creating" | "failed" | "committed";

/**
 * One frozen attempt to create the confirmed world. The IDs are generated once
 * so a retry after a lost response reaches the same idempotent reducer call
 * instead of creating a second world.
 */
export type CreationAttempt = {
  id: string;
  requestId: string;
  scene: ConfirmedScene;
};

export type CreationState = {
  status: CreationStatus;
  attempt?: CreationAttempt;
  error: string;
};

export type CreationAction =
  | { type: "start"; attempt: CreationAttempt }
  | { type: "committed" }
  | { type: "failed"; error: string }
  | { type: "review" };

export const initialCreation: CreationState = { status: "review", error: "" };

/**
 * `failed` keeps the frozen attempt so "try again" is safe. Only an explicit
 * return to review, and only from `failed`, abandons it, so the next attempt
 * gets a fresh world ID and request ID.
 */
export function creationReducer(
  state: CreationState,
  action: CreationAction,
): CreationState {
  switch (action.type) {
    case "start":
      if (state.status === "creating" || state.status === "committed")
        return state;
      return {
        status: "creating",
        attempt: state.attempt ?? action.attempt,
        error: "",
      };
    case "committed":
      return state.status === "creating"
        ? { ...state, status: "committed", error: "" }
        : state;
    case "failed":
      return state.status === "creating"
        ? { ...state, status: "failed", error: action.error }
        : state;
    case "review":
      return state.status === "failed" ? initialCreation : state;
  }
}
