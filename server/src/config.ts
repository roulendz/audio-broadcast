import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import type { types } from 'mediasoup';

type RtpCodecCapability = types.RtpCodecCapability;

dotenv.config({ path: path.resolve(__dirname, '../.env') }); // Load .env from parent

interface StreamConfig {
    id: string;
    name: string;
    rtpPort: number;
    ssrc: number;
    payloadType: number;
    codec: RtpCodecCapability;
}

// Basic validation (add more robust validation if needed)
function validateEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
}

const serverIp = validateEnv('LISTEN_IP');
const serverPort = parseInt(validateEnv('LISTEN_PORT'), 10);
const wsPort = parseInt(validateEnv('WEBSOCKET_PORT'), 10);

const webRtcListenIp = validateEnv('WEBRTC_LISTEN_IP');
const webRtcAnnouncedIp = process.env.WEBRTC_ANNOUNCED_IP || webRtcListenIp; // Fallback

const gstreamerListenIp = validateEnv('GSTREAMER_LISTEN_IP');

const mediasoupMinPort = parseInt(process.env.MEDIASOUP_MIN_PORT || '20000', 10);
const mediasoupMaxPort = parseInt(process.env.MEDIASOUP_MAX_PORT || '20100', 10);


// Load stream configurations
const streamsConfigPath = path.resolve(__dirname, '../../config/streams.json');
const streams: StreamConfig[] = JSON.parse(fs.readFileSync(streamsConfigPath, 'utf-8'));

export const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    server: {
        ip: serverIp,
        port: serverPort,
        wsPort: wsPort,
    },
    mediasoup: {
        // Mediasoup Worker settings
        worker: {
            rtcMinPort: mediasoupMinPort,
            rtcMaxPort: mediasoupMaxPort,
            logLevel: 'debug' as types.WorkerLogLevel,
            logTags: [
                'info',
                'ice',
                'dtls',
                'rtp',
                'srtp',
                'rtcp',
                // 'rtx', // Can be verbose
                // 'bwe',
                // 'score',
                // 'simulcast',
                // 'svc'
            ] as types.WorkerLogTag[],
        },
        router: {
            mediaCodecs: [ // Define codecs supported by the router globally
               // We primarily care about Opus from GStreamer here
               // Clients will negotiate based on what the router offers
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2, // Supports Stereo
                    parameters: {
                        useinbandfec: 1,
                        usedtx: 1, // Allow DTX generally
                        minptime: 10
                    },
                    rtcpFeedback: [ { type: 'transport-cc' } ]
                },
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 1, // Supports Mono
                    parameters: {
                        useinbandfec: 1,
                        usedtx: 1, // Allow DTX for voice
                        minptime: 10
                    },
                    rtcpFeedback: [ { type: 'transport-cc' } ]
                }
               // Add other codecs if you plan to support them from WebRTC clients (not needed for GStreamer ingest only)
                // {
                //     kind       : 'audio',
                //     mimeType   : 'audio/PCMU',
                //     clockRate  : 8000,
                //     channels   : 1
                // }
            ] as RtpCodecCapability[], // Ensure type correctness
        },
        // Transport settings
        webRtcTransport: {
            listenIps: [
                { ip: webRtcListenIp, announcedIp: webRtcAnnouncedIp }
            ],
            enableUdp: true,
            enableTcp: true, // Recommended fallback
            preferUdp: true,
            initialAvailableOutgoingBitrate: 800000, // Adjust as needed
        },
        plainTransport: {
            listenIp: { ip: gstreamerListenIp, announcedIp: undefined }, // No announced IP needed for plain transport ingest
            rtcpMux: false, // GStreamer likely sends RTP and RTCP on separate ports
            comedia: true   // Essential for PlainTransport ingest
        },
    },
    streams: streams,
};

console.log('--- Configuration ---');
console.log('Server IP:', config.server.ip);
console.log('Server Port:', config.server.port);
console.log('WebSocket Port:', config.server.wsPort);
console.log('WebRTC Listen IP:', webRtcListenIp);
console.log('WebRTC Announced IP:', webRtcAnnouncedIp);
console.log('GStreamer Listen IP:', gstreamerListenIp);
console.log('Available Streams:', config.streams.map(s => s.name).join(', '));
console.log('---------------------');