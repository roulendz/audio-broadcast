// FilePath: client/src/signaling/socket.ts
import { SignalMessage } from '../../../server/src/types'; // Reuse server types

let ws: WebSocket | null = null;
let messageQueue: string[] = []; // Queue messages if WS not ready
let connectPromise: Promise<void> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

// Define ports explicitly (match server setup)
const SECURE_WS_PORT = 3001;
const INSECURE_WS_PORT = 3002; // Must match the new port in main.ts

// Define listeners type
type MessageListener = (action: string, payload: any) => void;
const listeners = new Set<MessageListener>();

function getWebSocketUrl(): string {
    const isSecure = window.location.protocol === 'https:';
    const proto = isSecure ? 'wss:' : 'ws:';
    const port = isSecure ? SECURE_WS_PORT : INSECURE_WS_PORT;
    // Use the hostname from the browser's location bar
    const host = window.location.hostname;
    return `${proto}//${host}:${port}`;
}

export function connectWebSocket(): Promise<void> {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return Promise.resolve();
    }
    if (connectPromise) {
        return connectPromise;
    }

    connectPromise = new Promise((resolve, reject) => {
        const url = getWebSocketUrl();
        console.log(`Connecting WebSocket to ${url}...`); // Log will show which URL is used
        ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('WebSocket connected.');
            reconnectAttempts = 0;
            messageQueue.forEach(msg => ws?.send(msg));
            messageQueue = [];
            connectPromise = null;
            resolve();
        };

        ws.onmessage = (event) => {
            try {
                const data: SignalMessage = JSON.parse(event.data);
                listeners.forEach(listener => listener(data.action, data.payload));
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (event) => {
            console.error('WebSocket error:', event);
            // Don't reject immediately, let onclose handle reconnect
        };

        ws.onclose = (event) => {
            console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}. Attempting reconnect...`);
            ws = null;
            connectPromise = null;

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                setTimeout(() => {
                    console.log(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
                    connectWebSocket().catch(err => console.error("Reconnect failed:", err));
                }, RECONNECT_DELAY);
            } else {
                console.error('Max WebSocket reconnect attempts reached.');
                reject(new Error('WebSocket disconnected permanently after retries.'));
            }
        };
    });
    return connectPromise;
}

// --- Rest of the functions (sendSignal, addMessageListener, etc.) remain the same ---
export function sendSignal(action: string, payload?: any) {
    const message = JSON.stringify({ action, payload });
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
    } else {
        console.warn('WebSocket not open, queueing message:', action);
        messageQueue.push(message);
        if(!connectPromise && (!ws || ws.readyState === WebSocket.CLOSED)){
            connectWebSocket().catch(err => console.error("Send connection attempt failed:", err));
        }
    }
}

export function addMessageListener(listener: MessageListener) {
    listeners.add(listener);
}

export function removeMessageListener(listener: MessageListener) {
    listeners.delete(listener);
}

export function disconnectWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
    }
    connectPromise = null;
    messageQueue = [];
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    console.log("WebSocket manually disconnected.");
}