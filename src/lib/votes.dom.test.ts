// src/lib/votes.dom.test.ts
// Tests for the localStorage-backed per-browser vote-state helpers. The `.dom`
// suffix opts this file into the jsdom environment (see vite.config.ts), so
// `localStorage` is available.
import { describe, it, expect, beforeEach } from "vitest";
import { hasVoted, setVoted, VOTE_KEY } from "./votes";

describe("vote-state helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("VOTE_KEY namespaces by game id and reaction", () => {
    expect(VOTE_KEY("serpent", "like")).toBe(
      "iglidhima.arcade.vote.serpent.like",
    );
    expect(VOTE_KEY("block-cascade", "love")).toBe(
      "iglidhima.arcade.vote.block-cascade.love",
    );
  });

  it("hasVoted is false when nothing is stored", () => {
    expect(hasVoted("serpent", "like")).toBe(false);
  });

  it("setVoted(true) then hasVoted returns true", () => {
    setVoted("serpent", "like", true);
    expect(hasVoted("serpent", "like")).toBe(true);
    // Stored as the literal "1".
    expect(localStorage.getItem(VOTE_KEY("serpent", "like"))).toBe("1");
  });

  it("setVoted(false) clears a previously stored vote", () => {
    setVoted("maze-muncher", "love", true);
    expect(hasVoted("maze-muncher", "love")).toBe(true);
    setVoted("maze-muncher", "love", false);
    expect(hasVoted("maze-muncher", "love")).toBe(false);
    expect(localStorage.getItem(VOTE_KEY("maze-muncher", "love"))).toBeNull();
  });

  it("keeps like and love flags independent per game", () => {
    setVoted("brick-buster", "like", true);
    expect(hasVoted("brick-buster", "like")).toBe(true);
    expect(hasVoted("brick-buster", "love")).toBe(false);
  });

  it("supports the chess target like any other votable id", () => {
    expect(VOTE_KEY("chess", "love")).toBe("iglidhima.arcade.vote.chess.love");
    expect(hasVoted("chess", "love")).toBe(false);
    setVoted("chess", "love", true);
    expect(hasVoted("chess", "love")).toBe(true);
    expect(hasVoted("chess", "like")).toBe(false);
    setVoted("chess", "love", false);
    expect(hasVoted("chess", "love")).toBe(false);
  });

  it("treats any non-'1' stored value as not voted", () => {
    localStorage.setItem(VOTE_KEY("serpent", "like"), "yes");
    expect(hasVoted("serpent", "like")).toBe(false);
  });
});
