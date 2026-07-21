// src/ui/gameIcons.ts
// Decorative per-game icons for the Hub / Game_Selector cards.
//
// Each Game gets a distinct, tasteful inline SVG built from simple geometric
// shapes so it stays crisp at any size and matches the neon-on-dark theme. The
// markup uses `currentColor` for its fills/strokes, so each card can tint its
// icon via CSS (`.hub-card[data-game-id="…"] .hub-card__icon`) without touching
// this file. Sizing is left to CSS (the `viewBox` is a small 0 0 48 48 box with
// no hardcoded pixel width/height).
//
// The icons are purely decorative: every <svg> carries `aria-hidden="true"` and
// `focusable="false"`, because the card's own `aria-label` (e.g. "Play Serpent.
// Arrow keys to steer") already names the game for assistive technology. The
// icon must not duplicate that name.

import type { VoteTargetId } from "../lib/votes";

/**
 * Inline SVG markup keyed by {@link VoteTargetId} (the four games plus Chess).
 * Kept as a small, readable record so adding or tweaking a motif is a one-line
 * edit. Each string is a self-contained decorative `<svg>` using `currentColor`
 * and a shared 48x48 `viewBox`.
 */
export const GAME_ICONS: Record<VoteTargetId, string> = {
  // Stacked blocks / T-tetromino motif.
  "block-cascade": `
    <svg class="hub-card__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="currentColor">
      <rect x="6" y="8" width="12" height="12" rx="2" />
      <rect x="20" y="8" width="12" height="12" rx="2" />
      <rect x="34" y="8" width="12" height="12" rx="2" />
      <rect x="20" y="22" width="12" height="12" rx="2" />
      <rect x="20" y="36" width="12" height="6" rx="2" opacity="0.55" />
      <rect x="6" y="22" width="12" height="6" rx="2" opacity="0.55" />
      <rect x="34" y="22" width="12" height="6" rx="2" opacity="0.55" />
    </svg>`,

  // Segmented, coiled snake motif with a head and tongue.
  serpent: `
    <svg class="hub-card__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none"
         stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 36 q8 -12 16 -8 q10 4 8 -8 q-2 -8 8 -8" />
      <circle cx="40" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M40 10 l4 -3 M40 14 l4 3" stroke-width="2.5" />
    </svg>`,

  // Pellet-muncher wedge chasing a trail of pellets.
  "maze-muncher": `
    <svg class="hub-card__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M22 24 L40 13.6 A20 20 0 1 1 40 34.4 Z" />
      <circle cx="44" cy="24" r="2.4" opacity="0.85" />
      <circle cx="10" cy="10" r="2" opacity="0.5" />
    </svg>`,

  // Brick wall with a bouncing ball and paddle.
  "brick-buster": `
    <svg class="hub-card__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="currentColor">
      <rect x="5" y="7" width="12" height="7" rx="1.5" />
      <rect x="19" y="7" width="12" height="7" rx="1.5" />
      <rect x="33" y="7" width="10" height="7" rx="1.5" />
      <rect x="5" y="16" width="8" height="7" rx="1.5" opacity="0.75" />
      <rect x="15" y="16" width="12" height="7" rx="1.5" opacity="0.75" />
      <rect x="29" y="16" width="14" height="7" rx="1.5" opacity="0.75" />
      <circle cx="31" cy="31" r="3.2" />
      <rect x="14" y="39" width="20" height="4.5" rx="2.25" />
    </svg>`,

  // Chess: a knight silhouette built from a single simple shape, atop a base
  // plinth, with a small punched-out eye (via opacity) for character.
  chess: `
    <svg class="hub-card__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M18 40 c0 -6 1 -9 4 -12 c-3 1 -6 1 -8 -1 l3 -4 c-2 0 -3 -1 -3 -3
               c0 -4 4 -7 9 -9 l-1 -3 a1.6 1.6 0 0 1 3 -1 l1 2 c6 1 11 6 11 15
               v16 Z" />
      <circle cx="19.5" cy="17.5" r="1.3" opacity="0.35" />
      <rect x="13" y="41" width="24" height="4" rx="1.5" opacity="0.85" />
    </svg>`,
};

/**
 * Build the decorative icon element for a game as a real, namespaced SVG node.
 *
 * Parsing through an HTML `<template>` yields correctly-namespaced SVG DOM in
 * both the browser and jsdom, so the returned element can be appended straight
 * into a `.hub-card`.
 */
export function createGameIcon(id: VoteTargetId): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = GAME_ICONS[id].trim();
  return template.content.firstElementChild as SVGSVGElement;
}
