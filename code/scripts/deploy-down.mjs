import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const args = ["compose", "-f", "docker-compose.prod.yml", "down"];

if (process.argv.includes("--volumes")) {
  args.push("--volumes");
}

const result = spawnSync("docker", args, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
