import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { InferenceGateway } from "./InferenceGateway.js";

export interface InferenceGatewayServerOptions {
  readonly gateway: InferenceGateway;
  readonly host: string;
  readonly port: number;
  readonly maxRequestBodyBytes: number;
}

export interface InferenceGatewayServer {
  start(): Promise<{ readonly url: string }>;
  close(): Promise<void>;
}

const readBody = async (
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const requestHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
};

const sendResponse = async (
  response: Response,
  outgoing: ServerResponse,
): Promise<void> => {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  if (!response.body) {
    outgoing.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!outgoing.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => outgoing.once("drain", resolve));
      }
    }
    outgoing.end();
  } catch (error) {
    outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
  }
};

export const createInferenceGatewayServer = (
  options: InferenceGatewayServerOptions,
): InferenceGatewayServer => {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const hostHeader = incoming.headers.host ?? `${options.host}:${options.port}`;
      const url = new URL(incoming.url ?? "/", `http://${hostHeader}`);
      const method = incoming.method ?? "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      const body = hasBody
        ? await readBody(incoming, options.maxRequestBodyBytes)
        : undefined;
      const request = new Request(url, {
        method,
        headers: requestHeaders(incoming),
        body,
      });
      const response = await options.gateway.handle(request);
      await sendResponse(response, outgoing);
    } catch (error) {
      if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") {
        outgoing.statusCode = 413;
        outgoing.setHeader("content-type", "application/json");
        outgoing.end(
          JSON.stringify({ error: { message: "Request body exceeds gateway limit" } }),
        );
        return;
      }
      outgoing.statusCode = 500;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(
        JSON.stringify({
          error: {
            message:
              error instanceof Error
                ? `Inference gateway failed: ${error.message}`
                : "Inference gateway failed",
          },
        }),
      );
    }
  });

  return {
    start(): Promise<{ readonly url: string }> {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(options.port, options.host, () => {
          server.off("error", onError);
          const address = server.address() as AddressInfo;
          resolve({ url: `http://${options.host}:${address.port}` });
        });
      });
    },
    async close(): Promise<void> {
      await options.gateway.waitForIdle();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};
