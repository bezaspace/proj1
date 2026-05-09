import 'dotenv/config'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { env } from '../env.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(dirname, '../../migrations')

async function main() {
  const pool = new pg.Pool({ connectionString: env.databaseUrl })

  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()

  for (const file of files) {
    const alreadyApplied = await pool.query('select 1 from schema_migrations where id = $1', [file])
    if (alreadyApplied.rowCount) {
      continue
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    await pool.query('begin')
    try {
      await pool.query(sql)
      await pool.query('insert into schema_migrations (id) values ($1)', [file])
      await pool.query('commit')
      console.log(`Applied migration ${file}`)
    } catch (error) {
      await pool.query('rollback')
      throw error
    }
  }

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
