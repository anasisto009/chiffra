import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../config.js";

const { Pool } = pg;

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(currentDir, "schema.sql");

const pool = new Pool({
  connectionString: env.databaseUrl
});

try {
  const schemaSql = await readFile(schemaPath, "utf8");
  await pool.query(schemaSql);
  console.log("PostgreSQL schema migrated successfully.");
} finally {
  await pool.end();
}

