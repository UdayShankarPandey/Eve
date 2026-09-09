/**
 * PixelPal — Deterministic Color Quantizer & Palette Reducer
 * Sprint 6 Phase 4 Foundation
 *
 * Implements a pure, deterministic Median-Cut color quantization algorithm
 * with first-class transparency awareness and zero external ML dependencies.
 */

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Deterministic Median-Cut Color Quantization algorithm.
 * Groups opaque pixels into color boxes along the axis with the largest range,
 * splitting recursively at the median until `maxColors` buckets are produced.
 */
export function medianCutQuantize(
  pixels: readonly RgbColor[],
  maxColors: number
): RgbColor[] {
  if (pixels.length === 0 || maxColors <= 0) {
    return [];
  }

  // Deduplicate colors to avoid redundant computation and zero-range splits
  const uniqueMap = new Map<number, RgbColor>();
  for (const p of pixels) {
    const key = (p.r << 16) | (p.g << 8) | p.b;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, p);
    }
  }

  const uniqueColors = Array.from(uniqueMap.values());
  if (uniqueColors.length <= maxColors) {
    // Sort palette deterministically
    return uniqueColors.sort(compareColors);
  }

  const boxes: RgbColor[][] = [uniqueColors];

  while (boxes.length < maxColors) {
    let bestBoxIdx = -1;
    let maxRange = -1;
    let splitChannel: "r" | "g" | "b" = "r";

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length <= 1) continue;

      let minR = 255;
      let maxR = 0;
      let minG = 255;
      let maxG = 0;
      let minB = 255;
      let maxB = 0;

      for (const p of box) {
        if (p.r < minR) minR = p.r;
        if (p.r > maxR) maxR = p.r;
        if (p.g < minG) minG = p.g;
        if (p.g > maxG) maxG = p.g;
        if (p.b < minB) minB = p.b;
        if (p.b > maxB) maxB = p.b;
      }

      const rangeR = maxR - minR;
      const rangeG = maxG - minG;
      const rangeB = maxB - minB;
      const range = Math.max(rangeR, rangeG, rangeB);

      if (range > maxRange) {
        maxRange = range;
        bestBoxIdx = i;
        // Deterministic channel selection priority: r, then g, then b
        if (range === rangeR) {
          splitChannel = "r";
        } else if (range === rangeG) {
          splitChannel = "g";
        } else {
          splitChannel = "b";
        }
      }
    }

    if (bestBoxIdx === -1 || maxRange === 0) {
      break; // Cannot subdivide any further
    }

    const targetBox = boxes[bestBoxIdx];

    // Deterministic sorting with secondary and tertiary channel tie-breaking
    targetBox.sort((a, b) => {
      const primaryDiff = a[splitChannel] - b[splitChannel];
      if (primaryDiff !== 0) return primaryDiff;
      return compareColors(a, b);
    });

    const mid = Math.floor(targetBox.length / 2);
    const boxA = targetBox.slice(0, mid);
    const boxB = targetBox.slice(mid);
    boxes.splice(bestBoxIdx, 1, boxA, boxB);
  }

  // Calculate representative color for each bucket
  const palette: RgbColor[] = boxes.map((box) => {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    for (const p of box) {
      sumR += p.r;
      sumG += p.g;
      sumB += p.b;
    }

    return {
      r: Math.round(sumR / box.length),
      g: Math.round(sumG / box.length),
      b: Math.round(sumB / box.length),
    };
  });

  return palette.sort(compareColors);
}

/**
 * Deterministic color comparison for sorting.
 */
function compareColors(a: RgbColor, b: RgbColor): number {
  if (a.r !== b.r) return a.r - b.r;
  if (a.g !== b.g) return a.g - b.g;
  return a.b - b.b;
}

/**
 * Maps a single pixel to the closest color in the palette using Euclidean distance.
 */
export function findNearestColor(
  pixel: RgbColor,
  palette: readonly RgbColor[]
): RgbColor {
  if (palette.length === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  let minDistance = Infinity;
  let nearest = palette[0];

  for (let i = 0; i < palette.length; i++) {
    const c = palette[i];
    const dr = pixel.r - c.r;
    const dg = pixel.g - c.g;
    const db = pixel.b - c.b;
    const distance = dr * dr + dg * dg + db * db;

    if (distance < minDistance) {
      minDistance = distance;
      nearest = c;
    }
  }

  return nearest;
}

/**
 * Quantization options.
 */
export interface QuantizeOptions {
  readonly maxOpaqueColors: number;
  readonly alphaThreshold: number;
  readonly dithering?: boolean;
}

/**
 * Result of buffer quantization.
 */
export interface QuantizeResult {
  readonly buffer: Buffer;
  readonly palette: readonly RgbColor[];
  readonly opaqueColorCount: number;
  readonly totalOpaquePixels: number;
  readonly totalTransparentPixels: number;
}

/**
 * Quantizes an uncompressed RGBA pixel buffer deterministically.
 * Transparency is strictly preserved and segregated from the opaque color count.
 */
export function quantizeRgbaBuffer(
  rawBuffer: Buffer,
  width: number,
  height: number,
  options: QuantizeOptions
): QuantizeResult {
  const { maxOpaqueColors, alphaThreshold, dithering = false } = options;
  const pixelCount = width * height;
  const outBuffer = Buffer.from(rawBuffer); // Clone buffer for deterministic modification

  const opaquePixels: RgbColor[] = [];
  let transparentCount = 0;

  // Pass 1: Alpha segregation and binary thresholding
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const a = outBuffer[offset + 3];

    if (a < alphaThreshold) {
      // Clean cutoff: pixel becomes completely transparent black
      outBuffer[offset] = 0;
      outBuffer[offset + 1] = 0;
      outBuffer[offset + 2] = 0;
      outBuffer[offset + 3] = 0;
      transparentCount++;
    } else {
      // Crisp pixel sprite boundary: set alpha to fully opaque
      outBuffer[offset + 3] = 255;
      opaquePixels.push({
        r: outBuffer[offset],
        g: outBuffer[offset + 1],
        b: outBuffer[offset + 2],
      });
    }
  }

  // If there are no opaque pixels, return transparent canvas
  if (opaquePixels.length === 0) {
    return {
      buffer: outBuffer,
      palette: [],
      opaqueColorCount: 0,
      totalOpaquePixels: 0,
      totalTransparentPixels: transparentCount,
    };
  }

  // Pass 2: Calculate deterministic palette for opaque pixels
  const palette = medianCutQuantize(opaquePixels, maxOpaqueColors);

  // Pass 3: Map opaque pixels to palette
  if (dithering) {
    // Optional deterministic Floyd-Steinberg error diffusion bounded to opaque pixels
    const errorR = new Float32Array(pixelCount);
    const errorG = new Float32Array(pixelCount);
    const errorB = new Float32Array(pixelCount);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const offset = idx * 4;

        if (outBuffer[offset + 3] === 0) {
          continue; // Do not diffuse error into transparent background
        }

        const curR = Math.min(255, Math.max(0, outBuffer[offset] + errorR[idx]));
        const curG = Math.min(255, Math.max(0, outBuffer[offset + 1] + errorG[idx]));
        const curB = Math.min(255, Math.max(0, outBuffer[offset + 2] + errorB[idx]));

        const nearest = findNearestColor({ r: curR, g: curG, b: curB }, palette);

        outBuffer[offset] = nearest.r;
        outBuffer[offset + 1] = nearest.g;
        outBuffer[offset + 2] = nearest.b;

        const errR = curR - nearest.r;
        const errG = curG - nearest.g;
        const errB = curB - nearest.b;

        // Diffuse to neighbors if they are inside bounds
        if (x + 1 < width) {
          const right = y * width + (x + 1);
          errorR[right] += (errR * 7) / 16;
          errorG[right] += (errG * 7) / 16;
          errorB[right] += (errB * 7) / 16;
        }
        if (y + 1 < height) {
          if (x - 1 >= 0) {
            const downLeft = (y + 1) * width + (x - 1);
            errorR[downLeft] += (errR * 3) / 16;
            errorG[downLeft] += (errG * 3) / 16;
            errorB[downLeft] += (errB * 3) / 16;
          }
          const down = (y + 1) * width + x;
          errorR[down] += (errR * 5) / 16;
          errorG[down] += (errG * 5) / 16;
          errorB[down] += (errB * 5) / 16;
          if (x + 1 < width) {
            const downRight = (y + 1) * width + (x + 1);
            errorR[downRight] += (errR * 1) / 16;
            errorG[downRight] += (errG * 1) / 16;
            errorB[downRight] += (errB * 1) / 16;
          }
        }
      }
    }
  } else {
    // Default crisp nearest-color mapping (no noise / no diffusion artifacts)
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      if (outBuffer[offset + 3] === 0) {
        continue;
      }

      const pixel: RgbColor = {
        r: outBuffer[offset],
        g: outBuffer[offset + 1],
        b: outBuffer[offset + 2],
      };

      const nearest = findNearestColor(pixel, palette);
      outBuffer[offset] = nearest.r;
      outBuffer[offset + 1] = nearest.g;
      outBuffer[offset + 2] = nearest.b;
    }
  }

  // Count actual unique opaque colors in final buffer
  const finalColors = new Set<number>();
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    if (outBuffer[offset + 3] > 0) {
      const key =
        (outBuffer[offset] << 16) |
        (outBuffer[offset + 1] << 8) |
        outBuffer[offset + 2];
      finalColors.add(key);
    }
  }

  return {
    buffer: outBuffer,
    palette,
    opaqueColorCount: finalColors.size,
    totalOpaquePixels: opaquePixels.length,
    totalTransparentPixels: transparentCount,
  };
}
