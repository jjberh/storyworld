import type { EntityRole } from "@storyworld/contracts";

export type RoleChoice = EntityRole | "remove";

/** Full names, used as each picture answer's accessible name. */
export const roleLabels: Record<RoleChoice, string> = {
  character: "Main character",
  goal: "A place to reach",
  obstacle: "Something in the way",
  helper: "A helper",
  scenery: "Part of the scene",
  remove: "Not here, not in my picture",
};

/** The word under each icon; every one is part of its full name. */
export const roleShortLabels: Record<RoleChoice, string> = {
  character: "Character",
  goal: "Place",
  obstacle: "In the way",
  helper: "Helper",
  scenery: "Scene",
  remove: "Not here",
};

const paths: Record<RoleChoice, string> = {
  // A stick figure.
  character:
    "M12 3.5a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 1 0 0-5.5M12 9v6.5M6.5 12h11M12 15.5l-4 5M12 15.5l4 5",
  // A flag to reach.
  goal: "M6 21V3.5M6 4h11l-2.5 4l2.5 4H6",
  // A brick wall.
  obstacle:
    "M3 8h18v11H3zM3 13.5h18M9 8v5.5M15 8v5.5M6 13.5V19M12 13.5V19M18 13.5V19",
  // A heart.
  helper:
    "M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z",
  // A tree.
  scenery: "M12 21v-5M12 3l-6 8h3.5l-4 5h13l-4-5H18z",
  // A crossed-out circle.
  remove:
    "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4",
};

export function RoleIcon({ role }: { role: RoleChoice }) {
  return (
    <svg
      className="role-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths[role]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
