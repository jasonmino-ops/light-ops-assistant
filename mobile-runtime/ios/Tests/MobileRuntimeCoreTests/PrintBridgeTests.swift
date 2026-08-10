import Foundation
@preconcurrency import Network
import XCTest
@testable import MobileRuntimeCore

final class PrintBridgeTests: XCTestCase {
    func testPrintBridgeConnectsSendsExactBytesAndCloses() async throws {
        let listenerReady = expectation(description: "listener ready")
        let streamReceived = expectation(description: "stream received")
        let listener = try NWListener(using: .tcp, on: .any)
        let listenerQueue = DispatchQueue(label: "mobile-runtime.tests.listener")
        let expected = Data([0x1b, 0x40, 0x01, 0x00, 0xff, 0x1d, 0x56, 0x00])
        var received = Data()
        var assignedPort: UInt16?

        listener.stateUpdateHandler = { state in
            if case .ready = state {
                assignedPort = listener.port?.rawValue
                listenerReady.fulfill()
            }
        }
        listener.newConnectionHandler = { connection in
            connection.start(queue: listenerQueue)
            var receiveNext: (() -> Void)!
            receiveNext = {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { content, _, isComplete, error in
                    if let content { received.append(content) }
                    if isComplete || error != nil {
                        connection.cancel()
                        streamReceived.fulfill()
                    } else {
                        receiveNext()
                    }
                }
            }
            receiveNext()
        }
        listener.start(queue: listenerQueue)
        defer { listener.cancel() }

        await fulfillment(of: [listenerReady], timeout: 2)
        let port = try XCTUnwrap(assignedPort)
        let bridge = PrintBridge(timeouts: PrintBridgeTimeouts(connect: 2, write: 2, close: 2))
        let task = ValidatedPrintTask(
            taskId: "print-bridge-roundtrip",
            host: "127.0.0.1",
            port: port,
            commandStream: expected
        )

        let result = await bridge.execute(task)
        await fulfillment(of: [streamReceived], timeout: 2)

        XCTAssertEqual(result.status, .success)
        XCTAssertEqual(result.taskId, task.taskId)
        XCTAssertEqual(result.result?.bytesSent, expected.count)
        XCTAssertEqual(received, expected)
    }

    func testPrintBridgeReturnsStableConnectionFailure() async {
        let bridge = PrintBridge(timeouts: PrintBridgeTimeouts(connect: 1, write: 1, close: 1))
        let task = ValidatedPrintTask(
            taskId: "print-bridge-offline",
            host: "127.0.0.1",
            port: 9,
            commandStream: Data([0x1b, 0x40])
        )

        let result = await bridge.execute(task)

        XCTAssertEqual(result.status, .failure)
        XCTAssertTrue(result.error?.code == .connectionFailed || result.error?.code == .connectTimeout)
        XCTAssertEqual(result.error?.stage, .connect)
    }
}
