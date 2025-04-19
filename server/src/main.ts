import express, { Request, Response, NextFunction } from 'express';
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

    // The most basic approach - disable TypeScript checking for this line only
    // @ts-ignore
    // Add this instead:
    app.use((req, res, next) => {
        // Skip URLs that contain problematic patterns
        if (req.url.includes('://')) {
            return res.status(404).send('Invalid URL format');
        }
        
        // For GET requests to non-file paths, serve the SPA index
        if (req.method === 'GET' && !req.url.includes('.')) {
            return res.sendFile(path.join(clientBuildPath, 'index.html'));
        }
        
        // Otherwise continue to the next middleware
        next();
    });

    // --- Create HTTP/S Server ---
    // TODO: Add HTTPS setup if needed for non-local deployment
    const httpServer = http.createServer(app);

    httpServer.listen(config.server.port, config.server.ip, () => {
        console.log(`HTTP server listening on http://${config.server.ip}:${config.server.port}`);
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
        console.log(`HTTP server listening on http://${config.server.ip}:${config.server.port}`);
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