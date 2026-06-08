import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(serverRoot, "..");
const migrationsRoot = resolve(serverRoot, "prisma", "migrations");

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

Object.assign(
  process.env,
  parseEnvFile(resolve(workspaceRoot, ".env")),
  parseEnvFile(resolve(serverRoot, ".env"))
);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Create code/.env from code/.env.example first.");
  process.exit(1);
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarQuoteTag = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (!singleQuoted && !doubleQuoted && !dollarQuoteTag && char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        current += sql[index];
        index += 1;
      }
      current += "\n";
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "$") {
      const rest = sql.slice(index);
      const match = rest.match(/^\$[A-Za-z0-9_]*\$/);

      if (match) {
        const tag = match[0];
        current += tag;
        index += tag.length - 1;

        if (dollarQuoteTag === tag) {
          dollarQuoteTag = null;
        } else if (!dollarQuoteTag) {
          dollarQuoteTag = tag;
        }

        continue;
      }
    }

    if (!doubleQuoted && !dollarQuoteTag && char === "'" && sql[index - 1] !== "\\") {
      singleQuoted = !singleQuoted;
      current += char;
      continue;
    }

    if (!singleQuoted && !dollarQuoteTag && char === "\"") {
      doubleQuoted = !doubleQuoted;
      current += char;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && !dollarQuoteTag && char === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

async function executeSqlFile(prisma, filePath) {
  const sql = readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function relationExists(prisma, relationName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1) AS "name"`,
    relationName
  );

  return Boolean(rows[0]?.name);
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const migrationDirs = readdirSync(migrationsRoot)
      .filter((name) => existsSync(join(migrationsRoot, name, "migration.sql")))
      .sort();
    const initMigration = migrationDirs.find((name) => name.endsWith("_init"));
    const hasUserTable = await relationExists(prisma, "\"User\"");

    if (!hasUserTable) {
      if (!initMigration) {
        throw new Error("Initial migration not found.");
      }

      console.log(`Applying ${initMigration}`);
      await executeSqlFile(prisma, join(migrationsRoot, initMigration, "migration.sql"));
    } else {
      console.log("Initial schema already exists.");
    }

    for (const migrationDir of migrationDirs) {
      if (migrationDir === initMigration) {
        continue;
      }

      console.log(`Applying ${migrationDir}`);
      await executeSqlFile(prisma, join(migrationsRoot, migrationDir, "migration.sql"));
    }

    console.log("SQL migrations applied.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
