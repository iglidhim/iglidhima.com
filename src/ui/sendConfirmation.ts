// src/ui/sendConfirmation.ts
// Send_Confirmation chrome component — the playful celebration shown after a
// Submission is accepted (Requirements 5.1, 5.2, 5.3, 5.4, 5.5).
//
// This is a framework-free vanilla-TS factory matching the other ui/ components
// (doodleBoard, noteComposer, themeToggle, …): it builds its own DOM using the
// `.send-confirmation` / `.send-confirmation__confetti` CSS classes (styling is
// added in task 18.1) and exposes a small { element, mount, destroy } handle
// plus a `celebrate()` method the FamilyCorner view awaits before resetting the
// create experience.
//
// Design notes:
//   - `celebrate()` runs two independent effects — a self-contained confetti
//     canvas animation and a short confirmation sound — each wrapped in its own
//     try/catch so a failure of one never affects the other or the caller:
//       * Blocked/failing audio still shows the confetti (Requirement 5.4).
//       * A confetti failure still resolves the promise without an error, so
//         the UI can reset cleanly (Requirement 5.5).
//   - The promise resolves only once the celebration completes, giving the
//     caller a precise moment to reset the create-and-send experience
//     (Requirement 5.3).
//   - There is no third-party dependency: the confetti is a small
//     requestAnimationFrame canvas animation and the sound is a short
//     programmatically generated Web Audio tone, both bounded in time. This
//     keeps the bundle dependency-free, matching the rest of the app.
//   - Both effects are injectable (`playSound`, `runConfetti`) so tests can
//     stub a throwing audio/confetti and confirm the graceful fallbacks, and so
//     the duration stays bounded and fake-timer / short-duration friendly.

/** Plays a short confirmation sound. May throw/reject if audio is blocked. */
export type PlaySound = () => void | Promise<void>;

/**
 * Runs the confetti animation on the given canvas for (at most) `durationMs`
 * and resolves when it finishes. May throw/reject if rendering is unavailable.
 */
export type RunConfetti = (
  canvas: HTMLCanvasElement,
  durationMs: number,
) => void | Promise<void>;

/** A mounted Send_Confirmation. Returned by {@link createSendConfirmation}. */
export interface SendConfirmation {
  /** The overlay root element (also exposed for testing/positioning). */
  readonly element: HTMLElement;
  /** Attach the overlay to a parent node. */
  mount(parent: HTMLElement): void;
  /** Cancel any running celebration, detach, and remove from the DOM. */
  destroy(): void;
  /**
   * Play the confetti + sound celebration and resolve when it completes.
   * Never rejects: audio and confetti failures degrade gracefully
   * (Requirements 5.1, 5.2, 5.3, 5.4, 5.5).
   */
  celebrate(): Promise<void>;
}

/** Options for {@link createSendConfirmation}. */
export interface CreateSendConfirmationOptions {
  /** Bounded celebration duration in ms (defaults to ~1.2s). */
  durationMs?: number;
  /** Injectable sound effect; defaults to a short Web Audio tone. */
  playSound?: PlaySound;
  /** Injectable confetti effect; defaults to a canvas rAF animation. */
  runConfetti?: RunConfetti;
}

/** Default bounded celebration length: long enough to feel fun, short enough
 *  not to hold up the reset (Requirement 5.3). */
const DEFAULT_DURATION_MS = 1200;

/** Confetti piece colors — bright and kid-friendly. */
const CONFETTI_COLORS = [
  "#e6194b",
  "#f58231",
  "#ffe119",
  "#3cb44b",
  "#4363d8",
  "#911eb4",
  "#f032e6",
];

/**
 * Default confirmation sound: a short two-note Web Audio chime generated on the
 * fly (no bundled asset needed). Wrapped so a missing/blocked AudioContext
 * surfaces as a thrown error the caller's try/catch swallows (Requirement 5.4).
 */
function defaultPlaySound(): void {
  const AudioCtor: typeof AudioContext | undefined =
    typeof window !== "undefined"
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  if (AudioCtor === undefined) {
    // No Web Audio support: treat as "audio unavailable" — the confetti still
    // runs because sound and confetti are independent (Requirement 5.4).
    throw new Error("Web Audio is unavailable");
  }

  const ctx = new AudioCtor();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  gain.connect(ctx.destination);

  // A cheerful rising two-note chime.
  const notes: Array<{ freq: number; at: number }> = [
    { freq: 660, at: 0 },
    { freq: 990, at: 0.14 },
  ];
  for (const { freq, at } of notes) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + at);
    osc.connect(gain);
    osc.start(now + at);
    osc.stop(now + at + 0.2);
  }
}

/** A single confetti particle in the default animation. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
}

/**
 * Default confetti: a self-contained requestAnimationFrame canvas animation
 * bounded to `durationMs`. Resolves when the duration elapses (or immediately
 * if a 2D context / rAF is unavailable, e.g. under jsdom). Registers its cancel
 * handle through `onStart` so {@link createSendConfirmation}'s `destroy()` can
 * stop an in-flight animation.
 */
function makeDefaultRunConfetti(
  onStart: (cancel: () => void) => void,
): RunConfetti {
  return (canvas, durationMs) =>
    new Promise<void>((resolve) => {
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        ctx = null;
      }

      const raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : null;
      const caf =
        typeof cancelAnimationFrame === "function"
          ? cancelAnimationFrame
          : null;

      // Without a drawing context or rAF there is nothing to animate; the
      // celebration is still considered complete (Requirement 5.5 style
      // graceful degradation).
      if (ctx === null || raf === null) {
        resolve();
        return;
      }

      const width = canvas.width || 640;
      const height = canvas.height || 480;

      const particleCount = 80;
      const particles: Particle[] = [];
      for (let i = 0; i < particleCount; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: -Math.random() * height,
          vx: (Math.random() - 0.5) * 2,
          vy: 2 + Math.random() * 4,
          size: 6 + Math.random() * 8,
          color:
            CONFETTI_COLORS[
              Math.floor(Math.random() * CONFETTI_COLORS.length)
            ] ?? "#f032e6",
          rotation: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.3,
        });
      }

      const start =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      let frameId = 0;
      let settled = false;

      function finish(): void {
        if (settled) return;
        settled = true;
        if (caf !== null && frameId !== 0) {
          caf(frameId);
        }
        // Leave the canvas clear so no confetti lingers after the reset.
        try {
          ctx?.clearRect(0, 0, width, height);
        } catch {
          // Ignore: clearing is best-effort.
        }
        resolve();
      }

      // Expose cancellation so destroy() can stop mid-flight.
      onStart(finish);

      function frame(nowArg?: number): void {
        if (settled) return;
        const now =
          typeof nowArg === "number"
            ? nowArg
            : typeof performance !== "undefined" &&
                typeof performance.now === "function"
              ? performance.now()
              : Date.now();
        const elapsed = now - start;

        const context = ctx as CanvasRenderingContext2D;
        context.clearRect(0, 0, width, height);
        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.spin;
          context.save();
          context.translate(p.x, p.y);
          context.rotate(p.rotation);
          context.fillStyle = p.color;
          context.fillRect(-p.size / 2, -p.size / 2, p.size, p.size / 2);
          context.restore();
        }

        if (elapsed >= durationMs) {
          finish();
          return;
        }
        frameId = (raf as typeof requestAnimationFrame)(frame);
      }

      frameId = (raf as typeof requestAnimationFrame)(frame);
    });
}

/**
 * Create a Send_Confirmation overlay.
 *
 * The overlay is hidden until {@link SendConfirmation.celebrate} is called; it
 * then shows the confetti canvas, plays the sound, and hides itself again once
 * the bounded celebration completes.
 */
export function createSendConfirmation(
  options: CreateSendConfirmationOptions = {},
): SendConfirmation {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;

  // Holds the active confetti cancel handle while a celebration is running.
  let cancelConfetti: (() => void) | null = null;

  const playSound: PlaySound = options.playSound ?? defaultPlaySound;
  const runConfetti: RunConfetti =
    options.runConfetti ??
    makeDefaultRunConfetti((cancel) => {
      cancelConfetti = cancel;
    });

  // --- DOM -----------------------------------------------------------------
  const root = document.createElement("div");
  root.className = "send-confirmation";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  // Hidden until a celebration runs; keeps it out of the layout/AT tree.
  root.hidden = true;

  const canvas = document.createElement("canvas");
  canvas.className = "send-confirmation__confetti";
  canvas.setAttribute("aria-hidden", "true");
  // Give the backing store a sensible default size; CSS scales it to cover.
  canvas.width =
    typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 640;
  canvas.height =
    typeof window !== "undefined" && window.innerHeight
      ? window.innerHeight
      : 480;

  root.appendChild(canvas);

  function show(): void {
    root.hidden = false;
  }

  function hide(): void {
    root.hidden = true;
  }

  return {
    element: root,

    mount(parent: HTMLElement): void {
      parent.appendChild(root);
    },

    destroy(): void {
      // Stop any in-flight confetti so no frame fires after teardown.
      if (cancelConfetti !== null) {
        try {
          cancelConfetti();
        } catch {
          // Ignore: cancellation is best-effort.
        }
        cancelConfetti = null;
      }
      root.replaceChildren();
      root.remove();
    },

    async celebrate(): Promise<void> {
      show();

      // Sound and confetti are independent: each is guarded so one failing
      // never blocks the other or rejects the returned promise.
      // Sound first, in its own try/catch, so blocked audio still lets the
      // confetti run (Requirement 5.4).
      try {
        await playSound();
      } catch {
        // Audio blocked/failed: continue to the confetti (Requirement 5.4).
      }

      // Confetti, independently guarded: a failure here still resolves the
      // celebration without surfacing an error (Requirement 5.5).
      try {
        await runConfetti(canvas, durationMs);
      } catch {
        // Confetti failed to render: complete silently (Requirement 5.5).
      } finally {
        cancelConfetti = null;
        hide();
      }
      // Resolving here signals the caller to reset the create experience
      // (Requirement 5.3).
    },
  };
}
