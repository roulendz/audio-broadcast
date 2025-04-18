import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { getInitializedRouter } from '../mediasoup/setup';
import { config } from '../config';
import { getProducerByStreamId, getAvailableStreamsInfo } from '../GStreamerIngest';
import { ExtendedWebSocket, SignalMessage, ConnectPayload, ConsumePayload, ConsumerInfo } from '../types';
import type { types } from 'mediasoup';


const clients = new Map<string, ExtendedWebSocket>();

export function handleWebSocketConnection(ws: WebSocket) {
    const clientId = uuidv4();
    const extWs = ws as ExtendedWebSocket;
    extWs.clientId = clientId;
    extWs.transports = new Map();
    extWs.consumers = new Map();
    clients.set(clientId, extWs);

    console.log(`Client connected [ID: ${clientId}]`);

    // 1. Send initial info: Router capabilities and available streams
    send(extWs, 'serverInfo', {
        routerRtpCapabilities: getInitializedRouter().rtpCapabilities,
        availableStreams: getAvailableStreamsInfo(),
    });


    ws.on('message', async (message) => {
        try {
            const msg: SignalMessage = JSON.parse(message.toString());
            console.log(`Received [${clientId}]:`, msg.action, msg.payload ? JSON.stringify(msg.payload) : '');

            switch (msg.action) {
                case 'getRouterRtpCapabilities': // Client might request again
                    send(extWs, 'routerCapabilities', getInitializedRouter().rtpCapabilities);
                    break;

                case 'createWebRtcTransport':
                    await handleCreateWebRtcTransport(extWs);
                    break;

                case 'connectWebRtcTransport':
                    await handleConnectWebRtcTransport(extWs, msg.payload as ConnectPayload);
                    break;

                case 'consume':
                    await handleConsume(extWs, msg.payload as ConsumePayload);
                    break;

                // Add other cases like 'pauseConsumer', 'resumeConsumer' if needed

                default:
                    console.warn(`Unknown action from client ${clientId}: ${msg.action}`);
                    send(extWs, 'error', `Unknown action: ${msg.action}`);
            }
        } catch (error: any) {
            console.error(`Error processing message from ${clientId}:`, error);
            send(extWs, 'error', error.message || 'Server error');
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected [ID: ${clientId}]`);
        cleanupClient(extWs);
        clients.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error [ID: ${clientId}]:`, error);
        cleanupClient(extWs);
        clients.delete(clientId); // Ensure cleanup on error too
    });
}

async function handleCreateWebRtcTransport(ws: ExtendedWebSocket) {
    const router = getInitializedRouter();
    try {
        const transport = await router.createWebRtcTransport({
            ...config.mediasoup.webRtcTransport,
            appData: { clientId: ws.clientId } // Associate transport with client
        });

        ws.transports.set(transport.id, transport);

        transport.observer.on('close', () => {
            console.log(`WebRtcTransport closed for client ${ws.clientId} [ID: ${transport.id}]`);
            ws.transports.delete(transport.id);
            // Also close associated consumers? Maybe not needed if client handles this.
        });

        transport.observer.on('dtlsstatechange', (dtlsState) => {
            console.log(`Transport ${transport.id} DTLS state changed to ${dtlsState}`);
        if (dtlsState === 'failed' || dtlsState === 'closed') {
            console.warn(`Transport ${transport.id} DTLS connection closed/failed.`);
            // transport.close(); // Close transport on failure? Or let client retry?
        }
        });

        console.log(`Created WebRtcTransport for client ${ws.clientId} [ID: ${transport.id}]`);

        send(ws, 'transportCreated', {
            transportId: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        });
    } catch (error: any) {
        console.error(`Error creating WebRtcTransport for ${ws.clientId}:`, error);
        send(ws, 'error', `Failed to create transport: ${error.message}`);
    }
}

async function handleConnectWebRtcTransport(ws: ExtendedWebSocket, payload: ConnectPayload) {
    const { transportId, dtlsParameters } = payload;
    const transport = ws.transports.get(transportId);

    if (!transport) {
        throw new Error(`Transport ${transportId} not found for client ${ws.clientId}`);
    }

    if (transport.constructor.name !== 'WebRtcTransport') {
        throw new Error(`Transport ${transportId} is not a WebRtcTransport`);
    }

    try {
        await transport.connect({ dtlsParameters });
        console.log(`WebRtcTransport connected for client ${ws.clientId} [ID: ${transportId}]`);
        // No specific response needed, client proceeds to consume after connect
    } catch (error: any) {
        console.error(`Error connecting WebRtcTransport ${transportId} for ${ws.clientId}:`, error);
        send(ws, 'error', `Failed to connect transport ${transportId}: ${error.message}`);
    }
}

async function handleConsume(ws: ExtendedWebSocket, payload: ConsumePayload) {
    const { streamId } = payload;
    const router = getInitializedRouter();
    const producer = getProducerByStreamId(streamId);

    if (!producer) {
        throw new Error(`Stream/Producer with ID ${streamId} not found or not active.`);
    }

    // Find the client's WebRTC transport (assume one for simplicity now)
    // In a multi-transport scenario, client would specify which transport to use
    let transport;
    for(const t of ws.transports.values()){
        if(t.constructor.name === 'WebRtcTransport'){ // Ensure it's the right type
            transport = t;
            break;
        }
    }


    if (!transport) {
        throw new Error(`Client ${ws.clientId} does not have an active WebRtcTransport.`);
    }

    // Check if client can consume the producer's media kind
    if (!router.canConsume({ producerId: producer.id, rtpCapabilities: ws.rtpCapabilities as types.RtpCapabilities})) {
        throw new Error(`Client ${ws.clientId} cannot consume producer ${producer.id}`);
    }

    try {
        const consumer = await transport.consume({
            producerId: producer.id,
            rtpCapabilities: ws.rtpCapabilities as types.RtpCapabilities, // Client must send these! (Modify client/server handshake if needed)
            paused: true, // Start paused, client resumes after creation
            appData: { clientId: ws.clientId, streamId: streamId } // Link consumer
        });

        ws.consumers.set(consumer.id, consumer);

        consumer.observer.on('close', () => {
            console.log(`Consumer closed for client ${ws.clientId} [ID: ${consumer.id}]`);
            ws.consumers.delete(consumer.id);
        });
        consumer.on('producerclose', () => {
            console.log(`Producer for consumer ${consumer.id} closed. Closing consumer.`);
            consumer.close(); // Close consumer if its producer closes
            ws.consumers.delete(consumer.id);
            // Optionally notify client
            send(ws, 'consumerClosed', { consumerId: consumer.id });
        });

        console.log(`Created Consumer for client ${ws.clientId} consuming ${streamId} [CID: ${consumer.id}, PID: ${producer.id}]`);

        const response: ConsumerInfo = {
            producerId: producer.id,
            consumerId: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            transportId: transport.id,
            streamId: streamId,
        };

        send(ws, 'consumerReady', response);

        // Client should call resume after receiving 'consumerReady'
        // We can also resume immediately on server if desired:
        await consumer.resume();
        console.log(`Resumed Consumer [CID: ${consumer.id}]`);


    } catch (error: any) {
        console.error(`Error creating consumer for ${ws.clientId} on stream ${streamId}:`, error);
        send(ws, 'error', `Failed to consume stream ${streamId}: ${error.message}`);
    }
}

// Helper to send messages
function send(ws: WebSocket, action: string, payload?: any) {
    if (ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ action, payload });
        ws.send(message);
    } else {
        console.warn(`Attempted to send to closed WebSocket [Client ID unknown or closed]`);
    }
}

// Clean up resources when a client disconnects
function cleanupClient(ws: ExtendedWebSocket) {
    console.log(`Cleaning up resources for client ${ws.clientId}`);
    ws.consumers.forEach(consumer => consumer.close());
    ws.transports.forEach(transport => transport.close());
    ws.consumers.clear();
    ws.transports.clear();
}

// Add this function to handle the case where the client needs to send RTP capabilities
export function handleClientRtpCapabilities(ws: ExtendedWebSocket, payload: { rtpCapabilities: types.RtpCapabilities }) {
    if (payload.rtpCapabilities) {
        // Store capabilities on the WebSocket object for later use in canConsume/consume
        ws.rtpCapabilities = payload.rtpCapabilities;
        console.log(`Stored RTP Capabilities for client ${ws.clientId}`);
    } else {
        console.warn(`Client ${ws.clientId} sent invalid RTP capabilities`);
    }
}


// --- Augment ExtendedWebSocket type in types.ts ---
// Add this line in server/src/types.ts inside ExtendedWebSocket interface:
// rtpCapabilities?: RtpCapabilities;


// --- Modify handleWebSocketConnection ---
// In handleWebSocketConnection, add a case for the client sending its caps:
/*
            case 'setRtpCapabilities':
                handleClientRtpCapabilities(extWs, msg.payload);
                break;
*/