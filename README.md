# 🚀 ShareMesh Core

ShareMesh Core is a decentralized, high-performance, peer-to-peer (P2P) file-sharing platform designed to securely transfer massive files across browsers without data-storing intermediaries. By dropping bulky wrapper libraries, the platform interfaces directly with native web technologies to achieve true zero-knowledge end-to-end encryption and real-time network backpressure handling.

🔗 **Live Demo:** [https://decentralized-file-sharing-pied.vercel.app](https://decentralized-file-sharing-pied.vercel.app)

---

## ✨ Features
* **Native WebRTC Integration:** Engineered directly on top of the browser's native `RTCPeerConnection` and `RTCDataChannel` APIs, entirely bypassing heavy legacy wrappers like `simple-peer` to eliminate dependency bloat and polyfill injection crashes.
* **End-to-End Cryptography:** Implements secure application-layer encryption utilizing CryptoJS (AES-256). Payload data is fully encrypted client-side *before* entering the P2P pipeline, ensuring complete zero-knowledge security across the mesh.
* **Asynchronous Chunking & Backpressure Handling:** Seamlessly streams massive media files (like `.mp4` and `.heic`) by decomposing payloads into asynchronous 16KB chunk streams. Monitors the internal buffer (`bufferedAmount`) to throttle transmission dynamically, preventing client memory overflows.
* **WebRTC Race-Condition Resilience:** Features a custom state-based ICE Candidate buffering queue that prevents signaling synchronization issues during simultaneous peer handshakes.
* **Robust Room Management:** Built-in Socket.IO coordination handles private room allocation, live connection counts, explicit room capacity boundaries, and proactive peer exit/disconnect propagation.

## 🛠️ Tech Stack
* **Frontend:** React, Vite, Bootstrap CSS
* **Signaling Infrastructure:** Node.js, Express.js, Socket.IO
* **Cryptography:** CryptoJS (AES-256)
* **Deployment:** Vercel (Client App) & Railway (Signaling Container)

---

## 💻 Local Setup

If you want to spin up this project locally on your machine, follow these steps:

### 1. Clone the Repository
```bash
git clone [https://github.com/YOUR_USERNAME/ShareMesh.git](https://github.com/YOUR_USERNAME/ShareMesh.git)
cd ShareMesh
```

### 2. Run the Signaling Server
```bash
cd server
npm install
node server.js
```
*The signaling server will boot up natively on port 5000.*

### 3. Run the Client App
Open a separate terminal window and run:
```bash
cd client
npm install
npm run dev
```
*Open http://localhost:5173 in multiple tabs to test the direct peer-to-peer connection locally.*
