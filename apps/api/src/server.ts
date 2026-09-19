import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
import { createAudio } from "./services/elevenlabs";
import { createInterpreter } from "./services/interpretation";
config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port.");
const interpreter = createInterpreter(process.env);
const audio = createAudio(process.env);
const app = buildApp({ interpreter, audio });
await app.listen({ host: process.env.HOST ?? "0.0.0.0", port });
console.log(
  "Storyworld API ready on port " +
    port +
    " (" +
    interpreter.mode +
    " interpretation, " +
    audio.mode +
    " audio)",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
