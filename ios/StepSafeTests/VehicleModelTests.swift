import CoreML
import CoreVideo
import XCTest

/// The bundled vehicle model keeps the I/O contract VehicleDetector relies on: a Vision-compatible 640x640 image input,
/// the exported NMS pipeline's iouThreshold / confidenceThreshold inputs (VehicleDetector.Thresholds), confidence /
/// coordinates outputs, and the 80 COCO labels (VehicleDetector.classes filters on them by name).
final class VehicleModelTests: XCTestCase {
    private func model() throws -> MLModel {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: Tuning.vehicleModelName, withExtension: "mlmodelc"),
                                "\(Tuning.vehicleModelName).mlmodelc missing from the bundle")
        let config = MLModelConfiguration()
        config.computeUnits = .cpuOnly // the simulator has no Neural Engine
        return try MLModel(contentsOf: url, configuration: config)
    }

    func testIOContract() throws {
        let d = try model().modelDescription
        let image = try XCTUnwrap(d.inputDescriptionsByName["image"]?.imageConstraint)
        XCTAssertEqual(image.pixelsWide, 640)
        XCTAssertEqual(image.pixelsHigh, 640)
        XCTAssertNotNil(d.inputDescriptionsByName["iouThreshold"])
        XCTAssertNotNil(d.inputDescriptionsByName["confidenceThreshold"])
        XCTAssertNotNil(d.outputDescriptionsByName["confidence"])
        XCTAssertNotNil(d.outputDescriptionsByName["coordinates"])
        let labels = try XCTUnwrap(d.classLabels as? [String])
        XCTAssertEqual(labels.count, 80)
        for name in ["person", "bicycle", "car", "motorcycle", "bus", "truck"] { XCTAssertTrue(labels.contains(name), name) }
        XCTAssertEqual(labels[2], "car") // COCO order kept
    }

    func testBlankFramePredicts() throws {
        let m = try model()
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 640, 640, kCVPixelFormatType_32BGRA, nil, &buffer)
        let input = try MLDictionaryFeatureProvider(dictionary: [
            "image": MLFeatureValue(pixelBuffer: try XCTUnwrap(buffer)),
            "iouThreshold": MLFeatureValue(double: 0.45),
            "confidenceThreshold": MLFeatureValue(double: Double(Tuning.vehicleMinConfidence)),
        ])
        let out = try m.prediction(from: input)
        XCTAssertNotNil(out.featureValue(for: "confidence")?.multiArrayValue)
        XCTAssertNotNil(out.featureValue(for: "coordinates")?.multiArrayValue)
    }
}
