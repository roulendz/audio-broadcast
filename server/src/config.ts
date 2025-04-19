// FilePath: server/src/config.ts
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
            mediaCodecs: [
            {
                kind: 'audio',
                mimeType: 'audio/PCMU',  // μ-law codec
                clockRate: 8000,         // 8000 Hz
                channels: 1,             // Mono
                rtcpFeedback: [{ type: 'transport-cc' }]
            }
            // Remove the second Opus entry with channels: 1
        ] as RtpCodecCapability[],
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