// The parts gallery's system filter. The cards themselves are static
// HTML, written at build time from the catalogue (vite-plugin-site.mjs).

/**
 * @param {HTMLElement} filters the row of filter chips
 * @param {HTMLElement} gallery the list of part cards
 */
export function mountGallery(filters, gallery) {
  const chips = /** @type {HTMLButtonElement[]} */ ([...filters.querySelectorAll("[data-filter]")]);
  const cards = /** @type {HTMLElement[]} */ ([...gallery.querySelectorAll(".part-card")]);
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  filters.after(status);

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const filter = chip.dataset.filter;
      for (const other of chips) other.setAttribute("aria-pressed", String(other === chip));
      let shown = 0;
      cards.forEach((card) => {
        const match = filter === "all" || card.dataset.system === filter;
        card.hidden = !match;
        if (!match) return;
        // Replay the card's entrance, a little after the one before it.
        card.style.animation = "none";
        void card.offsetWidth;
        card.style.animation = "";
        card.style.animationDelay = `${Math.min(shown, 12) * 30}ms`;
        shown += 1;
      });
      status.textContent = `Showing ${shown} part${shown === 1 ? "" : "s"}`;
    });
  }
}
