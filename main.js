import { CommunicationManager } from './communication.js';
import { Board, BoardState, EventHandler } from './board-interactive.js';

// --- DOM Elements ---
const sessionStatus = document.getElementById('session-status');
const hamburgerMenuBtn = document.getElementById('hamburger-menu-btn');
const mainMenu = document.getElementById('main-menu');
const myPeerIdEl = document.getElementById('my-peer-id');
const peerList = document.getElementById('peer-list');
const boardCanvas = document.getElementById('board-canvas');

// GM Layer elements
const gmLayerControls = document.getElementById('gm-layer-controls');
const layerList = document.getElementById('layer-list');
const addLayerBtn = document.getElementById('add-layer-btn');

// GM Dialog elements
const gmMainControls = document.getElementById('gm-main-controls');
const openInviteDialogBtn = document.getElementById('open-invite-dialog-btn');
const saveBoardBtn = document.getElementById('save-board-btn');
const loadBoardBtn = document.getElementById('load-board-btn');
const exportBoardBtn = document.getElementById('export-board-btn');
const importBoardInput = document.getElementById('import-board-input');
const gmInviteDialog = document.getElementById('gm-invite-dialog');
const createInviteBtn = document.getElementById('create-invite-btn');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const gmSignalingData = document.getElementById('gm-signaling-data');
const processGmInputBtn = document.getElementById('process-gm-input-btn');

// Player Dialog elements
const playerAnswerDialog = document.getElementById('player-answer-dialog');
const playerSignalingData = document.getElementById('player-signaling-data');
const copyPlayerAnswerBtn = document.getElementById('copy-player-answer-btn');

// Load Dialog elements
const loadBoardDialog = document.getElementById('load-board-dialog');
const savedStatesList = document.getElementById('saved-states-list');

// --- App Modules ---
let communicationManager;
let board;
let boardState;
let eventHandler;

// --- State Management ---
const session = {
  role: 'idle', // 'gm' | 'player'
  myId: `peer_${Math.random().toString(36).substring(2, 9)}`,
  peers: new Map(), // <peerId, WebRTCManager>
  peerAudioElements: new Map(), // <peerId, HTMLAudioElement>
  peerVolumes: new Map(), // <peerId, number> User-set max volume
  localStream: null, // To store the user's media stream
  gmId: null, // For players, the ID of the GM
  // GM only: stores offers from players to share with new players
  p2pOffers: new Map(), // <peerId, offer>
  vtt: {
    layers: [
      {
        id: `layer_${Math.random().toString(36).substring(2, 9)}`,
        name: 'Player Layer',
        visible: true,
        tokens: [],
      }
    ],
  },
  eventHandler: null, // Will be initialized later
};

myPeerIdEl.textContent = session.myId;

// --- UI Abstraction for CommunicationManager ---
const ui = {
  updateStatus,
  updatePeerList,
  renderLayerControls,
  updateDistanceBasedAudio,
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

  boardState = new BoardState();
  eventHandler = new EventHandler(boardState, renderLayerControls);
  session.eventHandler = eventHandler;

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
    gmLayerControls.style.display = 'block';
    eventHandler.handleEvent({ type: 'game-state-update', vtt: session.vtt });
  }
  updatePeerList();

  board = new Board(boardCanvas, boardState, {
      role: session.role,
      onTokenMoveRequested: (layerId, tokenId, x, y) => {
          communicationManager.broadcastMessage({
              type: 'token-moved',
              layerId,
              tokenId,
              x,
              y
          });
      },
      onPingRequested: (pos) => {
          communicationManager.broadcastMessage({
              type: 'ping',
              x: pos.x,
              y: pos.y,
              durationMillis: 3000
          });
      },
      onTokenSelected: (layerId, tokenId) => {
          // TODO: Implement token properties UI
          if (tokenId) {
              console.log(`Token ${tokenId} on layer ${layerId} selected`);
          } else {
              console.log('Token deselected');
          }
      }
  });
}

/** Updates the status message in the UI. */
function updateStatus(message) {
  console.log(`Status: ${message}`);
  sessionStatus.textContent = message;
}

/**
 * Toggles the visibility of the main hamburger menu.
 * @param {boolean} [forceState] - `true` to show, `false` to hide. Toggles if undefined.
 */
function toggleMainMenu(forceState) {
    const isVisible = mainMenu.classList.contains('main-menu-visible');
    const show = typeof forceState === 'boolean' ? forceState : !isVisible;

    if (show) {
        mainMenu.classList.remove('main-menu-hidden');
        mainMenu.classList.add('main-menu-visible');
        hamburgerMenuBtn.setAttribute('aria-expanded', 'true');
    } else {
        mainMenu.classList.remove('main-menu-visible');
        mainMenu.classList.add('main-menu-hidden');
        hamburgerMenuBtn.setAttribute('aria-expanded', 'false');
    }
}

/** Generic function to open a modal dialog. */
function openModal(modalElement) {
  modalElement.style.display = 'block';
}

/** Generic function to close a modal dialog. */
function closeModal(modalElement) {
  modalElement.style.display = 'none';
}

/** Renders the layer controls UI based on the current board state. */
function renderLayerControls() {
    if (session.role !== 'gm') return;

    layerList.innerHTML = '';

    boardState.layers.forEach(layer => {
        const li = document.createElement('li');
        li.className = 'layer-item';
        li.dataset.layerId = layer.id;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'peer-id-text';
        nameSpan.textContent = layer.name;
        nameSpan.addEventListener('dblclick', () => {
            const newName = prompt('Enter new layer name:', layer.name);
            if (newName && newName.trim() !== '') {
                broadcastMessage({ type: 'layer-renamed', layerId: layer.id, name: newName });
            }
        });

        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'layer-item-controls';

        const visibilityBtn = document.createElement('button');
        visibilityBtn.textContent = layer.visible ? 'Visible' : 'Hidden';
        visibilityBtn.title = layer.visible ? 'Visible to players' : 'Hidden from players';
        visibilityBtn.onclick = () => {
            broadcastMessage({ type: 'layer-visibility-changed', layerId: layer.id, visible: !layer.visible });
        };

        const addNpcBtn = document.createElement('button');
        addNpcBtn.textContent = 'NPC+';
        addNpcBtn.title = 'Add NPC Token';
        addNpcBtn.onclick = () => {
            const npcToken = {
                id: `token_${Math.random().toString(36).substring(2, 9)}`,
                x: 100,
                y: 100,
                color: 'purple',
                peerId: null
            };
            broadcastMessage({ type: 'token-added', layerId: layer.id, tokenData: npcToken });
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'X';
        deleteBtn.title = 'Delete Layer';
        deleteBtn.onclick = () => {
            if (confirm(`Are you sure you want to delete the layer "${layer.name}"?`)) {
                broadcastMessage({ type: 'layer-deleted', layerId: layer.id });
            }
        };

        controlsDiv.appendChild(visibilityBtn);
        controlsDiv.appendChild(addNpcBtn);
        controlsDiv.appendChild(deleteBtn);

        li.appendChild(nameSpan);
        li.appendChild(controlsDiv);
        layerList.appendChild(li);
    });
}

/**
 * Updates peer audio volumes based on the distance between claimed tokens.
 */
function updateDistanceBasedAudio() {
    const myToken = findMyToken();
    if (!myToken) {
        for (const [peerId, audioEl] of session.peerAudioElements.entries()) {
            audioEl.volume = session.peerVolumes.get(peerId) ?? 1;
        }
        return;
    }

    const allTokens = boardState.layers.flatMap(l => l.tokens);

    for (const [peerId, audioEl] of session.peerAudioElements.entries()) {
        const peerToken = allTokens.find(t => t.peerId === peerId);
        const maxVolume = session.peerVolumes.get(peerId) ?? 1;

        if (peerToken) {
            const distance = Math.hypot(myToken.x - peerToken.x, myToken.y - peerToken.y);
            const minDistance = 40;
            const maxDistance = 1200;
            const minVolume = 0.05;
            let volumeRatio = 0;

            if (distance <= minDistance) {
                volumeRatio = 1;
            } else if (distance < maxDistance) {
                const invSqrDist = 1 / (distance * distance);
                const invSqrMin = 1 / (minDistance * minDistance);
                const invSqrMax = 1 / (maxDistance * maxDistance);
                volumeRatio = (invSqrDist - invSqrMax) / (invSqrMin - invSqrMax);
            }

            const finalVolume = minVolume + (maxVolume - minVolume) * volumeRatio;
            audioEl.volume = finalVolume;
        } else {
            audioEl.volume = maxVolume;
        }
    }
}

/**
 * Finds the token claimed by the current user in the session.
 * @returns {object|null} The token object or null if not found.
 */
function findMyToken() {
    return boardState.layers
        .flatMap(l => l.tokens)
        .find(t => t.peerId === session.myId);
}

/** Renders the list of connected peers. */
function updatePeerList() {
  peerList.innerHTML = '';
  if (session.peers.size === 0) {
    peerList.innerHTML = '<li>No peers connected.</li>';
    return;
  }
  const sortedPeers = Array.from(session.peers.keys()).sort((a, b) => {
    if (a === session.gmId) return -1;
    if (b === session.gmId) return 1;
    return a.localeCompare(b);
  });

  for (const peerId of sortedPeers) {
    const li = document.createElement('li');
    const peerIdText = document.createElement('span');
    peerIdText.className = 'peer-id-text';
    peerIdText.textContent = peerId === session.gmId ? `${peerId} (GM)` : peerId;
    li.appendChild(peerIdText);

    const audioEl = session.peerAudioElements.get(peerId);
    if (audioEl) {
      const controlsContainer = document.createElement('div');
      controlsContainer.className = 'peer-audio-controls';

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      muteBtn.textContent = audioEl.muted ? 'Unmute' : 'Mute';
      muteBtn.onclick = () => {
        audioEl.muted = !audioEl.muted;
        muteBtn.textContent = audioEl.muted ? 'Unmute' : 'Mute';
      };

      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.min = 0;
      volumeSlider.max = 1;
      volumeSlider.step = 0.05;
      volumeSlider.value = session.peerVolumes.get(peerId) ?? 1;
      volumeSlider.className = 'volume-slider';
      volumeSlider.oninput = () => {
        session.peerVolumes.set(peerId, parseFloat(volumeSlider.value));
        updateDistanceBasedAudio();
      };

      controlsContainer.appendChild(muteBtn);
      controlsContainer.appendChild(volumeSlider);
      li.appendChild(controlsContainer);
    }

    peerList.appendChild(li);
  }
}

/** Sends a message to all connected peers. */
function broadcastMessage(message) {
  communicationManager.broadcastMessage(message);
}

async function createInvite() {
  await communicationManager.createInvite();
  copyInviteLink();
}

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

async function processGmInput() {
  const data = gmSignalingData.value;
  if (!data) return;

  try {
    const payload = JSON.parse(atob(data));
    if (payload.type === 'answer') {
      gmSignalingData.value = '';
      await communicationManager.processAnswer(payload);
      closeModal(gmInviteDialog);
    } else {
      throw new Error(`Invalid payload type "${payload.type}" for GM input.`);
    }
  } catch (err) {
    console.error('Error processing input:', err);
    updateStatus('Error: Invalid signaling data. Check console.');
  }
}

function saveBoardState() {
  if (session.role !== 'gm') return;

  const saveName = prompt('Enter a name for this save state:');
  if (!saveName || saveName.trim() === '') {
    updateStatus('Save cancelled.');
    return;
  }

  try {
    const boardStateToSave = { layers: boardState.layers };
    const boardStateJSON = JSON.stringify(boardStateToSave);
    localStorage.setItem(`vtt-save-${saveName.trim()}`, boardStateJSON);
    updateStatus(`Board state "${saveName.trim()}" saved successfully.`);
    toggleMainMenu(false);
  } catch (err) {
    console.error("Failed to save board state:", err);
    updateStatus("Error: Could not save board state. See console for details.");
  }
}

function exportBoardState() {
  if (session.role !== 'gm') return;

  const defaultName = `libre-vtt-board-${new Date().toISOString().split('T')[0]}.json`;
  const fileName = prompt('Enter a filename for the export:', defaultName);
  if (!fileName || fileName.trim() === '') {
    updateStatus('Export cancelled.');
    return;
  }

  try {
    const boardStateToSave = { layers: boardState.layers };
    const boardStateJSON = JSON.stringify(boardStateToSave, null, 2);
    const blob = new Blob([boardStateJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.trim();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateStatus(`Board exported as "${fileName.trim()}".`);
    toggleMainMenu(false);
  } catch (err) {
    console.error("Failed to export board state:", err);
    updateStatus("Error: Could not export board state. See console for details.");
  }
}

function importBoardState(event) {
  if (session.role !== 'gm' || !event.target.files.length) return;
  const file = event.target.files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importedState = JSON.parse(e.target.result);
      if (!importedState || !Array.isArray(importedState.layers)) throw new Error("Invalid board state format.");
      loadBoardState(importedState, `file "${file.name}"`);
    } catch (err) {
      updateStatus(`Error importing "${file.name}": Invalid JSON or format.`);
      console.error("Import failed:", err);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function showLoadDialog() {
    if (session.role !== 'gm') return;

    savedStatesList.innerHTML = '';
    let hasSaves = false;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('vtt-save-')) {
            hasSaves = true;
            const saveName = key.substring('vtt-save-'.length);
            const li = document.createElement('li');
            li.className = 'saved-state-item';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = saveName;
            li.appendChild(nameSpan);

            const controlsDiv = document.createElement('div');

            const loadBtn = document.createElement('button');
            loadBtn.textContent = 'Load';
            loadBtn.onclick = () => {
                const savedStateJSON = localStorage.getItem(key);
                if (savedStateJSON) loadBoardState(JSON.parse(savedStateJSON), `save "${saveName}"`);
            };
            controlsDiv.appendChild(loadBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'delete-save-btn';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete the save "${saveName}"?`)) {
                    localStorage.removeItem(key);
                    showLoadDialog();
                }
            };
            controlsDiv.appendChild(deleteBtn);
            li.appendChild(controlsDiv);

            savedStatesList.appendChild(li);
        }
    }

    if (!hasSaves) {
        savedStatesList.innerHTML = '<li>No saved states found.</li>';
    }

    openModal(loadBoardDialog);
}

function loadBoardState(newState, sourceDescription) {
    if (!newState) {
        updateStatus(`Error: Could not load board state from ${sourceDescription}.`);
        return;
    }

    broadcastMessage({ type: 'game-state-update', vtt: newState });
    updateStatus(`Board state from ${sourceDescription} loaded successfully.`);
    closeModal(loadBoardDialog);
    toggleMainMenu(false);
}

// --- Event Listeners ---
window.addEventListener('DOMContentLoaded', () => initialize());

hamburgerMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMainMenu();
});

document.addEventListener('click', (e) => {
    if (mainMenu.classList.contains('main-menu-visible') && !mainMenu.contains(e.target)) {
        toggleMainMenu(false);
    }
});

addLayerBtn.addEventListener('click', () => {
    if (session.role !== 'gm') return;
    const name = prompt('Enter a name for the new layer:');
    if (name && name.trim() !== '') {
        const newLayer = {
            id: `layer_${Math.random().toString(36).substring(2, 9)}`,
            name: name.trim(),
            visible: true,
            tokens: [],
        };
        broadcastMessage({ type: 'layer-added', layer: newLayer });
    }
});


// GM Dialog Listeners
openInviteDialogBtn.addEventListener('click', (e) => {
  e.preventDefault();
  openModal(gmInviteDialog);
});
loadBoardBtn.addEventListener('click', (e) => {
  e.preventDefault();
  showLoadDialog();
});
saveBoardBtn.addEventListener('click', (e) => {
  e.preventDefault();
  saveBoardState();
});
exportBoardBtn.addEventListener('click', (e) => {
  e.preventDefault();
  exportBoardState();
});
importBoardInput.addEventListener('change', importBoardState);

gmInviteDialog.querySelector('.close-button').addEventListener('click', () => closeModal(gmInviteDialog));
loadBoardDialog.querySelector('.close-button').addEventListener('click', () => closeModal(loadBoardDialog));
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