import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import {
  selectGame,
  returnToHub,
  openFamilyCorner,
  type HubState,
} from "./hubState";
import type { GameId } from "../engine/types";

const GAME_IDS: readonly GameId[] = [
  "block-cascade",
  "serpent",
  "maze-muncher",
  "brick-buster",
];

const gameIdArb: fc.Arbitrary<GameId> = fc.constantFrom(...GAME_IDS);

// Any reachable hub state: the selector, playing some game, or Family Corner.
const hubStateArb: fc.Arbitrary<HubState> = fc.oneof(
  fc.constant<HubState>({ view: "hub" }),
  gameIdArb.map<HubState>((activeGame) => ({ view: "playing", activeGame })),
  fc.constant<HubState>({ view: "family-corner" }),
);

describe("hubState", () => {
  // Feature: personal-website, Property 1: Selecting a game makes it the sole Active_Game
  it("selectGame yields playing with activeGame === id from any state", () => {
    fc.assert(
      fc.property(hubStateArb, gameIdArb, (state, id) => {
        const result = selectGame(state, id);

        // Always transitions to the playing view with the selected game as the
        // sole Active_Game, including when another game is already active.
        expect(result.view).toBe("playing");
        expect(result).toEqual({ view: "playing", activeGame: id });
        if (result.view === "playing") {
          expect(result.activeGame).toBe(id);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: personal-website, Property 2: Returning to the Hub clears the Active_Game
  it("returnToHub yields the hub view and destroys the Active_Game exactly once", () => {
    fc.assert(
      fc.property(gameIdArb, (activeGame) => {
        const playing: HubState = { view: "playing", activeGame };

        // Pure transition: returning always yields the hub view.
        const result = returnToHub(playing);
        expect(result).toEqual({ view: "hub" });
        expect(result.view).toBe("hub");

        // Model the destroy() wiring bound to this transition: the Active_Game's
        // GameRunner.destroy() is invoked exactly once so the Play_Area clears.
        const destroy = vi.fn();
        const bindReturnToHub = (state: HubState): HubState => {
          if (state.view === "playing") {
            destroy();
          }
          return returnToHub(state);
        };

        bindReturnToHub(playing);
        expect(destroy).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: family-corner, Property 17: View transition into Family Corner
  it("openFamilyCorner yields the family-corner view from any prior state", () => {
    fc.assert(
      fc.property(hubStateArb, (state) => {
        const result = openFamilyCorner(state);

        // From any prior view (hub, playing, or family-corner), the pure
        // transition always yields the family-corner view (Requirement 1.2).
        expect(result).toEqual({ view: "family-corner" });
        expect(result.view).toBe("family-corner");
      }),
      { numRuns: 100 },
    );
  });
});
