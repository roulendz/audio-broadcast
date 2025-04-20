// Simplified and debug-logged version of mediasoupClient.ts
// FilePath: client/src/webrtc/mediasoupClient.ts

import mediasoupClient from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import type { ConsumerInfo } from '../../../server/src/types';
import { sendSignal, addMessageListener, removeMessageListener } from '../signaling/socket';

let device: types.Device | null = null;
let recvTransport: types.Transport | null = null;
let currentConsumer: types.Consumer | null = null;
let serverRouterCapabilities: types.RtpCapabilities | null = null;
let availableStreams: { id: string; name: string }[] = [];
let statsIntervalId: number | null = null;

function log(...args: any[]) {
    console.log('[mediasoupClient]', ...args);
}

function updateStatus(message: string) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = `Status: ${message}`;
}

function getStreamNameById(id?: string): string {
    return availableStreams.find(s => s.id === id)?.name || 'Unknown Stream';
}

function dispatchConnectionState(state: string) {
    const streamId = currentConsumer?.appData?.streamId || (window as any).pendingStreamId;
    window.dispatchEvent(new CustomEvent('connectionStateChange', {
        detail: { state, streamName: getStreamNameById(streamId) }
    }));
    updateStatus(
        state === 'connected' && streamId
            ? `Listening to: ${getStreamNameById(streamId)}`
            : state === 'failed' || state === 'closed'
                ? `Status: ${state === 'failed' ? 'Failed' : 'Disconnected'}`
                : 'Status: Connecting...'
    );
}

const handleSignalMessage = (action: string, payload: any) => {
    switch (action) {
        case 'serverInfo':
            log('serverInfo', payload);
            serverRouterCapabilities = payload.routerRtpCapabilities;
            availableStreams = payload.availableStreams;
            window.dispatchEvent(new CustomEvent('streamsAvailable', { detail: availableStreams }));
            loadDeviceIfNeeded();
            break;

        case 'transportCreated':
            log('transportCreated', payload);
            createRecvTransport(payload);
            break;

        case 'consumerReady':
            log('consumerReady', payload);
            handleConsumeReady(payload);
            break;

        case 'consumerClosed':
            if (currentConsumer?.id === payload.consumerId) {
                closeConsumer();
                dispatchConnectionState('closed');
            }
            break;

        case 'error':
            console.error('Server error:', payload);
            updateStatus(`Error: ${payload}`);
            dispatchConnectionState('failed');
            break;
    }
};

export async function initializeWebRTC() {
    log('Initializing WebRTC...');
    addMessageListener(handleSignalMessage);
}

async function loadDeviceIfNeeded() {
    if (device?.loaded || !serverRouterCapabilities) return;
    try {
        log('Loading device...');
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: serverRouterCapabilities });
        sendSignal('setRtpCapabilities', { rtpCapabilities: device.rtpCapabilities });
        window.dispatchEvent(new CustomEvent('deviceReady'));
    } catch (e: any) {
        console.error('Device load error', e);
        updateStatus('Failed to load device');
        dispatchConnectionState('failed');
    }
}

export function isDeviceLoaded() {
    return !!device?.loaded;
}

export function getAvailableStreams() {
    return availableStreams;
}

export function startConsuming(streamId: string) {
    console.log("[startConsuming] Called with stream ID:", streamId);
    closeConsumer();
    if (!device?.loaded) {
        updateStatus("Device not ready");
        dispatchConnectionState('failed');
        return;
    }
    if (!recvTransport || recvTransport.closed || recvTransport.connectionState === 'failed') {
        log('Creating new transport');
        (window as any).pendingStreamId = streamId;
        dispatchConnectionState('connecting');
        sendSignal('createWebRtcTransport');
        return;
    }
    if (recvTransport.connectionState === 'connected') {
        requestConsume(streamId);
    } else {
        (window as any).pendingStreamId = streamId;
        dispatchConnectionState(recvTransport.connectionState);
    }
}

function requestConsume(streamId: string) {
    console.log("[requestConsume] Invoked with stream ID:", streamId);
    if (!recvTransport || !device?.rtpCapabilities) return;
    log('Requesting consume', streamId);
    sendSignal('consume', { streamId });
}

function createRecvTransport(opts: any) {
    if (!device) return;
    if (recvTransport && !recvTransport.closed) recvTransport.close();

    recvTransport = device.createRecvTransport({
        id: opts.transportId,
        iceParameters: opts.iceParameters,
        dtlsParameters: opts.dtlsParameters,
        iceCandidates: opts.iceCandidates,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    log('Recv transport created', recvTransport.id);

    recvTransport.on('connect', ({ dtlsParameters }, callback) => {
        console.log("🔥 CONNECT event fired, sending DTLS:", dtlsParameters);
        sendSignal('connectWebRtcTransport', { transportId: recvTransport!.id, dtlsParameters });
        callback();
    });

    recvTransport.on('connectionstatechange', (state) => {
        log('Transport state change', state);
        dispatchConnectionState(state);

        if (state === 'connected') {
            const streamId = (window as any).pendingStreamId;
            if (streamId) {
                delete (window as any).pendingStreamId;
                requestConsume(streamId);
            }
        } else if (state === 'failed' || state === 'closed') {
            closeConsumer();
            recvTransport?.close();
            recvTransport = null;
        }
    });
}

async function handleConsumeReady(consumerInfo: ConsumerInfo) {
    if (!recvTransport || recvTransport.connectionState !== 'connected') return;
    try {
        currentConsumer = await recvTransport.consume({
            id: consumerInfo.consumerId,
            producerId: consumerInfo.producerId,
            kind: consumerInfo.kind,
            rtpParameters: consumerInfo.rtpParameters,
            appData: { ...(consumerInfo.appData || {}), streamId: consumerInfo.streamId }
        });
        log('Consumer created', currentConsumer);

        const audioEl = document.getElementById('remote-audio') as HTMLAudioElement;
        if (audioEl) {
            const stream = new MediaStream([currentConsumer.track]);
            audioEl.srcObject = stream;
            try {
                await audioEl.play();
                log('Audio started');
                updateStatus(`Listening to: ${getStreamNameById(consumerInfo.streamId)}`);
                dispatchConnectionState('connected');
                startStatsPolling();
            } catch (err) {
                log('Audio blocked; waiting for interaction');
                updateStatus("Click page to resume audio");
                const resume = () => {
                    audioEl.play().then(() => {
                        log('Audio resumed');
                        startStatsPolling();
                        updateStatus(`Listening to: ${getStreamNameById(consumerInfo.streamId)}`);
                        cleanupListeners();
                    }).catch(() => {
                        updateStatus('Audio failed');
                        dispatchConnectionState('failed');
                    });
                };
                const cleanupListeners = () => {
                    ['click', 'touchstart'].forEach(e => window.removeEventListener(e, resume));
                };
                window.addEventListener('click', resume, { once: true });
                window.addEventListener('touchstart', resume, { once: true });
            }
        }

        currentConsumer.on('trackended', () => {
            log('Track ended');
            closeConsumer();
            dispatchConnectionState('closed');
        });
    } catch (e) {
        console.error('Consumer error', e);
        updateStatus("Failed to play stream");
        dispatchConnectionState('failed');
    }
}

function closeConsumer() {
    if (!currentConsumer) return;
    log('Closing consumer', currentConsumer.id);
    stopStatsPolling();
    currentConsumer.close();
    currentConsumer = null;
    const audioEl = document.getElementById('remote-audio') as HTMLAudioElement;
    if (audioEl) {
        audioEl.srcObject = null;
        audioEl.pause();
        audioEl.load();
    }
}

function startStatsPolling() {
    if (statsIntervalId) return;
    statsIntervalId = window.setInterval(async () => {
        if (!currentConsumer || currentConsumer.closed) {
            stopStatsPolling();
            return;
        }
        try {
            const stats = await currentConsumer.getStats();
            log('Stats', stats);
        } catch (e) {
            stopStatsPolling();
        }
    }, 1000);
}

function stopStatsPolling() {
    if (statsIntervalId) {
        clearInterval(statsIntervalId);
        statsIntervalId = null;
    }
}

export function disconnect() {
    log('Disconnecting...');
    closeConsumer();
    if (recvTransport && !recvTransport.closed) recvTransport.close();
    recvTransport = null;
    removeMessageListener(handleSignalMessage);
    dispatchConnectionState('closed');
    delete (window as any).pendingStreamId;
}
