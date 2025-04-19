import './styles.css'; // Import Tailwind styles
import { connectWebSocket, disconnectWebSocket } from './signaling/socket';
import { initializeWebRTC, disconnect as disconnectWebRTC } from './webrtc/mediasoupClient';
import { setupUI } from './ui/StreamSelector';

console.log("Client application started.");

// Initialize UI components
setupUI();

// Connect WebSocket and initialize WebRTC
async function start() {
    try {
        await connectWebSocket(); // Establish signaling connection first
        initializeWebRTC(); // Setup WebRTC listeners and device loading
    } catch (error) {
        console.error("Initialization failed:", error);
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = `Status: Error - ${error}`;
    }
}

start();

// Optional: Handle page unload/visibility change for cleanup
window.addEventListener('beforeunload', () => {
    disconnectWebRTC();
    disconnectWebSocket();
});