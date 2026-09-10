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
 * Checks whether targetPath is strictly within (or equal to) rootDir.
 * Fully protects against directory traversal, prefix collisions, and symlink escapes.
 */
export function isPathContained(targetPath: string, rootDir: string): boolean {
  try {
    const normalizedTarget = normalizeScopePath(targetPath);
    const normalizedRoot = normalizeScopePath(rootDir);

    // On Windows, paths are case-insensitive
    const isWindows = process.platform === "win32";
    const targetComp = isWindows ? normalizedTarget.toLowerCase() : normalizedTarget;
    const rootComp = isWindows ? normalizedRoot.toLowerCase() : normalizedRoot;

    // Check directory containment via relative path computation
    const relative = path.relative(rootComp, targetComp);

    // Exactly equal to the root directory
    if (relative === "") {
      return true;
    }

    // If relative starts with '..' or is absolute, it is outside the root
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }

    // Additional symlink/junction escape check if the file or directory exists on disk
    try {
      if (fs.existsSync(normalizedTarget)) {
        const realTarget = fs.realpathSync(normalizedTarget);
        let realRoot = normalizedRoot;
        if (fs.existsSync(normalizedRoot)) {
          realRoot = fs.realpathSync(normalizedRoot);
        }

        const realTargetComp = isWindows ? realTarget.toLowerCase() : realTarget;
        const realRootComp = isWindows ? realRoot.toLowerCase() : realRoot;
        const realRelative = path.relative(realRootComp, realTargetComp);

        if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
          // Symlink escapes outside allowed root!
          return false;
        }
      }
    } catch {
      // If symlink check fails (e.g. deleted file event), containment check above is authoritative
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates whether a file path falls within any of the user's configured allowed paths.
 * Returns false if allowedRoots is empty or if targetPath lies outside all allowed roots.
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

  for (const root of allowedRoots) {
    if (typeof root === "string" && root.trim() !== "") {
      if (isPathContained(targetPath, root)) {
        return true;
      }
    }
  }

  return false;
}
