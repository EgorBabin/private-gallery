import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
});

// без обработчика обрыв простаивающего соединения (например, перезапуск
// Postgres) роняет весь процесс
pool.on('error', (err) => {
    console.error('PostgreSQL idle client error:', err.message);
});

export default pool;
