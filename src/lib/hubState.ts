// Pure hub state machine: the Site is either showing the Game_Selector (hub)
// or running exactly one Active_Game (playing). All transitions are pure and
// testable (Requirements 1.3, 1.5, 1.6).

import type { GameId } from "../engine/types";

export type HubState =
  | { view: "hub" }
  | { view: "playing"; activeGame: GameId }
  | { view: "family-corner" };

/** The initial hub state, showing the Game_Selector. */
export const initialHubState: HubState = { view: "hub" };

/**
 * Select a Game, making it the sole Active_Game (Requirements 1.3, 1.6).
 *
 * From either the hub or a `playing` state, this yields the `playing` view with
 * `activeGame` set to `id`; selecting a game while another is active replaces
 * the active game with the newly selected one.
 */
export function selectGame(_state: HubState, id: GameId): HubState {
  return { view: "playing", activeGame: id };
}

/**
 * Return to the Hub, clearing the Active_Game (Requirement 1.5).
 *
 * The pure transition always yields the `hub` view. Stopping and destroying the
 * Active_Game (and clearing the Play_Area) is a side effect wired where the
 * `GameRunner` is bound; this module models only the pure view transition.
 */
export function returnToHub(_state: HubState): HubState {
  return { view: "hub" };
}

/**
 * Open Family_Corner, entering its create-and-send experience (Requirement 1.2).
 *
 * From any prior view (`hub`, `playing`, or `family-corner`), this pure
 * transition yields the `family-corner` view. Mounting/tearing down the
 * Family Corner UI is a side effect wired in `main.ts`; this module models only
 * the pure view transition.
 */
export function openFamilyCorner(_state: HubState): HubState {
  return { view: "family-corner" };
}
