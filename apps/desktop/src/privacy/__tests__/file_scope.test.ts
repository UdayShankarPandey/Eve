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
  getDefaultDownloadsPath,
  resolveAuthorizedDownloadsDir,
  FileScopeValidator,
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

  it("7. resolveAuthorizedDownloadsDir strictly requires containment of canonical Downloads path", () => {
    const isWin = process.platform === "win32";
    const canonical = isWin
      ? "C:\\Users\\TestUser\\Downloads"
      : "/home/testuser/Downloads";
    const parentDir = isWin
      ? "C:\\Users\\TestUser"
      : "/home/testuser";
    const unrelatedDir = isWin
      ? "C:\\Users\\TestUser\\Projects"
      : "/home/testuser/Projects";
    const fakeBasenameMatch = isWin
      ? "D:\\Other\\Downloads"
      : "/opt/other/Downloads";
    const suffixCollision = isWin
      ? "C:\\Users\\TestUser\\MyDownloads"
      : "/home/testuser/MyDownloads";

    // 1. Empty allowedPaths -> null (DISABLED)
    assert.equal(resolveAuthorizedDownloadsDir([], canonical), null);
    assert.equal(resolveAuthorizedDownloadsDir(undefined as any, canonical), null);

    // 2. Unrelated directory -> null (DISABLED)
    assert.equal(resolveAuthorizedDownloadsDir([unrelatedDir], canonical), null);

    // 3. Basename collision on different drive/root -> null (DISABLED, no loose basename matching)
    assert.equal(resolveAuthorizedDownloadsDir([fakeBasenameMatch], canonical), null);

    // 4. Suffix collision -> null (DISABLED)
    assert.equal(resolveAuthorizedDownloadsDir([suffixCollision], canonical), null);

    // 5. Explicit Downloads directory -> canonical path (ENABLED)
    const exactResult = resolveAuthorizedDownloadsDir([canonical], canonical);
    assert.ok(exactResult !== null);
    assert.equal(
      path.normalize(exactResult!),
      path.normalize(normalizeScopePath(canonical))
    );

    // 6. Parent directory containing Downloads -> canonical path (ENABLED via valid containment)
    const parentResult = resolveAuthorizedDownloadsDir([parentDir], canonical);
    assert.ok(parentResult !== null);
    assert.equal(
      path.normalize(parentResult!),
      path.normalize(normalizeScopePath(canonical))
    );
  });

  it("8. EVT-01: FileScopeValidator enforces containment, snapshot updates, and boundary rules", () => {
    const rootA = path.join(tempBase, "project_a");
    const rootB = path.join(tempBase, "project_b");
    const siblingA = path.join(tempBase, "project_a_sibling");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.mkdirSync(siblingA, { recursive: true });

    const validator = new FileScopeValidator([rootA]);

    // 1. Accepts child path
    const childFile = path.join(rootA, "src", "index.ts");
    assert.equal(validator.isPathAllowed(childFile), true);

    // 2. Accepts root directory itself
    assert.equal(validator.isPathAllowed(rootA), true);

    // 3. Rejects sibling directory with common prefix (/foo vs /foo-extra)
    const siblingFile = path.join(siblingA, "leak.txt");
    assert.equal(validator.isPathAllowed(siblingFile), false);

    // 4. Rejects directory traversal (../ escape)
    const traversal = path.join(rootA, "..", "secret.txt");
    assert.equal(validator.isPathAllowed(traversal), false);

    // 5. Rejects unrelated path
    const unrelatedFile = path.join(rootB, "file.txt");
    assert.equal(validator.isPathAllowed(unrelatedFile), false);

    // 6. Multiple roots work
    validator.updateRoots([rootA, rootB]);
    assert.equal(validator.isPathAllowed(childFile), true);
    assert.equal(validator.isPathAllowed(unrelatedFile), true);

    // 7. Previously authorized path rejected after scope replacement
    validator.updateRoots([rootB]);
    assert.equal(validator.isPathAllowed(childFile), false, "Root A path must be rejected after replacement");
    assert.equal(validator.isPathAllowed(unrelatedFile), true);

    // 8. Empty roots reject all paths
    validator.updateRoots([]);
    assert.equal(validator.isPathAllowed(childFile), false);
    assert.equal(validator.isPathAllowed(unrelatedFile), false);
  });

  it("9. EVT-01: FileScopeValidator performs ZERO synchronous filesystem I/O on the hot event path", () => {
    const root = path.join(tempBase, "hotpath_dir");
    fs.mkdirSync(root, { recursive: true });
    const targetFile = path.join(root, "event.log");

    let existsSyncCalls = 0;
    let realpathSyncCalls = 0;

    const spyFs = {
      existsSync: (p: fs.PathLike) => {
        existsSyncCalls++;
        return fs.existsSync(p);
      },
      realpathSync: (p: fs.PathLike) => {
        realpathSyncCalls++;
        return fs.realpathSync(p);
      },
    };

    // Configuration / updateRoots uses fsProvider
    const validator = new FileScopeValidator([root], spyFs);
    const configExistsCalls = existsSyncCalls;
    const configRealpathCalls = realpathSyncCalls;

    // Verify configuration did resolve root canonicalization
    assert.ok(configExistsCalls > 0, "Configuration should verify root path");

    // Reset counters before evaluating hot path
    existsSyncCalls = 0;
    realpathSyncCalls = 0;

    // Simulate hot event path evaluating 100 incoming events
    for (let i = 0; i < 100; i++) {
      const allowed = validator.isPathAllowed(targetFile);
      assert.equal(allowed, true);
    }

    assert.equal(
      existsSyncCalls,
      0,
      "fs.existsSync must be called 0 times on the per-event hot path"
    );
    assert.equal(
      realpathSyncCalls,
      0,
      "fs.realpathSync must be called 0 times on the per-event hot path"
    );
  });
});
