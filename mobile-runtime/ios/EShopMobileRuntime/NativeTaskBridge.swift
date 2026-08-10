import WebKit

final class NativeTaskBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let messageHandlerName = "eshopNativeTask"

    private let dispatcher: NativeTaskDispatcher

    init(dispatcher: NativeTaskDispatcher = NativeTaskDispatcher()) {
        self.dispatcher = dispatcher
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame else {
            let rejected = NativeTaskExecutionResult.failure(
                taskId: "invalid-task",
                code: .invalidTask,
                stage: .validate,
                retryable: false
            )
            replyHandler(ResultBridge.jsonObject(for: rejected), nil)
            return
        }
        Task { @MainActor in
            let result = await dispatcher.dispatch(jsonObject: message.body)
            replyHandler(ResultBridge.jsonObject(for: result), nil)
        }
    }
}
