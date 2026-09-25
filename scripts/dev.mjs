import { spawn } from "node:child_process";

const server = spawn("node", ["server/index.mjs"], { stdio: "inherit", env: { ...process.env, PORT: "8787" } });
const web = spawn("npm", ["--prefix", "apps/web", "run", "dev"], { stdio: "inherit" });

function stop() {
  server.kill();
  web.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", (code) => {
  server.kill();
  process.exit(code ?? 0);
});
