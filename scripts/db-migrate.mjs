import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const db = drizzle(pool);
await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
const { rows } = await pool.query("select table_name from information_schema.tables where table_schema='public' order by table_name");
console.log("tables:", rows.map((r) => r.table_name).join(", "));
await pool.end();
