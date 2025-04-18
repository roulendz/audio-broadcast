# Local Audio Broadcast System

This project broadcasts local audio streams (e.g., from Dante via ALSA/PulseAudio) over the local network with low latency using GStreamer, mediasoup (SFU), and WebRTC. Clients can connect via a web browser to listen.

## Features

* **GStreamer Integration:** Captures audio, encodes to Opus (120kbps), and sends via RTP.
* **mediasoup SFU:** Efficiently forwards audio to multiple listeners using WebRTC.
* **Low Latency:** Optimized for minimal delay using PlainTransport (GStreamer->mediasoup) and WebRTC.
* **Web Client:** Simple browser interface to select and listen to streams.
* **Stats Overlay:** Displays real-time WebRTC connection health (bitrate, jitter, packet loss, latency).
* **Dynamic Stream Configuration:** Add/remove streams by editing `config/rtp-config.json`.
* **Glassmorphism UI:** Styled using TailwindCSS via CDN (no build step required for styles).
* **Local Network Only:** Designed for internal use, no STUN/TURN or external access configured.
* **No Authentication:** Anyone on the local network can listen.

## Prerequisites

* Node.js (v18 or later recommended for mediasoup v3)
* pnpm (or npm/yarn)
* GStreamer (1.0) with `opus`, `audioconvert`, `audioresample`, `rtp`, `alsasrc` (or `pulsesrc`), `audiotestsrc` plugins installed.
* An audio source configured (e.g., Dante audio mapped to an ALSA device).

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd audio-broadcast
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Configure Streams:**
    * Edit `config/rtp-config.json`.
    * Define your audio streams in the `streams` array. Ensure `ssrc` and `rtpPort` are unique for each stream.
    * Update `opusEncOptions` if needed.

4.  **Update GStreamer Commands:**
    * Modify the `gst:stream1`, `gst:stream2`, etc. scripts in `package.json` OR the standalone commands below.
    * **IMPORTANT:** Replace `audiotestsrc is-live=true wave=...` with your actual audio source element (e.g., `alsasrc device="hw:YourDanteDevice"` or `pulsesrc device="your.pulse.device.name"`). Find your device names using `arecord -L` (ALSA) or `pactl list sources short` (PulseAudio).
    * Ensure the `ssrc=` and `port=` values in the `udpsink` match the corresponding stream configuration in `config/rtp-config.json`.

## Running the System

1.  **Start the GStreamer Pipelines:**
    Open separate terminal windows for each stream you want to run.
    ```bash
    # Terminal 1: Start Stream 1
    pnpm run gst:stream1
    # or manually:
    # gst-launch-1.0 -v alsasrc device="hw:0" ! audioconvert ! audioresample ! opusenc bitrate=120000 inband-fec=true frame-size=20 audio-type=voice ! rtpopuspay pt=100 ssrc=1111 ! udpsink host=127.0.0.1 port=5001

    # Terminal 2: Start Stream 2
    pnpm run gst:stream2
    # or manually:
    # gst-launch-1.0 -v alsasrc device="hw:1" ! audioconvert ! audioresample ! opusenc bitrate=120000 inband-fec=true frame-size=20 audio-type=voice ! rtpopuspay pt=100 ssrc=2222 ! udpsink host=127.0.0.1 port=5003
    ```
    *(Remember to replace `alsasrc device="..."` with your actual source)*

2.  **Start the Node.js Server:**
    In another terminal:
    ```bash
    pnpm start
    ```
    This starts the backend server, mediasoup, and the WebSocket signaling.

3.  **Access the Client:**
    Open your web browser and navigate to `http://<your-server-ip>:3000` (e.g., `http://localhost:3000` or `http://192.168.1.100:3000`).

4.  **Listen:**
    Click the button corresponding to the stream you want to listen to. The audio player should appear, and the stats overlay will update.

## Development (Using Vite)

For easier client-side development with Hot Module Replacement (HMR):

1.  Ensure GStreamer pipelines and the backend server (`pnpm start`) are running as described above.
2.  In a separate terminal, run the Vite development server:
    ```bash
    pnpm run dev
    ```
3.  Access the client via the URL provided by Vite (usually `http://localhost:5173`). Changes made to files in the `client/` directory should reflect automatically in the browser.

## Notes

* **Firewall:** Ensure your server's firewall allows incoming connections on the HTTP port (default 3000) and the UDP ports used by mediasoup for WebRTC (default 40000-49999, defined in `rtp-config.json`). GStreamer communication is local (127.0.0.1), so it shouldn't require firewall changes.
* **mediasoup-client:** The WebRTC client uses the `mediasoup-client` library. It's loaded dynamically in `webrtc.js`. Ensure it's correctly served (Vite handles this in dev mode). For production deployment without Vite, you might need to copy `node_modules/mediasoup-client/lib/mediasoup-client.min.js` to your `public` folder and adjust the import path.
* **Error Handling:** Basic error handling is included, but can be expanded for robustness.