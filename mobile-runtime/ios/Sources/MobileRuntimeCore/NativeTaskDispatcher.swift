import Foundation

public protocol PrintTaskExecuting {
    func execute(_ task: ValidatedPrintTask) async -> NativeTaskExecutionResult
}

public final class NativeTaskDispatcher {
    private let validator: NativeTaskValidator
    private let printExecutor: PrintTaskExecuting

    public init(
        validator: NativeTaskValidator = NativeTaskValidator(),
        printExecutor: PrintTaskExecuting = PrintBridge()
    ) {
        self.validator = validator
        self.printExecutor = printExecutor
    }

    public func dispatch(jsonObject: Any) async -> NativeTaskExecutionResult {
        let fallbackTaskId = Self.taskId(from: jsonObject) ?? "invalid-task"
        guard JSONSerialization.isValidJSONObject(jsonObject),
              let encoded = try? JSONSerialization.data(withJSONObject: jsonObject),
              let task = try? JSONDecoder().decode(NativeTaskV1.self, from: encoded) else {
            return .failure(
                taskId: fallbackTaskId,
                code: .invalidTask,
                stage: .validate,
                retryable: false
            )
        }

        switch validator.validate(task) {
        case .success(let validatedTask):
            return await printExecutor.execute(validatedTask)
        case .failure(let failure):
            return .failure(
                taskId: task.taskId,
                code: failure.code,
                stage: .validate,
                retryable: false
            )
        }
    }

    private static func taskId(from jsonObject: Any) -> String? {
        guard let dictionary = jsonObject as? [String: Any],
              let taskId = dictionary["taskId"] as? String,
              !taskId.isEmpty else {
            return nil
        }
        return String(taskId.prefix(128))
    }
}
