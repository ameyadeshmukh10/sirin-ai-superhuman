/* Chat-bubble embed loader. Host sites include:
 *   <script src="https://<your-deployment>/embed.js" async></script>
 * Injects a fixed-position iframe running the /embed widget and resizes it as
 * the widget moves between its states (mini bubble, teaser card, chat panel,
 * full experience). Optional: data-position="left" to dock bottom-left.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (err) {
    return;
  }

  var position = script.getAttribute("data-position") === "left" ? "left" : "right";
  var MARGIN = 16;

  function small() {
    return window.innerWidth <= 640;
  }

  var container = document.createElement("div");
  var style = container.style;
  style.position = "fixed";
  style.bottom = MARGIN + "px";
  style[position] = MARGIN + "px";
  style.width = "0";
  style.height = "0";
  style.zIndex = "2147483000";
  style.opacity = "0";
  style.pointerEvents = "none";
  style.transition = "width 0.25s ease, height 0.25s ease, opacity 0.25s ease";

  var iframe = document.createElement("iframe");
  iframe.src = origin + "/embed" + (small() ? "?compact=1" : "");
  iframe.title = "AI guide";
  iframe.allow = "microphone; autoplay; clipboard-write";
  iframe.setAttribute("allowtransparency", "true");
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  iframe.style.background = "transparent";
  iframe.style.colorScheme = "normal"; /* keep transparency on dark-mode hosts */
  container.appendChild(iframe);

  function mount() {
    (document.body || document.documentElement).appendChild(container);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  var state = null;
  var teaserHeight = 560; /* fallback until the widget reports its real height */

  function apply() {
    if (!state) return; /* stay hidden until the widget says hello */
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    /* conversation states take over the whole viewport on phones */
    var fullBleed = (state === "panel" || state === "full") && small();
    var w, h;
    if (state === "mini") {
      w = 76;
      h = 76;
    } else if (state === "teaser") {
      w = Math.min(356, vw - MARGIN * 2);
      h = Math.min(teaserHeight, vh - MARGIN * 2);
    } else if (state === "panel") {
      w = Math.min(408, vw - MARGIN * 2);
      h = Math.min(724, vh - MARGIN * 2);
    } else {
      w = vw - MARGIN * 2;
      h = vh - MARGIN * 2;
    }
    if (fullBleed) {
      w = vw;
      h = vh;
    }
    style.width = w + "px";
    style.height = h + "px";
    style.bottom = (fullBleed ? 0 : MARGIN) + "px";
    style[position] = (fullBleed ? 0 : MARGIN) + "px";
    style.opacity = "1";
    style.pointerEvents = "auto";
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.type !== "sirin-embed" || typeof data.state !== "string") return;
    state = data.state;
    if (state === "teaser" && typeof data.height === "number" && data.height > 0) {
      teaserHeight = data.height;
    }
    apply();
  });
  window.addEventListener("resize", apply);
})();
