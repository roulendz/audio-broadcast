// FilePath: client/src/ui/StreamSelector.ts
import { getAvailableStreams, startConsuming, isDeviceLoaded } from '../webrtc/mediasoupClient'; // Removed unused 'disconnect'

// Keep variables at module scope
let connectButton: HTMLButtonElement | null = null;
let streamSelect: HTMLSelectElement | null = null;

export function setupUI() {
    connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    streamSelect = document.getElementById('stream-select') as HTMLSelectElement;

    if (!connectButton || !streamSelect) {
        console.error("UI elements not found!");
        return;
    }

    // Event listeners
    window.addEventListener('streamsAvailable', handleStreamsAvailable);
    window.addEventListener('deviceReady', handleDeviceReady);
    window.addEventListener('connectionStateChange', handleConnectionStateChange); // Use named handler

    connectButton.addEventListener('click', handleConnectClick);
    streamSelect.addEventListener('change', handleStreamSelectChange);

    // Initial state
    connectButton.disabled = true;
    streamSelect.disabled = true;
}

// --- Event Handlers ---

function handleStreamsAvailable(event: Event) {
    const streams = (event as CustomEvent).detail;
    populateStreamSelector(streams);
    if (streamSelect) {
        streamSelect.disabled = !isDeviceLoaded();
    }
}

function handleDeviceReady() {
    console.log("Device is ready, enabling UI.");
    if (streamSelect && connectButton && getAvailableStreams().length > 0) {
        streamSelect.disabled = false;
        connectButton.disabled = !streamSelect.value || !streamSelect.options[streamSelect.selectedIndex]?.value;
    } else if (connectButton) {
        // Device ready but no streams yet, keep button disabled
        connectButton.disabled = true;
    }
}

function handleConnectClick() {
    if (streamSelect?.value && streamSelect.options[streamSelect.selectedIndex]?.value) { // Ensure valid selection
        if (connectButton) {
           connectButton.disabled = true;
           connectButton.textContent = 'Connecting...';
        }
        startConsuming(streamSelect.value);
    }
}

function handleStreamSelectChange() {
    if (connectButton && streamSelect) {
        connectButton.disabled = !isDeviceLoaded() || !streamSelect.value || !streamSelect.options[streamSelect.selectedIndex]?.value;
    }
}

function handleConnectionStateChange(event: Event) {
    // Get elements again inside handler for safety
    connectButton = document.getElementById('connect-button') as HTMLButtonElement | null;
    streamSelect = document.getElementById('stream-select') as HTMLSelectElement | null;

    if (!connectButton) return; // Need button to update state

    const detail = (event as CustomEvent).detail;
    const state = detail.state as string; // Use string type from dispatchConnectionState
    const streamName = detail.streamName as string | undefined;

    console.log(`UI received connection state change: ${state}`); // Debug log

    switch (state) {
        case 'connected':
            connectButton.textContent = `Listening to ${streamName || 'Stream'}`;
            connectButton.disabled = true; // Keep disabled while connected
            if (streamSelect) streamSelect.disabled = true; // Optionally disable selector while connected
            break;
        case 'connecting':
        case 'checking':
            connectButton.textContent = 'Connecting...';
            connectButton.disabled = true;
            if (streamSelect) streamSelect.disabled = true; // Disable selector during connection attempt
            break;
        case 'disconnected': // Might recover, treat like closed for button state for now
        case 'failed':
        case 'closed':
            connectButton.textContent = 'Connect & Listen';
            // Re-enable button *only if* device is loaded and streams are available
            const streamsExist = getAvailableStreams().length > 0;
            connectButton.disabled = !isDeviceLoaded() || !streamsExist || !streamSelect?.value || !streamSelect?.options[streamSelect.selectedIndex]?.value;
             // Re-enable selector *only if* device is loaded and streams exist
            if (streamSelect) {
                 streamSelect.disabled = !isDeviceLoaded() || !streamsExist;
            }
            // *** FIX: Clear stream list on failure/close ***
            if (state === 'failed' || state === 'closed') {
                 console.log("Connection failed/closed, resetting stream list.");
                 populateStreamSelector([]); // Clear the dropdown options
                 if (streamSelect) streamSelect.disabled = true; // Ensure selector is disabled
                 if (connectButton) connectButton.disabled = true; // Ensure button is disabled
            }
            break;
        default:
            // Handle other states like 'new' if necessary
            connectButton.textContent = 'Connect & Listen';
            connectButton.disabled = true; // Default to disabled
            if (streamSelect) streamSelect.disabled = true;
            break;
    }
}


// --- UI Update Functions ---

function populateStreamSelector(streams: { id: string; name: string }[]) {
    // Get elements again inside function
    streamSelect = document.getElementById('stream-select') as HTMLSelectElement | null;
    connectButton = document.getElementById('connect-button') as HTMLButtonElement | null;

    if (!streamSelect) {
        console.error("populateStreamSelector: streamSelect element not found!");
        return;
    }

    const currentVal = streamSelect.value; // Store current selection if any

    while (streamSelect.options.length > 1) {
        streamSelect.remove(1);
    }

    const placeholderOption = streamSelect.options[0];
    if (!placeholderOption) {
        console.error("populateStreamSelector: Placeholder option not found!");
        return;
    }

    if (streams.length === 0) {
        placeholderOption.textContent = "No streams available";
        placeholderOption.value = "";
        streamSelect.disabled = true;
        if (connectButton) connectButton.disabled = true;
        return;
    }

    placeholderOption.textContent = "Select a stream...";
    placeholderOption.value = ""; // Ensure placeholder isn't selected by default

    streams.forEach(stream => {
        const option = document.createElement('option');
        option.value = stream.id;
        option.textContent = stream.name;
        streamSelect!.appendChild(option); // Use ! assertion, guarded above
    });

    // Try to restore previous selection if it still exists
    if (streams.some(s => s.id === currentVal)) {
        streamSelect.value = currentVal;
    }

    streamSelect.disabled = !isDeviceLoaded();
    if (connectButton) {
        connectButton.disabled = !isDeviceLoaded() || !streamSelect.value || !streamSelect.options[streamSelect.selectedIndex]?.value;
    }
}