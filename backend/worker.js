import 'dotenv/config';
import { createPhotoConsumerChannel } from './utils/rabbitmq.js';
import { processPhotoJob } from './workers/photoJobProcessor.js';

const PREFETCH_DEFAULT = 1;
const rawPrefetch = Number(
    process.env.PHOTO_WORKER_PREFETCH || PREFETCH_DEFAULT,
);
const prefetch =
    Number.isInteger(rawPrefetch) && rawPrefetch > 0
        ? rawPrefetch
        : PREFETCH_DEFAULT;

async function main() {
    const { connection, channel, queue } =
        await createPhotoConsumerChannel(prefetch);
    let isShuttingDown = false;

    const gracefulShutdown = async (signal) => {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;
        console.log(`[photo-worker] Received ${signal}, shutting down...`);
        try {
            await channel.close();
        } catch (err) {
            console.error('[photo-worker] Failed to close channel', err);
        }
        try {
            await connection.close();
        } catch (err) {
            console.error('[photo-worker] Failed to close connection', err);
        }
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void gracefulShutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void gracefulShutdown('SIGTERM');
    });

    connection.on('error', (err) => {
        console.error('[photo-worker] RabbitMQ connection error:', err);
    });

    connection.on('close', () => {
        if (isShuttingDown) {
            return;
        }
        console.error(
            '[photo-worker] RabbitMQ connection closed unexpectedly. Exiting.',
        );
        process.exit(1);
    });

    await channel.consume(
        queue,
        async (message) => {
            if (!message) {
                return;
            }

            let payload;
            try {
                payload = JSON.parse(message.content.toString('utf8'));
            } catch (parseErr) {
                console.error(
                    '[photo-worker] Invalid queue message JSON, dropping:',
                    parseErr,
                );
                channel.ack(message);
                return;
            }

            try {
                await processPhotoJob(payload);
                channel.ack(message);
            } catch (err) {
                console.error('[photo-worker] Photo processing failed:', err);
                // Do not requeue invalid/unprocessable data forever.
                channel.ack(message);
            }
        },
        { noAck: false },
    );

    console.log(
        `[photo-worker] Listening queue "${queue}" with prefetch=${prefetch}`,
    );
}

main().catch((err) => {
    console.error('[photo-worker] Fatal startup error:', err);
    process.exit(1);
});
