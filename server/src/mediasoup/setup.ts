import { getMediasoupWorker } from './worker';
import { createRouter, getRouter } from './router';
import type { types } from 'mediasoup'; // ✅ Import public types

let workerInstance: types.Worker;
let routerInstance: types.Router;

export async function initializeMediasoup(): Promise<{ worker: types.Worker; router: types.Router }> {
    workerInstance = await getMediasoupWorker();
    routerInstance = await createRouter(workerInstance);
    return { worker: workerInstance, router: routerInstance };
}

export function getInitializedRouter(): types.Router {
    return getRouter(); // Assumes initializeMediasoup has been called
}
