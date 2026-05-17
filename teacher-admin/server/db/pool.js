import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const { Pool } = pg

export const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'quizwiz_app',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'quizwiz',
      },
)
