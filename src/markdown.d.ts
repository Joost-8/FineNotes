/**
 * Importing a `.md` file gives its text: esbuild bundles Markdown with its
 * `text` loader (esbuild.config.mjs), and this tells TypeScript so. Used for
 * the changelog shown after an update.
 */
declare module "*.md" {
  const contents: string;
  export default contents;
}
