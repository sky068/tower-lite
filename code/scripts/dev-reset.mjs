import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    if (args.join(" ") === "run docker:reset") {
      console.error("");
      console.error("Docker reset failed. If Docker Desktop is not running, start it first:");
      console.error("  open -a Docker");
    }

    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "docker:reset"]);
run("npm", ["run", "prisma:migrate"]);
run("npm", ["run", "prisma:seed"]);
