import {
  createInferenceGateway,
  createInferenceGatewayServer,
  JsonlInferenceTelemetrySink,
  loadInferenceGatewayConfig,
} from "./index.js";

const config = loadInferenceGatewayConfig();
const telemetry = new JsonlInferenceTelemetrySink(config.telemetryPath);
const gateway = createInferenceGateway({ config, telemetry });
const server = createInferenceGatewayServer({
  gateway,
  host: config.host,
  port: config.port,
  maxRequestBodyBytes: config.maxRequestBodyBytes,
});

const { url } = await server.start();
console.log(`Sandcastle inference gateway listening at ${url}/v1`);
console.log(`Allowed models: ${config.allowedModels.join(", ")}`);
console.log(`Telemetry: ${config.telemetryPath}`);

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await server.close();
};

process.once("SIGINT", () => {
  void close().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});
