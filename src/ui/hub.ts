// src/ui/hub.ts
// Hub / Game_Selector chrome component (Requirements 1.1, 1.2, 9.1, 9.2, 9.5).
//
// Renders the landing area of the Site: a title identifying the arcade plus one
// selectable entry per Game, read from the static GAME_REGISTRY so all four
// games appear within the initial viewport (Requirements 1.1, 1.2). Each entry
// shows the game's display `name` and a short control label describing its
// primary controls.
//
// Every entry is a native <button> so it is keyboard-operable with the global
// `:focus-visible` ring (Requirements 9.1, 9.2) and carries a descriptive
// accessible name (Requirement 9.5). Selecting an entry invokes the caller's
// `onSelect(id)` callback, which drives the hub state machine (lib/hubState.ts)
// to `playing` and loads the chosen Game into the Play_Area.
//
// This is a framework-free vanilla-TS factory that builds its own DOM using the
// shared `.hub` / `.hub__title` / `.hub-grid` / `.hub-card` / `.hub-card__name`
// / `.hub-card__label` classes defined in src/styles/global.css, keeping
// rendering separate from game logic like the other chrome components.

import type { GameId } from "../engine/types";
import { GAME_REGISTRY } from "../games/registry";

/** Default heading text identifying the Site as an arcade hub. */
const DEFAULT_TITLE = "Arcade";

/**
 * Short, static control labels shown beneath each game name in the selector.
 *
 * These describe each game's primary controls at a glance without loading the
 * game module (the registry `loader()` is lazy, so the Hub must render synchronously
 * from static data to appear within the initial viewport, Requirement 1.1).
 */
const CONTROL_LABELS: Record<GameId, string> = {
  "block-cascade": "Arrow keys to move & rotate",
  serpent: "Arrow keys to steer",
  "maze-muncher": "Arrow keys to move",
  "brick-buster": "Left / Right to move the paddle",
};

/**
 * A mounted Hub. Returned by {@link createHub}. The bootstrap layer mounts it,
 * reacts to selections via `onSelect`, and tears it down with `destroy()` when
 * a Game becomes the Active_Game.
 */
export interface Hub {
  /** The hub root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the hub to a parent node. */
  mount(parent: HTMLElement): void;
  /** Remove the hub from the DOM and release its references. */
  destroy(): void;
}

export interface CreateHubOptions {
  /**
   * Invoked with the selected `GameId` when a Visitor activates a game entry,
   * so the caller can drive the hub state machine to `playing` and load the
   * Game into the Play_Area (Requirement 1.3).
   */
  onSelect: (id: GameId) => void;
  /** Optional override for the arcade heading (defaults to "Arcade"). */
  title?: string;
}

/**
 * Create the Hub / Game_Selector.
 *
 * Builds a heading plus one native <button> per registered game (name + control
 * label). Each button invokes `onSelect(id)` on click; being a native button it
 * is also operable via Enter/Space with a visible focus ring (Requirements 9.1,
 * 9.2). The registry order determines display order, yielding one entry for each
 * of the four Games within the initial viewport (Requirements 1.1, 1.2).
 */
export function createHub(options: CreateHubOptions): Hub {
  const { onSelect, title = DEFAULT_TITLE } = options;

  const root = document.createElement("section");
  root.className = "hub";
  // Landmark + accessible name for the selector region (Requirement 9.5).
  root.setAttribute("aria-label", `${title} game selector`);

  const heading = document.createElement("h1");
  heading.className = "hub__title";
  heading.textContent = title;

  const grid = document.createElement("div");
  grid.className = "hub-grid";
  // Grouped, labelled list of selectable games for assistive technology.
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Choose a game");

  const listeners: Array<() => void> = [];

  // Render one entry per game in registry order (Requirements 1.1, 1.2).
  for (const id of Object.keys(GAME_REGISTRY) as GameId[]) {
    const { name } = GAME_REGISTRY[id];
    const controlLabel = CONTROL_LABELS[id];

    const card = document.createElement("button");
    card.type = "button";
    card.className = "hub-card";
    card.dataset.gameId = id;
    // Full accessible name so the control is self-describing (Requirement 9.5).
    card.setAttribute("aria-label", `Play ${name}. ${controlLabel}`);

    const nameEl = document.createElement("span");
    nameEl.className = "hub-card__name";
    nameEl.textContent = name;

    const labelEl = document.createElement("span");
    labelEl.className = "hub-card__label";
    labelEl.textContent = controlLabel;

    card.append(nameEl, labelEl);

    const handler = (): void => onSelect(id);
    card.addEventListener("click", handler);
    listeners.push(() => card.removeEventListener("click", handler));

    grid.appendChild(card);
  }

  root.append(heading, grid);

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      for (const remove of listeners) {
        remove();
      }
      listeners.length = 0;
      root.remove();
    },
  };
}
