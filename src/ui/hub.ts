// src/ui/hub.ts
// Hub / Game_Selector chrome component (Requirements 1.1, 1.2, 9.1, 9.2, 9.5).
//
// Renders the landing area of the Site: a title identifying the arcade plus one
// selectable entry per Game, read from the static GAME_REGISTRY so all four
// games appear within the initial viewport (Requirements 1.1, 1.2). Each entry
// shows the game's display `name` and a short control label describing its
// primary controls.
//
// Each `.hub-card` is a plain container (`<article>`) holding two sibling
// regions so we never nest interactive controls inside one another:
//   a) `.hub-card__play` — a native <button> holding the icon + name + control
//      label. Activating it invokes `onSelect(id)` to launch the game. Being a
//      native button it is keyboard-operable with the global `:focus-visible`
//      ring (Requirements 9.1, 9.2) and carries a descriptive accessible name
//      "Play <name>. <controls>" (Requirement 9.5).
//   b) `.hub-card__votes` — a vote bar with two `.vote-btn` toggles (👍 like and
//      ❤️ love), each with its own aria-label, aria-pressed reflecting this
//      browser's stored state, and a live count. These are siblings of the play
//      button, so a vote click can never launch the game.
//
// Global Like/Love counts come from the same-origin Worker API via
// src/lib/votes.ts. The hub renders immediately with cached (localStorage
// pressed state) + zero counts, then updates counts when `fetchAllVotes()`
// resolves. A vote click optimistically updates the count + pressed state +
// localStorage, then calls `sendVote()`, reverting if the request fails.
//
// This is a framework-free vanilla-TS factory that builds its own DOM using the
// shared `.hub` / `.hub-card` / `.hub-card__play` / `.hub-card__votes` /
// `.vote-btn` classes defined in src/styles/global.css.

import type { GameId } from "../engine/types";
import { GAME_REGISTRY } from "../games/registry";
import { createGameIcon } from "./gameIcons";
import {
  fetchAllVotes as defaultFetchAllVotes,
  sendVote as defaultSendVote,
  hasVoted as defaultHasVoted,
  setVoted as defaultSetVoted,
  voteDelta,
  type AllVotes,
  type Reaction,
  type VoteCounts,
  type VoteTargetId,
} from "../lib/votes";

/** Default heading text identifying the Site as an arcade hub. */
const DEFAULT_TITLE = "Arcade";

/** The two reactions rendered in each card's vote bar, with their glyphs. */
const REACTION_META: ReadonlyArray<{ reaction: Reaction; glyph: string; verb: string }> = [
  { reaction: "like", glyph: "👍", verb: "Like" },
  { reaction: "love", glyph: "❤️", verb: "Love" },
];

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
 * The control label shown beneath the Chess card. Chess is not a canvas game
 * (it is not in {@link CONTROL_LABELS}), so it carries its own short label.
 */
const CHESS_LABEL = "Vs computer or a friend";

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

/**
 * The vote-system dependencies the hub uses. Injectable so tests can supply
 * mocks; defaults are the real implementations from src/lib/votes.ts.
 */
export interface HubVoteDeps {
  fetchAllVotes: () => Promise<AllVotes>;
  sendVote: (
    gameId: VoteTargetId,
    reaction: Reaction,
    delta: 1 | -1,
  ) => Promise<VoteCounts | null>;
  hasVoted: (gameId: VoteTargetId, reaction: Reaction) => boolean;
  setVoted: (gameId: VoteTargetId, reaction: Reaction, voted: boolean) => void;
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
  /** Optional override for the vote-system dependencies (defaults to the real module). */
  votes?: Partial<HubVoteDeps>;
  /**
   * Invoked when a Visitor activates the Family Corner entry, so the caller can
   * drive the hub state machine to `family-corner` and mount the Family Corner
   * view (Requirements 1.1, 1.2). When omitted, the entry is not rendered.
   */
  onOpenFamilyCorner?: () => void;
  /**
   * Invoked when a Visitor activates the Chess entry, so the caller can drive
   * the hub state machine to `chess` and mount the Chess view (parallel to
   * {@link CreateHubOptions.onOpenFamilyCorner}). When omitted, the entry is
   * not rendered.
   */
  onOpenChess?: () => void;
}

/** One vote button plus a small controller for optimistic updates. */
interface VoteControl {
  reaction: Reaction;
  button: HTMLButtonElement;
  countEl: HTMLElement;
  /** The currently displayed count. */
  count: number;
  /** This browser's pressed state (aria-pressed). */
  pressed: boolean;
}

/**
 * Create the Hub / Game_Selector.
 *
 * Builds a heading plus one `.hub-card` container per registered game. Each
 * card holds a `.hub-card__play` launch button (icon + name + control label)
 * and a `.hub-card__votes` bar with 👍/❤️ toggles. The registry order
 * determines display order, yielding one entry for each of the four Games
 * within the initial viewport (Requirements 1.1, 1.2).
 */
export function createHub(options: CreateHubOptions): Hub {
  const { onSelect, title = DEFAULT_TITLE, onOpenFamilyCorner, onOpenChess } = options;

  // Resolve vote dependencies, allowing partial overrides for tests.
  const votes: HubVoteDeps = {
    fetchAllVotes: options.votes?.fetchAllVotes ?? defaultFetchAllVotes,
    sendVote: options.votes?.sendVote ?? defaultSendVote,
    hasVoted: options.votes?.hasVoted ?? defaultHasVoted,
    setVoted: options.votes?.setVoted ?? defaultSetVoted,
  };

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
  // Per-target vote controls, so the async fetch can populate counts by id.
  // Keyed by VoteTargetId so the Chess card participates alongside the games.
  const controlsByGame = new Map<VoteTargetId, VoteControl[]>();
  // Guard so a late-resolving fetch never touches a destroyed hub.
  let destroyed = false;

  /**
   * Build one `.hub-card` (a launch button + a 👍/❤️ vote bar) and append it to
   * the grid. Shared by the four game cards and the Chess card so their DOM,
   * accessibility, vote wiring, and listener cleanup stay identical.
   *
   * @param spec.id         The vote target id (also the card's `data-game-id`).
   * @param spec.name       The display name shown in the card and aria-labels.
   * @param spec.label      The short control/description label under the name.
   * @param spec.onActivate Invoked when the play button is activated (launches a
   *                        game via `onSelect`, or opens Chess via `onOpenChess`).
   */
  function buildCard(spec: {
    id: VoteTargetId;
    name: string;
    label: string;
    onActivate: () => void;
  }): void {
    const { id, name, label, onActivate } = spec;

    // Container is a non-interactive <article> so the play button and vote
    // buttons are siblings, never nested interactive controls.
    const card = document.createElement("article");
    card.className = "hub-card";
    card.dataset.gameId = id;

    // --- (a) Launch button: preserves the original card click behavior. ------
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "hub-card__play";
    // Full accessible name so the control is self-describing (Requirement 9.5).
    playBtn.setAttribute("aria-label", `Play ${name}. ${label}`);

    // Decorative per-target icon, rendered above the name. It is aria-hidden, so
    // it adds visual identity without duplicating the button's accessible name.
    const icon = createGameIcon(id);

    const nameEl = document.createElement("span");
    nameEl.className = "hub-card__name";
    nameEl.textContent = name;

    const labelEl = document.createElement("span");
    labelEl.className = "hub-card__label";
    labelEl.textContent = label;

    playBtn.append(icon, nameEl, labelEl);

    const playHandler = (): void => onActivate();
    playBtn.addEventListener("click", playHandler);
    listeners.push(() => playBtn.removeEventListener("click", playHandler));

    // --- (b) Vote bar: 👍 like + ❤️ love toggles (siblings of the button). ---
    const voteBar = document.createElement("div");
    voteBar.className = "hub-card__votes";
    voteBar.setAttribute("role", "group");
    voteBar.setAttribute("aria-label", `React to ${name}`);

    const gameControls: VoteControl[] = [];

    for (const { reaction, glyph, verb } of REACTION_META) {
      const voteBtn = document.createElement("button");
      voteBtn.type = "button";
      voteBtn.className = "vote-btn";
      voteBtn.dataset.reaction = reaction;
      voteBtn.setAttribute("aria-label", `${verb} ${name}`);

      const pressed = votes.hasVoted(id, reaction);
      voteBtn.setAttribute("aria-pressed", String(pressed));

      const glyphEl = document.createElement("span");
      glyphEl.className = "vote-btn__glyph";
      glyphEl.setAttribute("aria-hidden", "true");
      glyphEl.textContent = glyph;

      const countEl = document.createElement("span");
      countEl.className = "vote-btn__count";
      countEl.textContent = "0";

      voteBtn.append(glyphEl, countEl);

      const control: VoteControl = {
        reaction,
        button: voteBtn,
        countEl,
        count: 0,
        pressed,
      };
      gameControls.push(control);

      const voteHandler = (): void => {
        void handleVote(id, control);
      };
      voteBtn.addEventListener("click", voteHandler);
      listeners.push(() => voteBtn.removeEventListener("click", voteHandler));

      voteBar.appendChild(voteBtn);
    }

    controlsByGame.set(id, gameControls);
    card.append(playBtn, voteBar);
    grid.appendChild(card);
  }

  // Render one card per game in registry order (Requirements 1.1, 1.2).
  for (const id of Object.keys(GAME_REGISTRY) as GameId[]) {
    buildCard({
      id,
      name: GAME_REGISTRY[id].name,
      label: CONTROL_LABELS[id],
      onActivate: () => onSelect(id),
    });
  }

  // Render the Chess card LAST in the grid, visually identical to the game
  // cards but launching the Chess play experience via `onOpenChess` rather than
  // loading a canvas game. Only rendered when the caller wires `onOpenChess`
  // (mirrors the previous standalone-entry guard).
  if (onOpenChess) {
    buildCard({
      id: "chess",
      name: "Chess",
      label: CHESS_LABEL,
      onActivate: () => onOpenChess(),
    });
  }

  /** Reflect a control's current state into the DOM. */
  function paint(control: VoteControl): void {
    control.countEl.textContent = String(control.count);
    control.button.setAttribute("aria-pressed", String(control.pressed));
  }

  /**
   * Toggle a reaction: optimistically update the count + pressed state +
   * localStorage, then POST. Revert the optimistic change if the POST fails.
   */
  async function handleVote(id: VoteTargetId, control: VoteControl): Promise<void> {
    const prevCount = control.count;
    const prevPressed = control.pressed;
    const delta = voteDelta(prevPressed);

    // Optimistic update.
    control.pressed = !prevPressed;
    control.count = Math.max(0, prevCount + delta);
    votes.setVoted(id, control.reaction, control.pressed);
    paint(control);

    const result = await votes.sendVote(id, control.reaction, delta);
    if (destroyed) {
      return;
    }
    if (result === null) {
      // Failure: revert the optimistic change.
      control.pressed = prevPressed;
      control.count = prevCount;
      votes.setVoted(id, control.reaction, prevPressed);
      paint(control);
      return;
    }
    // Success: reconcile the displayed count with the authoritative value.
    control.count = result[control.reaction];
    paint(control);
  }

  root.append(heading, grid);

  // --- Family Corner entry --------------------------------------------------
  // A navigational destination distinct from the four game cards: it does not
  // launch a game, it opens the private create-and-send experience for the
  // family (Requirements 1.1, 1.2). Rendered as its own native <button> in a
  // separate section below the game grid so it reads as a different kind of
  // destination. Only rendered when the caller wires `onOpenFamilyCorner`.
  if (onOpenFamilyCorner) {
    const familyNav = document.createElement("nav");
    familyNav.className = "hub__family";
    familyNav.setAttribute("aria-label", "Family Corner");

    const familyBtn = document.createElement("button");
    familyBtn.type = "button";
    familyBtn.className = "hub__family-corner";
    // Self-describing accessible name (Requirement 9.5-style labelling).
    familyBtn.setAttribute("aria-label", "Family Corner. Draw & send to Dad");

    const familyGlyph = document.createElement("span");
    familyGlyph.className = "hub__family-corner-glyph";
    familyGlyph.setAttribute("aria-hidden", "true");
    familyGlyph.textContent = "✉️";

    const familyName = document.createElement("span");
    familyName.className = "hub__family-corner-name";
    familyName.textContent = "Family Corner";

    const familyLabel = document.createElement("span");
    familyLabel.className = "hub__family-corner-label";
    familyLabel.textContent = "Draw & send to Dad";

    familyBtn.append(familyGlyph, familyName, familyLabel);

    const familyHandler = (): void => onOpenFamilyCorner();
    familyBtn.addEventListener("click", familyHandler);
    listeners.push(() =>
      familyBtn.removeEventListener("click", familyHandler),
    );

    familyNav.appendChild(familyBtn);
    root.appendChild(familyNav);
  }

  // Kick off the aggregate fetch without blocking the initial render. When it
  // resolves, populate each card's counts (unless the hub was destroyed first).
  void votes.fetchAllVotes().then((all) => {
    if (destroyed) {
      return;
    }
    for (const [id, gameControls] of controlsByGame) {
      const counts = all[id];
      for (const control of gameControls) {
        control.count = counts[control.reaction];
        paint(control);
      }
    }
  });

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      destroyed = true;
      for (const remove of listeners) {
        remove();
      }
      listeners.length = 0;
      controlsByGame.clear();
      root.remove();
    },
  };
}
