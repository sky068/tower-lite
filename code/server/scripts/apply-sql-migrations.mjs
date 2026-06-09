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

async function ensureMigrationTable(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_tower_sql_migrations" (
      "name" TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1)::text AS "tableName"`,
    `"${tableName}"`
  );

  return Boolean(rows[0]?.tableName);
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    tableName,
    columnName
  );

  return rows.length > 0;
}

async function enumValueExists(prisma, typeName, enumValue) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT 1
      FROM pg_type type
      JOIN pg_enum enum_value ON enum_value.enumtypid = type.oid
      WHERE type.typname = $1
        AND enum_value.enumlabel = $2
      LIMIT 1
    `,
    typeName,
    enumValue
  );

  return rows.length > 0;
}

async function getAppliedMigrations(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT "name" FROM "_tower_sql_migrations"`);
  return new Set(rows.map((row) => row.name));
}

async function markMigrationApplied(prisma, migrationDir) {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "_tower_sql_migrations" ("name")
      VALUES ($1)
      ON CONFLICT ("name") DO NOTHING
    `,
    migrationDir
  );
}

async function bootstrapExistingDevelopmentDatabase(prisma, migrationDirs, appliedMigrations) {
  if (appliedMigrations.size > 0 || !(await tableExists(prisma, "User"))) {
    return;
  }

  const existingMigrationChecks = {
    "20260606000100_init": () => tableExists(prisma, "User"),
    "20260606000300_task_change_notifications": () =>
      enumValueExists(prisma, "NotificationType", "TASK_STATUS_CHANGED"),
    "20260607000100_task_commented_notifications": () =>
      enumValueExists(prisma, "NotificationType", "TASK_COMMENTED"),
    "20260608000100_activity_log": () => tableExists(prisma, "ActivityLog"),
    "20260609000100_project_trash": () => columnExists(prisma, "TaskList", "deletedAt")
  };

  for (const migrationDir of migrationDirs) {
    const hasMigrationEffect = await existingMigrationChecks[migrationDir]?.();

    if (hasMigrationEffect) {
      await markMigrationApplied(prisma, migrationDir);
      appliedMigrations.add(migrationDir);
      console.log(`Marking existing migration ${migrationDir} as applied`);
    }
  }
}

async function main() {
  const prisma = new PrismaClient();

  try {
    await ensureMigrationTable(prisma);
    const migrationDirs = readdirSync(migrationsRoot)
      .filter((name) => existsSync(join(migrationsRoot, name, "migration.sql")))
      .sort();
    const appliedMigrations = await getAppliedMigrations(prisma);
    await bootstrapExistingDevelopmentDatabase(prisma, migrationDirs, appliedMigrations);

    for (const migrationDir of migrationDirs) {
      if (appliedMigrations.has(migrationDir)) {
        console.log(`Skipping ${migrationDir}`);
        continue;
      }

      console.log(`Applying ${migrationDir}`);
      await executeSqlFile(prisma, join(migrationsRoot, migrationDir, "migration.sql"));
      await markMigrationApplied(prisma, migrationDir);
      appliedMigrations.add(migrationDir);
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
