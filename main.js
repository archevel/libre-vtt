import { CommunicationManager } from './communication.js';

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

// --- App Modules ---
let communicationManager;

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

// --- UI Abstraction for CommunicationManager ---
const ui = {
  updateStatus,
  updatePeerList,
  renderVtt,
  openModal,
  elements: {
    createInviteBtn,
    copyInviteBtn,
    gmSignalingData,
    playerAnswerDialog,
    playerSignalingData,
  }
};

/** Determines role based on URL and initializes the application. */
async function initialize() {
  communicationManager = new CommunicationManager(session, ui);
  if (window.location.hash) {
    // Player role: An invite hash is present.
    session.role = 'player';
    updateStatus('Player mode. Processing invite from URL...');
    const encodedInvite = window.location.hash.substring(1);
    history.pushState("", document.title, window.location.pathname + window.location.search);
    try {
      const payload = JSON.parse(atob(encodedInvite));
      if (payload.type === 'invite') {
        await communicationManager.processInvite(payload);
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
        communicationManager.sendTokenMoveRequest(layerId, tokenId, newX, newY);
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

/** Sends a message to all connected peers. */
function broadcastMessage(message) {
  communicationManager.broadcastMessage(message);
}

/**
 * GM: Creates an offer for a new player and generates an invite payload.
 * This payload is then manually shared by the GM.
 */
async function createInvite() {
  await communicationManager.createInvite();
  copyInviteLink();
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
      await communicationManager.processAnswer(payload);
      closeModal(gmInviteDialog); // Close dialog on success
    } else {
      throw new Error(`Invalid payload type "${payload.type}" for GM input.`);
    }
  } catch (err) {
    console.error('Error processing input:', err);
    updateStatus('Error: Invalid signaling data. Check console.');
  }
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