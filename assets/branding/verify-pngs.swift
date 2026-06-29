import AppKit
import Foundation

// Sample points derived from pane-mark.svg (100×100 viewBox):
// - cutout center (78, 78) → hole should be transparent
// - body (25, 25) → opaque fill
// - bottom-right margin (95, 95) → opaque fill (inside L, outside cutout)

struct Sample {
  let name: String
  let xRatio: Double
  let yRatio: Double
  let expectTransparent: Bool
}

struct ColorSample {
  let name: String
  let xRatio: Double
  let yRatio: Double
  let minRed: Double
  let maxRed: Double
  let minGreen: Double
  let maxGreen: Double
  let minBlue: Double
  let maxBlue: Double
  let minAlpha: Double
}

let markSamples = [
  Sample(name: "cutout-center", xRatio: 0.78, yRatio: 0.78, expectTransparent: true),
  Sample(name: "body", xRatio: 0.25, yRatio: 0.25, expectTransparent: false),
  Sample(name: "br-margin", xRatio: 0.95, yRatio: 0.95, expectTransparent: false),
]

let squareSizes = [16, 22, 24, 32, 48, 64, 128, 192, 256, 512, 1024]
let markVariants = ["pane-mark-black", "pane-mark-white"]

// pane-wordmark.svg (78×36): text body lower-left, above-text margin transparent.
let wordmarkSamples = [
  Sample(name: "text-body", xRatio: 0.08, yRatio: 0.65, expectTransparent: false),
  Sample(name: "above-text", xRatio: 0.5, yRatio: 0.08, expectTransparent: true),
]

let wordmarkAspectW = 78
let wordmarkAspectH = 36

// pane-extension-icon.svg: orange rounded rect + white mark; cutout shows orange through.
let extensionIconSamples = [
  ColorSample(
    name: "orange-bg",
    xRatio: 0.5,
    yRatio: 0.12,
    minRed: 0.75,
    maxRed: 1.0,
    minGreen: 0.2,
    maxGreen: 0.45,
    minBlue: 0.0,
    maxBlue: 0.15,
    minAlpha: 0.99
  ),
  ColorSample(
    name: "white-mark",
    xRatio: 0.32,
    yRatio: 0.32,
    minRed: 0.9,
    maxRed: 1.0,
    minGreen: 0.9,
    maxGreen: 1.0,
    minBlue: 0.9,
    maxBlue: 1.0,
    minAlpha: 0.99
  ),
  ColorSample(
    name: "cutout-orange",
    xRatio: 0.68,
    yRatio: 0.68,
    minRed: 0.75,
    maxRed: 1.0,
    minGreen: 0.2,
    maxGreen: 0.45,
    minBlue: 0.0,
    maxBlue: 0.15,
    minAlpha: 0.99
  ),
]

guard CommandLine.arguments.count >= 2 else {
  fputs("usage: verify-pngs.swift <png-dir>\n", stderr)
  exit(1)
}

let dir = CommandLine.arguments[1]
var failures = 0

func loadRep(path: String) -> NSBitmapImageRep? {
  guard let img = NSImage(contentsOfFile: path),
        let rep = img.representations.first as? NSBitmapImageRep
  else {
    return nil
  }
  return rep
}

func checkTransparency(path: String, rep: NSBitmapImageRep, samples: [Sample]) {
  let w = rep.pixelsWide
  let h = rep.pixelsHigh

  for sample in samples {
    let x = min(max(Int((Double(w) * sample.xRatio).rounded(.down)), 0), w - 1)
    let y = min(max(Int((Double(h) * sample.yRatio).rounded(.down)), 0), h - 1)
    guard let color = rep.colorAt(x: x, y: y) else {
      fputs("FAIL \(path) \(sample.name): no pixel at \(x),\(y)\n", stderr)
      failures += 1
      continue
    }

    let alpha = color.alphaComponent
    let transparent = alpha < 0.01
    if transparent != sample.expectTransparent {
      fputs(
        "FAIL \(path) \(sample.name): alpha=\(alpha), expected transparent=\(sample.expectTransparent)\n",
        stderr
      )
      failures += 1
    }
  }
}

func checkColor(path: String, rep: NSBitmapImageRep, sample: ColorSample) {
  let w = rep.pixelsWide
  let h = rep.pixelsHigh
  let x = min(max(Int((Double(w) * sample.xRatio).rounded(.down)), 0), w - 1)
  let y = min(max(Int((Double(h) * sample.yRatio).rounded(.down)), 0), h - 1)

  guard let color = rep.colorAt(x: x, y: y) else {
    fputs("FAIL \(path) \(sample.name): no pixel at \(x),\(y)\n", stderr)
    failures += 1
    return
  }

  let r = color.redComponent
  let g = color.greenComponent
  let b = color.blueComponent
  let a = color.alphaComponent

  let inRange =
    r >= sample.minRed && r <= sample.maxRed &&
    g >= sample.minGreen && g <= sample.maxGreen &&
    b >= sample.minBlue && b <= sample.maxBlue &&
    a >= sample.minAlpha

  if !inRange {
    fputs(
      "FAIL \(path) \(sample.name): rgba=(\(r),\(g),\(b),\(a)), expected ranges r[\(sample.minRed)-\(sample.maxRed)] g[\(sample.minGreen)-\(sample.maxGreen)] b[\(sample.minBlue)-\(sample.maxBlue)]\n",
      stderr
    )
    failures += 1
  }
}

for variant in markVariants {
  for size in squareSizes {
    let path = "\(dir)/\(variant)-\(size).png"
    guard let rep = loadRep(path: path) else {
      fputs("FAIL missing or unreadable: \(path)\n", stderr)
      failures += 1
      continue
    }

    let w = rep.pixelsWide
    let h = rep.pixelsHigh

    if w != size || h != size {
      fputs("FAIL \(path): expected \(size)x\(size), got \(w)x\(h)\n", stderr)
      failures += 1
    }

    checkTransparency(path: path, rep: rep, samples: markSamples)
  }
}

for size in squareSizes {
  let path = "\(dir)/pane-extension-icon-\(size).png"
  guard let rep = loadRep(path: path) else {
    fputs("FAIL missing or unreadable: \(path)\n", stderr)
    failures += 1
    continue
  }

  let w = rep.pixelsWide
  let h = rep.pixelsHigh

  if w != size || h != size {
    fputs("FAIL \(path): expected \(size)x\(size), got \(w)x\(h)\n", stderr)
    failures += 1
  }

  for sample in extensionIconSamples {
    checkColor(path: path, rep: rep, sample: sample)
  }
}

for size in squareSizes {
  let path = "\(dir)/pane-wordmark-\(size).png"
  let expectedW = size * wordmarkAspectW / wordmarkAspectH
  let expectedH = size

  guard let rep = loadRep(path: path) else {
    fputs("FAIL missing or unreadable: \(path)\n", stderr)
    failures += 1
    continue
  }

  let w = rep.pixelsWide
  let h = rep.pixelsHigh

  if w != expectedW || h != expectedH {
    fputs("FAIL \(path): expected \(expectedW)x\(expectedH), got \(w)x\(h)\n", stderr)
    failures += 1
  }

  checkTransparency(path: path, rep: rep, samples: wordmarkSamples)
}

if failures > 0 {
  fputs("\(failures) verification failure(s)\n", stderr)
  exit(1)
}

print("All PNGs verified: marks, wordmark, and extension icon.")
