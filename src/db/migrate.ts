import Postgrator from 'postgrator'
import path from 'path'
import fs from 'fs'
import { createLogger } from '../utils/logger'

const log = createLogger('migrate')

export async function runMigrations() {
  const connectionString = process.env.DB_URL
  if (!connectionString) {
    log.warn('DB_URL is not set; skipping migrations')
    return
  }

  // Resolve migrations directory relative to the backend project root
  // We run `make dev` from agents-backend-tpl, so cwd is the project root here.
  // Do NOT prefix with 'agents-backend-tpl' again, otherwise the path is duplicated.
  const migrationsDirectory = path.join(process.cwd(), 'src', 'db', 'migrations')
  const { Pool } = (await import('pg')) as any
  const pool = new Pool({ connectionString })

  const postgrator = new Postgrator({
    migrationPattern: path.join(migrationsDirectory, '*.sql'),
    driver: 'pg',
    schemaTable: 'schema_migrations',
    execQuery: async (query: string) => {
      const res = await pool.query(query)
      return { rows: res.rows }
    },
    execSqlScript: async (sql: string) => {
      await pool.query(sql)
    },
  })

  try {
    const result = await postgrator.migrate()
    const latest = Array.isArray(result) ? result[result.length - 1] : result
    if (latest) {
      log.info({ version: (latest as any).version }, 'migrations applied')
    } else {
      log.info('no migrations to run')
    }
  } finally {
    await pool.end()
  }
}

