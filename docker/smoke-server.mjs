import { createServer } from "node:http";

const host = "0.0.0.0";
const port = 8080;

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");

  if (request.url === "/health") {
    response.writeHead(200);
    response.end(JSON.stringify({ status: "ok", service: "storyworld-docker-smoke" }));
    return;
  }

  response.writeHead(200);
  response.end(JSON.stringify({
    message: "Storyworld Docker is ready.",
    next: "Build the React and Fastify foundation, then run docker compose up --build."
  }));
});

server.listen(port, host, () => {
  console.log(`Storyworld Docker smoke server listening on http://${host}:${port}`);
});
