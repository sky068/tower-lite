import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const stateDir = join(root, ".tmp", "dev");
const services = [
  {
    name: "server",
    command: ["npm", "run", "dev:server"],
    port: 4000,
    url: "http://127.0.0.1:4000/api/v1"
  },
  {
    name: "client",
    command: ["npm", "run", "dev:client"],
    port: 5173,
    url: "http://127.0.0.1:5173"
  }
];

function pidFile(serviceName) {
  return join(stateDir, `${serviceName}.pid`);
}

function logFile(serviceName) {
  return join(stateDir, `${serviceName}.log`);
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(serviceName) {
  const file = pidFile(serviceName);

  if (!existsSync(file)) {
    return null;
  }

  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port, timeout: 500 });
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

async function waitForPort(port) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function startService(service) {
  const existingPid = readPid(service.name);

  if (existingPid && isRunning(existingPid)) {
    console.log(`ok   ${service.name} already started - pid ${existingPid}, ${service.url}`);
    return;
  }

  if (await canConnect(service.port)) {
    console.log(`warn ${service.name} port ${service.port} is already in use - leaving it untouched`);
    return;
  }

  const out = openSync(logFile(service.name), "a");
  const err = openSync(logFile(service.name), "a");
  const child = spawn(service.command[0], service.command.slice(1), {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, err],
    env: process.env
  });

  child.unref();
  writeFileSync(pidFile(service.name), `${child.pid}\n`);
  console.log(`boot ${service.name} - pid ${child.pid}, log ${logFile(service.name)}`);

  if (await waitForPort(service.port)) {
    console.log(`ok   ${service.name} ready - ${service.url}`);
    return;
  }

  console.log(`warn ${service.name} did not open port ${service.port} within 30s; check ${logFile(service.name)}`);
}

mkdirSync(stateDir, { recursive: true });

for (const service of services) {
  await startService(service);
}

console.log("");
console.log("Dev services:");
for (const service of services) {
  console.log(`- ${service.name}: ${service.url}`);
}
console.log("");
console.log("Stop with: npm run dev:down");
