import Postgrator from 'postgrator'
import path from 'path'
import { createLogger } from '../utils/logger'

const log = createLogger('migrate')

async function ensureDatabaseExists(connectionString: string) {
  const { Pool } = (await import('pg')) as any

  // Parse database name from connection string
  const dbNameMatch = connectionString.match(/\/([^/?]+)(\?|$)/)
  if (!dbNameMatch) {
    log.warn('Could not parse database name from DB_URL')
    return
  }
  const dbName = dbNameMatch[1]

  // Connect to postgres database to check if target database exists
  const postgresUrl = connectionString.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
  const adminPool = new Pool({ connectionString: postgresUrl })

  try {
    // Check if database exists
    const result = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    )

    if (result.rows.length === 0) {
      log.info({ dbName }, 'Database does not exist, creating...')
      await adminPool.query(`CREATE DATABASE "${dbName}"`)
      log.info({ dbName }, 'Database created successfully')
    } else {
      log.info({ dbName }, 'Database already exists')
    }
  } catch (err) {
    log.error({ err, dbName }, 'Failed to check/create database')
    throw err
  } finally {
    await adminPool.end()
  }
}

export async function runMigrations() {
  const connectionString = process.env.DB_URL
  if (!connectionString) {
    log.warn('DB_URL is not set; skipping migrations')
    return
  }

  // Ensure database exists before running migrations
  await ensureDatabaseExists(connectionString)

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

