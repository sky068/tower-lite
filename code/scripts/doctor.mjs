import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const envPath = join(root, ".env");
const envExamplePath = join(root, ".env.example");

const checks = [];

function addCheck(name, ok, detail, level = "fail") {
  checks.push({ name, ok, detail, level });
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    cwd: root,
    encoding: "utf8"
  });
  return result.status === 0;
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index === -1) {
          return [line, ""];
        }

        const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
        return [line.slice(0, index), value];
      })
  );
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 1200 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
addCheck("Node.js >= 18", nodeMajor >= 18, process.versions.node);
addCheck(".env.example exists", existsSync(envExamplePath), ".env.example");
addCheck(".env exists", existsSync(envPath), ".env");
addCheck("docker command", commandExists("docker"), "optional, used by docker-compose.yml", "warn");
addCheck("psql command", commandExists("psql"), "optional, useful for manual PostgreSQL checks", "warn");

const env = parseEnvFile(envPath);
const databaseUrl = env.DATABASE_URL;
addCheck("DATABASE_URL configured", Boolean(databaseUrl), databaseUrl ? "found" : "missing");

if (databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname || "localhost";
    const port = Number(url.port || 5432);
    addCheck(`PostgreSQL TCP ${host}:${port}`, await canConnect(host, port), "database port");
  } catch {
    addCheck("DATABASE_URL parseable", false, "invalid DATABASE_URL");
  }
}

const failed = checks.filter((check) => !check.ok && check.level === "fail");

for (const check of checks) {
  const icon = check.ok ? "ok" : check.level;
  console.log(`${icon.padEnd(4)} ${check.name} - ${check.detail}`);
}

if (failed.length > 0) {
  console.log("");
  console.log("Some checks failed. Fix the failed items before running database migration or the API server.");
  process.exit(1);
}

console.log("");
console.log("Environment looks ready.");
