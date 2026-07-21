// Integration smoke test for the bootstrap wiring (task 17.2).
//
// Exercises the full single-page flow end to end through `initArcade`: loading
// the page renders the Hub with one entry per game, selecting a game mounts the
// Play_Area with the Active_Game, and Back-to-Hub returns to the selector and
// clears the Play_Area.
//
// Runs under jsdom (via the *.dom.test.ts glob in vite.config.ts). The real game
// modules and registry are used (no mocks): the PlayArea lazy-`import()`s the
// selected game's GameDefinition, so we await `controller.loaded` before
// asserting the Play_Area mounted. Game renderers draw to a canvas, but the
// GameRunner guards `getContext` (null under jsdom), so no real rendering runs.
//
// _Requirements: 1.1, 1.3, 1.5_
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initArcade, type ArcadeController } from "../src/main";
import { GAME_REGISTRY } from "../src/games/registry";

const GAME_COUNT = Object.keys(GAME_REGISTRY).length;

describe("arcade bootstrap smoke test", () => {
  let root: HTMLDivElement;
  let controller: ArcadeController;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    controller = initArcade(root);
  });

  afterEach(() => {
    controller.destroy();
    root.remove();
  });

  it("renders the Hub with one selectable entry per game on load (Req 1.1)", () => {
    const cards = root.querySelectorAll<HTMLButtonElement>(".hub-card");
    expect(cards).toHaveLength(GAME_COUNT);
    expect(GAME_COUNT).toBe(4);

    // Each entry surfaces the game's name from the registry.
    const names = Array.from(cards).map((c) => c.querySelector(".hub-card__name")?.textContent);
    expect(names).toEqual(Object.values(GAME_REGISTRY).map((g) => g.name));

    // No Play_Area is present before a game is selected.
    expect(root.querySelector(".play-area")).toBeNull();
    expect(controller.state).toEqual({ view: "hub" });
  });

  it("mounts the Play_Area with the Active_Game when a game is selected (Req 1.3)", async () => {
    const firstCard = root.querySelector<HTMLElement>(".hub-card");
    expect(firstCard).not.toBeNull();
    const selectedId = firstCard!.dataset.gameId;

    // The launch button (sibling of the vote bar) drives the selection.
    firstCard!.querySelector<HTMLButtonElement>(".hub-card__play")!.click();

    // Selection drives the state machine to `playing` for that game.
    expect(controller.state).toEqual({ view: "playing", activeGame: selectedId });

    // Await the lazy game-module load, then assert the Play_Area is mounted.
    await controller.loaded;

    const playArea = root.querySelector(".play-area");
    expect(playArea).not.toBeNull();
    // The Hub selector is gone; the canvas stage and lifecycle controls are up.
    expect(root.querySelector(".hub")).toBeNull();
    expect(playArea!.querySelector(".play-area__canvas")).not.toBeNull();
    expect(playArea!.querySelector('[data-control="back"]')).not.toBeNull();
    expect(controller.playArea?.instance).not.toBeNull();
  });

  it("returns to the selector and clears the Play_Area on Back-to-Hub (Req 1.5)", async () => {
    root.querySelector<HTMLButtonElement>(".hub-card__play")!.click();
    await controller.loaded;

    // Sanity: we are in the Play_Area.
    expect(root.querySelector(".play-area")).not.toBeNull();
    const runner = controller.playArea?.instance;
    expect(runner).not.toBeNull();

    // Activate Back-to-Hub.
    const back = root.querySelector<HTMLButtonElement>('[data-control="back"]');
    expect(back).not.toBeNull();
    back!.click();

    // State machine is back on the Hub, the Play_Area is gone, and the selector
    // is shown again with all its entries.
    expect(controller.state).toEqual({ view: "hub" });
    expect(root.querySelector(".play-area")).toBeNull();
    expect(controller.playArea).toBeNull();
    expect(root.querySelectorAll(".hub-card")).toHaveLength(GAME_COUNT);
  });
});
