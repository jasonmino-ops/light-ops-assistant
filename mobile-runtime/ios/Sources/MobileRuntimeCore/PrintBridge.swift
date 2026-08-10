import Foundation
@preconcurrency import Network

public struct PrintBridgeTimeouts: Equatable {
    public let connect: TimeInterval
    public let write: TimeInterval
    public let close: TimeInterval

    public init(connect: TimeInterval = 10, write: TimeInterval = 15, close: TimeInterval = 5) {
        self.connect = connect
        self.write = write
        self.close = close
    }
}

public final class PrintBridge: PrintTaskExecuting {
    private let timeouts: PrintBridgeTimeouts
    private let queueFactory: () -> DispatchQueue

    public init(
        timeouts: PrintBridgeTimeouts = PrintBridgeTimeouts(),
        queueFactory: @escaping () -> DispatchQueue = {
            DispatchQueue(label: "com.elifekh.mobile-runtime.print-bridge")
        }
    ) {
        self.timeouts = timeouts
        self.queueFactory = queueFactory
    }

    public func execute(_ task: ValidatedPrintTask) async -> NativeTaskExecutionResult {
        let startedAt = DispatchTime.now().uptimeNanoseconds
        let queue = queueFactory()
        let connection = NWConnection(
            host: NWEndpoint.Host(task.host),
            port: NWEndpoint.Port(rawValue: task.port)!,
            using: .tcp
        )

        do {
            try await connect(connection, queue: queue)
            try await send(task.commandStream, through: connection, queue: queue)
            try await close(connection, queue: queue)
            connection.stateUpdateHandler = nil
            connection.cancel()

            let elapsed = DispatchTime.now().uptimeNanoseconds - startedAt
            return .success(
                taskId: task.taskId,
                bytesSent: task.commandStream.count,
                durationMs: Int(elapsed / 1_000_000)
            )
        } catch let failure as BridgeFailure {
            connection.stateUpdateHandler = nil
            connection.cancel()
            return mapFailure(failure, taskId: task.taskId)
        } catch {
            connection.stateUpdateHandler = nil
            connection.cancel()
            return .failure(
                taskId: task.taskId,
                code: .internalError,
                stage: .runtime,
                retryable: false
            )
        }
    }

    private func connect(_ connection: NWConnection, queue: DispatchQueue) async throws {
        try await withCheckedThrowingContinuation { continuation in
            let gate = ContinuationGate<Void>(continuation)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    gate.resume(.success(()))
                case .failed(let error):
                    gate.resume(.failure(BridgeFailure.network(stage: .connect, error: error)))
                case .waiting(let error) where Self.isLocalNetworkPermissionDenied(error):
                    gate.resume(.failure(BridgeFailure.network(stage: .connect, error: error)))
                case .cancelled:
                    gate.resume(.failure(BridgeFailure.cancelled(stage: .connect)))
                default:
                    break
                }
            }
            queue.asyncAfter(deadline: .now() + timeouts.connect) {
                gate.resume(.failure(BridgeFailure.timeout(stage: .connect)))
            }
            connection.start(queue: queue)
        }
    }

    private func send(_ bytes: Data, through connection: NWConnection, queue: DispatchQueue) async throws {
        try await withCheckedThrowingContinuation { continuation in
            let gate = ContinuationGate<Void>(continuation)
            connection.send(content: bytes, contentContext: .defaultMessage, isComplete: false, completion: .contentProcessed { error in
                if let error {
                    gate.resume(.failure(BridgeFailure.network(stage: .send, error: error)))
                } else {
                    gate.resume(.success(()))
                }
            })
            queue.asyncAfter(deadline: .now() + timeouts.write) {
                gate.resume(.failure(BridgeFailure.timeout(stage: .send)))
            }
        }
    }

    private func close(_ connection: NWConnection, queue: DispatchQueue) async throws {
        try await withCheckedThrowingContinuation { continuation in
            let gate = ContinuationGate<Void>(continuation)
            connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { error in
                if let error {
                    gate.resume(.failure(BridgeFailure.network(stage: .close, error: error)))
                } else {
                    gate.resume(.success(()))
                }
            })
            queue.asyncAfter(deadline: .now() + timeouts.close) {
                gate.resume(.failure(BridgeFailure.timeout(stage: .close)))
            }
        }
    }

    private func mapFailure(_ failure: BridgeFailure, taskId: String) -> NativeTaskExecutionResult {
        switch failure {
        case .timeout(stage: .connect):
            return .failure(taskId: taskId, code: .connectTimeout, stage: .connect, retryable: true)
        case .timeout(stage: .send):
            return .failure(taskId: taskId, code: .writeTimeout, stage: .send, retryable: true)
        case .timeout(stage: .close):
            return .failure(taskId: taskId, code: .closeFailed, stage: .close, retryable: true)
        case .network(stage: let stage, error: let error) where Self.isLocalNetworkPermissionDenied(error):
            return .failure(
                taskId: taskId,
                code: .localNetworkPermissionDenied,
                stage: stage.resultStage,
                retryable: false
            )
        case .network(stage: .connect, error: _), .cancelled(stage: .connect):
            return .failure(taskId: taskId, code: .connectionFailed, stage: .connect, retryable: true)
        case .network(stage: .send, error: _), .cancelled(stage: .send):
            return .failure(taskId: taskId, code: .writeFailed, stage: .send, retryable: true)
        case .network(stage: .close, error: _), .cancelled(stage: .close):
            return .failure(taskId: taskId, code: .closeFailed, stage: .close, retryable: true)
        }
    }

    private static func isLocalNetworkPermissionDenied(_ error: NWError) -> Bool {
        switch error {
        case .posix(let code):
            return code == .EACCES || code == .EPERM
        case .dns(let code):
            return code == -65_570
        default:
            return false
        }
    }
}

private enum BridgeStage {
    case connect
    case send
    case close

    var resultStage: NativeTaskExecutionStage {
        switch self {
        case .connect: return .connect
        case .send: return .send
        case .close: return .close
        }
    }
}

private enum BridgeFailure: Error {
    case timeout(stage: BridgeStage)
    case network(stage: BridgeStage, error: NWError)
    case cancelled(stage: BridgeStage)
}

private final class ContinuationGate<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?

    init(_ continuation: CheckedContinuation<Value, Error>) {
        self.continuation = continuation
    }

    func resume(_ result: Result<Value, Error>) {
        lock.lock()
        guard let continuation else {
            lock.unlock()
            return
        }
        self.continuation = nil
        lock.unlock()
        continuation.resume(with: result)
    }
}
