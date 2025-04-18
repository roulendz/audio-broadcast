import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';
import { config } from '../config';

let worker: mediasoup.types.Worker | null = null;

export async function getMediasoupWorker(): Promise<types.Worker> {
    if (!worker) {
        try {
            worker = await mediasoup.createWorker({
                logLevel: config.mediasoup.worker.logLevel,
                logTags: config.mediasoup.worker.logTags,
                rtcMinPort: config.mediasoup.worker.rtcMinPort,
                rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
            });

            worker.on('died', (error) => {
                console.error('Mediasoup worker died (error: %s)', error);
                // Implement logic to restart or handle the failure gracefully
                process.exit(1); // Example: exit if worker dies
            });

            console.log(`Mediasoup worker started [PID: ${worker.pid}]`);
        } catch (error) {
            console.error('Failed to create mediasoup worker:', error);
            process.exit(1);
        }
    }
    return worker;
}

export function closeWorker() {
    if (worker) {
        worker.close();
        console.log('Mediasoup worker closed.');
    }
}