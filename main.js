// --- DOM Elements ---
const sessionStatus = document.getElementById('session-status');
const myPeerIdEl = document.getElementById('my-peer-id');
const peerList = document.getElementById('peer-list');
const remoteAudio = document.getElementById('remote-audio');
const vttBoard = document.getElementById('vtt-board');

// GM Dialog elements
const gmMainControls = document.getElementById('gm-main-controls');
const openInviteDialogBtn = document.getElementById('open-invite-dialog-btn');
const gmInviteDialog = document.getElementById('gm-invite-dialog');
const createInviteBtn = document.getElementById('create-invite-btn');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const gmSignalingData = document.getElementById('gm-signaling-data');
const processGmInputBtn = document.getElementById('process-gm-input-btn');

// Player Dialog elements
const playerAnswerDialog = document.getElementById('player-answer-dialog');
const playerSignalingData = document.getElementById('player-signaling-data');
const copyPlayerAnswerBtn = document.getElementById('copy-player-answer-btn');

// --- State Management ---
const session = {
  role: 'idle', // 'gm' | 'player'
  myId: `peer_${Math.random().toString(36).substring(2, 9)}`,
  peers: new Map(), // <peerId, WebRTCManager>
  localStream: null, // To store the user's media stream
  gmId: null, // For players, the ID of the GM
  // GM only: stores offers from players to share with new players
  p2pOffers: new Map(), // <peerId, offer>
  vtt: {
    layers: [
      {
        id: `layer_${Math.random().toString(36).substring(2, 9)}`,
        name: 'Player Layer',
        visibleToPlayers: true,
        backgroundImage: null,
        tokens: [],
      }
    ]
  }
};

myPeerIdEl.textContent = session.myId;

/** Determines role based on URL and initializes the application. */
async function initialize() {
  if (window.location.hash) {
    // Player role: An invite hash is present.
    session.role = 'player';
    updateStatus('Player mode. Processing invite from URL...');
    const encodedInvite = window.location.hash.substring(1);
    history.pushState("", document.title, window.location.pathname + window.location.search);
    try {
      const payload = JSON.parse(atob(encodedInvite));
      if (payload.type === 'invite') {
        await handleInvite(payload);
      } else {
        updateStatus('Error: Invalid invite data in URL.');
      }
    } catch (err) {
      console.error("Failed to process invite from URL:", err);
      updateStatus('Error: Could not process invite from URL.');
    }
  } else {
    // GM role: No invite hash.
    session.role = 'gm';
    gmMainControls.style.display = 'block';
    updateStatus('GM mode. Create an invite to start.');
  }
  updatePeerList();
  renderVtt();
}

/** Updates the status message in the UI. */
function updateStatus(message) {
  console.log(`Status: ${message}`);
  sessionStatus.textContent = message;
}

/** Generic function to open a modal dialog. */
function openModal(modalElement) {
  modalElement.style.display = 'block';
}

/** Generic function to close a modal dialog. */
function closeModal(modalElement) {
  modalElement.style.display = 'none';
}

/** Renders the list of connected peers. */
function updatePeerList() {
  peerList.innerHTML = '';
  if (session.peers.size === 0) {
    peerList.innerHTML = '<li>No peers connected.</li>';
    return;
  }
  for (const peerId of session.peers.keys()) {
    const li = document.createElement('li');
    li.textContent = peerId;
    peerList.appendChild(li);
  }
}

/** Renders the entire VTT board based on the current session state. */
function renderVtt() {
  vttBoard.innerHTML = '';
  session.vtt.layers.forEach(layer => {
    // For players, only render layers marked as visible
    if (session.role === 'player' && !layer.visibleToPlayers) {
      return;
    }

    const layerEl = document.createElement('div');
    layerEl.className = 'vtt-layer';
    layerEl.dataset.layerId = layer.id;

    layer.tokens.forEach(token => {
      const tokenEl = document.createElement('div');
      tokenEl.className = 'token';
      tokenEl.dataset.tokenId = token.id;
      tokenEl.style.left = `${token.x}px`;
      tokenEl.style.top = `${token.y}px`;
      tokenEl.style.backgroundColor = token.color;
      tokenEl.textContent = token.peerId ? token.peerId.substring(0, 5) : 'NPC';

      makeTokenDraggable(tokenEl, layer.id);
      layerEl.appendChild(tokenEl);
    });

    vttBoard.appendChild(layerEl);
  });
}

/** Adds drag-and-drop functionality to a token element. */
function makeTokenDraggable(tokenEl, layerId) {
  tokenEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const boardRect = vttBoard.getBoundingClientRect();
    let startX = e.clientX;
    let startY = e.clientY;

    function onMouseMove(moveEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      const newLeft = Math.max(0, Math.min(boardRect.width - tokenEl.offsetWidth, tokenEl.offsetLeft + dx));
      const newTop = Math.max(0, Math.min(boardRect.height - tokenEl.offsetHeight, tokenEl.offsetTop + dy));

      tokenEl.style.left = `${newLeft}px`;
      tokenEl.style.top = `${newTop}px`;

      startX = moveEvent.clientX;
      startY = moveEvent.clientY;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      const newX = tokenEl.offsetLeft;
      const newY = tokenEl.offsetTop;
      const tokenId = tokenEl.dataset.tokenId;

      // Optimistic update for local responsiveness. The element is already moved.
      // We just need to update the state that would be used for a re-render.
      const layer = session.vtt.layers.find(l => l.id === layerId);
      const token = layer?.tokens.find(t => t.id === tokenId);
      if (token) {
        token.x = newX;
        token.y = newY;
      }

      if (session.role === 'gm') {
        // GM is authoritative, broadcasts the final position to all players.
        broadcastMessage({ type: 'token-moved', layerId, tokenId, x: newX, y: newY });
      } else {
        // Player sends a request to the GM to validate and broadcast the move.
        const gmConnection = session.peers.get(session.gmId);
        if (gmConnection) {
          gmConnection.send({ type: 'token-move-request', layerId, tokenId, x: newX, y: newY });
        }
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

/** Sends a message to all connected peers. */
function broadcastMessage(message) {
  for (const peer of session.peers.values()) {
    peer.send(message);
  }
}

/**
 * GM: Creates an offer for a new player and generates an invite payload.
 * This payload is then manually shared by the GM.
 */
async function createInvite() {
  updateStatus('Creating invite...');
  createInviteBtn.disabled = true; // Disable button while working
  const inviteId = `invite_${Math.random().toString(36).substring(2, 9)}`;
  const rtcManager = new WebRTCManager(inviteId);
  session.peers.set(inviteId, rtcManager); // Temporarily store by inviteId

  const iceGatheringPromise = new Promise(resolve => rtcManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

  try {
    // Get user media stream if we haven't already
    if (!session.localStream) {
      session.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    session.localStream.getTracks().forEach(track => rtcManager.peerConnection.addTrack(track, session.localStream));

    rtcManager.setupDataChannel(); // GM creates the data channel
    await rtcManager.createOffer();
    await iceGatheringPromise;

    const offer = rtcManager.peerConnection.localDescription;
    const payload = { type: 'invite', inviteId, offer, from: session.myId };
    const encodedPayload = btoa(JSON.stringify(payload));

    // Construct the full, shareable invite link
    const inviteLink = `${window.location.origin}${window.location.pathname}#${encodedPayload}`;

    // Update UI to show the link and copy button
    gmSignalingData.value = inviteLink;
    copyInviteBtn.style.display = 'inline-block';
    updateStatus(`Invite link created. Copy the link and send it to a player.`);
    createInviteBtn.disabled = false; // Re-enable for the next player
  } catch (err) {
    console.error('Error creating invite:', err);
    updateStatus('Error creating invite. Check console.');
    session.peers.delete(inviteId); // Clean up on failure
    createInviteBtn.disabled = false; // Re-enable on failure
  }
}

/**
 * Copies the generated invite link from the text area to the clipboard.
 */
function copyInviteLink() {
  const link = gmSignalingData.value;
  if (!link.startsWith('http')) {
    updateStatus('Error: No valid link in the text area to copy.');
    return;
  }
  navigator.clipboard.writeText(link).then(() => {
    updateStatus('Invite link copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy link:', err);
    updateStatus('Error: Could not copy link to clipboard. Check console.');
  });
}

/**
 * GM: Processes a player's answer pasted into the dialog.
 */
async function processGmInput() {
  const data = gmSignalingData.value;
  if (!data) return;

  try {
    const payload = JSON.parse(atob(data));
    if (payload.type === 'answer') {
      gmSignalingData.value = ''; // Clear after processing
      await handleAnswer(payload);
      closeModal(gmInviteDialog); // Close dialog on success
    } else {
      throw new Error(`Invalid payload type "${payload.type}" for GM input.`);
    }
  } catch (err) {
    console.error('Error processing input:', err);
    updateStatus('Error: Invalid signaling data. Check console.');
  }
}

/**
 * Player: Handles a received invite from the GM. Creates an answer and
 * places it in the text area to be sent back to the GM.
 */
async function handleInvite(payload) {
  updateStatus(`Processing invite from GM (${payload.from})...`);
  session.gmId = payload.from; // Store the GM's ID
  const rtcManager = new WebRTCManager(payload.from); // Connection to the GM
  session.peers.set(payload.from, rtcManager);
  updatePeerList();

  const iceGatheringPromise = new Promise(resolve => rtcManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

  try {
    if (!session.localStream) {
      session.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    session.localStream.getTracks().forEach(track => rtcManager.peerConnection.addTrack(track, session.localStream));

    // Player sets up data channel handlers for the channel created by the GM
    setupDataChannelHandlers(rtcManager, payload.from);

    await rtcManager.setRemoteDescription(payload.offer);
    const answer = await rtcManager.createAnswer();
    await iceGatheringPromise;

    const answerPayload = { type: 'answer', inviteId: payload.inviteId, from: session.myId, answer: rtcManager.peerConnection.localDescription };
    playerSignalingData.value = btoa(JSON.stringify(answerPayload));
    openModal(playerAnswerDialog);
    updateStatus('Answer created. Send the copied text back to the GM.');
  } catch (err) {
    console.error('Error handling invite:', err);
    updateStatus('Error handling invite. Check console.');
    session.peers.delete(payload.from);
  }
}

/**
 * GM: Handles a received answer from a player, completing the direct
 * GM-Player connection.
 */
async function handleAnswer(payload) {
  updateStatus(`Processing answer from ${payload.from}...`);
  const rtcManager = session.peers.get(payload.inviteId);
  if (!rtcManager) {
    throw new Error(`No pending invite found for inviteId: ${payload.inviteId}`);
  }

  await rtcManager.setRemoteDescription(payload.answer);

  // Connection is now pending, re-key the manager to the player's permanent ID
  session.peers.delete(payload.inviteId);
  session.peers.set(payload.from, rtcManager);
  rtcManager.id = payload.from; // Update the manager's internal ID

  updateStatus(`Connection with ${payload.from} is being established.`);
  updatePeerList();

  // Setup handlers for the now-active connection
  setupDataChannelHandlers(rtcManager, payload.from);
}

/**
 * Sets up the data channel message handlers for a given connection.
 * This is where the GM orchestrates the P2P mesh.
 */
function setupDataChannelHandlers(rtcManager, peerId) {
  rtcManager.ondatachannelopen = () => {
    updateStatus(`Data channel with ${peerId} is open.`);

    if (session.role === 'gm') {
      // 1. Send existing peer offers to the new player
      const offers = Array.from(session.p2pOffers.entries());

      // Create a token for the new player
      const playerLayer = session.vtt.layers.find(l => l.name === 'Player Layer');
      if (playerLayer) {
        const newPlayerToken = { id: `token_${peerId}`, peerId, x: 50, y: 50, color: `#${Math.floor(Math.random()*16777215).toString(16)}` };
        playerLayer.tokens.push(newPlayerToken);
        // Render the new token on the GM's screen and then send the update
        renderVtt();
        broadcastMessage({ type: 'game-state-update', vtt: session.vtt });
      }

      if (offers.length > 0) {
        rtcManager.send({ type: 'p2p-offer-list', offers });
      }

      // 2. Request a new P2P offer from this player to share with others
      rtcManager.send({ type: 'request-p2p-offer' });
    }
  };

  rtcManager.onmessage = (msg) => {
    console.log(`Received message from ${peerId}:`, msg);

    switch (msg.type) {
      // Any peer receives a full game state update from the GM
      case 'game-state-update':
        session.vtt = msg.vtt;
        renderVtt();
        break;

      // GM receives a request from a player to move a token
      case 'token-move-request':
        if (session.role === 'gm') {
          const layer = session.vtt.layers.find(l => l.id === msg.layerId);
          const token = layer?.tokens.find(t => t.id === msg.tokenId);
          if (token) {
            token.x = msg.x;
            token.y = msg.y;
            // GM approves the move and broadcasts the new authoritative position to ALL peers.
            renderVtt(); // Render the move on the GM's screen first
            broadcastMessage({ type: 'token-moved', layerId: msg.layerId, tokenId: msg.tokenId, x: msg.x, y: msg.y });
          }
        }
        break;

      // Any peer receives an authoritative "token has moved" message from the GM
      case 'token-moved':
        const layer = session.vtt.layers.find(l => l.id === msg.layerId);
        const token = layer?.tokens.find(t => t.id === msg.tokenId);
        if (token) {
          token.x = msg.x;
          token.y = msg.y;
          renderVtt();
        }
        break;

      // Player sends its P2P offer to the GM
      case 'p2p-offer':
        if (session.role === 'gm') {
          session.p2pOffers.set(peerId, msg.offer);
          // Broadcast this new peer's offer to all other connected peers
          for (const [id, peer] of session.peers) {
            if (id !== peerId) {
              peer.send({ type: 'p2p-offer-list', offers: [[peerId, msg.offer]] });
            }
          }
        }
        break;

      // Player receives a request from the GM to generate a P2P offer
      case 'request-p2p-offer':
        if (session.role === 'player') {
          updateStatus('GM requested a P2P offer. Generating...');
          // This is an async operation, so wrap it in an IIFE
          (async () => {
            try {
              // This is a special, temporary manager just to create an offer.
              const p2pOfferManager = new WebRTCManager('p2p-offer-template');
              const icePromise = new Promise(resolve => p2pOfferManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

              if (session.localStream) {
                session.localStream.getTracks().forEach(track => p2pOfferManager.peerConnection.addTrack(track, session.localStream));
              }

              await p2pOfferManager.createOffer();
              await icePromise;

              // Send the generated offer back to the GM. `rtcManager` is the GM connection.
              rtcManager.send({ type: 'p2p-offer', offer: p2pOfferManager.peerConnection.localDescription });
              updateStatus('P2P offer sent to GM.');

              p2pOfferManager.close(); // This manager's job is done.
            } catch (err) {
              console.error("Failed to generate P2P offer:", err);
              updateStatus("Error: Failed to generate P2P offer.");
            }
          })();
        }
        break;

      // Player receives a list of offers from the GM for other players
      case 'p2p-offer-list':
        // For each offer, create a new connection and send an answer back to the GM
        msg.offers.forEach(async ([otherPeerId, offer]) => {
          if (session.peers.has(otherPeerId)) return; // Already connected or connecting
          updateStatus(`Received offer to connect with ${otherPeerId}.`);
          const p2pManager = new WebRTCManager(otherPeerId);
          session.peers.set(otherPeerId, p2pManager);

          const icePromise = new Promise(resolve => p2pManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

          // Add the local audio track to the new P2P connection
          if (session.localStream) {
            session.localStream.getTracks().forEach(track => p2pManager.peerConnection.addTrack(track, session.localStream));
          }

          await p2pManager.setRemoteDescription(offer);
          const answer = await p2pManager.createAnswer();
          await icePromise;

          // Send the answer to the GM to be forwarded
          const gmConnection = session.peers.get(session.gmId);
          if (gmConnection) {
            gmConnection.send({ type: 'p2p-answer', to: otherPeerId, from: session.myId, answer: p2pManager.peerConnection.localDescription });
          }
          updatePeerList();
        });
        break;

      // GM forwards a P2P answer to the correct target player
      case 'p2p-answer':
        if (session.role === 'gm') {
          const targetPeer = session.peers.get(msg.to);
          if (targetPeer) {
            targetPeer.send(msg); // Forward the whole message
          }
        } else {
          // Player receives the forwarded answer and completes the P2P connection
          const p2pManager = session.peers.get(msg.from);
          if (p2pManager) {
            updateStatus(`Received answer from ${msg.from}. Connecting...`);
            p2pManager.setRemoteDescription(msg.answer);
          }
        }
        break;
    }
  };

  rtcManager.onconnectionstatechange = (state) => {
    updateStatus(`Connection with ${peerId} is now ${state}.`);
  };
}

// --- Event Listeners ---
window.addEventListener('DOMContentLoaded', () => initialize());

// GM Dialog Listeners
openInviteDialogBtn.addEventListener('click', () => openModal(gmInviteDialog));
gmInviteDialog.querySelector('.close-button').addEventListener('click', () => closeModal(gmInviteDialog));
createInviteBtn.addEventListener('click', createInvite);
copyInviteBtn.addEventListener('click', copyInviteLink);
processGmInputBtn.addEventListener('click', processGmInput);

// Player Dialog Listeners
copyPlayerAnswerBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(playerSignalingData.value).then(() => {
    updateStatus('Answer copied to clipboard!');
    closeModal(playerAnswerDialog);
  });
});