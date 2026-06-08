import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(serverRoot, "..");
const envFiles = [
  resolve(workspaceRoot, ".env"),
  resolve(serverRoot, ".env")
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");

        if (index === -1) {
          return [line, ""];
        }

        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      })
  );
}

const env = {
  ...process.env
};

for (const envFile of envFiles) {
  Object.assign(env, parseEnvFile(envFile));
}

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Create code/.env from code/.env.example first.");
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/prisma-with-env.mjs <prisma args...>");
  process.exit(1);
}

const prismaBinName = process.platform === "win32" ? "prisma.cmd" : "prisma";
const localPrismaBin = resolve(workspaceRoot, "node_modules", ".bin", prismaBinName);
const prismaCommand = existsSync(localPrismaBin) ? localPrismaBin : "prisma";

const child = spawn(prismaCommand, args, {
  cwd: serverRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("error", (error) => {
  console.error(`Failed to start Prisma CLI: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
