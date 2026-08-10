import UIKit
import WebKit

final class WebHostViewController: UIViewController, WKNavigationDelegate {
    private let nativeTaskBridge = NativeTaskBridge()
    private lazy var webView = makeWebView()
    private lazy var webURL = configuredWebURL()

    override func loadView() {
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.load(URLRequest(url: webURL))
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: NativeTaskBridge.messageHandlerName,
            contentWorld: .page
        )
    }

    private func makeWebView() -> WKWebView {
        let contentController = WKUserContentController()
        contentController.addScriptMessageHandler(
            nativeTaskBridge,
            contentWorld: .page,
            name: NativeTaskBridge.messageHandlerName
        )
        contentController.addUserScript(WKUserScript(
            source: Self.browserFacadeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .page
        ))

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
#if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
#endif
        return webView
    }

    private func configuredWebURL() -> URL {
        if let override = ProcessInfo.processInfo.environment["ESHOP_WEB_URL"],
           let url = URL(string: override),
           url.scheme == "https" {
            return url
        }
        guard let configured = Bundle.main.object(forInfoDictionaryKey: "EShopWebURL") as? String,
              let url = URL(string: configured),
              url.scheme == "https" else {
            preconditionFailure("EShopWebURL must be a valid HTTPS URL")
        }
        return url
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let targetURL = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if Self.sameOrigin(targetURL, webURL) {
            decisionHandler(.allow)
            return
        }
        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(targetURL)
        }
        decisionHandler(.cancel)
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(lhs) == effectivePort(rhs)
    }

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        return url.scheme?.lowercased() == "https" ? 443 : nil
    }

    private static let browserFacadeScript = """
    (() => {
      if (Object.prototype.hasOwnProperty.call(window, 'eshopMobileRuntime')) return;
      const handler = window.webkit?.messageHandlers?.eshopNativeTask;
      if (!handler) return;
      Object.defineProperty(window, 'eshopMobileRuntime', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: Object.freeze({
          contractVersion: '1.0',
          submitTask(task) {
            return handler.postMessage(task);
          }
        })
      });
    })();
    """
}
