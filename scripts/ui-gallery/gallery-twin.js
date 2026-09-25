// Exported pages hold one copy of the screen's markup, in the light frame.
// This copies it into the dark figure, so a change made once shows in both.
/* global document */
for (const figure of document.querySelectorAll("[data-twin-of]")) {
  const light = document.querySelector(".gallery-frame.theme-light");
  if (!light) break;
  const dark = light.cloneNode(true);
  dark.classList.replace("theme-light", "theme-dark");
  dark.dataset.screenLabel = (dark.dataset.screenLabel || "").replace("(light)", "(dark)");
  figure.appendChild(dark);
}
