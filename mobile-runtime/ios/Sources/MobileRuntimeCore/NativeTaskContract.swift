import Foundation

public enum NativeTaskContractV1 {
    public static let version = "1.0"
    public static let printTaskType = "print"
    public static let base64Encoding = "base64"
    public static let rawTCPPort = 9_100
    public static let defaultMaximumPayloadBytes = 8 * 1_024 * 1_024
}

public struct NativeTaskV1: Codable, Equatable {
    public let contractVersion: String
    public let taskId: String
    public let taskType: String
    public let payload: PrintTaskPayload

    public init(
        contractVersion: String,
        taskId: String,
        taskType: String,
        payload: PrintTaskPayload
    ) {
        self.contractVersion = contractVersion
        self.taskId = taskId
        self.taskType = taskType
        self.payload = payload
    }
}

public struct PrintTaskPayload: Codable, Equatable {
    public let target: PrintTaskTarget
    public let commandStream: PrintCommandStream

    public init(target: PrintTaskTarget, commandStream: PrintCommandStream) {
        self.target = target
        self.commandStream = commandStream
    }
}

public struct PrintTaskTarget: Codable, Equatable {
    public let host: String
    public let port: Int

    public init(host: String, port: Int) {
        self.host = host
        self.port = port
    }
}

public struct PrintCommandStream: Codable, Equatable {
    public let encoding: String
    public let byteLength: Int
    public let data: String

    public init(encoding: String, byteLength: Int, data: String) {
        self.encoding = encoding
        self.byteLength = byteLength
        self.data = data
    }
}

public struct ValidatedPrintTask: Equatable {
    public let taskId: String
    public let host: String
    public let port: UInt16
    public let commandStream: Data

    public init(taskId: String, host: String, port: UInt16, commandStream: Data) {
        self.taskId = taskId
        self.host = host
        self.port = port
        self.commandStream = commandStream
    }
}

public enum NativeTaskExecutionStatus: String, Codable, Equatable {
    case success
    case failure
}

public enum NativeTaskErrorCode: String, Codable, CaseIterable, Equatable {
    case invalidTask = "INVALID_TASK"
    case unsupportedContractVersion = "UNSUPPORTED_CONTRACT_VERSION"
    case unsupportedTaskType = "UNSUPPORTED_TASK_TYPE"
    case invalidTarget = "INVALID_TARGET"
    case invalidCommandStream = "INVALID_COMMAND_STREAM"
    case payloadTooLarge = "PAYLOAD_TOO_LARGE"
    case localNetworkPermissionDenied = "LOCAL_NETWORK_PERMISSION_DENIED"
    case connectTimeout = "CONNECT_TIMEOUT"
    case connectionFailed = "CONNECTION_FAILED"
    case writeTimeout = "WRITE_TIMEOUT"
    case writeFailed = "WRITE_FAILED"
    case closeFailed = "CLOSE_FAILED"
    case internalError = "INTERNAL_ERROR"
}

public enum NativeTaskExecutionStage: String, Codable, Equatable {
    case validate
    case connect
    case send
    case close
    case runtime
}

public struct NativeTaskSuccessPayload: Codable, Equatable {
    public let bytesSent: Int
    public let durationMs: Int

    public init(bytesSent: Int, durationMs: Int) {
        self.bytesSent = bytesSent
        self.durationMs = durationMs
    }
}

public struct NativeTaskFailurePayload: Codable, Equatable {
    public let code: NativeTaskErrorCode
    public let stage: NativeTaskExecutionStage
    public let retryable: Bool

    public init(code: NativeTaskErrorCode, stage: NativeTaskExecutionStage, retryable: Bool) {
        self.code = code
        self.stage = stage
        self.retryable = retryable
    }
}

public struct NativeTaskExecutionResult: Codable, Equatable {
    public let contractVersion: String
    public let taskId: String
    public let taskType: String
    public let status: NativeTaskExecutionStatus
    public let result: NativeTaskSuccessPayload?
    public let error: NativeTaskFailurePayload?

    public static func success(taskId: String, bytesSent: Int, durationMs: Int) -> Self {
        Self(
            contractVersion: NativeTaskContractV1.version,
            taskId: taskId,
            taskType: NativeTaskContractV1.printTaskType,
            status: .success,
            result: NativeTaskSuccessPayload(bytesSent: bytesSent, durationMs: durationMs),
            error: nil
        )
    }

    public static func failure(
        taskId: String,
        code: NativeTaskErrorCode,
        stage: NativeTaskExecutionStage,
        retryable: Bool
    ) -> Self {
        Self(
            contractVersion: NativeTaskContractV1.version,
            taskId: taskId,
            taskType: NativeTaskContractV1.printTaskType,
            status: .failure,
            result: nil,
            error: NativeTaskFailurePayload(code: code, stage: stage, retryable: retryable)
        )
    }
}
