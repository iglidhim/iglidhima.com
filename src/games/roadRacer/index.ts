// src/games/roadRacer/index.ts
// Road Racer — the canvas renderer plus the assembled `GameDefinition` that
// binds the pure logic (logic.ts) to the shared engine contract. This is the
// only module in the game that touches the canvas; the rules stay pure and
// separately testable (design: "clean split between pure logic and rendering").
//
// The player car is drawn as a top-down classic Beetle: bright red rounded
// body, chrome bumpers, whitewall tires, round headlights, and a chrome roof
// rack — a pixel homage to the real car that inspired the game.

import type { GameDefinition, Viewport } from "../../engine/types";
import {
  CAR_HEIGHT,
  CAR_WIDTH,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LANES,
  LANE_WIDTH,
  PLAYER_Y,
  STEER_SPEED,
  TRAFFIC_HEIGHT,
  TRAFFIC_WIDTH,
  createInitialState,
  getScore,
  isGameOver,
  step,
  type RoadRacerAction,
  type RoadRacerState,
  type TrafficCar,
} from "./logic";

// ---------------------------------------------------------------------------
// Palette (road furniture mirrors the site's neon-arcade tokens; the Beetle
// keeps its real-world bright red + chrome + whitewall scheme)
// ---------------------------------------------------------------------------

const COLOR_ASPHALT = "#141828"; // road surface
const COLOR_EDGE = "#e8e8f0"; // solid shoulder lines
const COLOR_DASH = "#39406b"; // lane divider dashes
const COLOR_OVERLAY = "rgba(10, 14, 26, 0.6)"; // game-over dim

// The Beetle.
const BEETLE_RED = "#e5342b";
const BEETLE_RED_DEEP = "#a31f17"; // outline / shading
const BEETLE_ROOF = "#ff5347"; // roof highlight
const CHROME = "#cfd6e4"; // bumpers + roof rack
const GLASS = "#1c2436"; // windshield / rear window
const HEADLIGHT = "#fff7cf";
const TIRE = "#10131f";
const WHITEWALL = "#f4f4f4";

/** Traffic paint schemes by `kind` (cosmetic), from the site's neon palette. */
const TRAFFIC_SCHEMES: readonly { body: string; trim: string }[] = [
  { body: "#35e0f2", trim: "#1791a4" }, // cyan
  { body: "#ffe14d", trim: "#b3941c" }, // yellow
  { body: "#c77dff", trim: "#8a48c4" }, // violet
];

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** Fill a rounded rect, falling back to a plain rect where unsupported. */
function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

/** Draw one wheel; the player's get a whitewall stripe on the outer edge. */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerSide: "left" | "right",
  whitewall: boolean,
): void {
  const w = 8;
  const h = 16;
  ctx.fillStyle = TIRE;
  rrect(ctx, x, y, w, h, 2.5);
  if (whitewall) {
    ctx.fillStyle = WHITEWALL;
    const stripeX = outerSide === "left" ? x + 1 : x + w - 3;
    rrect(ctx, stripeX, y + 2, 2, h - 4, 1);
  }
}

/**
 * The star of the show: a top-down classic Beetle at (x, y), CAR_WIDTH×CAR_HEIGHT
 * logical units, nose pointing up. Layers: whitewall wheels, chrome bumpers,
 * rounded red body, headlights, glass, roof with chrome roof rack.
 */
function drawBeetle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Wheels poke out beyond the body on both sides.
  drawWheel(ctx, x - 2, y + 8, "left", true);
  drawWheel(ctx, x + CAR_WIDTH - 6, y + 8, "right", true);
  drawWheel(ctx, x - 2, y + CAR_HEIGHT - 24, "left", true);
  drawWheel(ctx, x + CAR_WIDTH - 6, y + CAR_HEIGHT - 24, "right", true);

  // Chrome bumpers front and rear.
  ctx.fillStyle = CHROME;
  rrect(ctx, x + 4, y - 2, CAR_WIDTH - 8, 6, 3);
  rrect(ctx, x + 4, y + CAR_HEIGHT - 4, CAR_WIDTH - 8, 6, 3);

  // Rounded red body — the Beetle's capsule silhouette.
  ctx.fillStyle = BEETLE_RED;
  rrect(ctx, x + 2, y + 2, CAR_WIDTH - 4, CAR_HEIGHT - 4, 18);
  ctx.strokeStyle = BEETLE_RED_DEEP;
  ctx.lineWidth = 2;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, CAR_WIDTH - 4, CAR_HEIGHT - 4, 18);
    ctx.stroke();
  }

  // Round headlights at the nose.
  ctx.fillStyle = HEADLIGHT;
  ctx.beginPath();
  ctx.arc(x + 11, y + 9, 3.5, 0, Math.PI * 2);
  ctx.arc(x + CAR_WIDTH - 11, y + 9, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Windshield.
  ctx.fillStyle = GLASS;
  rrect(ctx, x + 7, y + 18, CAR_WIDTH - 14, 10, 3);

  // Roof, slightly lighter for the curved-highlight look.
  ctx.fillStyle = BEETLE_ROOF;
  rrect(ctx, x + 8, y + 30, CAR_WIDTH - 16, 22, 6);

  // Chrome roof rack: two side rails + three cross slats.
  ctx.fillStyle = CHROME;
  rrect(ctx, x + 9, y + 31, 1.5, 20, 0.75);
  rrect(ctx, x + CAR_WIDTH - 10.5, y + 31, 1.5, 20, 0.75);
  rrect(ctx, x + 9, y + 34, CAR_WIDTH - 18, 1.5, 0.75);
  rrect(ctx, x + 9, y + 40, CAR_WIDTH - 18, 1.5, 0.75);
  rrect(ctx, x + 9, y + 46, CAR_WIDTH - 18, 1.5, 0.75);

  // Rear window.
  ctx.fillStyle = GLASS;
  rrect(ctx, x + 8, y + 54, CAR_WIDTH - 16, 8, 3);
}

/** A slower boxy sedan in one of the neon paint schemes, nose up. */
function drawTrafficCar(ctx: CanvasRenderingContext2D, car: TrafficCar): void {
  const scheme = TRAFFIC_SCHEMES[car.kind] ?? TRAFFIC_SCHEMES[0]!;
  const { x, y } = car;

  drawWheel(ctx, x - 2, y + 8, "left", false);
  drawWheel(ctx, x + TRAFFIC_WIDTH - 6, y + 8, "right", false);
  drawWheel(ctx, x - 2, y + TRAFFIC_HEIGHT - 22, "left", false);
  drawWheel(ctx, x + TRAFFIC_WIDTH - 6, y + TRAFFIC_HEIGHT - 22, "right", false);

  ctx.fillStyle = scheme.body;
  rrect(ctx, x + 2, y + 2, TRAFFIC_WIDTH - 4, TRAFFIC_HEIGHT - 4, 8);

  // Cabin block in the trim shade, with glass bands fore and aft.
  ctx.fillStyle = scheme.trim;
  rrect(ctx, x + 8, y + 22, TRAFFIC_WIDTH - 16, 28, 4);
  ctx.fillStyle = GLASS;
  rrect(ctx, x + 8, y + 16, TRAFFIC_WIDTH - 16, 7, 3);
  rrect(ctx, x + 8, y + 50, TRAFFIC_WIDTH - 16, 6, 3);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Lane-divider dash pattern (logical units). */
const DASH_LENGTH = 28;
const DASH_PERIOD = 48;

/**
 * Render the highway and cars, scaling the FIELD_WIDTH×FIELD_HEIGHT logical
 * field to fill the fitted viewport. Pure with respect to state — only paints,
 * never mutates. The lane dashes scroll with the travelled distance so the
 * road visibly races downward beneath the Beetle.
 */
function render(
  ctx: CanvasRenderingContext2D,
  state: RoadRacerState,
  viewport: Viewport,
): void {
  const { width, height } = viewport;
  if (width <= 0 || height <= 0) return;

  ctx.save();
  ctx.scale(width / FIELD_WIDTH, height / FIELD_HEIGHT);

  // Asphalt.
  ctx.fillStyle = COLOR_ASPHALT;
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  // Solid shoulder lines.
  ctx.fillStyle = COLOR_EDGE;
  ctx.fillRect(3, 0, 2, FIELD_HEIGHT);
  ctx.fillRect(FIELD_WIDTH - 5, 0, 2, FIELD_HEIGHT);

  // Lane dividers: dashes scrolling downward with the travelled distance.
  ctx.fillStyle = COLOR_DASH;
  const offset = state.distance % DASH_PERIOD;
  for (let lane = 1; lane < LANES; lane++) {
    const x = lane * LANE_WIDTH - 1.5;
    for (let y = offset - DASH_PERIOD; y < FIELD_HEIGHT; y += DASH_PERIOD) {
      ctx.fillRect(x, y, 3, DASH_LENGTH);
    }
  }

  // Traffic first, then the Beetle on top (it is the closest car).
  for (const car of state.traffic) {
    drawTrafficCar(ctx, car);
  }
  drawBeetle(ctx, state.carX, PLAYER_Y);

  // Dim the field when the run is over.
  if (state.over) {
    ctx.fillStyle = COLOR_OVERLAY;
    ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

/**
 * The assembled Road Racer game: pure logic from `logic.ts` plus the canvas
 * renderer above, wired to the shared engine contract (Requirements 1.2, 3.1,
 * 3.2, 3.4, 3.5). Left/Right arrows and A/D steer; those keys are declared as
 * scroll keys so gameplay never scrolls the page while running (Requirement
 * 3.5). Touch controls provide left/right steering (Requirement 3.2).
 */
export const roadRacer: GameDefinition<RoadRacerState, RoadRacerAction> = {
  id: "road-racer",
  name: "Road Racer",
  instructions:
    "Race the little red Beetle up the highway. Steer with the Left/Right " +
    "arrow keys or A/D — or drag on a touch screen — to weave through " +
    "traffic. The road keeps getting faster, and every car you pass is a " +
    "bonus.",
  aspectRatio: FIELD_WIDTH / FIELD_HEIGHT,

  // Keyboard → action (Requirement 3.1).
  keyMap: {
    ArrowLeft: "left",
    ArrowRight: "right",
    a: "left",
    d: "right",
    A: "left",
    D: "right",
  },

  // Keys whose default browser scrolling is prevented while playing (Req 3.5).
  scrollKeys: ["ArrowLeft", "ArrowRight"],

  // On-screen controls for touch devices (Requirement 3.2).
  touchControls: [
    { action: "left", label: "Steer left", position: "left" },
    { action: "right", label: "Steer right", position: "right" },
  ],

  // On-canvas gestures (Req 3.2, 8.4): dragging horizontally steers the
  // Beetle so it tracks the finger — each action nudges STEER_SPEED logical
  // units, so the drag step is that same distance as a fraction of the
  // field's display width.
  gestures: {
    left: { action: "left", stepFraction: STEER_SPEED / FIELD_WIDTH },
    right: { action: "right", stepFraction: STEER_SPEED / FIELD_WIDTH },
  },

  createInitialState,
  step,
  isGameOver,
  getScore,
  render,
};

export default roadRacer;
