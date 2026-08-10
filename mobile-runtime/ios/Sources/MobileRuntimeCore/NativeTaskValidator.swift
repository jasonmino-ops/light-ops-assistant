import Foundation

public struct NativeTaskValidationFailure: Error, Equatable {
    public let code: NativeTaskErrorCode

    public init(code: NativeTaskErrorCode) {
        self.code = code
    }
}

public struct NativeTaskValidator {
    private let maximumPayloadBytes: Int

    public init(maximumPayloadBytes: Int = NativeTaskContractV1.defaultMaximumPayloadBytes) {
        self.maximumPayloadBytes = maximumPayloadBytes
    }

    public func validate(_ task: NativeTaskV1) -> Result<ValidatedPrintTask, NativeTaskValidationFailure> {
        guard !task.taskId.isEmpty, task.taskId.count <= 128 else {
            return .failure(NativeTaskValidationFailure(code: .invalidTask))
        }
        guard task.contractVersion == NativeTaskContractV1.version else {
            return .failure(NativeTaskValidationFailure(code: .unsupportedContractVersion))
        }
        guard task.taskType == NativeTaskContractV1.printTaskType else {
            return .failure(NativeTaskValidationFailure(code: .unsupportedTaskType))
        }
        guard isValidIPv4(task.payload.target.host),
              task.payload.target.port == NativeTaskContractV1.rawTCPPort else {
            return .failure(NativeTaskValidationFailure(code: .invalidTarget))
        }

        let stream = task.payload.commandStream
        guard stream.encoding == NativeTaskContractV1.base64Encoding,
              stream.byteLength > 0 else {
            return .failure(NativeTaskValidationFailure(code: .invalidCommandStream))
        }

        let maximumEncodedCharacters = ((maximumPayloadBytes + 2) / 3) * 4
        guard stream.byteLength <= maximumPayloadBytes,
              stream.data.count <= maximumEncodedCharacters else {
            return .failure(NativeTaskValidationFailure(code: .payloadTooLarge))
        }
        guard let bytes = Data(base64Encoded: stream.data), bytes.count == stream.byteLength else {
            return .failure(NativeTaskValidationFailure(code: .invalidCommandStream))
        }

        return .success(ValidatedPrintTask(
            taskId: task.taskId,
            host: task.payload.target.host,
            port: UInt16(task.payload.target.port),
            commandStream: bytes
        ))
    }

    private func isValidIPv4(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { part in
            guard !part.isEmpty,
                  part.allSatisfy(\.isNumber),
                  (part.count == 1 || part.first != "0"),
                  let number = Int(part) else {
                return false
            }
            return (0...255).contains(number)
        }
    }
}
