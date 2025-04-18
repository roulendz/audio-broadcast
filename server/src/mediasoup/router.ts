import type { types } from 'mediasoup';
import { config } from '../config';

let router: types.Router;

export async function createRouter(worker: types.Worker): Promise<types.Router> {
    if (!router) {
        try {
            router = await worker.createRouter({
                mediaCodecs: config.mediasoup.router.mediaCodecs,
            });
            console.log(`Mediasoup router created [ID: ${router.id}]`);
        } catch (error) {
            console.error('Failed to create mediasoup router:', error);
            process.exit(1);
        }
    }
    return router;
}

export function getRouter(): types.Router {
    if (!router) {
        throw new Error('Router not initialized. Call createRouter first.');
    }
    return router;
}
