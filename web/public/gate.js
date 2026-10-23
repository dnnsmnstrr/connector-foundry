// The unsupported-browser gate for the app page (app/index.html loads it
// before the app's module script). Vite lowers the app's syntax to
// ES2020 but polyfills nothing, so below the floor — Safari/iOS 15.4,
// Chrome 93, Firefox 114, Samsung Internet 17 — the first failure was a
// blank dark page: a SyntaxError while the module parses, or
// `past.at is not a function` thrown into an error boundary once it
// runs. Both are replaced by a short message saying what to update.
//
// Plain ES5, loaded as a classic script from public/ (not inline): the
// desktop app's Content-Security-Policy allows 'self' scripts only, and
// this has to parse on the very engines the app itself cannot (ESLint
// parses this file as ES5: eslint.config.js). The versions in the message
// are the floor docs/GETTING_STARTED.md gives (a unit test holds the two
// together).
(function () {
  // Firefox before 114 has no `type` in WorkerOptions: it never reads the
  // getter and would load the render worker as a classic script, where
  // its import.meta is a SyntaxError and every render fails. The options
  // are read before the URL is parsed, so the unparsable URL throws
  // without starting a worker or touching the network.
  function moduleWorkers() {
    // A Worker that is not the engine's own — the browser tests' stand-in,
    // put in place before any page script runs — says nothing about the
    // engine, and does not read its options.
    if (!/\[native code\]/.test(Function.prototype.toString.call(Worker))) return true;
    var reads = false;
    try {
      new Worker("http://[", {
        get type() {
          reads = true;
          return "module";
        }
      });
    } catch (e) {
      // Expected: the URL does not parse (or Worker does not exist).
    }
    return reads;
  }

  var ok =
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
    typeof HTMLDialogElement !== "undefined" &&
    "showModal" in HTMLDialogElement.prototype &&
    "at" in Array.prototype &&
    typeof Object.hasOwn === "function" &&
    moduleWorkers();

  var UNSUPPORTED =
    "<h1 style=\"font-size:1.25rem;margin:0 0 0.75rem\">This browser can't run Connector Foundry</h1>" +
    "<p>It needs Safari or iOS 15.4, Chrome 93, Firefox 114 or Samsung Internet 17, or newer. " +
    "Update the browser, or open this link on another device.</p>";
  var LOAD_FAILED =
    "<h1 style=\"font-size:1.25rem;margin:0 0 0.75rem\">Connector Foundry couldn't load</h1>" +
    "<p>Check the connection and reload the page. If it keeps happening, update the browser.</p>" +
    "<p><button type=\"button\" onclick=\"location.reload()\" style=\"font:inherit;padding:0.6rem 1.2rem;" +
    "border:none;border-radius:6px;background:#3a5aa0;color:#fff\">Reload</button></p>";

  // Writes a message into #root, now or — this script runs in <head>,
  // before #root is parsed — once the document has been read. The module
  // script is deferred, so it runs after this and before DOMContentLoaded:
  // it checks window.__unsupported (main.jsx) and mounts nothing.
  function show(html) {
    var root = document.getElementById("root");
    if (!root) {
      document.addEventListener("DOMContentLoaded", function () {
        show(html);
      });
      return;
    }
    root.innerHTML =
      '<div role="alert" style="max-width:36rem;margin:3rem auto;padding:0 1.25rem;' +
      'font:16px/1.5 system-ui,-apple-system,sans-serif;color:#e6e6e6">' +
      html +
      '<p><a href="https://dnnsmnstrr.github.io/connector-foundry/" style="color:#a8b4ff">' +
      "About Connector Foundry</a></p></div>";
  }

  function unsupported() {
    if (window.__unsupported) return;
    window.__unsupported = true;
    show(UNSUPPORTED);
  }

  if (!ok) unsupported();

  // Until the app's code has started (main.jsx sets __appStarted first
  // thing, once every module it imports has evaluated), an error means it
  // never will. On current engines a module that fails to parse, or throws
  // while it evaluates, reaches the window as an ErrorEvent: the engine
  // lacks something the build used. A plain Event at a <script> or a
  // modulepreload <link> is that file failing to download (or, in WebKit
  // before r288820 — Safari 15.4 to 15.x — a parse error too): a
  // connection problem, worth a reload rather than an update. A
  // stylesheet that fails is ignored: the app runs unstyled. Capturing,
  // because resource errors do not bubble.
  window.addEventListener(
    "error",
    function (event) {
      if (window.__appStarted || window.__unsupported) return;
      if (event.target === window) {
        unsupported();
        return;
      }
      var el = event.target;
      var name = el && el.tagName;
      if (name === "SCRIPT" || (name === "LINK" && /modulepreload/.test(el.rel || ""))) show(LOAD_FAILED);
    },
    true
  );
})();
