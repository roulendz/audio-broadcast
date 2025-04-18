// FilePath: server/src/GStreamerIngest.ts
import type { types } from 'mediasoup'; // Correct import for types
import { config } from './config'; // Assuming config is correctly set up

// Use types namespace
interface StreamProducer {
    id: string;
    producer: types.Producer;
    transport: types.PlainTransport;
}

// Store active producers, keyed by stream ID
const activeProducers = new Map<string, StreamProducer>();

// Use types.Router
export async function setupGStreamerIngest(router: types.Router) {
    console.log('Setting up GStreamer PlainTransports...');

    for (const streamConfig of config.streams) {
        // Type guard to ensure streamConfig.codec is correctly typed if necessary
        if (!streamConfig.codec || typeof streamConfig.payloadType !== 'number') {
            console.error(`Stream config for ${streamConfig.name} is missing codec info or payloadType.`);
            continue;
        }

        try {
            console.log(`  - Creating transport for stream: ${streamConfig.name} (Port: ${streamConfig.rtpPort})`);
            // Use types.PlainTransportOptions if needed, inferred here
            const transport: types.PlainTransport = await router.createPlainTransport({
                listenIp: config.mediasoup.plainTransport.listenIp, // listenIp must be defined in config
                rtcpMux: false, // Explicitly false if RTCP is expected on port + 1
                comedia: true,  // Usually needed for PlainTransport ingest
                enableSrtp: false // SRTP not typically used with GStreamer direct UDP
            });

            // GStreamer will likely send RTCP on port + 1
            const rtcpPort = streamConfig.rtpPort + 1;

            await transport.connect({
                ip: config.mediasoup.plainTransport.listenIp.ip, // Where GStreamer sends RTP
                port: streamConfig.rtpPort,
                rtcpPort: rtcpPort // Tell mediasoup where to expect RTCP
            });

            console.log(`    Transport ready for ${streamConfig.name}. Waiting for RTP...`);

            // Create the Producer once the transport is ready
            // This producer will become active when the first RTP packet arrives
            const producer: types.Producer = await transport.produce({
                kind: 'audio', // Ensure kind matches codec
                rtpParameters: {
                    // FIX 1: Construct RtpCodecParameters explicitly including payloadType
                    codecs: [
                        {
                            mimeType: streamConfig.codec.mimeType,
                            clockRate: streamConfig.codec.clockRate,
                            channels: streamConfig.codec.channels,
                            payloadType: streamConfig.payloadType, // <-- Use payloadType from config
                            parameters: streamConfig.codec.parameters,
                            rtcpFeedback: streamConfig.codec.rtcpFeedback || [] // Include if defined, default to empty array
                        } as types.RtpCodecParameters // Optional type assertion
                    ],
                    encodings: [{ ssrc: streamConfig.ssrc }],
                    // rtcp: { cname: `gst-${streamConfig.ssrc}` } // Mediasoup usually generates CNAME
                },
                appData: { streamId: streamConfig.id } // Link producer to stream config
            });

            activeProducers.set(streamConfig.id, {
                id: streamConfig.id,
                producer: producer,
                transport: transport,
            });

            console.log(`    Producer created for ${streamConfig.name} [ID: ${producer.id}, SSRC: ${streamConfig.ssrc}]`);

            // Optional: Listen for producer score changes (indicates quality/activity)
            producer.on('score', (score: types.ProducerScore[]) => { // Add specific type
                 // console.log(`Producer ${streamConfig.name} score:`, score);
            });

            producer.on('trace', (trace: types.ProducerTraceEventData) => { // Add specific type
                // console.log(`Producer ${streamConfig.name} trace:`, trace.type, trace.info);

                // FIX 2: Change 'recv' to 'in' for direction
                if (trace.type === 'rtp' && trace.direction === 'in') {
                // console.log(`First RTP packet received for ${streamConfig.name}`);
                }
            });

            // FIX 3: Remove unsupported 'rtcp' event listener for PlainTransport
            // transport.on('rtcp', (packet: Buffer) => { ... }); REMOVED

            // Use transport.observer.on for events like 'close'
            transport.observer.on('close', () => {
                console.warn(`PlainTransport for ${streamConfig.name} closed.`);
                // Ensure producer is also closed/removed if transport closes
                const entry = activeProducers.get(streamConfig.id);
                if (entry && entry.transport.id === transport.id) {
                    if (entry.producer && !entry.producer.closed) {
                        entry.producer.close(); // Close associated producer
                    }
                    activeProducers.delete(streamConfig.id);
                }
            });

            // Use producer.observer.on for events like 'close'
            producer.observer.on('close', () => {
                console.warn(`Producer for ${streamConfig.name} closed.`);
                // Remove from map if the producer closes independently
                const entry = activeProducers.get(streamConfig.id);
                if (entry && entry.producer.id === producer.id) {
                activeProducers.delete(streamConfig.id);
                }
            });


        } catch (error) {
            console.error(`Failed to create PlainTransport/Producer for stream ${streamConfig.name}:`, error);
            // Continue trying to set up other streams
        }
    }
    console.log('GStreamer ingest setup complete.');
}

// FIX 4: Add correct return type annotation using types namespace
export function getProducerByStreamId(streamId: string): types.Producer | undefined {
    return activeProducers.get(streamId)?.producer;
}

// Type annotation for return value (optional but good practice)
export function getAvailableStreamsInfo(): { id: string; name: string }[] {
    // Return info client needs (id, name) - Ensure config.streams is correctly typed
    return config.streams.map(s => ({ id: s.id, name: s.name }));
}