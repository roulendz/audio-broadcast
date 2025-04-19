// FilePath: server/src/types.ts
import WebSocket from 'ws';
import type { types } from 'mediasoup';

// Extend WebSocket type if needed to store user state
export interface ExtendedWebSocket extends WebSocket {
    clientId: string;
    transports: Map<string, types.Transport>;
    consumers: Map<string, types.Consumer>;
    rtpCapabilities?: types.RtpCapabilities;
}

// Type definitions for signaling messages (match client-side)
export interface SignalMessage {
    action: string;
    payload?: any;
}

export interface ConnectPayload {
    transportId: string;
    dtlsParameters: any; // mediasoup DtlsParameters type
}

export interface ConsumePayload {
    streamId: string; // ID of the GStreamer stream to consume
}

export interface ConsumerInfo {
    producerId: string;
    consumerId: string;
    kind: types.MediaKind; // 'audio' | 'video'
    rtpParameters: types.RtpParameters;
    transportId: string;
    streamId: string;
    appData?: { [key: string]: any };
}