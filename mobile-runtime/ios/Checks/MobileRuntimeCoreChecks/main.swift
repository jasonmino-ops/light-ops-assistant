import Foundation
@preconcurrency import Network
import MobileRuntimeCore

private enum CheckFailure: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case .failed(let message): return message
        }
    }
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw CheckFailure.failed(message) }
}

private final class LockedReceiver: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = Data()

    func append(_ data: Data) {
        lock.lock()
        storage.append(data)
        lock.unlock()
    }

    func value() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

private final class LockedValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Value

    init(_ value: Value) {
        storage = value
    }

    func set(_ value: Value) {
        lock.lock()
        storage = value
        lock.unlock()
    }

    func value() -> Value {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

@main
private enum MobileRuntimeCoreChecks {
    static func main() async throws {
        try checkContractPreservesBytes()
        try await checkDispatcherResultCorrelation()
        try await checkLoopbackTCPRoundTrip()
        try await checkOfflineFailureMapping()
        print("MobileRuntimeCoreChecks: PASS")
    }

    private static func checkContractPreservesBytes() throws {
        let bytes = Data([0x1b, 0x40, 0x00, 0xff, 0x1d, 0x56, 0x00])
        let task = makeTask(bytes: bytes)
        let validated = try NativeTaskValidator().validate(task).get()
        try require(validated.commandStream == bytes, "Contract validation changed command bytes")
        try require(validated.host == "192.168.18.49", "Contract validation changed target host")
        try require(validated.port == 9_100, "Contract validation changed target port")

        let unsupported = makeTask(bytes: bytes, contractVersion: "2.0")
        switch NativeTaskValidator().validate(unsupported) {
        case .success:
            throw CheckFailure.failed("Unsupported contract version was accepted")
        case .failure(let error):
            try require(error.code == .unsupportedContractVersion, "Wrong contract error mapping")
        }
    }

    private static func checkDispatcherResultCorrelation() async throws {
        let dispatcher = NativeTaskDispatcher(printExecutor: InMemoryPrintExecutor())
        let task = makeTask(bytes: Data([0x1b, 0x40]))
        let encoded = try JSONEncoder().encode(task)
        let object = try JSONSerialization.jsonObject(with: encoded)
        let result = await dispatcher.dispatch(jsonObject: object)
        try require(result.status == .success, "Dispatcher did not return success")
        try require(result.taskId == task.taskId, "Dispatcher lost task correlation")
        try require(result.result?.bytesSent == 2, "Dispatcher changed byte count")
    }

    private static func checkLoopbackTCPRoundTrip() async throws {
        let listener = try NWListener(using: .tcp, on: .any)
        let queue = DispatchQueue(label: "com.elifekh.mobile-runtime.checks.listener")
        let ready = DispatchSemaphore(value: 0)
        let complete = DispatchSemaphore(value: 0)
        let receiver = LockedReceiver()
        let assignedPort = LockedValue<UInt16?>(nil)
        let listenerFailure = LockedValue<String?>(nil)

        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                assignedPort.set(listener.port?.rawValue)
                ready.signal()
            case .failed(let error):
                listenerFailure.set(String(describing: error))
                ready.signal()
            default:
                break
            }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            var receiveNext: (() -> Void)!
            receiveNext = {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { content, _, isComplete, error in
                    if let content { receiver.append(content) }
                    if isComplete || error != nil {
                        connection.cancel()
                        complete.signal()
                    } else {
                        receiveNext()
                    }
                }
            }
            receiveNext()
        }
        listener.start(queue: queue)
        defer { listener.cancel() }

        try require(
            ready.wait(timeout: .now() + 2) == .success,
            "Loopback listener did not start: \(listenerFailure.value() ?? "timeout")"
        )
        let port = assignedPort.value()
        guard let port else { throw CheckFailure.failed("Loopback listener has no assigned port") }

        let expected = Data([0x1b, 0x40, 0x01, 0x00, 0xff, 0x1d, 0x56, 0x00])
        let result = await PrintBridge(
            timeouts: PrintBridgeTimeouts(connect: 2, write: 2, close: 2)
        ).execute(ValidatedPrintTask(
            taskId: "loopback-print",
            host: "127.0.0.1",
            port: port,
            commandStream: expected
        ))

        try require(result.status == .success, "Print Bridge loopback did not succeed")
        try require(result.result?.bytesSent == expected.count, "Print Bridge reported wrong byte count")
        try require(complete.wait(timeout: .now() + 2) == .success, "Loopback stream did not close")
        try require(receiver.value() == expected, "Print Bridge changed command bytes")
    }

    private static func checkOfflineFailureMapping() async throws {
        let result = await PrintBridge(
            timeouts: PrintBridgeTimeouts(connect: 1, write: 1, close: 1)
        ).execute(ValidatedPrintTask(
            taskId: "offline-print",
            host: "127.0.0.1",
            port: 9,
            commandStream: Data([0x1b, 0x40])
        ))
        try require(result.status == .failure, "Offline endpoint unexpectedly succeeded")
        try require(
            result.error?.code == .connectionFailed || result.error?.code == .connectTimeout,
            "Offline endpoint returned an unstable error code"
        )
        try require(result.error?.stage == .connect, "Offline endpoint returned the wrong failure stage")
    }

    private static func makeTask(
        bytes: Data,
        contractVersion: String = NativeTaskContractV1.version
    ) -> NativeTaskV1 {
        NativeTaskV1(
            contractVersion: contractVersion,
            taskId: "core-check-task",
            taskType: NativeTaskContractV1.printTaskType,
            payload: PrintTaskPayload(
                target: PrintTaskTarget(host: "192.168.18.49", port: 9_100),
                commandStream: PrintCommandStream(
                    encoding: "base64",
                    byteLength: bytes.count,
                    data: bytes.base64EncodedString()
                )
            )
        )
    }
}

private final class InMemoryPrintExecutor: PrintTaskExecuting {
    func execute(_ task: ValidatedPrintTask) async -> NativeTaskExecutionResult {
        .success(taskId: task.taskId, bytesSent: task.commandStream.count, durationMs: 0)
    }
}
