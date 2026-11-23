// The guide search page's script: reads the box, writes the results in.
// Everything it shows is built by src/model/guide-site.ts.

import { GUIDE_SIZE, queryOf, resultsHtml } from "../../src/model/guide-site";

const input = document.querySelector<HTMLInputElement>("#q");
const results = document.querySelector<HTMLElement>("#results");

if (input && results) {
  input.placeholder = `Search ${GUIDE_SIZE} answers: "left panel disappears", "export as PDF"…`;
  const show = (): void => {
    results.innerHTML = resultsHtml(input.value);
    const url = new URL(window.location.href);
    if (input.value.trim()) url.searchParams.set("q", input.value.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  };
  input.value = queryOf(window.location.search);
  input.addEventListener("input", show);
  show();
  input.focus();
}
