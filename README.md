# StreamFlow

StreamFlow is a blazing-fast, edge-native video streaming proxy and modern web player powered entirely by **Cloudflare Workers**. It allows you to seamlessly stream direct video URLs that would otherwise fail due to strict CORS policies or format limitations, wrapping them in a premium glassmorphic UI.

## 🏗️ Architecture

StreamFlow uses a tightly integrated full-stack architecture running entirely on the Cloudflare Edge network.

### 1. Cloudflare Workers (The Edge Proxy)
The backend is a highly optimized, native Cloudflare Worker (`src/index.ts`) that acts as a secure, stream-aware proxy. 

**Key Features:**
- **Range Request Passthrough:** Automatically maps and forwards `Range` and `Content-Range` HTTP headers between the client and the source server, ensuring that scrubbing and skipping through the video works flawlessly.
- **`HEAD` Pre-fetching:** Properly handles `HEAD` requests, allowing modern video players to determine file sizes and buffer capabilities before initializing a full download stream.
- **SSRF Protection:** Built-in security layers actively prevent Server-Side Request Forgery by blocking requests targeting internal network ranges (e.g., `localhost`, AWS/GCP metadata servers).
- **Graceful Timeouts:** Uses an `AbortSignal` with a strict 15-second timeout to prevent the worker from hanging indefinitely if a source server becomes unresponsive.
- **CORS Bypassing:** Injects appropriate permissive CORS headers back to the browser, allowing you to stream videos from remote origins directly inside the custom player.

### 2. Cloudflare Assets (The Frontend)
The frontend (`public/`) is served statically using Cloudflare's new Worker Assets configuration, meaning the HTML, CSS, and JS are served globally from the edge with ultra-low latency, right alongside the proxy API.

**Key Features:**
- **Premium Glassmorphic UI:** A visually stunning, state-of-the-art dark mode interface featuring dynamic neon gradients and background blurring (`backdrop-filter`).
- **60fps Debounced Rendering:** Custom progress bar updates and slider dragging are tethered to `requestAnimationFrame`, avoiding layout thrashing and guaranteeing buttery smooth UI interactions.
- **Auto-Recovery Engine:** If a transient network failure drops the video connection mid-stream, the player automatically intercepts the error, reconnects to the stream, and resumes playback from the exact timestamp.
- **Persistent Preferences:** Volume level, mute state, and playback speed are automatically saved and restored via browser `localStorage`.
- **Accessibility (a11y):** All custom video controls are fully instrumented with `aria-label` tags for complete screen reader support.

---

## 🚀 Getting Started

### Prerequisites
- Node.js installed
- A Cloudflare account

### Local Development
To run the project locally with the Cloudflare dev server:

```bash
npm install
npm run dev
```

The application will start on `http://localhost:8787`.

### Deployment
Because both the proxy worker and the frontend assets are bundled together via `wrangler.jsonc`, deployment takes exactly one command:

```bash
npx wrangler deploy
```

This will deploy the worker and upload the `/public` directory to Cloudflare's edge network globally.
