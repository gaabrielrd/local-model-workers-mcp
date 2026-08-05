import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-test HTTP responder that can misbehave on demand.
 *
 * Each fault models a real failure the model hop can hit: a provider that dies
 * mid-response, a proxy that truncates a stream, an appliance that returns an
 * HTML error page, or a host that simply stops answering.
 */
export type Fault =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "disconnect-mid-body" }
  | { readonly kind: "truncated-sse" }
  | { readonly kind: "interleaved-sse" }
  | { readonly kind: "non-json"; readonly body?: string }
  | { readonly kind: "slow"; readonly delayMs: number; readonly body: unknown }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "empty-body" };

export interface FaultResponder {
  readonly baseUrl: string;
  readonly requestCount: () => number;
  /** Queues faults consumed one per request; the last one repeats. */
  readonly queue: (...faults: readonly Fault[]) => void;
  readonly close: () => Promise<void>;
}

export async function startFaultResponder(
  initial: readonly Fault[] = [{ kind: "ok", body: { data: [] } }],
): Promise<FaultResponder> {
  let faults: Fault[] = [...initial];
  let requests = 0;

  const server: Server = createServer((request, response) => {
    requests += 1;
    const fault = faults.length > 1 ? (faults.shift() as Fault) : faults[0];
    request.resume();

    switch (fault?.kind) {
      case "disconnect-mid-body": {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"choices":[{"message":{"content":"{\\"partia');
        response.socket?.destroy();
        return;
      }
      case "truncated-sse": {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"choices":[{"delta":{"content":"he');
        response.socket?.destroy();
        return;
      }
      case "interleaved-sse": {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(": keep-alive\n\n");
        response.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      case "non-json": {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(fault.body ?? "<html><body>Gateway</body></html>");
        return;
      }
      case "slow": {
        setTimeout(() => {
          if (response.writableEnded) {
            return;
          }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(fault.body));
        }, fault.delayMs).unref();
        return;
      }
      case "status": {
        response.writeHead(fault.status, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ error: "injected" }));
        return;
      }
      case "empty-body": {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("");
        return;
      }
      default: {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify((fault as { body: unknown }).body));
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    queue: (...next) => {
      faults = [...next];
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
