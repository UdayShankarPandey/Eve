/**
 * PixelPal — Desktop Path & Persistent Storage Abstractions
 * Sprint 6 Baseline Hardening
 *
 * Provides cross-platform resolution for desktop persistent application data,
 * adhering to standard OS conventions and Tauri v2 bundle identifier guidelines.
 */

import * as path from "node:path";
import * as os from "node:os";

/** Default bundle identifier for the PixelPal desktop application */
export const DEFAULT_APP_IDENTIFIER = "com.pixelpal.desktop";

/**
 * Resolves the persistent application data directory for PixelPal across platforms.
 * Adheres to desktop OS standards and Tauri v2 directory resolution rules:
 *
 * - Windows: %APPDATA%\com.pixelpal.desktop (or %LOCALAPPDATA% / ~/AppData/Roaming)
 * - macOS:   ~/Library/Application Support/com.pixelpal.desktop
 * - Linux:   $XDG_DATA_HOME/com.pixelpal.desktop (or ~/.local/share/com.pixelpal.desktop)
 *
 * Supports an environment variable override via `PIXELPAL_DATA_DIR` for hermetic testing
 * and non-standard deployment environments.
 *
 * @param customAppIdentifier Optional custom identifier (defaults to com.pixelpal.desktop)
 * @returns Absolute path to the desktop application data directory
 */
export function getDesktopAppDataDir(
  customAppIdentifier: string = DEFAULT_APP_IDENTIFIER
): string {
  const envOverride = process.env.PIXELPAL_DATA_DIR;
  if (envOverride && envOverride.trim() !== "") {
    return path.resolve(envOverride.trim());
  }

  const platform = process.platform;

  if (platform === "win32") {
    const appData =
      process.env.APPDATA ||
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, customAppIdentifier);
  }

  if (platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      customAppIdentifier
    );
  }

  // Linux and other POSIX operating systems (XDG Base Directory specification)
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome && xdgDataHome.trim() !== "") {
    return path.join(xdgDataHome, customAppIdentifier);
  }

  return path.join(os.homedir(), ".local", "share", customAppIdentifier);
}

/**
 * Resolves the default persistent directory for CharacterProfile JSON documents.
 * Format: <desktopAppDataDir>/profiles
 *
 * Unlike temporary upload/processed/generated/sprite caches (which reside under os.tmpdir()),
 * CharacterProfile represents persistent user companion identity and must be durable
 * across OS restarts and temp cleaning cycles.
 *
 * @param customAppIdentifier Optional custom identifier
 * @returns Absolute path to the persistent profiles storage directory
 */
export function getDefaultProfileStorageDir(
  customAppIdentifier?: string
): string {
  return path.join(getDesktopAppDataDir(customAppIdentifier), "profiles");
}
