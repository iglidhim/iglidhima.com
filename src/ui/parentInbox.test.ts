// Render/behaviour tests for the ParentInbox chrome component.
//
// Lives under src/ui/** so it runs in the jsdom environment (see vite.config.ts),
// giving it a document and window. Image loading uses a stubbed URL builder, so
// no real image bytes are ever fetched or asserted on.
//
// _Validates: Requirements 7.3, 7.4, 7.5_
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createParentInbox } from "./parentInbox";
import type { SubmissionSummary } from "../lib/inbox";

describe("createParentInbox", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  /** Three submissions with distinct timestamps (oldest → newest). */
  function sampleSubmissions(): SubmissionSummary[] {
    return [
      {
        id: "a",
        sender: "Kian",
        created_at: 1000,
        has_note: true,
        note_text: "Hi Dad from Kian",
        has_image: false,
      },
      {
        id: "b",
        sender: "Eloise",
        created_at: 3000,
        has_note: false,
        note_text: null,
        has_image: true,
      },
      {
        id: "c",
        sender: "Kian",
        created_at: 2000,
        has_note: true,
        note_text: "A drawing and a note",
        has_image: true,
      },
    ];
  }

  it("renders items newest-first (Requirement 7.1)", async () => {
    const inbox = createParentInbox({
      fetchSubmissions: async () => sampleSubmissions(),
      imageSrc: (id) => `stub://image/${id}`,
    });
    inbox.mount(host);
    await inbox.load();

    const items = host.querySelectorAll<HTMLElement>(".inbox__item");
    expect(items.length).toBe(3);
    // created_at 3000 (b), 2000 (c), 1000 (a) — non-increasing.
    expect(items[0]!.dataset.id).toBe("b");
    expect(items[1]!.dataset.id).toBe("c");
    expect(items[2]!.dataset.id).toBe("a");
  });

  it("shows each item's sender, timestamp, and content indicator (Requirement 7.2)", async () => {
    const inbox = createParentInbox({
      fetchSubmissions: async () => sampleSubmissions(),
      imageSrc: (id) => `stub://image/${id}`,
    });
    inbox.mount(host);
    await inbox.load();

    const first = host.querySelector<HTMLElement>(".inbox__item")!;
    expect(first.querySelector(".inbox__sender")?.textContent).toBe("Eloise");
    expect(first.querySelector(".inbox__time")?.textContent).toBeTruthy();
    // b has an image only.
    expect(first.querySelector(".inbox__indicator")?.textContent).toBe("Drawing");
    const thumb = first.querySelector<HTMLImageElement>(".inbox__thumb");
    expect(thumb).not.toBeNull();
    expect(thumb?.getAttribute("src")).toBe("stub://image/b");
  });

  it("shows the full-view detail when a submission is selected (Requirement 7.3)", async () => {
    const inbox = createParentInbox({
      fetchSubmissions: async () => sampleSubmissions(),
      imageSrc: (id) => `stub://image/${id}`,
    });
    inbox.mount(host);
    await inbox.load();

    // Select submission "c" (drawing + note).
    const cItem = host.querySelector<HTMLElement>('.inbox__item[data-id="c"]')!;
    cItem.querySelector<HTMLButtonElement>(".inbox__select")!.click();

    const detail = host.querySelector<HTMLElement>(".inbox__detail");
    expect(detail).not.toBeNull();
    // Full drawing image points at the stubbed URL for c.
    const image = detail?.querySelector<HTMLImageElement>(".inbox__detail-image");
    expect(image?.getAttribute("src")).toBe("stub://image/c");
    // Full note text is shown (not the truncated preview).
    expect(detail?.querySelector(".inbox__detail-note")?.textContent).toBe(
      "A drawing and a note",
    );
    // The list is no longer rendered while the detail view is open.
    expect(host.querySelector(".inbox__list")).toBeNull();
  });

  it("deletes via the injected deleter and removes the item from the DOM (Requirement 7.4)", async () => {
    const deleteSubmission = vi.fn(async () => {});
    const inbox = createParentInbox({
      fetchSubmissions: async () => sampleSubmissions(),
      deleteSubmission,
      imageSrc: (id) => `stub://image/${id}`,
    });
    inbox.mount(host);
    await inbox.load();

    expect(host.querySelectorAll(".inbox__item").length).toBe(3);

    const cItem = host.querySelector<HTMLElement>('.inbox__item[data-id="c"]')!;
    cItem.querySelector<HTMLButtonElement>(".inbox__delete")!.click();

    // Let the delete promise settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(deleteSubmission).toHaveBeenCalledWith("c");
    const remaining = host.querySelectorAll<HTMLElement>(".inbox__item");
    expect(remaining.length).toBe(2);
    expect(host.querySelector('.inbox__item[data-id="c"]')).toBeNull();
  });

  it("shows the empty-state message when there are no submissions (Requirement 7.5)", async () => {
    const inbox = createParentInbox({
      fetchSubmissions: async () => [],
    });
    inbox.mount(host);
    await inbox.load();

    expect(host.querySelector(".inbox__empty")).not.toBeNull();
    expect(host.querySelectorAll(".inbox__item").length).toBe(0);
  });

  it("shows a retry message when the list fetch fails", async () => {
    let calls = 0;
    const inbox = createParentInbox({
      fetchSubmissions: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("network down");
        }
        return sampleSubmissions();
      },
    });
    inbox.mount(host);
    await inbox.load();

    // First load fails → retry UI, not a blank page.
    const error = host.querySelector<HTMLElement>(".inbox__error");
    expect(error).not.toBeNull();
    const retry = error?.querySelector<HTMLButtonElement>(".inbox__retry");
    expect(retry).not.toBeNull();

    // Clicking retry re-loads and renders the list.
    retry!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.querySelector(".inbox__error")).toBeNull();
    expect(host.querySelectorAll(".inbox__item").length).toBe(3);
  });
});
