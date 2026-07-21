// Render tests for the Hub / Game_Selector chrome component (task 9.4).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// _Requirements: 1.1, 1.2, 9.1, 9.2, 9.5_
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHub, type HubVoteDeps } from "./hub";
import { GAME_REGISTRY } from "../games/registry";
import type { GameId } from "../engine/types";
import { zeroVotes, type AllVotes } from "../lib/votes";

/**
 * Build a set of injectable vote deps that never touch the network or real
 * localStorage, so the hub render tests are deterministic. `fetchAllVotes`
 * defaults to all-zero counts; individual tests override as needed.
 */
function stubVoteDeps(overrides: Partial<HubVoteDeps> = {}): HubVoteDeps {
  const voted = new Set<string>();
  const key = (id: GameId, reaction: string): string => `${id}:${reaction}`;
  return {
    fetchAllVotes: async (): Promise<AllVotes> => zeroVotes(),
    sendVote: async () => ({ like: 0, love: 0 }),
    hasVoted: (id, reaction) => voted.has(key(id, reaction)),
    setVoted: (id, reaction, isVoted) => {
      if (isVoted) voted.add(key(id, reaction));
      else voted.delete(key(id, reaction));
    },
    ...overrides,
  };
}

describe("createHub", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders using the shared hub CSS classes with a title", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    expect(host.querySelector(".hub")).not.toBeNull();
    expect(host.querySelector(".hub__title")).not.toBeNull();
    expect(host.querySelector(".hub-grid")).not.toBeNull();
    // The heading identifies the arcade.
    expect(host.querySelector(".hub__title")?.textContent).toBe("Arcade");
  });

  it("renders four game entries with names and control labels (Req 1.1, 1.2)", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLElement>(".hub-card");
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
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    const renderedNames = Array.from(
      host.querySelectorAll(".hub-card__name"),
    ).map((el) => el.textContent);
    expect(renderedNames).toEqual(["Tetris", "Snake", "Pac-Man", "Brick Buster"]);

    // The accessible name of each play button is built from the display name, so
    // it announces "Play <name>. ..." for assistive tech (Requirement 9.5).
    const tetrisPlay = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="block-cascade"] .hub-card__play',
    );
    expect(tetrisPlay?.getAttribute("aria-label")).toMatch(/^Play Tetris\. /);
  });

  it("renders a distinct decorative SVG icon inside each play button (aria-hidden)", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLElement>(".hub-card");
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

  it("wraps each entry in a non-interactive .hub-card container with a native play button (Req 9.1, 9.2, 9.5)", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLElement>(".hub-card");
    expect(cards).toHaveLength(4);
    cards.forEach((card) => {
      // The container is not itself a button (avoids nested interactive controls).
      expect(card.tagName).not.toBe("BUTTON");
      const playBtn = card.querySelector<HTMLButtonElement>(".hub-card__play");
      expect(playBtn).not.toBeNull();
      expect(playBtn?.tagName).toBe("BUTTON");
      expect(playBtn?.type).toBe("button");
      expect(playBtn?.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    });
  });

  it("invokes onSelect with the correct GameId when a play button is activated (Req 1.3)", () => {
    const selected: GameId[] = [];
    const hub = createHub({
      onSelect: (id) => selected.push(id),
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    const serpentPlay = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="serpent"] .hub-card__play',
    );
    expect(serpentPlay).not.toBeNull();
    serpentPlay?.click();

    expect(selected).toEqual(["serpent"]);
  });

  it("wires each play button to its own GameId", () => {
    const selected: GameId[] = [];
    const hub = createHub({
      onSelect: (id) => selected.push(id),
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    host
      .querySelectorAll<HTMLButtonElement>(".hub-card__play")
      .forEach((btn) => btn.click());

    expect(selected).toEqual(Object.keys(GAME_REGISTRY) as GameId[]);
  });

  it("removes itself from the DOM on destroy", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);
    expect(host.querySelector(".hub")).not.toBeNull();

    hub.destroy();
    expect(host.querySelector(".hub")).toBeNull();
  });
});

describe("createHub — Family Corner entry", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders a Family Corner entry distinct from the game cards when the callback is provided (Req 1.1)", () => {
    const hub = createHub({
      onSelect: () => {},
      onOpenFamilyCorner: () => {},
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    const entry = host.querySelector<HTMLButtonElement>(".hub__family-corner");
    expect(entry).not.toBeNull();
    // It is a native button, keyboard-operable, with an accessible name.
    expect(entry?.tagName).toBe("BUTTON");
    expect(entry?.type).toBe("button");
    expect(entry?.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    // It is not one of the four game cards.
    expect(entry?.classList.contains("hub-card")).toBe(false);
    expect(host.querySelectorAll(".hub-card")).toHaveLength(4);
  });

  it("omits the Family Corner entry when no callback is provided", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    expect(host.querySelector(".hub__family-corner")).toBeNull();
  });

  it("invokes onOpenFamilyCorner when the entry is activated (Req 1.2)", () => {
    let opened = 0;
    const hub = createHub({
      onSelect: () => {},
      onOpenFamilyCorner: () => {
        opened += 1;
      },
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    host.querySelector<HTMLButtonElement>(".hub__family-corner")?.click();
    expect(opened).toBe(1);
  });

  it("activating the Family Corner entry does not launch a game", () => {
    const selected: GameId[] = [];
    const hub = createHub({
      onSelect: (id) => selected.push(id),
      onOpenFamilyCorner: () => {},
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    host.querySelector<HTMLButtonElement>(".hub__family-corner")?.click();
    expect(selected).toEqual([]);
  });

  it("cleans up the entry's listener on destroy", () => {
    let opened = 0;
    const hub = createHub({
      onSelect: () => {},
      onOpenFamilyCorner: () => {
        opened += 1;
      },
      votes: stubVoteDeps(),
    });
    hub.mount(host);
    const entry = host.querySelector<HTMLButtonElement>(".hub__family-corner");

    hub.destroy();
    // The button is detached and its handler released.
    entry?.click();
    expect(opened).toBe(0);
  });
});

describe("createHub — Chess entry", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders a Chess entry distinct from the game cards when the callback is provided", () => {
    const hub = createHub({
      onSelect: () => {},
      onOpenChess: () => {},
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    const entry = host.querySelector<HTMLButtonElement>(".hub__chess");
    expect(entry).not.toBeNull();
    expect(entry?.tagName).toBe("BUTTON");
    expect(entry?.type).toBe("button");
    expect(entry?.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    // It is not one of the four game cards.
    expect(entry?.classList.contains("hub-card")).toBe(false);
    expect(host.querySelectorAll(".hub-card")).toHaveLength(4);
  });

  it("omits the Chess entry when no callback is provided", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    expect(host.querySelector(".hub__chess")).toBeNull();
  });

  it("invokes onOpenChess when the entry is activated", () => {
    let opened = 0;
    const hub = createHub({
      onSelect: () => {},
      onOpenChess: () => {
        opened += 1;
      },
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    host.querySelector<HTMLButtonElement>(".hub__chess")?.click();
    expect(opened).toBe(1);
  });

  it("activating the Chess entry does not launch a game", () => {
    const selected: GameId[] = [];
    const hub = createHub({
      onSelect: (id) => selected.push(id),
      onOpenChess: () => {},
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    host.querySelector<HTMLButtonElement>(".hub__chess")?.click();
    expect(selected).toEqual([]);
  });

  it("cleans up the entry's listener on destroy", () => {
    let opened = 0;
    const hub = createHub({
      onSelect: () => {},
      onOpenChess: () => {
        opened += 1;
      },
      votes: stubVoteDeps(),
    });
    hub.mount(host);
    const entry = host.querySelector<HTMLButtonElement>(".hub__chess");

    hub.destroy();
    entry?.click();
    expect(opened).toBe(0);
  });
});

describe("createHub — vote bar", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders two vote buttons per card with the right data-reaction and aria-labels", () => {
    const hub = createHub({ onSelect: () => {}, votes: stubVoteDeps() });
    hub.mount(host);

    const cards = host.querySelectorAll<HTMLElement>(".hub-card");
    expect(cards).toHaveLength(4);

    cards.forEach((card) => {
      const bar = card.querySelector(".hub-card__votes");
      expect(bar).not.toBeNull();
      const voteBtns = card.querySelectorAll<HTMLButtonElement>(".vote-btn");
      expect(voteBtns).toHaveLength(2);
      expect(voteBtns[0]?.dataset.reaction).toBe("like");
      expect(voteBtns[1]?.dataset.reaction).toBe("love");

      const id = card.dataset.gameId as GameId;
      const name = GAME_REGISTRY[id].name;
      expect(voteBtns[0]?.getAttribute("aria-label")).toBe(`Like ${name}`);
      expect(voteBtns[1]?.getAttribute("aria-label")).toBe(`Love ${name}`);
      // Vote buttons are siblings of the play button, never nested inside it.
      const play = card.querySelector(".hub-card__play");
      expect(play?.querySelector(".vote-btn")).toBeNull();
    });
  });

  it("reflects the visitor's stored pressed state via aria-pressed", () => {
    const votes = stubVoteDeps({
      hasVoted: (id, reaction) => id === "serpent" && reaction === "like",
    });
    const hub = createHub({ onSelect: () => {}, votes });
    hub.mount(host);

    const serpentLike = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="serpent"] .vote-btn[data-reaction="like"]',
    );
    const serpentLove = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="serpent"] .vote-btn[data-reaction="love"]',
    );
    expect(serpentLike?.getAttribute("aria-pressed")).toBe("true");
    expect(serpentLove?.getAttribute("aria-pressed")).toBe("false");
  });

  it("populates counts from fetchAllVotes without blocking initial render", async () => {
    const all = zeroVotes();
    all["serpent"] = { like: 7, love: 3 };
    let resolveFetch: (v: AllVotes) => void = () => {};
    const fetchPromise = new Promise<AllVotes>((r) => {
      resolveFetch = r;
    });
    const votes = stubVoteDeps({ fetchAllVotes: () => fetchPromise });

    const hub = createHub({ onSelect: () => {}, votes });
    hub.mount(host);

    // Rendered immediately with zero counts before the fetch resolves.
    const serpentLikeCount = host.querySelector(
      '.hub-card[data-game-id="serpent"] .vote-btn[data-reaction="like"] .vote-btn__count',
    );
    expect(serpentLikeCount?.textContent).toBe("0");

    resolveFetch(all);
    await fetchPromise;
    await Promise.resolve();

    expect(serpentLikeCount?.textContent).toBe("7");
    const serpentLoveCount = host.querySelector(
      '.hub-card[data-game-id="serpent"] .vote-btn[data-reaction="love"] .vote-btn__count',
    );
    expect(serpentLoveCount?.textContent).toBe("3");
  });

  it("optimistically toggles aria-pressed and the displayed count on click", async () => {
    const sendVote = vi.fn(async () => ({ like: 1, love: 0 }));
    const votes = stubVoteDeps({ sendVote });
    const hub = createHub({ onSelect: () => {}, votes });
    hub.mount(host);

    const likeBtn = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="block-cascade"] .vote-btn[data-reaction="like"]',
    );
    const countEl = likeBtn?.querySelector(".vote-btn__count");
    expect(likeBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(countEl?.textContent).toBe("0");

    likeBtn?.click();

    // Optimistic update is synchronous, before the POST resolves.
    expect(likeBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(countEl?.textContent).toBe("1");
    expect(sendVote).toHaveBeenCalledWith("block-cascade", "like", 1);

    // After the POST resolves, the count reconciles to the server value.
    await Promise.resolve();
    await Promise.resolve();
    expect(countEl?.textContent).toBe("1");
  });

  it("reverts the optimistic update when the vote request fails", async () => {
    const sendVote = vi.fn(async () => null);
    const votes = stubVoteDeps({ sendVote });
    const hub = createHub({ onSelect: () => {}, votes });
    hub.mount(host);

    const loveBtn = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="serpent"] .vote-btn[data-reaction="love"]',
    );
    const countEl = loveBtn?.querySelector(".vote-btn__count");

    loveBtn?.click();
    // Optimistic: pressed + count bumped.
    expect(loveBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(countEl?.textContent).toBe("1");

    // Await the failed POST; the change reverts.
    await Promise.resolve();
    await Promise.resolve();
    expect(loveBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(countEl?.textContent).toBe("0");
  });

  it("a vote click does not launch the game", () => {
    const selected: GameId[] = [];
    const hub = createHub({
      onSelect: (id) => selected.push(id),
      votes: stubVoteDeps(),
    });
    hub.mount(host);

    const likeBtn = host.querySelector<HTMLButtonElement>(
      '.hub-card[data-game-id="serpent"] .vote-btn[data-reaction="like"]',
    );
    likeBtn?.click();
    expect(selected).toEqual([]);
  });
});
