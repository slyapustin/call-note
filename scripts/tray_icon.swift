import AppKit

let output = CommandLine.arguments[1]
for scale in [1, 2] {
    let pixels = 20 * scale
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    bitmap.size = NSSize(width: 20, height: 20)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor.black.setStroke()
    let bubble = NSBezierPath(roundedRect: NSRect(x: 2.5, y: 4.5, width: 15, height: 13), xRadius: 4, yRadius: 4)
    bubble.lineWidth = 1.6
    bubble.stroke()
    let tail = NSBezierPath()
    tail.move(to: NSPoint(x: 5, y: 5)); tail.line(to: NSPoint(x: 4, y: 2)); tail.line(to: NSPoint(x: 8, y: 4.5))
    tail.lineWidth = 1.5; tail.lineJoinStyle = .round; tail.lineCapStyle = .round; tail.stroke()
    let lines = NSBezierPath()
    lines.move(to: NSPoint(x: 6, y: 13.5)); lines.line(to: NSPoint(x: 14, y: 13.5))
    lines.move(to: NSPoint(x: 6, y: 9)); lines.line(to: NSPoint(x: 8, y: 9))
    lines.line(to: NSPoint(x: 9.5, y: 11)); lines.line(to: NSPoint(x: 11, y: 8)); lines.line(to: NSPoint(x: 12, y: 9)); lines.line(to: NSPoint(x: 14, y: 9))
    lines.lineWidth = 1.5; lines.lineJoinStyle = .round; lines.lineCapStyle = .round; lines.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let suffix = scale == 2 ? "@2x" : ""
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(output)/callNoteTemplate\(suffix).png"))
}
