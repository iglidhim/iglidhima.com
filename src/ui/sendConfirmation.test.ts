// Render/behaviour tests for the SendConfirmation chrome component.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document and window. The confetti and sound effects are injected
// as stubs/spies so the tests stay fast, deterministic, and can force each
// effect to throw to exercise the graceful fallbacks.
//
// _Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5_
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSendConfirmation,
  type PlaySound,
  type RunConfetti,
} from "./sendConfirmation";

describe("createSendConfirmation", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders a hidden overlay with a confetti canvas using the send-confirmation classes", () => {
    const confirmation = createSendConfirmation({
      playSound: () => {},
      runConfetti: () => {},
    });
    confirmation.mount(host);

    const root = host.querySelector<HTMLElement>(".send-confirmation");
    expect(root).not.toBeNull();
    // Hidden until a celebration runs.
    expect(root?.hidden).toBe(true);

    const canvas = host.querySelector<HTMLCanvasElement>(
      ".send-confirmation__confetti",
    );
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName).toBe("CANVAS");
  });

  it("triggers confetti and sound on success and resolves (Requirements 5.1, 5.2, 5.3)", async () => {
    const playSound = vi.fn<PlaySound>(() => {});
    const runConfetti = vi.fn<RunConfetti>(() => {});

    const confirmation = createSendConfirmation({ playSound, runConfetti });
    confirmation.mount(host);

    await confirmation.celebrate();

    // Both effects fired on success (Requirements 5.1 confetti, 5.2 sound).
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(runConfetti).toHaveBeenCalledTimes(1);
    // The confetti runs against the component's canvas with a bounded duration.
    const canvas = host.querySelector<HTMLCanvasElement>(
      ".send-confirmation__confetti",
    )!;
    expect(runConfetti.mock.calls[0]?.[0]).toBe(canvas);
    expect(typeof runConfetti.mock.calls[0]?.[1]).toBe("number");
  });

  it("still shows confetti when audio throws (Requirement 5.4)", async () => {
    const playSound = vi.fn<PlaySound>(() => {
      throw new Error("audio blocked");
    });
    const runConfetti = vi.fn<RunConfetti>(() => {});

    const confirmation = createSendConfirmation({ playSound, runConfetti });
    confirmation.mount(host);

    // Blocked audio must not reject the celebration...
    await expect(confirmation.celebrate()).resolves.toBeUndefined();
    // ...and the confetti still runs (Requirement 5.4).
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(runConfetti).toHaveBeenCalledTimes(1);
  });

  it("still shows confetti when audio rejects asynchronously (Requirement 5.4)", async () => {
    const playSound = vi.fn<PlaySound>(() => Promise.reject(new Error("blocked")));
    const runConfetti = vi.fn<RunConfetti>(() => {});

    const confirmation = createSendConfirmation({ playSound, runConfetti });
    confirmation.mount(host);

    await expect(confirmation.celebrate()).resolves.toBeUndefined();
    expect(runConfetti).toHaveBeenCalledTimes(1);
  });

  it("resolves without error when confetti throws (Requirement 5.5)", async () => {
    const playSound = vi.fn<PlaySound>(() => {});
    const runConfetti = vi.fn<RunConfetti>(() => {
      throw new Error("no 2d context");
    });

    const confirmation = createSendConfirmation({ playSound, runConfetti });
    confirmation.mount(host);

    // A confetti failure still resolves the celebration cleanly.
    await expect(confirmation.celebrate()).resolves.toBeUndefined();
    // The sound still played independently.
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it("resolves without error when confetti rejects asynchronously (Requirement 5.5)", async () => {
    const playSound = vi.fn<PlaySound>(() => {});
    const runConfetti = vi.fn<RunConfetti>(() =>
      Promise.reject(new Error("render failed")),
    );

    const confirmation = createSendConfirmation({ playSound, runConfetti });
    confirmation.mount(host);

    await expect(confirmation.celebrate()).resolves.toBeUndefined();
  });

  it("resolves so the caller can reset, and hides the overlay after celebrating (Requirement 5.3)", async () => {
    let resolveConfetti: (() => void) | undefined;
    const runConfetti = vi.fn<RunConfetti>(
      () =>
        new Promise<void>((resolve) => {
          resolveConfetti = resolve;
        }),
    );

    const confirmation = createSendConfirmation({
      playSound: () => {},
      runConfetti,
    });
    confirmation.mount(host);

    const root = host.querySelector<HTMLElement>(".send-confirmation")!;

    let resolved = false;
    const done = confirmation.celebrate().then(() => {
      resolved = true;
    });

    // While the confetti is running the overlay is visible and not yet resolved.
    await Promise.resolve();
    expect(root.hidden).toBe(false);
    expect(resolved).toBe(false);

    // Completing the confetti resolves the celebration (caller reset point).
    resolveConfetti?.();
    await done;
    expect(resolved).toBe(true);
    // The overlay hides itself once the celebration completes.
    expect(root.hidden).toBe(true);
  });

  it("uses a bounded default duration and resolves with the default (canvas) confetti under jsdom", async () => {
    // With no injected confetti, the default animation runs. Under jsdom the 2D
    // context is unavailable, so it degrades gracefully and still resolves.
    const confirmation = createSendConfirmation({
      durationMs: 20,
      playSound: () => {},
    });
    confirmation.mount(host);

    await expect(confirmation.celebrate()).resolves.toBeUndefined();
  });

  it("removes itself and cancels any in-flight confetti on destroy", async () => {
    const runConfetti = vi.fn<RunConfetti>(
      () => new Promise<void>(() => {}), // never resolves on its own
    );
    const confirmation = createSendConfirmation({
      playSound: () => {},
      runConfetti,
    });
    confirmation.mount(host);

    expect(host.querySelector(".send-confirmation")).not.toBeNull();

    // Start a celebration that would otherwise hang.
    void confirmation.celebrate();
    await Promise.resolve();

    confirmation.destroy();
    expect(host.querySelector(".send-confirmation")).toBeNull();
  });
});
