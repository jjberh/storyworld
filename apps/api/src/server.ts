import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port.");
const app = buildApp();
await app.listen({ host: process.env.HOST ?? "0.0.0.0", port });
console.log("Storyworld API ready on port " + port + " (fixture providers)");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
