// Render tests for the LifecycleControls chrome component (task 9.2).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// _Requirements: 1.4, 2.1, 5.3, 9.2, 9.5_
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLifecycleControls } from "./controls";
import type { GameStatus } from "../engine/types";

/** Return the labels of the currently visible (non-hidden) lifecycle buttons. */
function visibleLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>(".controls .btn"))
    .filter((btn) => !btn.hidden)
    .map((btn) => btn.textContent ?? "");
}

describe("createLifecycleControls", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders all six controls as native keyboard-operable buttons (Req 9.2)", () => {
    const lc = createLifecycleControls();
    lc.mount(host);

    const buttons = host.querySelectorAll<HTMLButtonElement>(".controls .btn");
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.type).toBe("button");
    }
  });

  it("gives every control a descriptive accessible label (Req 9.5)", () => {
    const lc = createLifecycleControls();
    lc.mount(host);

    for (const button of host.querySelectorAll<HTMLButtonElement>(".controls .btn")) {
      const label = button.getAttribute("aria-label");
      expect(label).toBeTruthy();
      // Visible text and accessible name agree.
      expect(button.textContent).toBe(label);
    }
  });

  it("shows only Start (and Back to Hub) in idle (Req 2.1)", () => {
    const lc = createLifecycleControls();
    lc.mount(host);

    // Defaults to idle on creation.
    expect(visibleLabels(host).sort()).toEqual(["Back to Hub", "Start"]);
  });

  it("shows Pause and Restart while running", () => {
    const lc = createLifecycleControls();
    lc.mount(host);
    lc.setStatus("running");

    expect(visibleLabels(host).sort()).toEqual(["Back to Hub", "Pause", "Restart"]);
  });

  it("shows Resume and Restart while paused", () => {
    const lc = createLifecycleControls();
    lc.mount(host);
    lc.setStatus("paused");

    expect(visibleLabels(host).sort()).toEqual(["Back to Hub", "Restart", "Resume"]);
  });

  it("shows Play Again only in gameover (Req 5.3)", () => {
    const lc = createLifecycleControls();
    lc.mount(host);

    const playAgain = host.querySelector<HTMLButtonElement>('[data-control="playAgain"]');
    expect(playAgain).not.toBeNull();

    // Not visible in any non-gameover status.
    for (const status of ["idle", "running", "paused"] as GameStatus[]) {
      lc.setStatus(status);
      expect(playAgain?.hidden).toBe(true);
    }

    lc.setStatus("gameover");
    expect(playAgain?.hidden).toBe(false);
    expect(visibleLabels(host).sort()).toEqual(["Back to Hub", "Play Again"]);
  });

  it("always exposes Back to Hub while a game is active (Req 1.4)", () => {
    const lc = createLifecycleControls();
    lc.mount(host);

    const back = host.querySelector<HTMLButtonElement>('[data-control="back"]');
    for (const status of ["idle", "running", "paused", "gameover"] as GameStatus[]) {
      lc.setStatus(status);
      expect(back?.hidden).toBe(false);
    }
  });

  it("invokes the matching callback when a button is clicked", () => {
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onRestart = vi.fn();
    const onPlayAgain = vi.fn();
    const onBackToHub = vi.fn();

    const lc = createLifecycleControls({
      onStart,
      onPause,
      onResume,
      onRestart,
      onPlayAgain,
      onBackToHub,
    });
    lc.mount(host);

    host.querySelector<HTMLButtonElement>('[data-control="start"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="pause"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="resume"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="restart"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="playAgain"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="back"]')?.click();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onBackToHub).toHaveBeenCalledTimes(1);
  });

  it("routes lifecycle buttons to a supplied GameInstance", () => {
    const instance = {
      status: "idle" as GameStatus,
      score: 0,
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      restart: vi.fn(),
      destroy: vi.fn(),
    };
    const onBackToHub = vi.fn();

    const lc = createLifecycleControls({ instance, onBackToHub });
    lc.mount(host);

    host.querySelector<HTMLButtonElement>('[data-control="start"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="pause"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="resume"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="restart"]')?.click();
    // Play-Again maps to restart per the lifecycle machine.
    host.querySelector<HTMLButtonElement>('[data-control="playAgain"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-control="back"]')?.click();

    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(instance.pause).toHaveBeenCalledTimes(1);
    expect(instance.resume).toHaveBeenCalledTimes(1);
    // restart directly + play-again -> restart = 2
    expect(instance.restart).toHaveBeenCalledTimes(2);
    expect(onBackToHub).toHaveBeenCalledTimes(1);
  });

  it("removes itself from the DOM on destroy", () => {
    const lc = createLifecycleControls();
    lc.mount(host);
    expect(host.querySelector(".controls")).not.toBeNull();

    lc.destroy();
    expect(host.querySelector(".controls")).toBeNull();
  });
});
