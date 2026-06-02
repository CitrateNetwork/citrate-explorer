import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = neon(url);
const db = drizzle(sql);
await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
const rows = await sql`select table_name from information_schema.tables where table_schema='public' order by table_name`;
console.log("tables:", rows.map(r => r.table_name).join(", "));
