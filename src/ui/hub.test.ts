// Render tests for the Hub / Game_Selector chrome component (task 9.4).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// _Requirements: 1.1, 1.2, 9.1, 9.2, 9.5_
import { describe, it, expect, beforeEach } from "vitest";
import { createHub } from "./hub";
import { GAME_REGISTRY } from "../games/registry";
import type { GameId } from "../engine/types";

describe("createHub", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders using the shared hub CSS classes with a title", () => {
    const hub = createHub({ onSelect: () => {} });
    hub.mount(host);

    expect(host.querySelector(".hub")).not.toBeNull();
    expect(host.querySelector(".hub__title")).not.toBeNull();
    expect(host.querySelector(".hub-grid")).not.toBeNull();
    // The heading identifies the arcade.
    expect(host.querySelector(".hub__title")?.textContent).toBe("Arcade");
  });

  it("renders four game entries with names and control labels (Req 1.1, 1.2)", () => {
    const hub = createHub({ onSelect: () => {} });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLButtonElement>(".hub-card");
    expect(cards).toHaveLength(4);

    const expectedNames = (Object.keys(GAME_REGISTRY) as GameId[]).map(
      (id) => GAME_REGISTRY[id].name,
    );
    const renderedNames = Array.from(
      host.querySelectorAll(".hub-card__name"),
    ).map((el) => el.textContent);
    expect(renderedNames).toEqual(expectedNames);

    // Every entry carries a non-empty control label.
    const labels = host.querySelectorAll(".hub-card__label");
    expect(labels).toHaveLength(4);
    labels.forEach((el) => expect(el.textContent?.trim().length).toBeGreaterThan(0));
  });

  it("renders the current display names (Tetris, Snake, Pac-Man, Brick Buster)", () => {
    const hub = createHub({ onSelect: () => {} });
    hub.mount(host);

    const renderedNames = Array.from(
      host.querySelectorAll(".hub-card__name"),
    ).map((el) => el.textContent);
    expect(renderedNames).toEqual(["Tetris", "Snake", "Pac-Man", "Brick Buster"]);

    // The accessible name of each card is built from the display name, so the
    // card announces "Play <name>. ..." for assistive tech (Requirement 9.5).
    const tetrisCard = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="block-cascade"]',
    );
    expect(tetrisCard?.getAttribute("aria-label")).toMatch(/^Play Tetris\. /);
  });

  it("renders a distinct decorative SVG icon inside each card (aria-hidden)", () => {
    const hub = createHub({ onSelect: () => {} });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLButtonElement>(".hub-card");
    expect(cards).toHaveLength(4);

    cards.forEach((card) => {
      const icon = card.querySelector("svg");
      expect(icon).not.toBeNull();
      if (!icon) return;
      // Decorative: hidden from assistive tech and not focusable.
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("focusable")).toBe("false");
      expect(icon.classList.contains("hub-card__icon")).toBe(true);
      // The icon is rendered above the game name within the card.
      const name = card.querySelector(".hub-card__name");
      expect(name).not.toBeNull();
      expect(
        icon.compareDocumentPosition(name as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("renders each entry as a native, accessible-labelled <button> (Req 9.1, 9.2, 9.5)", () => {
    const hub = createHub({ onSelect: () => {} });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLButtonElement>("button.hub-card");
    expect(cards).toHaveLength(4);
    cards.forEach((btn) => {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.type).toBe("button");
      expect(btn.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    });
  });

  it("invokes onSelect with the correct GameId when an entry is activated (Req 1.3)", () => {
    const selected: GameId[] = [];
    const hub = createHub({ onSelect: (id) => selected.push(id) });
    hub.mount(host);

    const serpentCard = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="serpent"]',
    );
    expect(serpentCard).not.toBeNull();
    serpentCard?.click();

    expect(selected).toEqual(["serpent"]);
  });

  it("wires each entry to its own GameId", () => {
    const selected: GameId[] = [];
    const hub = createHub({ onSelect: (id) => selected.push(id) });
    hub.mount(host);

    host
      .querySelectorAll<HTMLButtonElement>(".hub-card")
      .forEach((btn) => btn.click());

    expect(selected).toEqual(Object.keys(GAME_REGISTRY) as GameId[]);
  });

  it("removes itself from the DOM on destroy", () => {
    const hub = createHub({ onSelect: () => {} });
    hub.mount(host);
    expect(host.querySelector(".hub")).not.toBeNull();

    hub.destroy();
    expect(host.querySelector(".hub")).toBeNull();
  });
});
