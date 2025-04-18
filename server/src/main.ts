import express from 'express';
import http from 'http';
import https from 'https'; // If using HTTPS later
import WebSocket from 'ws';
import path from 'path';
import { config } from './config';
import { initializeMediasoup } from './mediasoup/setup';
import { setupGStreamerIngest } from './GStreamerIngest';
import { handleWebSocketConnection } from './signaling/handler';

async function run() {
    console.log('Starting server...');

    // --- Initialize Mediasoup ---
    const { worker, router } = await initializeMediasoup();

    // --- Setup GStreamer Ingest ---
    // Needs the router to be ready
    await setupGStreamerIngest(router);

    // --- Create Express App ---
    const app = express();
    app.use(express.json());

    // Serve static files from the client build output
    const clientBuildPath = path.join(__dirname, '../../client/dist'); // Adjust if client structure differs
    console.log(`Serving static files from: ${clientBuildPath}`);
    app.use(express.static(clientBuildPath));

    // Serve index.html for any route not handled by static files (for SPA routing)
    app.get('*', (req, res) => {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });


    // --- Create HTTP/S Server ---
    // TODO: Add HTTPS setup if needed for non-local deployment
    const httpServer = http.createServer(app);

    httpServer.listen(config.server.port, config.server.ip, () => {
        console.log(`HTTP server listening on http://<span class="math-inline">\{config\.server\.ip\}\:</span>{config.server.port}`);
    });

    // --- Create WebSocket Server ---
    const wsServer = new WebSocket.Server({
        // Attach to existing HTTP server OR run on a separate port
         server: httpServer // Attach to the same server
        // port: config.server.wsPort // Use separate port if preferred
    });

    wsServer.on('connection', (socket) => {
        handleWebSocketConnection(socket); // Pass to the handler
    });

    wsServer.on('listening', () => {
        console.log(`WebSocket server listening on ws://<span class="math-inline">\{config\.server\.ip\}\:</span>{config.server.port}`); // Adjust port if separate
    });

    wsServer.on('error', (error) => {
        console.error('WebSocket server error:', error);
    });

    console.log('Server setup complete. Waiting for connections...');

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('SIGINT received, shutting down...');
        wsServer.close();
        httpServer.close();
        // closeWorker(); // Close mediasoup worker if you have the function
        process.exit(0);
    });

}

run().catch(error => {
    console.error("Server failed to start:", error);
    process.exit(1);
});