import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const stateDir = join(root, ".tmp", "dev");
const services = [
  { name: "server", port: 4000 },
  { name: "client", port: 5173 }
];

function pidFile(serviceName) {
  return join(stateDir, `${serviceName}.pid`);
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

function removePidFile(serviceName) {
  rmSync(pidFile(serviceName), { force: true });
}

function stopPid(pid, label) {
  if (!isRunning(pid)) {
    console.log(`ok   ${label} already stopped`);
    return true;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }

  return true;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });

  return result.status === 0 ? result.stdout.trim() : "";
}

function listeningPids(port) {
  const output = commandOutput("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"]);

  return output
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function processCwd(pid) {
  const output = commandOutput("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  const line = output.split(/\r?\n/).find((item) => item.startsWith("n"));
  return line ? line.slice(1) : "";
}

function stopPortIfOwnedByProject(service) {
  const pids = listeningPids(service.port);

  for (const pid of pids) {
    const cwd = processCwd(pid);

    if (!cwd.startsWith(root)) {
      console.log(`warn ${service.name} port ${service.port} is used by pid ${pid} outside this project - leaving it untouched`);
      continue;
    }

    if (stopPid(pid, `${service.name} port ${service.port} pid ${pid}`)) {
      console.log(`stop ${service.name} port ${service.port} - pid ${pid}`);
    } else {
      console.log(`warn failed to stop ${service.name} port ${service.port} - pid ${pid}`);
    }
  }
}

for (const service of services) {
  const pid = readPid(service.name);

  if (pid) {
    if (stopPid(pid, service.name)) {
      console.log(`stop ${service.name} - pid ${pid}`);
    } else {
      console.log(`warn failed to stop ${service.name} - pid ${pid}`);
    }
    removePidFile(service.name);
  } else {
    console.log(`ok   ${service.name} has no pid file`);
  }

  stopPortIfOwnedByProject(service);
}

writeFileSync(join(stateDir, "last-stop.txt"), `${new Date().toISOString()}\n`, {
  flag: "a"
});

console.log("");
console.log("Done. Check ports with: lsof -nP -iTCP:4000 -sTCP:LISTEN && lsof -nP -iTCP:5173 -sTCP:LISTEN");
