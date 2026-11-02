// The guides' pages (docs/**, written by scripts/build-docs.mjs): a copy
// button on each code block, the "On this page" list following the
// reader, the guide list folding away on a phone, and videos that load
// only when played.
import "./site.css";
import "./docs.css";
import { watchHeader } from "./common.js";

watchHeader();
copyButtons();
tocFollowsScroll();
sidebarToggle();
playVideos();

// A video is a link until it is clicked (build-docs.mjs's videoFigure()),
// so reading a guide sends nothing to YouTube; the click swaps in the
// player from YouTube's no-cookie domain, already playing. A click with a
// modifier key held still opens YouTube in a new tab, as a link does.
function playVideos() {
  for (const link of /** @type {NodeListOf<HTMLAnchorElement>} */ (
    document.querySelectorAll(".video-link[data-video]")
  )) {
    link.addEventListener("click", (event) => {
      const id = link.dataset.video ?? "";
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !/^[\w-]{11}$/.test(id)) return;
      event.preventDefault();
      const player = document.createElement("iframe");
      player.className = "video-player";
      player.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
      player.title = link.querySelector(".video-title")?.textContent ?? "Video";
      player.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      player.allowFullscreen = true;
      link.replaceWith(player);
      player.focus();
    });
  }
}

function copyButtons() {
  if (!navigator.clipboard) return;
  for (const block of document.querySelectorAll(".prose pre")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block.querySelector("code")?.textContent ?? "");
        button.textContent = "Copied";
      } catch {
        button.textContent = "Couldn't copy";
      }
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    });
    block.append(button);
  }
}

// The heading last scrolled past is the current one in "On this page".
function tocFollowsScroll() {
  const links = /** @type {HTMLAnchorElement[]} */ ([...document.querySelectorAll(".docs-toc a")]);
  if (!links.length || !("IntersectionObserver" in window)) return;
  const headings = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter(Boolean);
  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      // The first heading on screen, or else the last one above it.
      let current = headings.find((heading) => visible.has(heading));
      if (!current) current = headings.filter((heading) => heading.getBoundingClientRect().top < 0).pop();
      for (const link of links) {
        if (current && link.hash === `#${current.id}`) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    },
    { rootMargin: "-72px 0px -55% 0px" },
  );
  for (const heading of headings) observer.observe(heading);
}

function sidebarToggle() {
  const toggle = document.querySelector(".docs-sidebar-toggle");
  const sidebar = document.getElementById("docs-sidebar");
  if (!toggle || !sidebar) return;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    sidebar.classList.toggle("is-open", open);
  });
}
