// Integration test for Family Corner hub entry + view routing (task 13.4).
//
// Task 13.1 already covers the Hub's Family Corner entry rendering and its
// callback in src/ui/hub.test.ts. This file exercises the *wiring* in
// src/main.ts: that selecting the entry actually drives the hub state machine
// into the `family-corner` view and mounts the create-and-send experience with
// no login prompt, that Back-to-Hub returns to the selector, and that the
// `/inbox` bootstrap (`bootInbox`) mounts and loads the Parent_Inbox.
//
// Runs under jsdom (via the *.dom.test.ts glob in vite.config.ts). Like the
// existing bootstrap smoke test we import `initArcade` / `bootInbox` directly
// and drive them against our own root, so the module's `#app` auto-boot is a
// harmless no-op (jsdom has no `#app`) and there is no double-boot.
//
// _Requirements: 1.1, 1.2, 4.3, 7.1_
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initArcade,
  bootInbox,
  type ArcadeController,
  type InboxController,
} from "../src/main";

describe("Family Corner routing via initArcade", () => {
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

  it("renders a Family Corner entry on the Hub at boot (Req 1.1)", () => {
    // The app boots on the Hub, which surfaces the Family Corner entry.
    expect(controller.state).toEqual({ view: "hub" });
    expect(root.querySelector(".hub")).not.toBeNull();
    expect(root.querySelector(".hub__family-corner")).not.toBeNull();
    // No Family Corner view is mounted until the entry is activated.
    expect(root.querySelector(".family-corner")).toBeNull();
    expect(controller.familyCorner).toBeNull();
  });

  it("activating the entry transitions to the family-corner view and mounts it (Req 1.1, 1.2)", () => {
    root.querySelector<HTMLButtonElement>(".hub__family-corner")!.click();

    // The pure state machine is now in the family-corner view.
    expect(controller.state).toEqual({ view: "family-corner" });
    expect(controller.familyCorner).not.toBeNull();

    // The Hub is torn down and the Family Corner view is mounted in its place.
    expect(root.querySelector(".hub")).toBeNull();
    expect(root.querySelector(".family-corner")).not.toBeNull();
    // A single view occupies the shared container (no leak of the Play_Area).
    expect(root.querySelector(".play-area")).toBeNull();
  });

  it("presents no login or credential prompt in Family Corner (Req 4.3)", () => {
    root.querySelector<HTMLButtonElement>(".hub__family-corner")!.click();

    const fc = root.querySelector(".family-corner")!;
    expect(fc).not.toBeNull();

    // Identity is chosen by two friendly toggles (Kian, Eloise), not a login.
    const options = fc.querySelectorAll<HTMLButtonElement>(
      ".sender-selector__option",
    );
    expect(options).toHaveLength(2);
    expect(Array.from(options).map((o) => o.textContent)).toEqual([
      "Kian",
      "Eloise",
    ]);

    // There is no credential entry of any kind: no password field, and in fact
    // no <input> elements at all (the note is a <textarea>).
    expect(fc.querySelector('input[type="password"]')).toBeNull();
    expect(fc.querySelectorAll("input")).toHaveLength(0);
    expect(root.querySelector('input[type="password"]')).toBeNull();
  });

  it("returns to the Hub from Family Corner's Back-to-Hub control (Req 1.2)", () => {
    root.querySelector<HTMLButtonElement>(".hub__family-corner")!.click();
    expect(root.querySelector(".family-corner")).not.toBeNull();

    const back = root.querySelector<HTMLButtonElement>(".family-corner__back");
    expect(back).not.toBeNull();
    back!.click();

    // Back on the Hub: the Family Corner view is gone and the selector is shown.
    expect(controller.state).toEqual({ view: "hub" });
    expect(controller.familyCorner).toBeNull();
    expect(root.querySelector(".family-corner")).toBeNull();
    expect(root.querySelector(".hub")).not.toBeNull();
    expect(root.querySelector(".hub__family-corner")).not.toBeNull();
  });
});

describe("Parent Inbox bootstrap via bootInbox", () => {
  let root: HTMLDivElement;
  let controller: InboxController;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    controller?.destroy();
    root?.remove();
    globalThis.fetch = originalFetch;
  });

  it("mounts the Parent_Inbox and renders the empty state after load (Req 7.1)", async () => {
    // Stub the list fetch so bootInbox's default fetcher resolves to an empty
    // list; bootInbox is called directly (path-independent — no reliance on
    // window.location).
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ submissions: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    root = document.createElement("div");
    document.body.appendChild(root);
    controller = bootInbox(root);

    // The inbox is mounted into the root immediately.
    expect(root.querySelector(".inbox")).not.toBeNull();

    // Await the initial submission-list load, then assert it rendered a
    // terminal state (empty-state here), not the loading placeholder.
    await controller.loaded;
    expect(root.querySelector(".inbox__empty")).not.toBeNull();
    expect(root.querySelector(".inbox__loading")).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("mounts the Parent_Inbox and renders the submission list after load (Req 7.1)", async () => {
    // Two submissions returned newest-first from the list endpoint.
    const submissions = [
      {
        id: "b",
        sender: "Eloise",
        created_at: 2000,
        has_note: true,
        note_text: "hi dad",
        has_image: false,
      },
      {
        id: "a",
        sender: "Kian",
        created_at: 1000,
        has_note: false,
        note_text: null,
        has_image: true,
      },
    ];
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ submissions }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    root = document.createElement("div");
    document.body.appendChild(root);
    controller = bootInbox(root);

    expect(root.querySelector(".inbox")).not.toBeNull();

    await controller.loaded;

    // The list rendered (not the empty state), one item per submission.
    expect(root.querySelector(".inbox__list")).not.toBeNull();
    expect(root.querySelector(".inbox__empty")).toBeNull();
    expect(root.querySelectorAll(".inbox__item")).toHaveLength(2);
  });
});
