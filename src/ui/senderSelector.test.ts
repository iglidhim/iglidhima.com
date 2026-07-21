// Render/behaviour tests for the Sender_Selector chrome component.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document and window.
//
// _Validates: Requirements 4.1, 4.2, 4.3_
import { describe, it, expect, beforeEach } from "vitest";
import { createSenderSelector } from "./senderSelector";
import { ALLOWED_SENDERS } from "../worker/validation";

describe("createSenderSelector", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders exactly two options, Kian and Eloise (Requirement 4.1)", () => {
    const selector = createSenderSelector();
    selector.mount(host);

    const root = host.querySelector(".sender-selector");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("group");
    expect(root?.getAttribute("aria-label")).toBeTruthy();

    const options = host.querySelectorAll<HTMLButtonElement>(".sender-selector__option");
    expect(options.length).toBe(2);

    const labels = Array.from(options, (b) => b.textContent);
    expect(labels).toEqual([...ALLOWED_SENDERS]);
    expect(labels).toEqual(["Kian", "Eloise"]);
    // Each option is a native button (keyboard operable — Requirement 10.5).
    options.forEach((b) => expect(b.tagName).toBe("BUTTON"));
  });

  it("selects no sender initially — getSender() returns null", () => {
    const selector = createSenderSelector();
    selector.mount(host);

    expect(selector.getSender()).toBeNull();

    const options = host.querySelectorAll<HTMLButtonElement>(".sender-selector__option");
    options.forEach((b) => expect(b.getAttribute("aria-pressed")).toBe("false"));
  });

  it("records the chosen name and toggles aria-pressed on selection (Requirement 4.2)", () => {
    const selector = createSenderSelector();
    selector.mount(host);

    const options = host.querySelectorAll<HTMLButtonElement>(".sender-selector__option");
    const kian = options[0]!;
    const eloise = options[1]!;

    kian.click();
    expect(selector.getSender()).toBe("Kian");
    expect(kian.getAttribute("aria-pressed")).toBe("true");
    expect(eloise.getAttribute("aria-pressed")).toBe("false");

    // Picking the other option switches the pressed state exclusively.
    eloise.click();
    expect(selector.getSender()).toBe("Eloise");
    expect(kian.getAttribute("aria-pressed")).toBe("false");
    expect(eloise.getAttribute("aria-pressed")).toBe("true");
  });

  it("invokes the onChange callback with the chosen sender", () => {
    const seen: string[] = [];
    const selector = createSenderSelector({ onChange: (s) => seen.push(s) });
    selector.mount(host);

    const options = host.querySelectorAll<HTMLButtonElement>(".sender-selector__option");
    options[0]!.click();
    options[1]!.click();

    expect(seen).toEqual(["Kian", "Eloise"]);
  });

  it("presents no credential or password input anywhere (Requirement 4.3)", () => {
    const selector = createSenderSelector();
    selector.mount(host);

    // No text/password/email inputs, and no <form>, exist in the component.
    expect(host.querySelectorAll("input").length).toBe(0);
    expect(host.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(host.querySelectorAll("form").length).toBe(0);
  });

  it("detaches its listeners and removes itself on destroy", () => {
    const selector = createSenderSelector();
    selector.mount(host);

    const kian = host.querySelector<HTMLButtonElement>(".sender-selector__option")!;
    expect(host.querySelector(".sender-selector")).not.toBeNull();

    selector.destroy();
    expect(host.querySelector(".sender-selector")).toBeNull();

    // Firing click on the detached button must not change recorded state.
    kian.click();
    expect(selector.getSender()).toBeNull();
  });
});
