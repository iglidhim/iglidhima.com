// Integration test for the Chess hub entry + view routing.
//
// Parallels test/familyRouting.dom.test.ts: it exercises the wiring in
// src/main.ts, that activating the Hub's Chess entry drives the hub state
// machine into the `chess` view and mounts the play experience, and that
// Back-to-Hub returns to the selector. src/ui/hub.test.ts and
// src/ui/chess.test.ts cover the entry rendering and the view behaviour.
//
// Runs under jsdom (via the *.dom.test.ts glob in vite.config.ts). Like the
// existing routing tests we import `initArcade` directly and drive it against
// our own root, so the module's `#app` auto-boot is a harmless no-op.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initArcade, type ArcadeController } from "../src/main";

describe("Chess routing via initArcade", () => {
  let root: HTMLDivElement;
  let controller: ArcadeController;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    controller = initArcade(root);
  });

  afterEach(() => {
    controller.destroy();
    root.remove();
  });

  it("renders a Chess entry on the Hub at boot", () => {
    expect(controller.state).toEqual({ view: "hub" });
    expect(root.querySelector(".hub__chess")).not.toBeNull();
    // No Chess view is mounted until the entry is activated.
    expect(root.querySelector(".chess")).toBeNull();
    expect(controller.chess).toBeNull();
  });

  it("activating the entry transitions to the chess view and mounts it", () => {
    root.querySelector<HTMLButtonElement>(".hub__chess")!.click();

    expect(controller.state).toEqual({ view: "chess" });
    expect(controller.chess).not.toBeNull();

    // The Hub is torn down and the Chess view is mounted in its place.
    expect(root.querySelector(".hub")).toBeNull();
    expect(root.querySelector(".chess")).not.toBeNull();
    // A single view occupies the shared container (no Play_Area / Family leak).
    expect(root.querySelector(".play-area")).toBeNull();
    expect(root.querySelector(".family-corner")).toBeNull();
    // The board rendered with 64 squares.
    expect(root.querySelectorAll(".chess__square")).toHaveLength(64);
  });

  it("returns to the Hub from the Chess view's Back-to-Hub control", () => {
    root.querySelector<HTMLButtonElement>(".hub__chess")!.click();
    expect(root.querySelector(".chess")).not.toBeNull();

    const back = root.querySelector<HTMLButtonElement>(".chess__back");
    expect(back).not.toBeNull();
    back!.click();

    expect(controller.state).toEqual({ view: "hub" });
    expect(controller.chess).toBeNull();
    expect(root.querySelector(".chess")).toBeNull();
    expect(root.querySelector(".hub")).not.toBeNull();
    expect(root.querySelector(".hub__chess")).not.toBeNull();
  });
});
