import pool from '../db.js';

// Очередь фоновых задач в PostgreSQL вместо RabbitMQ: отдельный брокер
// для пары задач в минуту стоил сотни мегабайт памяти.
// - publishPhotoJob: INSERT + NOTIFY, воркер просыпается сразу;
// - claimNextJob: FOR UPDATE SKIP LOCKED, задачу берёт ровно один воркер;
// - задача, захваченная упавшим воркером, через JOB_LOCK_TIMEOUT_MS
//   возвращается в очередь (как redelivery неподтверждённого сообщения).

const JOBS_CHANNEL = 'gallery_jobs';
const JOB_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
export const JOB_MAX_ATTEMPTS = 2;

let ensureTablePromise = null;

export function ensureJobsTable() {
    if (!ensureTablePromise) {
        ensureTablePromise = pool
            .query(
                `CREATE TABLE IF NOT EXISTS public.jobs (
                    id bigserial PRIMARY KEY,
                    payload jsonb NOT NULL,
                    attempts integer NOT NULL DEFAULT 0,
                    locked_at timestamptz,
                    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
                )`,
            )
            .catch((err) => {
                ensureTablePromise = null;
                throw err;
            });
    }
    return ensureTablePromise;
}

export async function publishPhotoJob(payload) {
    await ensureJobsTable();
    await pool.query(
        `WITH inserted AS (
            INSERT INTO public.jobs (payload) VALUES ($1) RETURNING id
        )
        SELECT pg_notify($2, id::text) FROM inserted`,
        [JSON.stringify(payload ?? {}), JOBS_CHANNEL],
    );
}

/** @returns {Promise<{id: string, payload: object, attempts: number}|null>} */
export async function claimNextJob() {
    await ensureJobsTable();
    const { rows } = await pool.query(
        `UPDATE public.jobs
         SET locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1
         WHERE id = (
             SELECT id FROM public.jobs
             WHERE locked_at IS NULL
                OR locked_at < CURRENT_TIMESTAMP - make_interval(secs => $1)
             ORDER BY id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         RETURNING id, payload, attempts`,
        [JOB_LOCK_TIMEOUT_MS / 1000],
    );
    return rows[0] || null;
}

export async function completeJob(id) {
    await pool.query('DELETE FROM public.jobs WHERE id = $1', [id]);
}

/** Вернуть задачу в очередь (например, при остановке воркера посреди работы). */
export async function releaseJob(id) {
    await pool.query(
        'UPDATE public.jobs SET locked_at = NULL, attempts = GREATEST(attempts - 1, 0) WHERE id = $1',
        [id],
    );
}

/**
 * Подписка на новые задачи. Возвращает функцию отписки.
 * onError вызывается при обрыве соединения: подписку нужно создать заново.
 */
export async function listenForJobs(onJob, onError) {
    await ensureJobsTable();
    const client = await pool.connect();
    let released = false;

    const release = (err) => {
        if (released) {
            return;
        }
        released = true;
        client.removeAllListeners('notification');
        client.removeAllListeners('error');
        client.release(err);
    };

    client.on('notification', () => onJob());
    client.on('error', (err) => {
        release(err);
        onError(err);
    });

    try {
        await client.query(`LISTEN ${JOBS_CHANNEL}`);
    } catch (err) {
        release(err);
        throw err;
    }

    return async () => {
        if (released) {
            return;
        }
        try {
            await client.query(`UNLISTEN ${JOBS_CHANNEL}`);
        } catch {
            // соединение уже закрыто
        }
        release();
    };
}
