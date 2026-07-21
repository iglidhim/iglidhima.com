// src/ui/playArea.ts
// PlayArea chrome component (Requirements 1.3, 1.4, 1.5, 1.6, 3.4).
//
// The PlayArea is the host region in which the currently selected Game renders
// and runs. Given a `GameId`, it:
//
//   1. lazy-`import()`s the selected game's `GameDefinition` through the game
//      registry loader, so only the chosen game's code is fetched (Req 1.3);
//   2. creates a `<canvas>` sized to the game's `aspectRatio` via the pure
//      canvas-fit math (Req 8.3) and constructs a `GameRunner` bound to it;
//   3. mounts the shared chrome around it — the Scoreboard, the LifecycleControls
//      (including Back-to-Hub, Req 1.4), the Touch_Controls overlay, and the
//      game's instructions text (Req 3.4);
//   4. wires the runner's score/status callbacks into the Scoreboard and the
//      LifecycleControls, and seeds the Scoreboard's High_Score from the
//      Local_Store (Req 6.3).
//
// Because game modules load asynchronously, construction is split: the factory
// returns synchronously with an empty root element and a `load()` method that
// performs the dynamic import and builds the runner + chrome. If the import
// fails, the PlayArea surfaces a non-blocking message and hands control back to
// the caller (`onError`, falling back to `onBackToHub`) rather than leaving an
// empty Play_Area (see design "Lazy game load failures").
//
// `destroy()` stops and tears down the runner (which cancels the loop, removes
// input listeners, and clears the canvas), destroys every chrome component, and
// clears the root's DOM so the Play_Area is emptied on return to the Hub or when
// switching games (Requirements 1.5, 1.6). This is a framework-free vanilla-TS
// factory, matching the other chrome components; it uses the shared `.play-area`
// / `.play-area__stage` / `.play-area__canvas` / `.instructions` CSS classes.

import type { GameDefinition, GameId } from "../engine/types";
import { GAME_REGISTRY } from "../games/registry";
import { createGameRunner, type GameRunner } from "../engine/gameRunner";
import { InputManager, detectTouchCapable, type InputManagerOptions } from "../engine/input";
import { createScoreboard, type Scoreboard } from "./scoreboard";
import { createLifecycleControls, type LifecycleControls } from "./controls";
import { createTouchControls, type TouchControls } from "./touchControls";
import { fitToContainer } from "../lib/canvasFit";
import { readHighScore as defaultReadHighScore } from "../scores/scoreStore";

/** A game definition with concrete state/action types erased (registry shape). */
type AnyGameDefinition = GameDefinition<unknown, string>;

/** The registry shape the PlayArea reads from (injectable for tests). */
type GameRegistry = Record<GameId, { name: string; loader: () => Promise<AnyGameDefinition> }>;

/** Fallback canvas backing dimensions when the stage has no measured width
 *  (e.g. under jsdom, where layout is not computed). CSS scales the canvas to
 *  the Play_Area width responsively (`.play-area__canvas { max-width: 100% }`). */
const DEFAULT_STAGE_WIDTH = 480;
const DEFAULT_STAGE_HEIGHT = 640;

export interface CreatePlayAreaOptions {
  /** The game to load into the Play_Area as the Active_Game (Req 1.3). */
  gameId: GameId;
  /** Invoked when the Visitor activates Back-to-Hub (Req 1.4). */
  onBackToHub: () => void;
  /**
   * Invoked when the game module fails to load (Req: lazy load failure). When
   * omitted, the PlayArea falls back to `onBackToHub` so the Visitor is never
   * stranded on an empty Play_Area.
   */
  onError?: (error: unknown, id: GameId) => void;
  /** Registry override (defaults to the real GAME_REGISTRY). Injectable for tests. */
  registry?: GameRegistry;
  /** High_Score reader override (defaults to the real ScoreStore adapter). */
  readHighScore?: (id: GameId) => number;
  /** Force touch capability on/off (auto-detected when omitted). */
  touchCapable?: boolean;
}

/**
 * A mounted Play_Area. Returned by {@link createPlayArea}. The caller mounts it,
 * calls `load()` to fetch and start hosting the game, and calls `destroy()` to
 * stop the game and clear the region when returning to the Hub or switching
 * games (Requirements 1.5, 1.6).
 */
export interface PlayArea {
  /** The Play_Area root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the Play_Area to a parent node. */
  mount(parent: HTMLElement): void;
  /**
   * Lazy-load the selected game and build the canvas + runner + chrome. Resolves
   * once the game is hosted, or after surfacing a load-failure message. Safe to
   * call once; subsequent calls are no-ops.
   */
  load(): Promise<void>;
  /**
   * The live game instance once `load()` has succeeded, else `null`. Exposed so
   * the surrounding wiring/tests can drive or inspect the lifecycle.
   */
  readonly instance: GameRunner<unknown, string> | null;
  /**
   * Stop and destroy the runner, tear down every chrome component, and clear the
   * Play_Area DOM (Requirements 1.5, 1.6). Idempotent and terminal.
   */
  destroy(): void;
}

/** Compute the canvas backing size that fits the stage while preserving aspect. */
function computeCanvasSize(stage: HTMLElement, aspectRatio: number): { width: number; height: number } {
  const containerWidth = stage.clientWidth > 0 ? stage.clientWidth : DEFAULT_STAGE_WIDTH;
  const containerHeight = stage.clientHeight > 0 ? stage.clientHeight : DEFAULT_STAGE_HEIGHT;
  const fit = fitToContainer(containerWidth, containerHeight, aspectRatio);
  return {
    width: Math.max(1, Math.round(fit.width)),
    height: Math.max(1, Math.round(fit.height)),
  };
}

/**
 * Create a Play_Area for the given game.
 *
 * The root element is created synchronously; call {@link PlayArea.load} to fetch
 * the game module and build the runner and chrome.
 */
export function createPlayArea(options: CreatePlayAreaOptions): PlayArea {
  const {
    gameId,
    onBackToHub,
    onError,
    registry = GAME_REGISTRY,
    readHighScore = defaultReadHighScore,
  } = options;
  const touchCapable = options.touchCapable ?? detectTouchCapable();

  const root = document.createElement("div");
  root.className = "play-area";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Game play area");

  // Chrome + runner references, populated on a successful load(), torn down on
  // destroy(). Kept in closure state so destroy() can clean up whatever exists.
  let runner: GameRunner<unknown, string> | null = null;
  let scoreboard: Scoreboard | null = null;
  let controls: LifecycleControls | null = null;
  let touch: TouchControls | null = null;
  let input: InputManager<string> | null = null;

  let loadStarted = false;
  let destroyed = false;

  /** Surface a non-blocking load-failure message and hand back control. */
  function surfaceLoadFailure(error: unknown): void {
    const message = document.createElement("p");
    message.className = "play-area__error";
    message.setAttribute("role", "alert");
    message.textContent = "This game could not be loaded. Returning to the hub.";
    root.appendChild(message);

    // Prefer the explicit error handler; otherwise fall back to returning to the
    // Hub so the Visitor is never left on an empty Play_Area.
    if (onError) {
      onError(error, gameId);
    } else {
      onBackToHub();
    }
  }

  function buildForDefinition(definition: AnyGameDefinition): void {
    // --- Scoreboard: seed the stored High_Score for this game (Req 6.3) ------
    scoreboard = createScoreboard();
    scoreboard.setHighScore(readHighScore(gameId));

    // --- Canvas stage: sized to the game's aspect ratio (Req 8.3) -----------
    const stage = document.createElement("div");
    stage.className = "play-area__stage";

    const canvas = document.createElement("canvas");
    canvas.className = "play-area__canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${definition.name} game`);
    stage.appendChild(canvas);

    const size = computeCanvasSize(stage, definition.aspectRatio);
    canvas.width = size.width;
    canvas.height = size.height;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      // Canvas 2D unavailable (e.g. under jsdom): the runner skips rendering.
      ctx = null;
    }

    // --- Touch_Controls overlay (only shown on touch-capable devices) --------
    touch = createTouchControls(definition.touchControls, { touchCapable });

    // --- InputManager bound to the touch overlay so on-screen controls work --
    const inputOptions: InputManagerOptions<string> = {
      keyMap: definition.keyMap,
      scrollKeys: definition.scrollKeys,
      touchControls: definition.touchControls,
      touchContainer: touch.element,
      touchCapable,
    };
    input = new InputManager<string>(inputOptions);

    // --- GameRunner bound to the canvas, scoreboard, and controls ------------
    runner = createGameRunner<unknown, string>({
      definition,
      ctx,
      viewport: { width: size.width, height: size.height },
      input,
      onScoreChange: (score) => scoreboard?.setScore(score),
      onStatusChange: (status) => controls?.setStatus(status),
    });

    // --- LifecycleControls: lifecycle bound to the runner; Back-to-Hub to the
    //     surrounding caller (Req 1.4). Play-Again maps to restart internally. -
    controls = createLifecycleControls({
      instance: runner,
      onBackToHub,
    });

    // Mount order: Scoreboard, canvas stage, controls, touch overlay, then the
    // game's instructions text (Req 3.4).
    scoreboard.mount(root);
    root.appendChild(stage);
    controls.mount(root);
    touch.mount(root);

    const instructions = document.createElement("p");
    instructions.className = "instructions";
    instructions.textContent = definition.instructions;
    root.appendChild(instructions);

    // Reflect the runner's initial idle status onto the controls.
    controls.setStatus(runner.status);
  }

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    async load(): Promise<void> {
      if (loadStarted || destroyed) return;
      loadStarted = true;

      const entry = registry[gameId];
      try {
        const definition = await entry.loader();
        // A destroy() may have raced ahead of the async import; bail if so.
        if (destroyed) return;
        buildForDefinition(definition);
      } catch (error) {
        if (destroyed) return;
        surfaceLoadFailure(error);
      }
    },

    get instance(): GameRunner<unknown, string> | null {
      return runner;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;

      // Stop the game first: cancels the loop, removes input listeners, clears
      // the canvas (Req 1.5).
      runner?.destroy();
      // Tear down the chrome components.
      scoreboard?.destroy();
      controls?.destroy();
      touch?.destroy();
      input = null;
      runner = null;
      scoreboard = null;
      controls = null;
      touch = null;

      // Clear any remaining DOM (e.g. the canvas stage, instructions, or a
      // load-failure message) and detach the root.
      root.replaceChildren();
      root.remove();
    },
  };
}
