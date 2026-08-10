import Foundation

public enum ResultBridge {
    public static func jsonObject(for result: NativeTaskExecutionResult) -> Any {
        do {
            let encoded = try JSONEncoder().encode(result)
            return try JSONSerialization.jsonObject(with: encoded)
        } catch {
            return [
                "contractVersion": NativeTaskContractV1.version,
                "taskId": result.taskId,
                "taskType": NativeTaskContractV1.printTaskType,
                "status": NativeTaskExecutionStatus.failure.rawValue,
                "error": [
                    "code": NativeTaskErrorCode.internalError.rawValue,
                    "stage": NativeTaskExecutionStage.runtime.rawValue,
                    "retryable": false,
                ],
            ]
        }
    }
}
