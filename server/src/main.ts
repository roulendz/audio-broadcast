import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import WebSocket from 'ws';
import path from 'path';
import { config } from './config';
import { initializeMediasoup } from './mediasoup/setup';
import { setupGStreamerIngest } from './GStreamerIngest';
import { handleWebSocketConnection } from './signaling/handler';

async function run() {
    console.log('Starting server...');

    // Initialize Mediasoup
    const { worker, router } = await initializeMediasoup();
    
    // Setup GStreamer Ingest
    await setupGStreamerIngest(router);

    // Create Express App
    const app = express();
    app.use(express.json());

    const clientBuildPath = path.join(__dirname, '../../client/dist');
    console.log(`Serving static files from: ${clientBuildPath}`);
    app.use(express.static(clientBuildPath));

    // Use type assertion to resolve the TypeScript error
    app.use(((req, res, next) => {
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
    }) as express.RequestHandler);

    // SSL Configuration
    const sslOptions = {
        key: fs.readFileSync('V:/laragon/etc/ssl/laragon.key'),
        cert: fs.readFileSync('V:/laragon/etc/ssl/laragon.crt'),
        // If you have a CA certificate:
        // ca: fs.readFileSync('V:/laragon/etc/ssl/cacert.pem')
    };

    // Create HTTPS Server
    const httpsServer = https.createServer(sslOptions, app);

    httpsServer.listen(config.server.port, config.server.ip, () => {
        console.log(`HTTPS server listening on https://${config.server.ip}:${config.server.port}`);
    });


    // Create Secure WebSocket Server
    const wssServer = new WebSocket.Server({ server: httpsServer });

    wssServer.on('connection', (socket) => {
        console.log('New secure WebSocket connection');
        handleWebSocketConnection(socket);
    });

    wssServer.on('error', (error) => {
        console.error('WebSocket server error:', error);
    });

    // Create a separate WSS server on port 3001
    const standaloneWssServer = https.createServer(sslOptions);
    
    standaloneWssServer.listen(config.server.wsPort, config.server.ip, () => {
        console.log(`Standalone WSS server listening on wss://${config.server.ip}:${config.server.wsPort}`);
    });

    const standaloneWss = new WebSocket.Server({
        server: standaloneWssServer
    });

    standaloneWss.on('connection', (socket) => {
        console.log('New standalone secure WebSocket connection');
        handleWebSocketConnection(socket);
    });

    standaloneWss.on('error', (error) => {
        console.error('Standalone WebSocket server error:', error);
    });

    console.log('Server setup complete. Waiting for connections...');

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('SIGINT received, shutting down...');
        wssServer.close();
        standaloneWss.close();
        httpsServer.close();
        standaloneWssServer.close();
        process.exit(0);
    });
}

run().catch(error => {
    console.error("Server failed to start:", error);
    process.exit(1);
});