import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';
const PHOTO_QUEUE = process.env.RABBITMQ_QUEUE || 'gallery.photo.jobs';

let publisherState = null;

function attachPublisherListeners(connection, channel) {
    connection.on('error', (err) => {
        console.error('RabbitMQ publisher connection error:', err);
    });

    connection.on('close', () => {
        if (
            publisherState &&
            publisherState.connection === connection &&
            publisherState.channel === channel
        ) {
            publisherState = null;
        }
    });

    channel.on('error', (err) => {
        console.error('RabbitMQ publisher channel error:', err);
    });

    channel.on('close', () => {
        if (
            publisherState &&
            publisherState.connection === connection &&
            publisherState.channel === channel
        ) {
            publisherState = null;
        }
    });
}

async function createPublisherChannel() {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createConfirmChannel();
    await channel.assertQueue(PHOTO_QUEUE, { durable: true });
    attachPublisherListeners(connection, channel);
    return { connection, channel };
}

async function getPublisherState() {
    if (publisherState?.connection && publisherState?.channel) {
        return publisherState;
    }

    if (publisherState?.promise) {
        return publisherState.promise;
    }

    publisherState = {
        promise: createPublisherChannel()
            .then((nextState) => {
                publisherState = nextState;
                return nextState;
            })
            .catch((err) => {
                publisherState = null;
                throw err;
            }),
    };

    return publisherState.promise;
}

export async function publishPhotoJob(payload) {
    const state = await getPublisherState();
    const body = Buffer.from(JSON.stringify(payload));
    try {
        state.channel.sendToQueue(PHOTO_QUEUE, body, {
            persistent: true,
            contentType: 'application/json',
            timestamp: Date.now(),
        });
        await state.channel.waitForConfirms();
    } catch (err) {
        publisherState = null;
        throw err;
    }
}

export async function createPhotoConsumerChannel(prefetch = 1) {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(PHOTO_QUEUE, { durable: true });
    if (Number.isInteger(prefetch) && prefetch > 0) {
        channel.prefetch(prefetch);
    }
    return { connection, channel, queue: PHOTO_QUEUE };
}
