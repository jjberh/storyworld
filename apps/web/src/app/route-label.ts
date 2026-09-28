import type { WorldState } from "@storyworld/contracts/model";

/** The Story Room's short status line for the character's route. */
export function routeLabel(pathStatus: WorldState["pathStatus"]): string {
  switch (pathStatus) {
    case "available":
      return "Route opened";
    case "blocked":
      return "River blocks the route";
    case "free_play":
      return "Free play: draw anything!";
    case "idle":
      return "No route yet";
  }
}
