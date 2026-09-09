/**
 * PixelPal — Isolated Background Removal Strategies
 * Sprint 6 Phase 2 Foundation
 *
 * Provides a clean strategy abstraction for background removal:
 * - NoBackgroundRemovalStrategy: Passthrough strategy (default).
 * - CornerChromaBackgroundRemovalStrategy: Local, deterministic heuristic
 *   baseline for uniform backdrops without external heavy ML dependencies.
 */

import type { BackgroundRemovalMode, BackgroundRemovalStrategy } from "./types.ts";

/**
 * Default passthrough strategy: does not modify pixels.
 */
export class NoBackgroundRemovalStrategy implements BackgroundRemovalStrategy {
  public readonly mode: BackgroundRemovalMode = "none";

  public async removeBackground(
    rawPixels: Uint8Array,
    _width: number,
    _height: number,
    _channels: number,
    _threshold?: number
  ): Promise<{ rawPixels: Uint8Array; backgroundRemoved: boolean }> {
    return { rawPixels, backgroundRemoved: false };
  }
}

/**
 * Local deterministic heuristic strategy for uniform/solid backgrounds.
 * Samples the outer corners of the image to detect key backdrop color,
 * and masks matching pixels with smooth alpha roll-off.
 */
export class CornerChromaBackgroundRemovalStrategy implements BackgroundRemovalStrategy {
  public readonly mode: BackgroundRemovalMode = "corner-chroma";

  public async removeBackground(
    rawPixels: Uint8Array,
    width: number,
    height: number,
    channels: number,
    threshold: number = 25
  ): Promise<{ rawPixels: Uint8Array; backgroundRemoved: boolean }> {
    if (channels < 4) {
      // Background removal requires RGBA (4 channels)
      return { rawPixels, backgroundRemoved: false };
    }

    if (width < 4 || height < 4) {
      return { rawPixels, backgroundRemoved: false };
    }

    // Sample the 4 outer corners (top-left, top-right, bottom-left, bottom-right)
    const corners = [
      0, // (0, 0)
      (width - 1) * 4, // (width - 1, 0)
      (height - 1) * width * 4, // (0, height - 1)
      ((height - 1) * width + (width - 1)) * 4, // (width - 1, height - 1)
    ];

    let avgR = 0;
    let avgG = 0;
    let avgB = 0;

    for (const offset of corners) {
      avgR += rawPixels[offset];
      avgG += rawPixels[offset + 1];
      avgB += rawPixels[offset + 2];
    }

    avgR /= corners.length;
    avgG /= corners.length;
    avgB /= corners.length;

    // Check corner variance to verify this is actually a uniform backdrop
    let maxCornerVariance = 0;
    for (const offset of corners) {
      const dr = Math.abs(rawPixels[offset] - avgR);
      const dg = Math.abs(rawPixels[offset + 1] - avgG);
      const db = Math.abs(rawPixels[offset + 2] - avgB);
      maxCornerVariance = Math.max(maxCornerVariance, dr, dg, db);
    }

    // If corner variance exceeds threshold, it's a non-uniform background (e.g. natural scene)
    // Avoid destructive partial removal: preserve the original background
    if (maxCornerVariance > threshold * 1.5) {
      return { rawPixels, backgroundRemoved: false };
    }

    // Apply color key mask with smooth ramp
    const output = new Uint8Array(rawPixels);
    const softThreshold = threshold * 1.5;
    let modifiedPixelCount = 0;

    const totalPixels = width * height;
    for (let i = 0; i < totalPixels; i++) {
      const offset = i * 4;
      const r = output[offset];
      const g = output[offset + 1];
      const b = output[offset + 2];

      // Euclidean color distance in RGB space
      const distance = Math.sqrt(
        (r - avgR) ** 2 + (g - avgG) ** 2 + (b - avgB) ** 2
      );

      if (distance <= threshold) {
        output[offset + 3] = 0; // Fully transparent
        modifiedPixelCount++;
      } else if (distance < softThreshold) {
        // Linear transition ramp
        const alphaFactor = (distance - threshold) / (softThreshold - threshold);
        output[offset + 3] = Math.round(output[offset + 3] * alphaFactor);
        modifiedPixelCount++;
      }
    }

    // Only declare background removed if a reasonable percentage of backdrop was masked
    const backgroundRemoved = modifiedPixelCount > totalPixels * 0.05;
    return {
      rawPixels: backgroundRemoved ? output : rawPixels,
      backgroundRemoved,
    };
  }
}
