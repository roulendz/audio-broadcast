// FilePath: client/src/signaling/socket.ts
import { SignalMessage } from '../../../server/src/types'; // Reuse server types

let ws: WebSocket | null = null;
let messageQueue: string[] = []; // Queue messages if WS not ready
let connectPromise: Promise<void> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds


// Define listeners type
type MessageListener = (action: string, payload: any) => void;
const listeners = new Set<MessageListener>();

function getWebSocketUrl(): string {
    if (import.meta.env.DEV) {
        // In dev, use the Vite proxy
        return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    } else {
        // In production, direct connection
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.hostname}:3001`;
    }
}

export function connectWebSocket(): Promise<void> {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return Promise.resolve();
    }
    // If already connecting, return the existing promise
    if (connectPromise) {
        return connectPromise;
    }

    connectPromise = new Promise((resolve, reject) => {
        const url = getWebSocketUrl();
        console.log(`Connecting WebSocket to ${url}...`);
        ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('WebSocket connected.');
            reconnectAttempts = 0; // Reset on successful connection
            // Process queued messages
            messageQueue.forEach(msg => ws?.send(msg));
            messageQueue = [];
            connectPromise = null; // Clear promise on success
            resolve();
        };

        ws.onmessage = (event) => {
            try {
                const data: SignalMessage = JSON.parse(event.data);
                // console.log('WS Received:', data.action, data.payload);
                // Notify all listeners
                listeners.forEach(listener => listener(data.action, data.payload));
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (event) => {
            console.error('WebSocket error:', event);
             // Don't reject immediately on error, let onclose handle reconnect
             // connectPromise = null; // Clear promise on error
             // reject(new Error('WebSocket connection error'));
        };

        ws.onclose = (event) => {
            console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}. Attempting reconnect...`);
            ws = null;
            connectPromise = null; // Clear promise on close

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                setTimeout(() => {
                    // *** FIX: Correct template literal usage ***
                    console.log(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
                    connectWebSocket().catch(err => console.error("Reconnect failed:", err)); // Attempt reconnect
                }, RECONNECT_DELAY);
            } else {
                console.error('Max WebSocket reconnect attempts reached.');
                 reject(new Error('WebSocket disconnected permanently after retries.')); // Reject after max retries
            }
        };
    });
    return connectPromise;
}

export function sendSignal(action: string, payload?: any) {
    const message = JSON.stringify({ action, payload });
    if (ws && ws.readyState === WebSocket.OPEN) {
        // console.log('WS Sending:', action, payload);
        ws.send(message);
    } else {
        console.warn('WebSocket not open, queueing message:', action);
        messageQueue.push(message);
         // Attempt to connect if not already trying
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
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect after manual disconnect
    console.log("WebSocket manually disconnected.");
}

// Initial connection attempt (optional, can be triggered by UI)
// connectWebSocket().catch(err => console.error("Initial WebSocket connection failed:", err));