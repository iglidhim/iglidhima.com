// Unit tests for input resolution and scroll prevention (task 6.2).
//
// resolveAction is pure; the scroll-prevention and buffering assertions dispatch
// real DOM KeyboardEvents, so this suite runs under jsdom (via the *.dom.test.ts
// glob in vite.config.ts).
// _Requirements: 3.1, 3.5_
import { describe, it, expect } from "vitest";
import { InputManager, resolveAction, detectTouchCapable } from "../src/engine/input";
import type { TouchControlSpec } from "../src/engine/types";

type Action = "left" | "right" | "up" | "down" | "drop";

const keyMap: Readonly<Record<string, Action>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  " ": "drop",
};

const scrollKeys = ["ArrowUp", "ArrowDown", " "] as const;

const touchControls: readonly TouchControlSpec[] = [
  { action: "left", label: "Move left", position: "left" },
  { action: "right", label: "Move right", position: "right" },
  { action: "drop", label: "Drop", position: "primary" },
];

describe("resolveAction", () => {
  it("maps each configured key to its expected action", () => {
    expect(resolveAction(keyMap, "ArrowLeft")).toBe("left");
    expect(resolveAction(keyMap, "ArrowRight")).toBe("right");
    expect(resolveAction(keyMap, "ArrowUp")).toBe("up");
    expect(resolveAction(keyMap, "ArrowDown")).toBe("down");
    expect(resolveAction(keyMap, " ")).toBe("drop");
  });

  it("returns null for keys the game does not map", () => {
    expect(resolveAction(keyMap, "a")).toBeNull();
    expect(resolveAction(keyMap, "Enter")).toBeNull();
    expect(resolveAction(keyMap, "Escape")).toBeNull();
    expect(resolveAction(keyMap, "")).toBeNull();
  });
});

describe("InputManager keyboard handling", () => {
  it("buffers mapped actions on keydown while running and drains them once", () => {
    const target = new EventTarget();
    const input = new InputManager<Action>({ keyMap, scrollKeys, keyboardTarget: target });
    input.attach();
    input.setRunning(true);

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "q" })); // unmapped, ignored

    expect(input.drainActions()).toEqual(["left", "right"]);
    // Draining clears the buffer.
    expect(input.drainActions()).toEqual([]);

    input.destroy();
  });

  it("ignores input when the game is not running", () => {
    const target = new EventTarget();
    const input = new InputManager<Action>({ keyMap, scrollKeys, keyboardTarget: target });
    input.attach();
    // running defaults to false

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));

    expect(input.drainActions()).toEqual([]);
    input.destroy();
  });

  it("prevents default scrolling for scrollKeys while running", () => {
    const target = new EventTarget();
    const input = new InputManager<Action>({ keyMap, scrollKeys, keyboardTarget: target });
    input.attach();
    input.setRunning(true);

    const scrollEvent = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    target.dispatchEvent(scrollEvent);
    expect(scrollEvent.defaultPrevented).toBe(true);

    const spaceEvent = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    target.dispatchEvent(spaceEvent);
    expect(spaceEvent.defaultPrevented).toBe(true);

    input.destroy();
  });

  it("does not prevent default for keys outside scrollKeys", () => {
    const target = new EventTarget();
    const input = new InputManager<Action>({ keyMap, scrollKeys, keyboardTarget: target });
    input.attach();
    input.setRunning(true);

    // ArrowLeft is mapped but not a scroll key -> no preventDefault.
    const leftEvent = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
    target.dispatchEvent(leftEvent);
    expect(leftEvent.defaultPrevented).toBe(false);

    input.destroy();
  });

  it("does not prevent default scrolling while not running", () => {
    const target = new EventTarget();
    const input = new InputManager<Action>({ keyMap, scrollKeys, keyboardTarget: target });
    input.attach();

    const scrollEvent = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    target.dispatchEvent(scrollEvent);
    expect(scrollEvent.defaultPrevented).toBe(false);

    input.destroy();
  });

  it("stops buffering after destroy detaches listeners", () => {
    const target = new EventTarget();
    const input = new InputManager<Action>({ keyMap, scrollKeys, keyboardTarget: target });
    input.attach();
    input.setRunning(true);
    input.destroy();

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(input.drainActions()).toEqual([]);
  });
});

describe("InputManager touch handling", () => {
  it("buffers actions from touch controls carrying data-action while running", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    button.setAttribute("data-action", "drop");
    container.appendChild(button);
    document.body.appendChild(container);

    const input = new InputManager<Action>({
      keyMap,
      scrollKeys,
      touchControls,
      keyboardTarget: new EventTarget(),
      touchContainer: container,
      touchCapable: true,
    });
    input.attach();
    input.setRunning(true);

    button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(input.drainActions()).toEqual(["drop"]);

    input.destroy();
    container.remove();
  });

  it("ignores touch actions not declared in touchControls", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    button.setAttribute("data-action", "up"); // "up" is not among touchControls
    container.appendChild(button);
    document.body.appendChild(container);

    const input = new InputManager<Action>({
      keyMap,
      touchControls,
      keyboardTarget: new EventTarget(),
      touchContainer: container,
      touchCapable: true,
    });
    input.attach();
    input.setRunning(true);

    button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(input.drainActions()).toEqual([]);

    input.destroy();
    container.remove();
  });
});

describe("pushAction", () => {
  it("buffers actions only while running", () => {
    const input = new InputManager<Action>({ keyMap, keyboardTarget: new EventTarget() });

    input.pushAction("left");
    expect(input.drainActions()).toEqual([]); // not running

    input.setRunning(true);
    input.pushAction("left");
    input.pushAction("right");
    expect(input.drainActions()).toEqual(["left", "right"]);
  });
});

describe("detectTouchCapable", () => {
  it("returns a boolean for the current environment", () => {
    expect(typeof detectTouchCapable()).toBe("boolean");
  });
});
