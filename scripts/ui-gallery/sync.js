// Runs inside a Claude Design preview page (a render_preview serve_url opened
// in the browser pane), where the project's files are same-origin. Paste it
// in with the pane's JavaScript tool; the pane will not let that page reach
// localhost, so it only reads, and hands its results back as the tool result.
//
//   await gallerySync.hashes(names)   {name: sha256 prefix}, as check-export.mjs
//                                     computes them, for --verify
//   await gallerySync.text(name)      one file as stored (preview injections
//                                     removed), e.g. polish.css to pull back
/* global window, location, fetch, URL, crypto, TextEncoder */
(function () {
  // The preview server injects its own <style> and <script> into every HTML
  // page it serves; they are not part of the stored file.
  function stored(text) {
    return text
      .replace(/<style data-omelette-injected>[\s\S]*?<\/style>/g, "")
      .replace(/<script data-omelette-injected>[\s\S]*?<\/script>/g, "")
      .replace(/<head>\n+/, "<head>\n");
  }

  function normalise(text) {
    return text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  }

  async function text(name) {
    var res = await fetch(new URL(name, location.href).href, { cache: "no-store" });
    if (!res.ok) throw new Error(name + ": " + res.status);
    return stored(await res.text());
  }

  async function hash(name) {
    var bytes = new TextEncoder().encode(normalise(await text(name)));
    var digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("")
      .slice(0, 16);
  }

  window.gallerySync = {
    text: text,
    hashes: async function (names) {
      var out = {};
      await Promise.all(
        names.map(async function (name) {
          try {
            out[name] = await hash(name);
          } catch (e) {
            out[name] = "error: " + (e.message || e);
          }
        }),
      );
      return out;
    },
  };
})();
