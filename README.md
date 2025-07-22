# WebRTC Virtual Tabletop (VTT)

This project is a proof-of-concept for a truly serverless Virtual Tabletop (VTT) application that runs entirely in the browser. It uses WebRTC to establish direct peer-to-peer voice connections between all participants.

## Core Concept: The GM as a Signaling Hub

The most unique aspect of this project is its complete lack of a backend signaling server. Traditional WebRTC applications require a server to help peers exchange the metadata (offers, answers, and ICE candidates) needed to connect.

This application sidesteps that requirement by elevating the Game Master's (GM) browser to act as a temporary signaling hub.

The connection process works as follows:

1.  **Initial Connection (GM to Player)**:
    - The GM starts a session and generates a unique invite link.
    - The GM sends this link to a Player.
    - The Player opens the link, which contains the GM's connection offer. The Player's browser automatically generates an answer.
    - The Player copies this answer and sends it back to the GM (e.g., via a messaging app).
    - The GM processes the answer, establishing a direct, one-to-one WebRTC connection (with a secure data channel) with the Player.

2.  **Peer-to-Peer Mesh Creation (Player to Player)**:
    - Once the GM is connected to a Player, it uses the established data channel to request a "P2P Offer" from that Player. This is an offer that the Player is willing to share with other peers.
    - When a new Player (Player B) connects to the GM, the GM sends it the collection of P2P Offers it has gathered from all other connected players (e.g., Player A).
    - Player B's client receives Player A's offer and automatically generates an answer.
    - This answer is sent back to the GM over Player B's data channel.
    - The GM acts as a forwarder, sending the answer to Player A over its data channel.
    - Player A receives the answer and completes the direct peer-to-peer connection with Player B.

This process is repeated for every new player, resulting in a full mesh network where every participant is connected directly to every other participant, with the GM only acting as the initial introducer.

## Technology Stack

*   **Vanilla JavaScript (ESM)**: No frameworks, keeping the core logic clear and lightweight.
*   **WebRTC**: For peer-to-peer audio and data communication.
*   **Vite**: A fast, modern build tool for frontend development.
*   **`@vitejs/plugin-basic-ssl`**: To enable the required `https://` secure context for WebRTC during local development.

## How to Run Locally

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd libre-vtt
    ```

2.  **Install dependencies:**
    This project uses `pnpm`.
    ```bash
    pnpm install
    ```

3.  **Start the development server:**
    ```bash
    pnpm dev
    ```
    Vite will start a local development server at `https://localhost:5173` (or a similar port).

4.  **Trust the self-signed certificate:**
    Your browser will show a privacy warning because the SSL certificate is self-signed. This is safe for local development. Click "Advanced" and "Proceed" to continue.

5.  **Using the App:**
    - **GM Role**: Open the link in a browser. You are the GM. Click "Create Invite" and send the generated link to your players.
    - **Player Role**: Open the invite link from the GM. The app will load the invite data. Click "Process Input" to generate an answer. Copy this answer text and send it back to the GM.
    - The GM pastes the player's answer into their "Process Input" text area to establish the connection. The mesh network will then be built automatically.