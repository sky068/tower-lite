import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const composeFiles = ["-f", "docker-compose.prod.yml"];
const shouldSeed = process.argv.includes("--seed");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(resolve(root, ".env"))) {
  console.error("Missing .env. Create it first:");
  console.error("  cp .env.example .env");
  process.exit(1);
}

console.log("Starting PostgreSQL and Redis...");
run("docker", ["compose", ...composeFiles, "up", "-d", "--build", "postgres", "redis"]);

console.log("Applying database migrations...");
run("docker", ["compose", ...composeFiles, "run", "--rm", "server", "npm", "run", "prisma:migrate", "--workspace", "server"]);

if (shouldSeed) {
  console.log("Seeding initial data...");
  run("docker", ["compose", ...composeFiles, "run", "--rm", "server", "npm", "run", "prisma:seed", "--workspace", "server"]);
}

console.log("Starting Tower Lite...");
run("docker", ["compose", ...composeFiles, "up", "-d", "--build", "server", "client"]);

console.log("");
console.log("Tower Lite is starting.");
console.log("Open the address configured by WEB_PORT, default: http://localhost:8080");
console.log("Logs: npm run deploy:logs");
console.log("Stop: npm run deploy:down");
