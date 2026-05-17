import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { D1DatabaseLike } from "../orchestrator/processingJobRepo";

function sqliteRowsModified(db: DatabaseSync): number {
  const withMethod = db as DatabaseSync & { getRowsModified?: () => number };
  if (typeof withMethod.getRowsModified === "function") {
    return withMethod.getRowsModified();
  }
  const row = db.prepare("SELECT changes() AS n").get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** In-memory SQLite D1 stand-in for golden harness (schema from `schema.sql`). */
export function createGoldenSqliteD1(repoRoot: string): D1DatabaseLike {
  const db = new DatabaseSync(":memory:");
  const schemaPath = join(repoRoot, "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));

  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              statement.run(...args);
              return { meta: { changes: sqliteRowsModified(db) } };
            },
            async first<T = unknown>(): Promise<T | null> {
              const row = statement.get(...args) as T | undefined;
              return row ?? null;
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      const results: Array<{ meta?: { changes?: number } }> = [];
      for (const stmt of statements) {
        const bound = stmt as { run(): Promise<{ meta?: { changes?: number } }> };
        results.push(await bound.run());
      }
      return results;
    },
  };
}
