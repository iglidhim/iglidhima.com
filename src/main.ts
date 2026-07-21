// src/main.ts
// Bootstrap entry for the arcade hub (Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 9.4).
//
// This module ties the pure hub state machine (lib/hubState.ts) to the DOM
// chrome: it mounts the Hub / Game_Selector, and on a game selection drives the
// state machine to `playing`, tears down the Hub view, and mounts a PlayArea
// hosting the chosen game as the Active_Game (Requirements 1.1, 1.3).
//
// The PlayArea's Back-to-Hub control returns the Visitor to the Hub: the state
// machine transitions via `returnToHub`, the PlayArea is destroyed (which stops
// the Active_Game and clears the Play_Area), and the Hub is re-rendered
// (Requirements 1.4, 1.5).
//
// Selecting a different game while one is already active stops the current game
// and loads the newly selected one as the Active_Game (Requirement 1.6): the
// selection handler always destroys any live PlayArea before mounting the new
// one, so exactly one Active_Game exists at a time.
//
// The single-page structure uses the shared `.arcade-layout` / `.arcade-container`
// classes for the centered, responsive single-column layout (Requirements 8.1,
// 8.2), matching the tokens defined in src/styles/global.css.

import type { GameId } from "./engine/types";
import {
  initialHubState,
  selectGame,
  returnToHub,
  openFamilyCorner,
  openChess,
  type HubState,
} from "./lib/hubState";
import { initTheme } from "./lib/theme";
import { createHub, type Hub } from "./ui/hub";
import { createPlayArea, type PlayArea } from "./ui/playArea";
import { createFamilyCorner, type FamilyCorner } from "./ui/familyCorner";
import { createChess, type Chess } from "./ui/chess";
import { createParentInbox, type ParentInbox } from "./ui/parentInbox";
import { createThemeToggle, type ThemeToggle } from "./ui/themeToggle";

/**
 * A handle to a running arcade instance, returned by {@link initArcade}. It
 * exposes just enough of the bootstrap's internals for integration/smoke tests
 * to observe the hub state machine and await the async game-module load without
 * reaching into module-private state. In the browser the return value is
 * unused — the Site simply boots and runs.
 */
export interface ArcadeController {
  /** The current pure hub view state (`hub` | `playing` | `family-corner` | `chess`). */
  readonly state: HubState;
  /** The live Hub view when on the selector, else `null`. */
  readonly hub: Hub | null;
  /** The live Play_Area hosting the Active_Game, else `null`. */
  readonly playArea: PlayArea | null;
  /** The live Family_Corner view when open, else `null`. */
  readonly familyCorner: FamilyCorner | null;
  /** The live Chess view when open, else `null`. */
  readonly chess: Chess | null;
  /**
   * The in-flight (or settled) promise for the current game-module load, or
   * `null` when showing the Hub. Awaiting it lets callers wait until the
   * selected game has been mounted into the Play_Area.
   */
  readonly loaded: Promise<void> | null;
  /** Tear down the arcade: destroy the active view and detach the layout. */
  destroy(): void;
}

/**
 * Initialize the arcade hub inside the given mount root (Requirements 1.1, 1.3,
 * 1.4, 1.5, 1.6). Builds the single-page layout scaffold, mounts the Hub, and
 * wires the hub state machine so selecting a game loads it as the Active_Game
 * and Back-to-Hub clears the Play_Area and returns to the selector.
 *
 * Extracted from the module top level so it can be driven directly (e.g. by an
 * integration test) against an arbitrary root; the module still auto-boots
 * against `#app` in the browser (see bottom of file).
 */
export function initArcade(root: HTMLElement): ArcadeController {
  // Build the single-page layout scaffold: a vertical stack (`.arcade-layout`)
  // holding a centered, max-width container (`.arcade-container`) into which the
  // active view (Hub or Play_Area) mounts (Requirements 8.1, 8.2).
  const layout = document.createElement("main");
  layout.className = "arcade-layout";

  // Persistent header bar, built once so it survives Hub <-> Play_Area view
  // swaps (the swaps only replace `container`'s contents). Hosts the theme
  // toggle, right-aligned, visible on both the Hub and Play views.
  const header = document.createElement("header");
  header.className = "arcade-header";
  const themeToggle: ThemeToggle = createThemeToggle();
  themeToggle.mount(header);
  layout.appendChild(header);

  const container = document.createElement("div");
  container.className = "arcade-container";
  layout.appendChild(container);
  root.appendChild(layout);

  // The pure hub view state; every transition goes through hubState.ts.
  let state: HubState = initialHubState;

  // Live view references. At most one of these is non-null at a time, mirroring
  // the hub state machine's `hub` | `playing` | `family-corner` views.
  let hub: Hub | null = null;
  let playArea: PlayArea | null = null;
  let familyCorner: FamilyCorner | null = null;
  let chess: Chess | null = null;
  // The current game-module load promise while playing (null on the Hub).
  let loaded: Promise<void> | null = null;

  /** Tear down the Hub view if mounted. */
  function teardownHub(): void {
    hub?.destroy();
    hub = null;
  }

  /**
   * Tear down the Play_Area if mounted. Destroying the PlayArea stops the
   * Active_Game (cancels its loop, removes input listeners) and clears the
   * Play_Area DOM (Requirement 1.5).
   */
  function teardownPlayArea(): void {
    playArea?.destroy();
    playArea = null;
    loaded = null;
  }

  /**
   * Tear down the Family_Corner view if mounted. Destroying it releases every
   * child factory (DoodleBoard, NoteComposer, SenderSelector, SendConfirmation),
   * detaches listeners, and clears the Family_Corner DOM.
   */
  function teardownFamilyCorner(): void {
    familyCorner?.destroy();
    familyCorner = null;
  }

  /**
   * Tear down the Chess view if mounted. Destroying it cancels any pending
   * computer move, detaches every listener, and clears the Chess DOM.
   */
  function teardownChess(): void {
    chess?.destroy();
    chess = null;
  }

  /** Render the Hub / Game_Selector as the sole view (Requirement 1.1). */
  function renderHub(): void {
    teardownPlayArea();
    teardownFamilyCorner();
    teardownChess();
    teardownHub();

    hub = createHub({
      onSelect: handleSelect,
      onOpenFamilyCorner: handleOpenFamilyCorner,
      onOpenChess: handleOpenChess,
    });
    hub.mount(container);
  }

  /**
   * Load the given game as the Active_Game into the Play_Area (Requirement 1.3).
   * Tears down the Hub view and any currently active game first, so selecting a
   * different game while one is playing replaces it (Requirement 1.6).
   */
  function renderGame(id: GameId): void {
    teardownHub();
    teardownFamilyCorner();
    teardownChess();
    teardownPlayArea();

    playArea = createPlayArea({
      gameId: id,
      onBackToHub: handleBackToHub,
    });
    playArea.mount(container);
    // Kick off the lazy game-module load; the PlayArea handles load failures
    // internally by surfacing a message and returning to the Hub. The promise
    // is retained so callers (tests) can await the mount.
    loaded = playArea.load();
  }

  /**
   * Mount the Family_Corner create-and-send view as the sole view
   * (Requirements 1.2, 1.3, 1.4, 1.5). Tears down any live Hub / Play_Area
   * first, so exactly one view occupies the shared `.arcade-container` at a
   * time (no leaks). The persistent header + theme toggle are untouched, so
   * Family Corner inherits the current light/dark theme and updates live with
   * the toggle via the shared `data-theme` tokens.
   */
  function renderFamilyCorner(): void {
    teardownHub();
    teardownPlayArea();
    teardownChess();
    teardownFamilyCorner();

    familyCorner = createFamilyCorner({ onBackToHub: handleBackToHub });
    familyCorner.mount(container);
  }

  /**
   * Mount the Chess play view as the sole view (parallel to
   * {@link renderFamilyCorner}). Tears down any live Hub / Play_Area /
   * Family_Corner first, so exactly one view occupies the shared
   * `.arcade-container` at a time (no leaks). The persistent header + theme
   * toggle are untouched, so Chess inherits the current light/dark theme.
   */
  function renderChess(): void {
    teardownHub();
    teardownPlayArea();
    teardownFamilyCorner();
    teardownChess();

    chess = createChess({ onBackToHub: handleBackToHub });
    chess.mount(container);
  }

  /**
   * Handle a Game_Selector selection: transition to `playing` and load the chosen
   * game as the Active_Game (Requirements 1.3, 1.6).
   */
  function handleSelect(id: GameId): void {
    state = selectGame(state, id);
    renderGame(id);
  }

  /**
   * Handle the Play_Area's Back-to-Hub control: transition to `hub`, destroy the
   * Active_Game, and re-render the Hub (Requirements 1.4, 1.5).
   */
  function handleBackToHub(): void {
    state = returnToHub(state);
    renderHub();
  }

  /**
   * Handle the Hub's Family Corner entry: transition to `family-corner` and
   * mount the create-and-send view (Requirement 1.2). Family Corner's own
   * Back-to-Hub control reuses {@link handleBackToHub}, returning via
   * `returnToHub` and re-rendering the Hub.
   */
  function handleOpenFamilyCorner(): void {
    state = openFamilyCorner(state);
    renderFamilyCorner();
  }

  /**
   * Handle the Hub's Chess entry: transition to `chess` and mount the play
   * view (parallel to {@link handleOpenFamilyCorner}). Chess's own Back-to-Hub
   * control reuses {@link handleBackToHub}, returning via `returnToHub` and
   * re-rendering the Hub.
   */
  function handleOpenChess(): void {
    state = openChess(state);
    renderChess();
  }

  // Initial render: the Site loads showing the Hub (Requirement 1.1).
  renderHub();

  return {
    get state() {
      return state;
    },
    get hub() {
      return hub;
    },
    get playArea() {
      return playArea;
    },
    get familyCorner() {
      return familyCorner;
    },
    get chess() {
      return chess;
    },
    get loaded() {
      return loaded;
    },
    destroy(): void {
      teardownPlayArea();
      teardownFamilyCorner();
      teardownChess();
      teardownHub();
      themeToggle.destroy();
      layout.remove();
    },
  };
}

/**
 * A handle to a running Parent_Inbox instance, returned by {@link bootInbox}.
 * Mirrors {@link ArcadeController} in spirit but only exposes the inbox view
 * and the settled `load()` promise so integration/smoke tests can await the
 * initial submission fetch without reaching into module-private state.
 */
export interface InboxController {
  /** The live Parent_Inbox view. */
  readonly inbox: ParentInbox;
  /**
   * The in-flight (or settled) promise for the initial submission-list load,
   * so callers (tests) can await the first render.
   */
  readonly loaded: Promise<void>;
  /** Tear down the inbox: destroy the view and detach the layout. */
  destroy(): void;
}

/**
 * Boot the Parent_Inbox as the sole view inside the given mount root
 * (Requirement 7.1). This is the `/inbox` route, handled outside the hub state
 * machine: the page is only reachable behind Cloudflare Access (an owner
 * deployment step), so no client-side auth logic is needed here — the Worker
 * and the edge gate enforce access, and this function simply renders the inbox.
 *
 * Mirrors {@link initArcade}: it builds the same `.arcade-layout` scaffold with
 * the persistent `.arcade-header` (hosting the theme toggle) and the centered
 * `.arcade-container`, then mounts {@link createParentInbox} into the container
 * and kicks off its async `load()`. It deliberately does NOT initialize the
 * arcade hub, so the inbox owns the page.
 */
export function bootInbox(root: HTMLElement): InboxController {
  // Same single-page scaffold as the arcade, so the inbox inherits the shared
  // layout, header, and theme toggle (light/dark via the `data-theme` tokens).
  const layout = document.createElement("main");
  layout.className = "arcade-layout";

  const header = document.createElement("header");
  header.className = "arcade-header";
  const themeToggle: ThemeToggle = createThemeToggle();
  themeToggle.mount(header);
  layout.appendChild(header);

  const container = document.createElement("div");
  container.className = "arcade-container";
  layout.appendChild(container);
  root.appendChild(layout);

  const inbox = createParentInbox();
  inbox.mount(container);
  // Kick off the initial submission-list fetch; the inbox surfaces its own
  // loading / empty / error states. The promise is retained so callers (tests)
  // can await the first render.
  const loaded = inbox.load();

  return {
    get inbox() {
      return inbox;
    },
    get loaded() {
      return loaded;
    },
    destroy(): void {
      inbox.destroy();
      themeToggle.destroy();
      layout.remove();
    },
  };
}

// Auto-boot in the browser: mount into the `#app` root defined in index.html.
// Guarded so importing this module in a non-browser / test context (where
// `#app` is absent) is a harmless no-op; the browser page always provides
// `#app`, so runtime behavior there is unchanged.
const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  // Resolve and apply the initial theme before rendering any chrome, so the
  // theme toggle and layout pick up the correct palette from the start. The
  // no-flash inline script in index.html has already applied it for first
  // paint; this re-confirms it via the shared resolve logic.
  initTheme();
  // The `/inbox` route is handled outside the hub machine: mount the
  // Parent_Inbox instead of the arcade (the page is only reachable behind
  // Cloudflare Access). Any other path boots the arcade hub as usual.
  if (window.location.pathname === "/inbox") {
    bootInbox(app);
  } else {
    initArcade(app);
  }
}
