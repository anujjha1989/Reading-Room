import Foundation
import Vision
import ImageIO

// Read a JSON list of image paths. OCR stays on the Mac; no documents are uploaded.
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let paths = try JSONDecoder().decode([String].self, from: Data(contentsOf: input))
var results: [String: String] = [:]
if let data = try? Data(contentsOf: output), let old = try? JSONDecoder().decode([String:String].self, from: data) { results = old }
for (index, path) in paths.enumerated() {
    if results[path] != nil { continue }
    autoreleasepool {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        do {
            try VNImageRequestHandler(url: URL(fileURLWithPath:path)).perform([request])
            results[path] = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator:"\n")
        } catch { results[path] = "OCR_ERROR: \(error)" }
    }
    try JSONEncoder().encode(results).write(to: output, options:.atomic)
    if index % 25 == 0 { print("OCR \(index+1)/\(paths.count)") }
}
print("OCR completed: \(results.count)")
