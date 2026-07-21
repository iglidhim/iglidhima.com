// Render tests for the PlayArea chrome component (task 9.5).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// The registry loader is mocked with a fake GameDefinition so the test exercises
// the PlayArea's mounting/teardown/error paths without loading real game modules
// or touching localStorage.
// _Requirements: 1.3, 1.4, 1.5, 1.6, 3.4_
import { describe, it, expect, beforeEach } from "vitest";
import { createPlayArea } from "./playArea";
import type { GameDefinition, GameId } from "../engine/types";

/** A minimal, side-effect-free fake game used to drive the PlayArea. */
interface FakeState {
  score: number;
}

function makeFakeDefinition(overrides: Partial<GameDefinition<FakeState, string>> = {}): GameDefinition<
  FakeState,
  string
> {
  return {
    id: "block-cascade" as GameId,
    name: "Fake Game",
    instructions: "Use the arrow keys to play the fake game.",
    aspectRatio: 0.5,
    keyMap: { ArrowLeft: "left", ArrowRight: "right" },
    scrollKeys: ["ArrowLeft", "ArrowRight"],
    touchControls: [
      { action: "left", label: "Left", position: "left" },
      { action: "right", label: "Right", position: "right" },
    ],
    createInitialState: () => ({ score: 0 }),
    step: (state) => state,
    isGameOver: () => false,
    getScore: (state) => state.score,
    render: () => {},
    ...overrides,
  };
}

function makeRegistry(
  loader: () => Promise<GameDefinition<unknown, string>>,
): Record<GameId, { name: string; loader: () => Promise<GameDefinition<unknown, string>> }> {
  const entry = { name: "Fake Game", loader };
  return {
    "block-cascade": entry,
    serpent: entry,
    "maze-muncher": entry,
    "brick-buster": entry,
  };
}

describe("createPlayArea", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("mounts the canvas, scoreboard, controls, touch overlay, and instructions after load (Req 1.3, 3.4)", async () => {
    const definition = makeFakeDefinition();
    const pa = createPlayArea({
      gameId: "block-cascade",
      onBackToHub: () => {},
      registry: makeRegistry(async () => definition as unknown as GameDefinition<unknown, string>),
      readHighScore: () => 4200,
      touchCapable: true,
    });
    pa.mount(host);
    await pa.load();

    const root = host.querySelector(".play-area");
    expect(root).not.toBeNull();

    // Canvas sized to the game's aspect ratio (Req 8.3).
    const canvas = host.querySelector<HTMLCanvasElement>(".play-area__canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.width / canvas!.height).toBeCloseTo(0.5, 5);

    // Scoreboard seeded with the stored High_Score (Req 6.3).
    expect(host.querySelector(".scoreboard")).not.toBeNull();
    expect(host.querySelector(".scoreboard__high-score")?.textContent).toBe("4200");

    // Lifecycle controls incl. Back-to-Hub (Req 1.4).
    expect(host.querySelector(".controls")).not.toBeNull();
    expect(host.querySelector('[data-control="back"]')).not.toBeNull();
    expect(host.querySelector('[data-control="start"]')).not.toBeNull();

    // Touch overlay enabled (touchCapable: true) with a button per spec.
    expect(host.querySelector('.touch-controls[data-touch="true"]')).not.toBeNull();
    expect(host.querySelectorAll(".touch-controls__btn")).toHaveLength(2);

    // Instructions text rendered (Req 3.4).
    expect(host.querySelector(".instructions")?.textContent).toBe(
      "Use the arrow keys to play the fake game.",
    );

    pa.destroy();
  });

  it("invokes onBackToHub when the Back-to-Hub control is activated (Req 1.4)", async () => {
    let backCalls = 0;
    const pa = createPlayArea({
      gameId: "serpent",
      onBackToHub: () => {
        backCalls += 1;
      },
      registry: makeRegistry(
        async () => makeFakeDefinition() as unknown as GameDefinition<unknown, string>,
      ),
      readHighScore: () => 0,
      touchCapable: false,
    });
    pa.mount(host);
    await pa.load();

    host.querySelector<HTMLButtonElement>('[data-control="back"]')!.click();
    expect(backCalls).toBe(1);

    pa.destroy();
  });

  it("clears the Play_Area DOM on destroy (Req 1.5, 1.6)", async () => {
    const pa = createPlayArea({
      gameId: "maze-muncher",
      onBackToHub: () => {},
      registry: makeRegistry(
        async () => makeFakeDefinition() as unknown as GameDefinition<unknown, string>,
      ),
      readHighScore: () => 0,
      touchCapable: true,
    });
    pa.mount(host);
    await pa.load();

    expect(host.querySelector(".play-area")).not.toBeNull();
    expect(pa.instance).not.toBeNull();

    pa.destroy();

    // Root detached and emptied; no canvas/controls/scoreboard remain.
    expect(host.querySelector(".play-area")).toBeNull();
    expect(host.querySelector(".play-area__canvas")).toBeNull();
    expect(host.querySelector(".controls")).toBeNull();
    expect(host.querySelector(".scoreboard")).toBeNull();
    expect(pa.element.childElementCount).toBe(0);
  });

  it("surfaces a non-blocking message and invokes onError on a lazy-load failure", async () => {
    let errorSeen: unknown = null;
    const pa = createPlayArea({
      gameId: "brick-buster",
      onBackToHub: () => {},
      onError: (error) => {
        errorSeen = error;
      },
      registry: makeRegistry(async () => {
        throw new Error("chunk load failed");
      }),
      readHighScore: () => 0,
    });
    pa.mount(host);
    await pa.load();

    // A message is shown rather than leaving an empty Play_Area.
    const message = host.querySelector(".play-area__error");
    expect(message).not.toBeNull();
    expect(message?.textContent).toContain("could not be loaded");
    // The error handler was invoked.
    expect(errorSeen).toBeInstanceOf(Error);
    // No game instance was constructed.
    expect(pa.instance).toBeNull();

    pa.destroy();
  });

  it("falls back to onBackToHub when no onError is provided and the load fails", async () => {
    let backCalls = 0;
    const pa = createPlayArea({
      gameId: "brick-buster",
      onBackToHub: () => {
        backCalls += 1;
      },
      registry: makeRegistry(async () => {
        throw new Error("boom");
      }),
      readHighScore: () => 0,
    });
    pa.mount(host);
    await pa.load();

    expect(backCalls).toBe(1);
    expect(host.querySelector(".play-area__error")).not.toBeNull();

    pa.destroy();
  });
});
