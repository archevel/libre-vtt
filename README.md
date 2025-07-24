# Libre VTT

Libre VTT is a modern, lightweight, and serverless Virtual Tabletop (VTT) that runs entirely in your browser. It uses WebRTC to establish direct peer-to-peer connections for voice chat and real-time game state synchronization, all without a dedicated backend server.

## Features

*   **Serverless Architecture**: Uses the Game Master's browser as a temporary signaling hub to connect players.
*   **Peer-to-Peer Voice Chat**: High-quality, low-latency audio directly between all participants.
*   **Layer-Based Board**: Create and manage multiple layers for maps, tokens, and hidden information.
*   **Dynamic Backgrounds**: Set a background image for any layer, with GM controls for positioning and scaling.
*   **Token Management**: GMs can add, move, and delete NPC tokens. All users can move any visible token. A global token scale slider allows for easy size adjustments.
*   **GM Controls**: Toggle layer visibility for players (hidden layers appear transparent for the GM).
*   **Session Persistence**: Save, load, import, and export the entire board state, including all layers, backgrounds, and tokens.

## Core Concept: The GM as a Signaling Hub

The most unique aspect of this project is its complete lack of a backend signaling server. Traditional WebRTC applications require a server to help peers exchange the metadata (offers, answers, and ICE candidates) needed to connect.

This application sidesteps that requirement by elevating the Game Master's (GM) browser to act as a temporary signaling hub.

The connection process works as follows:

1.  **Initial Connection (GM to Player)**:
    - The GM starts a session and generates a unique invite link from the menu.
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
    git clone https://github.com/archevel/libre-vtt.git
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
    - **GM Role**: Open the application in your browser. You are the GM.
      1. Open the hamburger menu (☰) and click "Manage Invites".
      2. Click "Create Invite" and then "Copy Invite Link".
      3. Send the copied link to your players.
      4. When a player sends you their "Answer" text, paste it into the text area in the "Manage Invites" dialog and click "Process Player Answer".

    - **Player Role**:
      1. Open the invite link from the GM.
      2. A dialog will appear with your "Answer" text. Click "Copy Answer".
      3. Send this copied text back to the GM.

    Once the GM processes your answer, you will be connected. The application will then automatically build direct connections to all other players in the session.