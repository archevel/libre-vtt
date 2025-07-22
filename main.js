import './style.css'
import { WebRTCManager } from './WebRTCManager.js';

// --- DOM Elements ---
const sessionStatus = document.getElementById('session-status');
const myPeerIdEl = document.getElementById('my-peer-id');
const gmControls = document.getElementById('gm-controls');
const createInviteBtn = document.getElementById('create-invite-btn');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const signalingText = document.getElementById('signaling-data');
const processInputBtn = document.getElementById('process-input-btn');
const peerList = document.getElementById('peer-list');
const remoteAudio = document.getElementById('remote-audio');

// --- State Management ---
const session = {
  role: 'idle', // 'gm' | 'player'
  myId: `peer_${Math.random().toString(36).substring(2, 9)}`,
  peers: new Map(), // <peerId, WebRTCManager>
  localStream: null, // To store the user's media stream
  gmId: null, // For players, the ID of the GM
  // GM only: stores offers from players to share with new players
  p2pOffers: new Map(), // <peerId, offer>
};

myPeerIdEl.textContent = session.myId;

/** Determines role based on URL and initializes the application. */
function initialize() {
  if (window.location.hash) {
    // Player role: An invite hash is present.
    session.role = 'player';
    updateStatus('Player mode. Invite data loaded from URL. Click "Process Input".');
    signalingText.value = window.location.hash.substring(1);
    history.pushState("", document.title, window.location.pathname + window.location.search);
  } else {
    // GM role: No invite hash.
    session.role = 'gm';
    gmControls.style.display = 'block';
    updateStatus('GM mode. Create an invite to start.');
  }
  updatePeerList();
}

/** Updates the status message in the UI. */
function updateStatus(message) {
  console.log(`Status: ${message}`);
  sessionStatus.textContent = message;
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
    signalingText.value = inviteLink;
    copyInviteBtn.style.display = 'inline-block';
    updateStatus(`Invite link created. Copy the link and send it to a player.`);
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
  const link = signalingText.value;
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
 * Central handler for processing pasted signaling data.
 * It decodes the data and routes it to the correct handler based on its type.
 */
async function processInput() {
  const data = signalingText.value;
  if (!data) return;

  try {
    const payload = JSON.parse(atob(data));
    signalingText.value = ''; // Clear after processing

    if (payload.type === 'invite' && session.role === 'player') {
      await handleInvite(payload);
    } else if (payload.type === 'answer' && session.role === 'gm') {
      await handleAnswer(payload);
    } else {
      throw new Error(`Invalid payload type "${payload.type}" for role "${session.role}"`);
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
    signalingText.value = btoa(JSON.stringify(answerPayload));
    updateStatus('Answer created. Copy text and send back to the GM.');
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
window.addEventListener('DOMContentLoaded', initialize);
createInviteBtn.addEventListener('click', createInvite);
copyInviteBtn.addEventListener('click', copyInviteLink);
processInputBtn.addEventListener('click', processInput);