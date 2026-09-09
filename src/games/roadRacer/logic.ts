// src/games/roadRacer/logic.ts
// Pure game logic for Road Racer — an original vertical lane-racer (the player
// races UP a three-lane highway, weaving through slower traffic as the road
// gets faster). This module contains NO canvas or DOM code; the renderer and
// the `GameDefinition` export live in `index.ts`. Everything here is a pure
// function of its inputs so the rules can be exercised directly under
// Vitest/fast-check (Requirements 4.3, 5.1).
//
// Purity strategy mirrors Serpent: randomness (traffic lanes, spawn gaps,
// car colours) comes from a tiny LCG whose seed lives in the state, and time
// advances in fixed sub-ticks accumulated from `dtMs`, so a huge frame delta
// can never tunnel the player through a traffic car.

// ---------------------------------------------------------------------------
// Field dimensions & tuning
// ---------------------------------------------------------------------------

/** Logical playfield width (units). */
export const FIELD_WIDTH = 300;
/** Logical playfield height (units). */
export const FIELD_HEIGHT = 500;
/** Number of highway lanes. */
export const LANES = 3;
/** Width of one lane in logical units. */
export const LANE_WIDTH = FIELD_WIDTH / LANES;

/** Player car (the Beetle) hitbox size in logical units. */
export const CAR_WIDTH = 44;
export const CAR_HEIGHT = 76;
/** Traffic car hitbox size in logical units. */
export const TRAFFIC_WIDTH = 44;
export const TRAFFIC_HEIGHT = 72;

/** The player car's fixed top edge (near the bottom of the field). */
export const PLAYER_Y = FIELD_HEIGHT - CAR_HEIGHT - 24;

/** Horizontal movement applied per `left`/`right` action. */
export const STEER_SPEED = 25;

/** Road speed at the start of a session (units per ms). */
export const START_SPEED = 0.12;
/** Road speed ceiling (units per ms). */
export const MAX_SPEED = 0.3;
/** Speed gained per ms of driving (reaches the cap after ~45 s). */
export const ACCELERATION = 0.000004;

/**
 * Traffic drives the same direction but slower, so it approaches the player
 * at this fraction of the current road speed.
 */
export const TRAFFIC_APPROACH = 0.55;

/** Road distance travelled before the FIRST traffic car appears (calm start). */
export const FIRST_SPAWN_DISTANCE = 260;
/** Bounds of the random road-distance gap between consecutive spawns. */
export const MIN_SPAWN_GAP = 180;
export const MAX_SPAWN_GAP = 320;

/** Points per 10 units of road distance. */
export const DISTANCE_PER_POINT = 10;
/** Bonus points for every traffic car overtaken (it exits the bottom edge). */
export const OVERTAKE_BONUS = 10;

/** Fixed simulation sub-tick (ms). */
export const TICK_MS = 16;

/** Collision forgiveness: both hitboxes shrink by this inset (arcade feel). */
export const HITBOX_INSET = 4;

/** Number of traffic paint schemes the renderer offers (kind = 0..N-1). */
export const TRAFFIC_KINDS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The player/simulation actions Road Racer understands: steering nudges. */
export type RoadRacerAction = "left" | "right";

/** One slower traffic car on the highway. */
export interface TrafficCar {
  /** Left edge in logical units. */
  x: number;
  /** Top edge in logical units (grows downward; spawns above the field). */
  y: number;
  /** The lane index (0..LANES-1) the car drives in. */
  lane: number;
  /** Paint-scheme index (0..TRAFFIC_KINDS-1) — cosmetic only. */
  kind: number;
}

/** The full runtime state advanced by `step`. Not persisted. */
export interface RoadRacerState {
  carX: number;          // player car left edge (PLAYER_Y is fixed)
  traffic: TrafficCar[]; // cars on (or just above) the field
  distance: number;      // road units travelled this session
  bonus: number;         // accumulated overtake bonus points
  speed: number;         // current road speed (units per ms)
  nextSpawnAt: number;   // road distance at which the next car spawns
  seed: number;          // PRNG seed for deterministic spawning
  tickTimerMs: number;   // accumulated time toward the next fixed tick
  over: boolean;         // Game_Over_State flag
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (same LCG family as Serpent's food placement)
// ---------------------------------------------------------------------------

/** A tiny linear-congruential generator; returns a value in [0, 1) and a new seed. */
function nextRandom(seed: number): { value: number; seed: number } {
  const next = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return { value: next / 0x7fffffff, seed: next };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** The x of a lane's centre line in logical units. */
export function laneCenter(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** Whether the player car and a traffic car overlap (inset AABBs). */
function collides(carX: number, traffic: TrafficCar): boolean {
  const inset = HITBOX_INSET;
  const aL = carX + inset;
  const aR = carX + CAR_WIDTH - inset;
  const aT = PLAYER_Y + inset;
  const aB = PLAYER_Y + CAR_HEIGHT - inset;
  const bL = traffic.x + inset;
  const bR = traffic.x + TRAFFIC_WIDTH - inset;
  const bT = traffic.y + inset;
  const bB = traffic.y + TRAFFIC_HEIGHT - inset;
  return aL < bR && bL < aR && aT < bB && bT < aB;
}

/** Clamp the player car's left edge to the paved field. */
function clampCarX(x: number): number {
  return Math.max(0, Math.min(FIELD_WIDTH - CAR_WIDTH, x));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * A new session: the Beetle centred in the middle lane, an empty road, Score 0
 * (Requirement 4.3), starting speed, and the first spawn a calm stretch ahead.
 */
export function createInitialState(): RoadRacerState {
  return {
    carX: (FIELD_WIDTH - CAR_WIDTH) / 2,
    traffic: [],
    distance: 0,
    bonus: 0,
    speed: START_SPEED,
    nextSpawnAt: FIRST_SPAWN_DISTANCE,
    seed: 424243,
    tickTimerMs: 0,
    over: false,
  };
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/**
 * Whether a lane's entrance (the strip just above the field) is clear enough
 * to admit a new car without overlapping one that just spawned.
 */
function entranceClear(traffic: readonly TrafficCar[], lane: number): boolean {
  return !traffic.some((t) => t.lane === lane && t.y < TRAFFIC_HEIGHT * 2);
}

/**
 * Spawn one traffic car in a randomly chosen lane (falling back to the next
 * lane when the pick's entrance is blocked; skipping the spawn entirely when
 * every lane is blocked, which keeps the road honestly passable), and schedule
 * the next spawn a random road-distance gap ahead. Pure: returns the new
 * traffic list, the advanced seed, and the next spawn distance.
 */
function spawnTraffic(
  state: RoadRacerState,
): { traffic: TrafficCar[]; seed: number; nextSpawnAt: number } {
  let { seed } = state;

  // Random lane, with up to LANES-1 fallback tries clockwise.
  const laneDraw = nextRandom(seed);
  seed = laneDraw.seed;
  let lane = Math.min(LANES - 1, Math.floor(laneDraw.value * LANES));
  let placed = false;
  for (let attempt = 0; attempt < LANES; attempt++) {
    if (entranceClear(state.traffic, lane)) {
      placed = true;
      break;
    }
    lane = (lane + 1) % LANES;
  }

  // Cosmetic paint scheme.
  const kindDraw = nextRandom(seed);
  seed = kindDraw.seed;
  const kind = Math.min(TRAFFIC_KINDS - 1, Math.floor(kindDraw.value * TRAFFIC_KINDS));

  // Next spawn after a random gap of road distance — density is spatial, so
  // higher speed means less reaction time but never an unfair wall.
  const gapDraw = nextRandom(seed);
  seed = gapDraw.seed;
  const gap = MIN_SPAWN_GAP + gapDraw.value * (MAX_SPAWN_GAP - MIN_SPAWN_GAP);
  const nextSpawnAt = state.distance + gap;

  if (!placed) {
    return { traffic: state.traffic, seed, nextSpawnAt };
  }

  const car: TrafficCar = {
    x: laneCenter(lane) - TRAFFIC_WIDTH / 2,
    y: -TRAFFIC_HEIGHT,
    lane,
    kind,
  };
  return { traffic: [...state.traffic, car], seed, nextSpawnAt };
}

// ---------------------------------------------------------------------------
// Fixed tick
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by exactly one fixed tick: ramp the speed, add road
 * distance, move traffic toward the player, spawn/cull cars (culling awards
 * the overtake bonus), and end the session on any collision. Pure.
 */
export function advanceTick(state: RoadRacerState): RoadRacerState {
  if (state.over) return state;

  const speed = Math.min(MAX_SPEED, state.speed + ACCELERATION * TICK_MS);
  const distance = state.distance + speed * TICK_MS;

  // Traffic approaches at the closing-speed fraction of the road speed.
  const approach = speed * TRAFFIC_APPROACH * TICK_MS;
  let traffic = state.traffic.map((t) => ({ ...t, y: t.y + approach }));

  // Cull cars that exit the bottom edge — each one was overtaken (Req 4.1).
  const remaining = traffic.filter((t) => t.y < FIELD_HEIGHT);
  const bonus = state.bonus + (traffic.length - remaining.length) * OVERTAKE_BONUS;
  traffic = remaining;

  // Spawn when the road has rolled far enough.
  let { seed, nextSpawnAt } = state;
  if (distance >= nextSpawnAt) {
    const spawned = spawnTraffic({ ...state, traffic, distance, seed, nextSpawnAt });
    traffic = spawned.traffic;
    seed = spawned.seed;
    nextSpawnAt = spawned.nextSpawnAt;
  }

  // Any contact ends the run (Requirement 5.1).
  const over = traffic.some((t) => collides(state.carX, t));

  return { ...state, speed, distance, traffic, bonus, seed, nextSpawnAt, over };
}

/**
 * Advance the state by applying the buffered steering `actions`, then running
 * one fixed tick per elapsed TICK_MS in `dtMs`. Pure. A game already in the
 * Game_Over_State is returned unchanged, so play is halted and the Score is
 * preserved (design Property 8).
 */
export function step(
  state: RoadRacerState,
  actions: readonly RoadRacerAction[],
  dtMs: number,
): RoadRacerState {
  if (state.over) return state;

  // Steering resolves before time advances (one nudge per buffered action).
  let carX = state.carX;
  for (const action of actions) {
    carX = clampCarX(carX + (action === "left" ? -STEER_SPEED : STEER_SPEED));
  }

  // A sideswipe (steering into a car) ends the run immediately.
  let current: RoadRacerState = { ...state, carX };
  if (current.traffic.some((t) => collides(carX, t))) {
    return { ...current, tickTimerMs: 0, over: true };
  }

  let timer = current.tickTimerMs + Math.max(0, dtMs);
  while (timer >= TICK_MS) {
    timer -= TICK_MS;
    current = advanceTick(current);
    if (current.over) {
      return { ...current, tickTimerMs: 0 };
    }
  }
  return { ...current, tickTimerMs: timer };
}

/** The end condition: the Beetle hit another car (Requirement 5.1). */
export function isGameOver(state: RoadRacerState): boolean {
  return state.over;
}

/**
 * The current Score (Requirement 4.1): distance driven plus overtake bonuses.
 * Both components only ever grow, so the Score is monotonic (Property 7).
 */
export function getScore(state: RoadRacerState): number {
  return Math.floor(state.distance / DISTANCE_PER_POINT) + state.bonus;
}
