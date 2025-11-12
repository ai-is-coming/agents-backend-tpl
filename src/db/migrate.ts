import Postgrator from 'postgrator'
import { Client } from 'pg'
import fs from 'fs/promises'
import path from 'path'
import { createLogger } from '../utils/logger'

// Minimal Postgrator runner for Bun/TS projects
// - Uses SQL files from src/db/migrations
// - Reads DB settings from environment variables
//
// Required env (example for Postgres):
//   DB_DRIVER=pg            // pg | mysql | mssql | sqlite3
//   DB_URL=postgres://user:pass@localhost:5432/mydb
//   DB_NAME=mydb            // optional; will be derived from DB_URL for pg/mysql

const log = createLogger('migrate')

function getMigrationsGlob(): string {
  return path.join(process.cwd(), 'src', 'db', 'migrations', '*')
}

function parseDbNameFromUrl(urlStr: string): string | undefined {
  try {
    const u = new URL(urlStr)
    const db = u.pathname.replace(/^\//, '')
    return db || undefined
  } catch {
    return undefined
  }
}

async function hasSqlMigrations(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.some((f) => f.toLowerCase().endsWith('.sql'))
  } catch {
    return false
  }
}

async function ensureDatabaseExists(connectionString: string, database: string): Promise<void> {
  // Parse the connection string and connect to 'postgres' (default maintenance DB)
  const url = new URL(connectionString)
  url.pathname = '/postgres'

  const maintenanceClient = new Client({ connectionString: url.toString() })

  try {
    await maintenanceClient.connect()

    // Check if database exists
    const result = await maintenanceClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database]
    )

    if (result.rows.length === 0) {
      log.info({ database }, 'database does not exist, creating...')
      // Create database (cannot use parameterized query for CREATE DATABASE)
      // Sanitize database name to prevent SQL injection
      const sanitizedDbName = database.replace(/[^a-zA-Z0-9_]/g, '')
      if (sanitizedDbName !== database) {
        throw new Error(`Invalid database name: ${database}. Only alphanumeric characters and underscores are allowed.`)
      }
      await maintenanceClient.query(`CREATE DATABASE ${sanitizedDbName}`)
      log.info({ database }, 'database created successfully')
    } else {
      log.info({ database }, 'database already exists')
    }
  } finally {
    await maintenanceClient.end()
  }
}

async function withPg() {
  const connectionString = process.env.DB_URL
  if (!connectionString) throw new Error('Missing env: DB_URL')

  const database = process.env.DB_NAME || parseDbNameFromUrl(connectionString)
  if (!database) throw new Error('Cannot determine DB_NAME; set env DB_NAME explicitly')

  // Ensure database exists before connecting
  await ensureDatabaseExists(connectionString, database)

  const client = new Client({ connectionString })
  await client.connect()

  return {
    database,
    execQuery: (query: string) => client.query(query),
    close: () => client.end(),
  }
}

export async function runMigrations(options?: { to?: string; statusOnly?: boolean }) {
  const driver = 'pg' as const

  const migrationsGlob = getMigrationsGlob()
  const { to, statusOnly } = options ?? {}

  // Ensure database exists first (before checking for migration files)
  const connectionString = process.env.DB_URL
  if (connectionString) {
    const database = process.env.DB_NAME || parseDbNameFromUrl(connectionString)
    if (database) {
      await ensureDatabaseExists(connectionString, database)
    }
  }

  const migrationsDir = path.dirname(migrationsGlob)
  if (!(await hasSqlMigrations(migrationsDir))) {
    log.info({ migrationsDir }, 'no .sql migration files found; skipping migrations')
    return []
  }

  log.info({ driver, migrationsGlob }, 'starting migration runner')

  const client: any = await withPg()

  const postgrator = new Postgrator({
    migrationPattern: migrationsGlob,
    driver: 'pg',
    database: client.database,
    execQuery: client.execQuery,
    schemaTable: 'schema_versions',
  })

  postgrator.on('validation-started', (m: any) => log.info({ m }, 'validation-started'))
  postgrator.on('validation-finished', (m: any) => log.info({ m }, 'validation-finished'))
  postgrator.on('migration-started', (m: any) => log.info({ m }, 'migration-started'))
  postgrator.on('migration-finished', (m: any) => log.info({ m }, 'migration-finished'))

  try {
    if (statusOnly) {
      const current = await postgrator.getDatabaseVersion()
      const max = await postgrator.getMaxVersion()
      log.info({ current, max }, 'migration status')
      return []
    }

    const applied = await postgrator.migrate(to)
    if (!applied || applied.length === 0) {
      log.info('database already at target version')
      return []
    } else {
      log.info({ count: applied.length, files: applied.map((m: any) => m.filename) }, 'migrations applied')
      return applied
    }
  } catch (err: any) {
    log.error({ err, applied: err?.appliedMigrations }, 'migration failed')
    throw err
  } finally {
    await client.close()
  }
}
