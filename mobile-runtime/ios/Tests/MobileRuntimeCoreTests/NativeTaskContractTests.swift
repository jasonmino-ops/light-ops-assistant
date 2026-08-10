import Foundation
import XCTest
@testable import MobileRuntimeCore

final class NativeTaskContractTests: XCTestCase {
    func testValidPrintTaskPreservesCommandBytes() throws {
        let original = Data([0x1b, 0x40, 0x00, 0xff, 0x1d, 0x56, 0x00])
        let task = makeTask(bytes: original)

        let validated = try NativeTaskValidator().validate(task).get()

        XCTAssertEqual(validated.taskId, task.taskId)
        XCTAssertEqual(validated.host, "192.168.18.49")
        XCTAssertEqual(validated.port, 9_100)
        XCTAssertEqual(validated.commandStream, original)
    }

    func testContractValidationReturnsStableRequiredCodes() {
        let validator = NativeTaskValidator(maximumPayloadBytes: 4)
        let bytes = Data([0x1b, 0x40])

        assertFailure(
            validator.validate(makeTask(contractVersion: "2.0", bytes: bytes)),
            equals: .unsupportedContractVersion
        )
        assertFailure(
            validator.validate(makeTask(taskType: "camera", bytes: bytes)),
            equals: .unsupportedTaskType
        )
        assertFailure(
            validator.validate(makeTask(host: "printer.local", bytes: bytes)),
            equals: .invalidTarget
        )
        assertFailure(
            validator.validate(makeTask(port: 9_101, bytes: bytes)),
            equals: .invalidTarget
        )
        assertFailure(
            validator.validate(makeTask(encoding: "hex", bytes: bytes)),
            equals: .invalidCommandStream
        )
        assertFailure(
            validator.validate(makeTask(declaredByteLength: 3, bytes: bytes)),
            equals: .invalidCommandStream
        )
        assertFailure(
            validator.validate(makeTask(bytes: Data(repeating: 0x01, count: 5))),
            equals: .payloadTooLarge
        )
    }

    func testDispatcherRejectsMalformedTaskWithoutRawError() async throws {
        let dispatcher = NativeTaskDispatcher(printExecutor: RecordingPrintExecutor())
        let result = await dispatcher.dispatch(jsonObject: [
            "contractVersion": "1.0",
            "taskId": "malformed-1",
            "taskType": "print",
        ])

        XCTAssertEqual(result.status, .failure)
        XCTAssertEqual(result.taskId, "malformed-1")
        XCTAssertEqual(result.error?.code, .invalidTask)
        XCTAssertEqual(result.error?.stage, .validate)

        let object = ResultBridge.jsonObject(for: result)
        let encoded = try JSONSerialization.data(withJSONObject: object)
        let text = String(decoding: encoded, as: UTF8.self)
        XCTAssertFalse(text.localizedCaseInsensitiveContains("stack"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("exception"))
    }

    func testDispatcherCorrelatesTaskIdAndDispatchesOnlyPrint() async throws {
        let executor = RecordingPrintExecutor()
        let dispatcher = NativeTaskDispatcher(printExecutor: executor)
        let task = makeTask(bytes: Data([0x1b, 0x40, 0x1d, 0x56, 0x00]))
        let encoded = try JSONEncoder().encode(task)
        let object = try JSONSerialization.jsonObject(with: encoded)

        let result = await dispatcher.dispatch(jsonObject: object)

        XCTAssertEqual(result.status, .success)
        XCTAssertEqual(result.taskId, task.taskId)
        XCTAssertEqual(result.result?.bytesSent, 5)
        XCTAssertEqual(executor.receivedTask?.commandStream, Data([0x1b, 0x40, 0x1d, 0x56, 0x00]))
    }

    private func makeTask(
        contractVersion: String = "1.0",
        taskType: String = "print",
        host: String = "192.168.18.49",
        port: Int = 9_100,
        encoding: String = "base64",
        declaredByteLength: Int? = nil,
        bytes: Data
    ) -> NativeTaskV1 {
        NativeTaskV1(
            contractVersion: contractVersion,
            taskId: "task-contract-test-1",
            taskType: taskType,
            payload: PrintTaskPayload(
                target: PrintTaskTarget(host: host, port: port),
                commandStream: PrintCommandStream(
                    encoding: encoding,
                    byteLength: declaredByteLength ?? bytes.count,
                    data: bytes.base64EncodedString()
                )
            )
        )
    }

    private func assertFailure(
        _ result: Result<ValidatedPrintTask, NativeTaskValidationFailure>,
        equals expected: NativeTaskErrorCode,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        switch result {
        case .success:
            XCTFail("Expected validation failure", file: file, line: line)
        case .failure(let failure):
            XCTAssertEqual(failure.code, expected, file: file, line: line)
        }
    }
}

private final class RecordingPrintExecutor: PrintTaskExecuting {
    var receivedTask: ValidatedPrintTask?

    func execute(_ task: ValidatedPrintTask) async -> NativeTaskExecutionResult {
        receivedTask = task
        return .success(taskId: task.taskId, bytesSent: task.commandStream.count, durationMs: 1)
    }
}
