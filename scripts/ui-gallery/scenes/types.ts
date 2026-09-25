export interface SceneContext {
  /** The frame to render into: the pane the plugin's view would fill. */
  frame: HTMLElement;
  /** Wait for layout, timers and fonts. */
  settle(ms?: number): Promise<void>;
}

export interface Scene {
  /** File name of the exported page; stable, kebab-case. */
  id: string;
  title: string;
  /** Index section. */
  group: string;
  /** What the screen is and where it lives in the code, for the designer. */
  note?: string;
  /** Frame size in CSS px; the iPad landscape pane by default. */
  size?: { width: number; height: number };
  settleMs?: number;
  render(ctx: SceneContext): Promise<void> | void;
}
