// FilePath: server/src/main.ts
import express, { Request, Response, NextFunction } from 'express';
import http from 'http'; // Import http
import https from 'https';
import fs from 'fs';
import WebSocket from 'ws';
import path from 'path';
import { config } from './config';
import { initializeMediasoup } from './mediasoup/setup';
import { setupGStreamerIngest } from './GStreamerIngest';
import { handleWebSocketConnection } from './signaling/handler';

// Define the port for the insecure WS server
const INSECURE_WEBSOCKET_PORT = config.server.wsPort + 1; // e.g., 3001 + 1 = 3002

async function run() {
    console.log('Starting server...');

    // Initialize Mediasoup
    const { worker, router } = await initializeMediasoup();

    // Setup GStreamer Ingest
    await setupGStreamerIngest(router);

    // Create Express App (for serving client files via HTTPS)
    const app = express();
    app.use(express.json());

    const clientBuildPath = path.join(__dirname, '../../client/dist');
    console.log(`Serving static files from: ${clientBuildPath}`);
    app.use(express.static(clientBuildPath));

    // SPA Fallback handler (ensure it's correctly typed or adjust as needed)
    app.use(((req, res, next) => {
        if (req.url.includes('://')) { // Basic check for invalid format
             return res.status(404).send('Invalid URL format');
        }
        // For GET requests to non-file paths, serve the SPA index
        if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.includes('.')) {
            res.sendFile(path.join(clientBuildPath, 'index.html'));
        } else {
            next(); // Continue to other middleware or 404
        }
    }) as express.RequestHandler);


    // --- HTTPS Server (for Client Files) ---
    const sslOptions = {
        key: fs.readFileSync('V:/laragon/etc/ssl/laragon.key'),
        cert: fs.readFileSync('V:/laragon/etc/ssl/laragon.crt'),
    };
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(config.server.port, config.server.ip, () => {
        console.log(`HTTPS server (client files) listening on https://${config.server.ip}:${config.server.port}`);
    });
    // REMOVED: WSS server attached to httpsServer, as client connects to standalone port


    // --- Standalone Secure WSS Server (on wsPort: 3001) ---
    const standaloneWssServer = https.createServer(sslOptions); // Needs SSL options
    standaloneWssServer.listen(config.server.wsPort, config.server.ip, () => {
        console.log(`Standalone WSS server listening on wss://${config.server.ip}:${config.server.wsPort}`);
    });
    const standaloneWss = new WebSocket.Server({
        server: standaloneWssServer // Attach WSS to this HTTPS server
    });
    standaloneWss.on('connection', (socket) => {
        console.log(`New secure WebSocket connection on port ${config.server.wsPort}`);
        handleWebSocketConnection(socket);
    });
    standaloneWss.on('error', (error) => {
        console.error(`Standalone WSS server (port ${config.server.wsPort}) error:`, error);
    });


    // --- Standalone Insecure WS Server (on INSECURE_WEBSOCKET_PORT: 3002) ---
    const httpServer = http.createServer((req, res) => {
         // This basic HTTP server only needs to handle WebSocket upgrades
         res.writeHead(404); // Respond with 404 to non-WebSocket requests
         res.end();
    });
    httpServer.listen(INSECURE_WEBSOCKET_PORT, config.server.ip, () => {
        console.log(`Standalone WS server listening on ws://${config.server.ip}:${INSECURE_WEBSOCKET_PORT}`);
    });
    const standaloneWs = new WebSocket.Server({
        server: httpServer // Attach WS to this HTTP server
    });
    standaloneWs.on('connection', (socket) => {
        console.log(`New insecure WebSocket connection on port ${INSECURE_WEBSOCKET_PORT}`);
        handleWebSocketConnection(socket); // Use the same handler
    });
    standaloneWs.on('error', (error) => {
        console.error(`Standalone WS server (port ${INSECURE_WEBSOCKET_PORT}) error:`, error);
    });


    console.log('Server setup complete. Waiting for connections...');

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('SIGINT received, shutting down...');
        standaloneWss.close(); // Close secure WS server
        standaloneWs.close(); // Close insecure WS server
        httpsServer.close(); // Close HTTPS server (client files)
        standaloneWssServer.close(); // Close HTTPS server for WSS
        httpServer.close(); // Close HTTP server for WS
        // Consider closing mediasoup worker/router if applicable
        process.exit(0);
    });
}

run().catch(error => {
    console.error("Server failed to start:", error);
    process.exit(1);
});