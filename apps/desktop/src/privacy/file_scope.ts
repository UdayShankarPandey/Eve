/**
 * PixelPal — File Scope & Path Containment Validator
 * Sprint 10 Phase 2
 *
 * Enforces strict filesystem scoping for the FILES permission domain:
 * - Canonical path normalization
 * - Traversal attack defense (e.g. `../` escapes)
 * - Prefix collision prevention (e.g. `C:\folder` vs `C:\folder-extra`)
 * - Cross-platform drive letter and case normalization (Windows)
 * - Symlink and junction escape detection
 * - Zero observation without explicit user allowlist
 */

import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Normalizes a filesystem path into an absolute, clean, canonical representation.
 */
export function normalizeScopePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("Invalid path: path must be a non-empty string");
  }

  const resolved = path.resolve(path.normalize(rawPath.trim()));

  // Normalize Windows drive letter casing (e.g. c:\ -> C:\)
  if (process.platform === "win32" && /^[a-zA-Z]:\\/.test(resolved)) {
    return resolved.charAt(0).toUpperCase() + resolved.slice(1);
  }

  return resolved;
}

/**
 * Checks whether targetPath is strictly within (or equal to) rootDir using deterministic
 * path boundary calculation. Performs zero filesystem I/O.
 */
export function isPathWithinRoot(normalizedTarget: string, normalizedRoot: string): boolean {
  const isWindows = process.platform === "win32";
  const targetComp = isWindows ? normalizedTarget.toLowerCase() : normalizedTarget;
  const rootComp = isWindows ? normalizedRoot.toLowerCase() : normalizedRoot;

  const relative = path.relative(rootComp, targetComp);
  if (relative === "") {
    return true;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return true;
}

/**
 * Checks whether targetPath is strictly within (or equal to) rootDir.
 * Fully protects against directory traversal, prefix collisions, and symlink escapes.
 * Options allow enabling or bypassing deep filesystem realpath inspection.
 */
export function isPathContained(
  targetPath: string,
  rootDir: string,
  options: { checkSymlinks?: boolean } = { checkSymlinks: true }
): boolean {
  try {
    const normalizedTarget = normalizeScopePath(targetPath);
    const normalizedRoot = normalizeScopePath(rootDir);

    // Fast deterministic boundary containment
    if (!isPathWithinRoot(normalizedTarget, normalizedRoot)) {
      return false;
    }

    // Additional deep symlink/junction escape check if explicitly requested and target exists
    if (options.checkSymlinks) {
      try {
        if (fs.existsSync(normalizedTarget)) {
          const realTarget = fs.realpathSync(normalizedTarget);
          let realRoot = normalizedRoot;
          if (fs.existsSync(normalizedRoot)) {
            realRoot = fs.realpathSync(normalizedRoot);
          }

          if (!isPathWithinRoot(normalizeScopePath(realTarget), normalizeScopePath(realRoot))) {
            return false;
          }
        }
      } catch {
        // If symlink check fails (e.g. deleted file event), containment check above is authoritative
      }
    }

    return true;
  } catch {
    return false;
  }
}

export interface FileScopeFsProvider {
  existsSync?: (path: fs.PathLike) => boolean;
  realpathSync?: (path: fs.PathLike) => string;
}

/**
 * Pre-resolved, immutable canonical scope validator for the hot event path.
 * Canonicalizes approved roots at configuration time (via realpathSync when roots exist),
 * and evaluates incoming event paths using deterministic path comparison with zero filesystem I/O.
 */
export class FileScopeValidator {
  private canonicalRoots: readonly string[] = [];
  private fsProvider: FileScopeFsProvider;

  constructor(allowedPaths: readonly string[] = [], fsProvider: FileScopeFsProvider = fs) {
    this.fsProvider = fsProvider;
    this.updateRoots(allowedPaths);
  }

  /**
   * Resolves and canonicalizes the configured roots into an immutable snapshot.
   * Atomically replaces the active root snapshot.
   */
  public updateRoots(allowedPaths: readonly string[]): void {
    const nextRoots: string[] = [];
    const existsFn = this.fsProvider.existsSync ?? fs.existsSync;
    const realpathFn = this.fsProvider.realpathSync ?? fs.realpathSync;

    if (Array.isArray(allowedPaths)) {
      for (const raw of allowedPaths) {
        if (typeof raw !== "string" || raw.trim() === "") continue;
        try {
          const normalized = normalizeScopePath(raw);
          let canonical = normalized;
          try {
            if (existsFn(normalized)) {
              canonical = normalizeScopePath(realpathFn(normalized));
            }
          } catch {
            // Fall back safely to normalized representation
          }
          nextRoots.push(canonical);
        } catch {
          // Ignore invalid path entry, never broaden scope
        }
      }
    }
    // Atomic snapshot replacement
    this.canonicalRoots = Object.freeze(nextRoots);
  }

  /**
   * Returns the active canonical root paths.
   */
  public getCanonicalRoots(): readonly string[] {
    return this.canonicalRoots;
  }

  /**
   * Evaluates path containment against pre-resolved canonical roots with ZERO filesystem I/O.
   */
  public isPathAllowed(targetPath: unknown): boolean {
    if (typeof targetPath !== "string" || targetPath.trim() === "") {
      return false;
    }
    if (this.canonicalRoots.length === 0) {
      return false;
    }

    let normalizedTarget: string;
    try {
      normalizedTarget = normalizeScopePath(targetPath);
    } catch {
      return false;
    }

    for (const root of this.canonicalRoots) {
      if (isPathWithinRoot(normalizedTarget, root)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Validates whether a file path falls within any of the user's configured allowed paths.
 * Returns false if allowedRoots is empty or if targetPath lies outside all allowed roots.
 * Performs deterministic in-memory containment with zero synchronous filesystem I/O.
 */
export function isPathAllowed(
  targetPath: unknown,
  allowedRoots?: readonly string[]
): boolean {
  if (typeof targetPath !== "string" || targetPath.trim() === "") {
    return false;
  }

  if (!allowedRoots || !Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    // Strict privacy invariant: no filesystem monitoring without explicit scope
    return false;
  }

  let normalizedTarget: string;
  try {
    normalizedTarget = normalizeScopePath(targetPath);
  } catch {
    return false;
  }

  for (const root of allowedRoots) {
    if (typeof root === "string" && root.trim() !== "") {
      try {
        const normalizedRoot = normalizeScopePath(root);
        if (isPathWithinRoot(normalizedTarget, normalizedRoot)) {
          return true;
        }
      } catch {
        // ignore invalid root
      }
    }
  }

  return false;
}

/**
 * Resolves the default OS user Downloads directory path across platforms.
 */
export function getDefaultDownloadsPath(): string {
  if (process.platform === "win32") {
    const profile = process.env.USERPROFILE || "C:\\Users\\Default";
    return path.join(profile, "Downloads");
  }
  const home = process.env.HOME || "/tmp";
  return path.join(home, "Downloads");
}

/**
 * Resolves whether the canonical Downloads directory is authorized under the given allowedPaths.
 * Returns the canonical Downloads path if it is provably contained within an explicitly
 * user-approved allowedPath according to existing FileScopeValidator containment semantics,
 * or null if unauthorized.
 *
 * Downloads may NEVER be authorized based solely on basename === "Downloads" or string matching.
 */
export function resolveAuthorizedDownloadsDir(
  allowedPaths: readonly string[],
  canonicalDownloadsPath?: string
): string | null {
  if (!allowedPaths || !Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    return null;
  }

  let canonicalDownloads: string;
  try {
    const rawTarget = canonicalDownloadsPath || getDefaultDownloadsPath();
    canonicalDownloads = normalizeScopePath(rawTarget);
  } catch {
    return null;
  }

  if (isPathAllowed(canonicalDownloads, allowedPaths)) {
    return canonicalDownloads;
  }

  return null;
}

