/**
 * PixelPal — File Scope & Path Containment Tests
 * Sprint 10 Phase 2
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  normalizeScopePath,
  isPathContained,
  isPathAllowed,
} from "../file_scope.ts";

describe("Category C: File Scope & Path Containment", () => {
  let tempBase: string;
  let allowedDir: string;
  let siblingDir: string;
  let nestedDir: string;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "pixelpal-scope-test-"));
    allowedDir = path.join(tempBase, "allowed_folder");
    siblingDir = path.join(tempBase, "allowed_folder_extra");
    nestedDir = path.join(allowedDir, "nested", "deeper");

    fs.mkdirSync(allowedDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempBase)) {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  });

  it("1. Normalizes paths cleanly and handles Windows drive letters", () => {
    const p1 = normalizeScopePath(allowedDir);
    assert.ok(path.isAbsolute(p1));

    if (process.platform === "win32") {
      const lowerDrive = "c:\\test\\folder";
      const normalized = normalizeScopePath(lowerDrive);
      assert.ok(normalized.startsWith("C:\\"));
    }
  });

  it("2. Accurately identifies direct and nested descendants", () => {
    const directFile = path.join(allowedDir, "hello.txt");
    const nestedFile = path.join(nestedDir, "deep.txt");

    assert.ok(isPathContained(directFile, allowedDir));
    assert.ok(isPathContained(nestedFile, allowedDir));
    assert.ok(isPathContained(allowedDir, allowedDir), "Root directory itself is contained");
  });

  it("3. Strictly rejects sibling directories with prefix collision (e.g. /foo vs /foo-extra)", () => {
    const siblingFile = path.join(siblingDir, "secret.txt");
    assert.equal(
      isPathContained(siblingFile, allowedDir),
      false,
      "Sibling folder starting with same prefix must NOT be considered contained"
    );
  });

  it("4. Blocks directory traversal attacks (../ escapes)", () => {
    const traversalAttempt = path.join(allowedDir, "..", "allowed_folder_extra", "evil.txt");
    assert.equal(
      isPathContained(traversalAttempt, allowedDir),
      false,
      "Traversal path escaping allowed folder must be rejected"
    );

    const rootTraversal = path.join(allowedDir, "..", "..", "..", "system.ini");
    assert.equal(isPathContained(rootTraversal, allowedDir), false);
  });

  it("5. isPathAllowed enforces allowlist rules and blocks when allowlist is empty", () => {
    const testFile = path.join(allowedDir, "doc.pdf");

    // When allowedRoots is empty -> strictly false
    assert.equal(isPathAllowed(testFile, []), false);
    assert.equal(isPathAllowed(testFile, undefined), false);

    // When allowedRoots contains the directory -> true
    assert.equal(isPathAllowed(testFile, [allowedDir]), true);

    // Outside path with allowedRoots configured -> false
    const outsideFile = path.join(siblingDir, "doc.pdf");
    assert.equal(isPathAllowed(outsideFile, [allowedDir]), false);

    // Empty/invalid target path -> false
    assert.equal(isPathAllowed("", [allowedDir]), false);
    assert.equal(isPathAllowed(null, [allowedDir]), false);
  });

  it("6. Detects symlink escapes when symlink targets outside allowed directory", () => {
    const realOutsideDir = path.join(tempBase, "secret_vault");
    fs.mkdirSync(realOutsideDir, { recursive: true });
    const realOutsideFile = path.join(realOutsideDir, "secret.txt");
    fs.writeFileSync(realOutsideFile, "confidential");

    const symlinkTarget = path.join(allowedDir, "link_to_secret.txt");

    try {
      fs.symlinkSync(realOutsideFile, symlinkTarget);

      // Even though link is physically located in allowedDir, realpath points outside!
      assert.equal(
        isPathContained(symlinkTarget, allowedDir),
        false,
        "Symlink escaping to outside target must be rejected"
      );
    } catch (err: any) {
      // On Windows non-admin shells, symlink creation might require privilege;
      // if unsupported by OS environment, test passes gracefully
      if (err.code === "EPERM") {
        return;
      }
      throw err;
    }
  });
});
