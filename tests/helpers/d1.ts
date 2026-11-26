// A fresh, in-memory local D1 database (workerd, through wrangler's getPlatformProxy) with the
// repository's migrations applied: the same SQL engine and API the worker uses in production.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export const migrationFiles = (): string[] => readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

/** Statements of one migration file, without comments. */
export function statements(file: string): string[] {
  return readFileSync(MIGRATIONS_DIR + file, "utf8")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export async function applyMigration(db: D1Database, file: string): Promise<void> {
  await db.batch(statements(file).map((sql) => db.prepare(sql)));
}

/** `migrations`: how many files to apply, in order (default: all). */
export async function freshD1(migrations = Infinity): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({
    configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)),
    persist: false,
  });
  for (const file of migrationFiles().slice(0, migrations)) await applyMigration(env.DB, file);
  return { db: env.DB, dispose };
}

/** Email binding that records what was sent instead of sending it. */
export function fakeMail() {
  const sent: Array<{ to: string; subject: string; text: string; html: string; replyTo?: string; headers?: Record<string, string> }> = [];
  return { sent, env: { EMAIL: { send: async (m: Record<string, unknown>) => (sent.push(m as never), { messageId: `m${sent.length}` }) }, EMAIL_FROM: "noreply@akt16.org" } };
}
