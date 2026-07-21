// Render tests for the Scoreboard chrome component (task 9.1).
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts).
// _Requirements: 4.1, 4.2, 4.3, 6.3_
import { describe, it, expect, beforeEach } from "vitest";
import { createScoreboard } from "./scoreboard";

describe("createScoreboard", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders using the shared scoreboard CSS classes", () => {
    const sb = createScoreboard();
    sb.mount(host);

    expect(host.querySelector(".scoreboard")).not.toBeNull();
    expect(host.querySelectorAll(".scoreboard__item")).toHaveLength(2);
    expect(host.querySelector(".scoreboard__score")).not.toBeNull();
    expect(host.querySelector(".scoreboard__high-score")).not.toBeNull();
    expect(host.querySelectorAll(".scoreboard__caption")).toHaveLength(2);
  });

  it("shows 0 for Score and High_Score before play begins (Req 4.3)", () => {
    const sb = createScoreboard();
    sb.mount(host);

    expect(host.querySelector(".scoreboard__score")?.textContent).toBe("0");
    expect(host.querySelector(".scoreboard__high-score")?.textContent).toBe("0");
  });

  it("updates the displayed Score on score change (Req 4.1, 4.2)", () => {
    const sb = createScoreboard();
    sb.mount(host);

    sb.setScore(120);
    expect(host.querySelector(".scoreboard__score")?.textContent).toBe("120");

    sb.setScore(999);
    expect(host.querySelector(".scoreboard__score")?.textContent).toBe("999");
  });

  it("displays the active game's stored High_Score (Req 6.3)", () => {
    const sb = createScoreboard();
    sb.mount(host);

    sb.setHighScore(4200);
    expect(host.querySelector(".scoreboard__high-score")?.textContent).toBe("4200");
  });

  it("coerces invalid values to a safe non-negative integer", () => {
    const sb = createScoreboard();
    sb.mount(host);

    sb.setScore(-5);
    expect(host.querySelector(".scoreboard__score")?.textContent).toBe("0");

    sb.setScore(Number.NaN);
    expect(host.querySelector(".scoreboard__score")?.textContent).toBe("0");

    sb.setScore(12.9);
    expect(host.querySelector(".scoreboard__score")?.textContent).toBe("12");
  });

  it("removes itself from the DOM on destroy", () => {
    const sb = createScoreboard();
    sb.mount(host);
    expect(host.querySelector(".scoreboard")).not.toBeNull();

    sb.destroy();
    expect(host.querySelector(".scoreboard")).toBeNull();
  });
});
