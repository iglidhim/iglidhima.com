// src/games/registry.ts
// The static game registry: the single source the Game_Selector (hub) and the
// PlayArea read from to discover the available games and lazily load them
// (Requirements 1.1, 1.2).
//
// Each entry pairs a `GameId` with the game's display `name` and a `loader()`
// that dynamically `import()`s the game module on demand, returning its
// `GameDefinition`. Using dynamic `import()` keeps each game in its own bundle
// chunk so only the selected game's code is fetched when it is played.

import type { GameDefinition, GameId } from "../engine/types";

/** A game definition with its concrete state/action types erased for the registry. */
type AnyGameDefinition = GameDefinition<unknown, string>;

export const GAME_REGISTRY: Record<
  GameId,
  {
    name: string;
    loader: () => Promise<AnyGameDefinition>;
  }
> = {
  "block-cascade": {
    name: "Block Cascade",
    loader: async () =>
      (await import("./blockCascade/index")).blockCascade as unknown as AnyGameDefinition,
  },
  serpent: {
    name: "Serpent",
    loader: async () =>
      (await import("./serpent/index")).serpent as unknown as AnyGameDefinition,
  },
  "maze-muncher": {
    name: "Maze Muncher",
    loader: async () =>
      (await import("./mazeMuncher/index")).mazeMuncher as unknown as AnyGameDefinition,
  },
  "brick-buster": {
    name: "Brick Buster",
    loader: async () =>
      (await import("./brickBuster/index")).brickBuster as unknown as AnyGameDefinition,
  },
};
