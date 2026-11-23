/**
 * Which system this device runs, and its version, for a bug report
 * (`osName` in `model/bug-report.ts` words it). Read where it can be trusted:
 *
 * - iPad, iPhone, Android: Obsidian's app is Capacitor, and its Device
 *   plugin says `osVersion` ("26.6.1" on an iPad Air on iPadOS 26.6.1). The
 *   user agent cannot be used there: an iPad's claims "Mac OS X 10_15_7".
 *   Without it, the name alone (the plugin review forbids reading the
 *   system from the user agent).
 * - A computer: Electron's `process.getSystemVersion()` ("10.0.26200" on
 *   Windows 11). `window.Capacitor` exists there too, so the app kind is
 *   checked first.
 *
 * Null when nothing trustworthy answered; the form then says nothing.
 */

import { Platform } from "obsidian";
import type { OsFacts } from "../model/bug-report";

/** How long the Device plugin may take before the form opens without it. */
const DEVICE_WAIT_MS = 800;

interface DeviceInfo {
  osVersion?: unknown;
  name?: unknown;
  model?: unknown;
}

interface CapacitorWindow {
  Capacitor?: { Plugins?: { Device?: { getInfo?: () => Promise<DeviceInfo> } } };
  process?: { getSystemVersion?: () => string };
}

/** The Device plugin's answer, or null if it has none, fails or is slow. */
async function deviceInfo(): Promise<DeviceInfo | null> {
  const getInfo = (window as unknown as CapacitorWindow).Capacitor?.Plugins?.Device?.getInfo;
  if (!getInfo) return null;
  try {
    return await Promise.race([
      getInfo(),
      new Promise<null>((done) => window.setTimeout(() => done(null), DEVICE_WAIT_MS)),
    ]);
  } catch {
    return null;
  }
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export async function readOsFacts(): Promise<OsFacts | null> {
  if (Platform.isIosApp) {
    const info = await deviceInfo();
    const name = `${text(info?.name) ?? ""} ${text(info?.model) ?? ""}`;
    return {
      system: "ios",
      version: text(info?.osVersion),
      tablet: Platform.isTablet || /\biPad/.test(name),
    };
  }
  if (Platform.isAndroidApp) {
    const info = await deviceInfo();
    return {
      system: "android",
      version: text(info?.osVersion),
    };
  }
  if (!Platform.isDesktopApp) return null;
  let version: string | null = null;
  try {
    version = (window as unknown as CapacitorWindow).process?.getSystemVersion?.() ?? null;
  } catch {
    version = null;
  }
  if (Platform.isWin) return { system: "windows", version };
  if (Platform.isMacOS) return { system: "macos", version };
  if (Platform.isLinux) return { system: "linux", version };
  return null;
}
