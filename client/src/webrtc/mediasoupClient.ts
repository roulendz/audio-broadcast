// FilePath: client/src/webrtc/mediasoupClient.ts

import mediasoupClient from 'mediasoup-client';
import type { types } from 'mediasoup-client';

import type { ConsumerInfo } from '../../../server/src/types'; // Ensure this path is correct
import { sendSignal, addMessageListener, removeMessageListener } from '../signaling/socket';

// --- Variables ---
// *** FIX 1: Ensure only ONE declaration for statsIntervalId ***
let device: types.Device | null = null;
let recvTransport: types.Transport | null = null;
let currentConsumer: types.Consumer | null = null;
let serverRouterCapabilities: types.RtpCapabilities | null = null;
let availableStreams: { id: string; name: string }[] = [];
let statsIntervalId: number | null = null; // Single declaration at module scope

// --- Helper Functions ---
function updateStatus(message: string) {
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = `Status: ${message}`;
}

function getStreamNameById(streamId: string | undefined): string {
    if (!streamId) return 'Unknown Stream';
    const stream = availableStreams.find(s => s.id === streamId);
    return stream ? stream.name : 'Unknown Stream';
}

// Type for state parameter will be inferred or explicitly set later if needed
function dispatchConnectionState(state: string) { // Use string for now, refine if needed
    const streamId = currentConsumer?.appData?.streamId || (window as any).pendingStreamId;
    const event = new CustomEvent('connectionStateChange', {
        detail: { state, streamName: getStreamNameById(streamId) }
    });
    window.dispatchEvent(event);

    let statusText = `Connection: ${state}`;
     if (state === 'connected' && streamId) {
         statusText = `Listening to: ${getStreamNameById(streamId)}`;
     } else if (state === 'closed' || state === 'failed') {
         statusText = `Status: ${state === 'failed' ? 'Failed' : 'Disconnected'}`;
     } else if (state === 'connecting' || state === 'checking'){
         statusText = `Status: Connecting...`;
     }
    updateStatus(statusText);
}


// --- Signaling Handler ---
const handleSignalMessage = (action: string, payload: any) => {
    switch (action) {
        case 'serverInfo':
            console.log("Received server info:", payload);
            serverRouterCapabilities = payload.routerRtpCapabilities as types.RtpCapabilities;
            availableStreams = payload.availableStreams;
            const event = new CustomEvent('streamsAvailable', { detail: availableStreams });
            window.dispatchEvent(event);
            loadDeviceIfNeeded();
            break;

        case 'transportCreated':
            console.log("Received transport params:", JSON.stringify(payload, null, 2));
            createRecvTransport(
                payload.transportId,
                payload.iceParameters as types.IceParameters,
                payload.iceCandidates as types.IceCandidate[],
                payload.dtlsParameters as types.DtlsParameters
            );
            break;

        case 'consumerReady':
            console.log("Received consumer ready:", payload as ConsumerInfo);
            handleConsumeReady(payload);
            break;

        case 'consumerClosed':
            console.log(`Consumer ${payload.consumerId} closed by server.`);
            if(currentConsumer && currentConsumer.id === payload.consumerId){
                closeConsumer();
                dispatchConnectionState('closed');
            }
            break;

        case 'error':
            console.error("Received server error:", payload);
            updateStatus(`Error: ${payload}`);
            dispatchConnectionState('failed');
            break;
    }
};

// --- WebRTC Initialization ---
export async function initializeWebRTC() {
    console.log("Initializing WebRTC...");
    addMessageListener(handleSignalMessage);
}

async function loadDeviceIfNeeded() {
    if (device?.loaded) {
        console.log("Device already loaded.");
        return;
    }
    if (!serverRouterCapabilities) {
        console.warn("Cannot load device, router capabilities not received yet.");
        return;
    }
    try {
        console.log("Loading mediasoup device...");
        device = new mediasoupClient.Device();
        console.log("Loading device with Router RTP Capabilities:", JSON.stringify(serverRouterCapabilities));
        await device.load({ routerRtpCapabilities: serverRouterCapabilities });
        console.log("Device loaded successfully.");
        if (device.rtpCapabilities) {
           sendSignal('setRtpCapabilities', { rtpCapabilities: device.rtpCapabilities });
        } else {
            console.error("Device loaded but rtpCapabilities are missing!");
        }
        const event = new CustomEvent('deviceReady');
        window.dispatchEvent(event);

    } catch (error: any) {
        console.error('Error loading mediasoup device:', error);
        if (error.name === 'UnsupportedError') {
            updateStatus('Browser not supported');
        } else {
            updateStatus('Failed to load device');
        }
        dispatchConnectionState('failed');
    }
}

export function isDeviceLoaded(): boolean {
     return device?.loaded || false;
}

export function getAvailableStreams(): { id: string; name: string }[] {
     return availableStreams;
}


// --- Transport Management ---
async function createRecvTransport(
    transportId: string,
    iceParameters: types.IceParameters,
    iceCandidates: types.IceCandidate[],
    dtlsParameters: types.DtlsParameters
) {
if (!device) {
        console.error("Device not loaded, cannot create transport.");
        updateStatus("Device not ready");
        dispatchConnectionState('failed');
    return;
    }
    if (recvTransport && !recvTransport.closed) {
        console.log("Closing existing RECV transport before creating new one.");
        recvTransport.close();
    }
    recvTransport = null;

    console.log("Creating RECV transport client-side:", transportId);
    try {
        recvTransport = device.createRecvTransport({
            id: transportId,
            iceParameters,
            iceCandidates,
            dtlsParameters,
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' } // Add another for redundancy
            ]
        });
        console.log(`Transport created. ID: ${recvTransport.id}, Closed: ${recvTransport.closed}, ConnectionState: ${recvTransport.connectionState}, AppData:`, recvTransport.appData);
        // --- Transport Events ---
        recvTransport.on('connect', (
            { dtlsParameters: connectDtlsParams }: { dtlsParameters: types.DtlsParameters },
            callback: () => void,
            errback: (error: Error) => void
        ) => {
            console.log("Transport 'connect' event fired. Sending DTLS params to server.");
            try {
                if (!recvTransport) throw new Error("recvTransport became null unexpectedly");
                sendSignal('connectWebRtcTransport', {
                    transportId: recvTransport.id,
                    dtlsParameters: connectDtlsParams,
                });
                callback();
            } catch (error) {
                console.error("Error sending connect signal:", error);
                errback(error as Error);
            }
        });

        // *** FIX 2: Remove explicit type annotation for state for now ***
        recvTransport.on('connectionstatechange', (state: types.ConnectionState) => {
            console.log(`Transport connection state changed: ${state}`);
            // We dispatch the state as a string, the specific type isn't strictly needed here yet
            dispatchConnectionState(state);

            switch (state) {
                case 'connected':
                    console.log("Transport connected!");
                    const pendingStreamId = (window as any).pendingStreamId;
                    if (pendingStreamId) {
                        console.log("Consuming pending stream:", pendingStreamId);
                        delete (window as any).pendingStreamId;
                        requestConsume(pendingStreamId);
                    }
                    break;
                case 'failed':
                    console.error('Transport connection failed.');
                    recvTransport?.close();
                    break;
                case 'disconnected':
                    console.warn('Transport disconnected.');
                    break;
                case 'closed':
                    console.log('Transport closed.');
                    if (recvTransport && recvTransport.id === transportId && recvTransport.closed) {
                        recvTransport = null;
                    }
                    closeConsumer();
                    break;
            }
        });
        console.log("Listeners attached.")
        console.log("RECV Transport created client-side.");

    } catch (error) {
        console.error('Error creating Recv transport:', error);
        updateStatus("Failed to create connection");
        dispatchConnectionState('failed');
    }
}


// --- Consumer Management ---
export function startConsuming(streamId: string) {
    console.log(`UI requested consumption of stream: ${streamId}`);
    closeConsumer();

    if (!device?.loaded) {
        updateStatus("Device not ready. Cannot start stream.");
        console.error("startConsuming called but device not loaded.");
        dispatchConnectionState('failed');
        return;
    }

    if (!recvTransport) {
        console.log("Transport not ready, requesting creation...");
        dispatchConnectionState("connecting");
        (window as any).pendingStreamId = streamId;
        sendSignal('createWebRtcTransport');
        return;
    }

    if(recvTransport.connectionState !== 'connected'){
        console.warn(`Transport not connected yet (state: ${recvTransport.connectionState}). Will consume when connected.`);
        dispatchConnectionState(recvTransport.connectionState);
        (window as any).pendingStreamId = streamId;
        if (recvTransport.connectionState === 'failed' || recvTransport.connectionState === 'closed') {
            console.log("Transport is failed/closed, requesting a new one...");
            sendSignal('createWebRtcTransport');
        }
        return;
    }

    requestConsume(streamId);
}

function requestConsume(streamId: string) {
    if (!recvTransport || recvTransport.connectionState !== 'connected') {
        console.error(`Cannot consume stream ${streamId}, transport not ready or not connected (State: ${recvTransport?.connectionState}).`);
        (window as any).pendingStreamId = streamId;
        if (!recvTransport || ['failed', 'closed'].includes(recvTransport.connectionState)) {
            console.log("Requesting new transport before consuming...");
            sendSignal('createWebRtcTransport');
        } else {
            dispatchConnectionState(recvTransport?.connectionState || "connecting");
        }
        return;
    }
    console.log(`Requesting to consume stream: ${streamId}`);
    updateStatus(`Requesting stream: ${getStreamNameById(streamId)}...`);
    sendSignal('consume', { streamId });
}


async function handleConsumeReady(consumerInfo: ConsumerInfo) {
    // Assuming you added `appData` to ConsumerInfo on the server type definition
    if (!recvTransport) {
        console.error("Received consumer info, but transport is missing!");
        return;
    }
    if (!device?.loaded) {
        console.error("Received consumer info, but device is not loaded!");
        return;
    }

    console.log("Creating consumer client-side:", consumerInfo);
    try {
        if (currentConsumer && !currentConsumer.closed) {
            console.warn("Closing pre-existing consumer before creating new one.");
            closeConsumer();
        }

        currentConsumer = await recvTransport.consume({
            id: consumerInfo.consumerId,
            producerId: consumerInfo.producerId,
            kind: consumerInfo.kind,
            rtpParameters: consumerInfo.rtpParameters, // Assuming this matches types.RtpParameters
            appData: { ...(consumerInfo.appData || {}), streamId: consumerInfo.streamId } // Safely access appData
        } as types.ConsumerOptions);

        console.log("Consumer created:", currentConsumer);

        const { track } = currentConsumer;
        const audioElement = document.getElementById('remote-audio') as HTMLAudioElement;
        if (audioElement) {
            const stream = new MediaStream([track]);
            audioElement.srcObject = stream;
            console.log("Audio track added to element. Attempting play...");

            audioElement.play().then(() => {
                console.log("Audio playback started successfully.");
                updateStatus(`Listening to: ${getStreamNameById(consumerInfo.streamId)}`);
                dispatchConnectionState('connected');
                startStatsPolling();
            }).catch(e => {
                console.warn("Audio play failed (likely needs user interaction first):", e);
                updateStatus("Ready. Click page or player to start audio.");
                dispatchConnectionState('connected');

                const resumeAudio = () => {
                    if (audioElement.paused) {
                        console.log("Attempting to resume audio playback via interaction...");
                        audioElement.play().then(() => {
                            console.log("Audio playback resumed via interaction.");
                            updateStatus(`Listening to: ${getStreamNameById(consumerInfo.streamId)}`);
                            startStatsPolling();
                        }).catch(err => {
                            console.error("Audio play still failed after interaction:", err);
                            updateStatus("Could not start audio.");
                            dispatchConnectionState('failed');
                        });
                    }
                    window.removeEventListener('click', resumeAudio);
                    window.removeEventListener('touchstart', resumeAudio);
                    audioElement.removeEventListener('click', resumeAudio);
                };
                window.addEventListener('click', resumeAudio, { once: true });
                window.addEventListener('touchstart', resumeAudio, { once: true });
                audioElement.addEventListener('click', resumeAudio, { once: true });
            });

        } else {
            console.error("Audio element not found!");
        }

        currentConsumer.on('trackended', () => {
            console.warn('Consumer track ended.');
            closeConsumer();
            dispatchConnectionState("closed");
        });

        currentConsumer.on('transportclose', () => {
            console.warn('Consumer transport closed.');
        });

        currentConsumer.observer.on('close', () => {
            const closedConsumerId = currentConsumer?.id;
            console.log(`Consumer observer closed [ID: ${closedConsumerId}]`);
            if (currentConsumer && currentConsumer.id === closedConsumerId) {
                closeConsumer();
                dispatchConnectionState("closed");
            }
        });

    } catch (error) {
        console.error('Error creating consumer client-side:', error);
        updateStatus("Failed to start stream");
        dispatchConnectionState("failed");
    }
}

function closeConsumer() {
    if (currentConsumer) {
        const consumerId = currentConsumer.id;
        console.log(`Closing consumer [ID: ${consumerId}]`);
        stopStatsPolling();

        if (!currentConsumer.closed) {
            currentConsumer.close();
        }
        currentConsumer = null;

        const audioElement = document.getElementById('remote-audio') as HTMLAudioElement;
        if (audioElement) {
            audioElement.srcObject = null;
            audioElement.pause();
            audioElement.load();
        }
        console.log(`Consumer [ID: ${consumerId}] closed and cleaned up.`);
    }
}

// --- Stats Polling ---
function startStatsPolling() {
     if (statsIntervalId !== null) return; // Already polling
    stopStatsPolling(); // Clear just in case

    const statsOverlayEl = document.getElementById('stats-overlay');
    if (statsOverlayEl) statsOverlayEl.style.display = 'block';

    console.log("Starting stats polling...");
    statsIntervalId = window.setInterval(async () => {
        if (!currentConsumer || currentConsumer.closed) {
            stopStatsPolling(); // Stop polling if consumer gone
            return;
        }
        try {
            const stats = await currentConsumer.getStats();
            updateStatsOverlay(stats);
        } catch (error) {
            console.error("Error getting consumer stats:", error);
            stopStatsPolling();
        }
    }, 1000);
}

function stopStatsPolling() {
    if (statsIntervalId !== null) {
        console.log("Stopping stats polling.");
        clearInterval(statsIntervalId);
        statsIntervalId = null;
        clearStatsOverlay();
    }
}


// --- Stats Overlay Update Logic ---
function updateStatsOverlay(stats: RTCStatsReport) {
    let currentBitrate = 0;
    let currentJitter = 0; // in ms
    let currentPacketsLost = 0;
    let currentPacketsReceived = 0;
    let currentRoundTripTime : number | undefined; // in ms
    let currentCodecName = 'N/A';
    let currentJitterBufferDelay = 0; // in seconds
    let currentAudioLevel: number | undefined;

    const now = performance.now();
    const previousStats = (window as any).previousRtpStats || { bytesReceived: 0, timestamp: 0 };
    let totalBytesReceived = 0;

    stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            totalBytesReceived = report.bytesReceived || 0;
            if (previousStats.timestamp > 0 && totalBytesReceived >= previousStats.bytesReceived) {
                const timeDiffSeconds = (now - previousStats.timestamp) / 1000;
                const bytesDiff = totalBytesReceived - previousStats.bytesReceived;
                if (timeDiffSeconds > 0) {
                    currentBitrate = Math.round((bytesDiff * 8) / timeDiffSeconds / 1000); // kbps
                }
            } else if (previousStats.timestamp === 0) {
                currentBitrate = 0;
            }

            currentJitter = report.jitter !== undefined ? (report.jitter * 1000) : 0;
            currentPacketsLost = report.packetsLost || 0;
            currentPacketsReceived = report.packetsReceived || 0;
            currentJitterBufferDelay = report.jitterBufferDelay !== undefined ? report.jitterBufferDelay : 0;
            currentAudioLevel = report.audioLevel;

            if (report.codecId) {
                const codecReport = stats.get(report.codecId);
                if (codecReport) {
                    currentCodecName = codecReport.mimeType?.replace('audio/', '') || 'Unknown';
                }
            }
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime !== undefined) {
             currentRoundTripTime = report.currentRoundTripTime * 1000;
        }
    });

    (window as any).previousRtpStats = { bytesReceived: totalBytesReceived, timestamp: now };

    const totalPackets = currentPacketsReceived + currentPacketsLost;
    const packetLossPercent = totalPackets > 0 ? (currentPacketsLost / totalPackets) * 100 : 0;

    const updateElementText = (id: string, value: string | number | undefined, unit: string = '', precision?: number) => {
        const el = document.getElementById(id);
        if (el) {
            let textContent = 'N/A';
            if (value !== undefined && value !== null) {
                if (typeof value === 'number') {
                   textContent = precision !== undefined ? value.toFixed(precision) : value.toString();
                } else {
                    textContent = value;
                }
                textContent += unit ? ` ${unit}` : '';
            }
            el.textContent = textContent;
        }
    };

    updateElementText('stats-codec', currentCodecName);
    updateElementText('stats-bitrate', currentBitrate, 'kbps', 0);
    updateElementText('stats-jitter', currentJitter, 'ms', 2);
    updateElementText('stats-packetloss', packetLossPercent, '%', 2);
    updateElementText('stats-rtt', currentRoundTripTime, 'ms', 0);
    updateElementText('stats-bufferdelay', currentJitterBufferDelay, 's', 3);
    updateElementText('stats-audiolevel', currentAudioLevel, '', 2);
}

function clearStatsOverlay() {
     const updateElementText = (id: string, value: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
     updateElementText('stats-codec', 'N/A');
     updateElementText('stats-bitrate', '0 kbps');
     updateElementText('stats-jitter', '0.00 ms');
     updateElementText('stats-packetloss', '0.00 %');
     updateElementText('stats-rtt', 'N/A ms');
     updateElementText('stats-bufferdelay', '0.000 s');
     updateElementText('stats-audiolevel', 'N/A');

    const statsOverlayEl = document.getElementById('stats-overlay');
    if (statsOverlayEl) statsOverlayEl.style.display = 'none';

    delete (window as any).previousRtpStats;
}


// --- Disconnect ---
export function disconnect() {
    console.log("Disconnecting WebRTC and Signaling...");
    closeConsumer();
    if (recvTransport && !recvTransport.closed) {
        recvTransport.close();
    }
    recvTransport = null;

    if (device) {
        device = null;
        console.log("Device reference removed.");
    }
    removeMessageListener(handleSignalMessage);
    dispatchConnectionState("closed");
    serverRouterCapabilities = null;
    availableStreams = [];
    delete (window as any).pendingStreamId;

    // *** FIX 3: Remove direct call to populateStreamSelector ***
    // Resetting UI should be handled by UI component listening to 'connectionStateChange' event
    // populateStreamSelector([]); // REMOVED

    clearStatsOverlay();
}