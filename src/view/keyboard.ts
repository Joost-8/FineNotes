/**
 * The on-screen keyboard's height as Obsidian mobile reports it; 0 elsewhere.
 * Read from `<body>`: a custom property set on `<html>` is inherited there,
 * so this sees the value wherever Obsidian's native side puts it. Never read
 * the keyboard off `visualViewport` — on Obsidian's iPad app it does not
 * shrink for the keyboard (ledger: "Obsidian's iPad keyboard cap").
 */
export function keyboardHeight(): number {
  const raw = getComputedStyle(document.body).getPropertyValue("--keyboard-height");
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : 0;
}
