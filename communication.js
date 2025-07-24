import { WebRTCManager } from './webrtc.js';

/**
 * Manages all WebRTC communication, including invite creation,
 * answer handling, and data channel messaging.
 */
export class CommunicationManager {
  /**
   * @param {object} session - The global session state object.
   * @param {object} ui - An object containing UI update functions and elements.
   */
  constructor(session, ui) {
    this.session = session;
    this.ui = ui;
  }

  /**
   * GM: Creates an offer for a new player and generates an invite payload.
   * This payload is then manually shared by the GM.
   */
  async createInvite() {
    this.ui.updateStatus('Creating invite...');
    this.ui.elements.createInviteBtn.disabled = true;

    const inviteId = `invite_${Math.random().toString(36).substring(2, 9)}`;
    const rtcManager = new WebRTCManager(inviteId);
    this.session.peers.set(inviteId, rtcManager); // Temporarily store by inviteId

    const iceGatheringPromise = new Promise(resolve => rtcManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

    try {
      if (!this.session.localStream) {
        this.session.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      this.session.localStream.getTracks().forEach(track => rtcManager.peerConnection.addTrack(track, this.session.localStream));

      rtcManager.setupDataChannel(); // GM creates the data channel
      await rtcManager.createOffer();
      await iceGatheringPromise;

      const offer = rtcManager.peerConnection.localDescription;
      const payload = { type: 'invite', inviteId, offer, from: this.session.myId };
      const encodedPayload = btoa(JSON.stringify(payload));
      const inviteLink = `${window.location.origin}${window.location.pathname}#${encodedPayload}`;

      this.ui.elements.gmSignalingData.value = inviteLink;
      this.ui.elements.copyInviteBtn.style.display = 'inline-block';
      this.ui.updateStatus(`Invite link created. Copy the link and send it to a player.`);
    } catch (err) {
      console.error('Error creating invite:', err);
      this.ui.updateStatus('Error creating invite. Check console.');
      this.session.peers.delete(inviteId); // Clean up on failure
    } finally {
      this.ui.elements.createInviteBtn.disabled = false;
    }
  }

  /**
   * Player: Handles a received invite from the GM. Creates an answer and
   * places it in the text area to be sent back to the GM.
   * @param {object} payload The decoded invite payload from the URL.
   */
  async processInvite(payload) {
    this.ui.updateStatus(`Processing invite from GM (${payload.from})...`);
    this.session.gmId = payload.from;
    const rtcManager = new WebRTCManager(payload.from);
    this.session.peers.set(payload.from, rtcManager);
    this.ui.updatePeerList();

    const iceGatheringPromise = new Promise(resolve => rtcManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

    try {
      if (!this.session.localStream) {
        this.session.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      this.session.localStream.getTracks().forEach(track => rtcManager.peerConnection.addTrack(track, this.session.localStream));

      this._setupConnectionHandlers(rtcManager, payload.from);

      await rtcManager.setRemoteDescription(payload.offer);
      await rtcManager.createAnswer();
      await iceGatheringPromise;

      const answerPayload = { type: 'answer', inviteId: payload.inviteId, from: this.session.myId, answer: rtcManager.peerConnection.localDescription };
      this.ui.elements.playerSignalingData.value = btoa(JSON.stringify(answerPayload));
      this.ui.openModal(this.ui.elements.playerAnswerDialog);
      this.ui.updateStatus('Answer created. Send the copied text back to the GM.');
    } catch (err) {
      console.error('Error handling invite:', err);
      this.ui.updateStatus('Error handling invite. Check console.');
      this.session.peers.delete(payload.from);
      this.ui.updatePeerList();
    }
  }

  /**
   * GM: Handles a received answer from a player, completing the direct
   * GM-Player connection.
   * @param {object} payload The decoded answer payload from the GM's input.
   */
  async processAnswer(payload) {
    this.ui.updateStatus(`Processing answer from ${payload.from}...`);
    const rtcManager = this.session.peers.get(payload.inviteId);
    if (!rtcManager) {
      throw new Error(`No pending invite found for inviteId: ${payload.inviteId}`);
    }

    // Re-map the connection from the temporary inviteId to the final peerId
    this.session.peers.delete(payload.inviteId);
    this.session.peers.set(payload.from, rtcManager);
    rtcManager.id = payload.from;

    // Setup handlers *before* setting the remote description, as setting it
    // can trigger events like 'ontrack'.
    this._setupConnectionHandlers(rtcManager, payload.from);

    await rtcManager.setRemoteDescription(payload.answer);

    this.ui.updateStatus(`Connection with ${payload.from} is being established.`);
    this.ui.updatePeerList();
  }

  /**
   * Sends a message to all connected peers.
   * @param {object} message The message object to send.
   */
  broadcastMessage(message) {
    for (const peer of this.session.peers.values()) {
      peer.send(message);
    }
  }

  /**
   * Player: Sends a request to the GM to move a token.
   * @param {string} layerId The ID of the layer containing the token.
   * @param {string} tokenId The ID of the token being moved.
   * @param {number} x The new x-coordinate.
   * @param {number} y The new y-coordinate.
   */
  sendTokenMoveRequest(layerId, tokenId, x, y) {
    const gmConnection = this.session.peers.get(this.session.gmId);
    if (gmConnection) {
      gmConnection.send({ type: 'token-move-request', layerId, tokenId, x, y });
    }
  }

  /**
   * Player: Sends a request to the GM to claim a token.
   * @param {string} layerId The ID of the layer containing the token.
   * @param {string} tokenId The ID of the token being claimed.
   */
  sendClaimTokenRequest(layerId, tokenId) {
    const gmConnection = this.session.peers.get(this.session.gmId);
    if (gmConnection) {
      gmConnection.send({ type: 'claim-token-request', layerId, tokenId });
    }
  }

  /**
   * Player: Sends a request to the GM to unclaim a token.
   * @param {string} layerId The ID of the layer containing the token.
   * @param {string} tokenId The ID of the token being unclaimed.
   */
  sendUnclaimTokenRequest(layerId, tokenId) {
    const gmConnection = this.session.peers.get(this.session.gmId);
    if (gmConnection) {
      gmConnection.send({ type: 'unclaim-token-request', layerId, tokenId });
    }
  }

  /**
   * Sets up the data channel and connection state handlers for a given connection.
   * @param {WebRTCManager} rtcManager The manager for the connection.
   * @param {string} peerId The ID of the peer being connected to.
   */
  _setupConnectionHandlers(rtcManager, peerId) {
    rtcManager.ontrack = (event) => {
      console.log(`Received track from ${peerId}`);
      if (event.streams && event.streams[0]) {
        let audioEl = this.session.peerAudioElements.get(peerId);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          document.body.appendChild(audioEl); // Add to body, keep it out of sight
          this.session.peerAudioElements.set(peerId, audioEl);
        }
        audioEl.srcObject = event.streams[0];
        this.ui.updatePeerList(); // Re-render peer list to show controls
      }
    };

    rtcManager.ondatachannelopen = () => {
      this.ui.updateStatus(`Data channel with ${peerId} is open.`);

      if (this.session.role === 'gm' && peerId !== this.session.gmId) {
        // 1. Send existing peer offers to the new player
        const offers = Array.from(this.session.p2pOffers.entries());

        // Create a token for the new player
        const playerLayer = this.session.vtt.layers.find(l => l.name === 'Player Layer');
        if (playerLayer) {
          const newPlayerToken = { id: `token_${peerId}`, peerId, x: 50, y: 50, color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`, scale: 1 };
          playerLayer.tokens.push(newPlayerToken);
          this.ui.renderVtt();
          this.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
          //this.broadcastMessage({ type: 'token-added', layerId: playerLayer.id, tokenData: newPlayerToken });
        }

        if (offers.length > 0) {
          rtcManager.send({ type: 'p2p-offer-list', offers });
        }

        // 2. Request a new P2P offer from this player to share with others
        rtcManager.send({ type: 'request-p2p-offer' });
      }
    };

    rtcManager.onmessage = (msg) => this._handleMessage(peerId, msg);

    rtcManager.onconnectionstatechange = (state) => {
      this.ui.updateStatus(`Connection with ${peerId} is now ${state}.`);
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.ui.updateStatus(`Peer ${peerId} has disconnected.`);
        this.session.peers.delete(peerId);

        const audioEl = this.session.peerAudioElements.get(peerId);
        if (audioEl) {
          audioEl.remove(); // Remove from DOM
          this.session.peerAudioElements.delete(peerId);
        }

        if (this.session.role === 'gm') {
          this.session.p2pOffers.delete(peerId);

          const changes = {
            removedTokenId: `token_${peerId}`, // The ID of the player's original token
            unclaimedTokens: [] // Other tokens the player might have controlled
          };

          // Find and mark for unclaiming any other tokens the player might have controlled
          this.session.vtt.layers.forEach(l => {
            l.tokens.forEach(t => {
              if (t.peerId === peerId && t.id !== changes.removedTokenId) {
                t.peerId = null;
                changes.unclaimedTokens.push({ layerId: l.id, tokenId: t.id });
              }
            });
          });

          // Remove the player's original token from the state
          this.session.vtt.layers.forEach(l => {
            l.tokens = l.tokens.filter(t => t.id !== changes.removedTokenId);
          });

          // Broadcast a targeted update instead of the full game state
          this.broadcastMessage({ type: 'player-disconnected-update', changes });
        }
        this.ui.updatePeerList();
        this.ui.renderVtt();
        this.ui.updateDistanceBasedAudio();
      }
    };
  }

  /**
   * Handles incoming messages from the data channel.
   * @param {string} peerId The ID of the peer who sent the message.
   * @param {object} msg The parsed message object.
   */
  _handleMessage(peerId, msg) {
    console.log(`Received message from ${peerId}:`, msg);

    switch (msg.type) {
      case 'game-state-update':
        this.session.vtt = msg.vtt;
        // A full state update should re-render everything.
        this.ui.renderVtt();
        this.ui.renderLayerControls();
        this.ui.updateDistanceBasedAudio();
        break;

      case 'token-move-request':
        if (this.session.role === 'gm') {
          const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
          const token = layer?.tokens.find(t => t.id === msg.tokenId);
          if (token) {
            token.x = msg.x;
            token.y = msg.y;
            this.ui.renderVtt();
            this.ui.updateDistanceBasedAudio();
            this.broadcastMessage({ type: 'token-moved', layerId: msg.layerId, tokenId: msg.tokenId, x: msg.x, y: msg.y });
          }
        }
        break;

      case 'token-moved': {
        const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
        const token = layer?.tokens.find(t => t.id === msg.tokenId);
        if (token) {
          token.x = msg.x;
          token.y = msg.y;
          this.ui.renderVtt();
          this.ui.updateDistanceBasedAudio();
        }
        break;
      }

      case 'token-deleted': {
        const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
        if (layer) {
          layer.tokens = layer.tokens.filter(t => t.id !== msg.tokenId);
          this.ui.renderVtt();
          this.ui.updateDistanceBasedAudio();
        }
        break;
      }

      case 'token-added': {
        const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
        if (layer) {
          // Avoid adding a duplicate if the message somehow gets echoed back
          if (!layer.tokens.some(t => t.id === msg.tokenData.id)) {
            layer.tokens.push(msg.tokenData);
          }
          this.ui.renderVtt();
          this.ui.updateDistanceBasedAudio();
        }
        break;
      }

      case 'token-property-changed': {
        const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
        const token = layer?.tokens.find(t => t.id === msg.tokenId);
        if (token && msg.properties) {
          Object.assign(token, msg.properties);
          this.ui.renderVtt();
          this.ui.updateDistanceBasedAudio();
        }
        break;
      }

      case 'claim-token-request':
        if (this.session.role === 'gm') {
          const changes = [];
          // Unclaim any other token owned by the requesting player
          this.session.vtt.layers.forEach(l => {
              l.tokens.forEach(t => {
                  if (t.peerId === peerId) {
                      t.peerId = null;
                      changes.push({ layerId: l.id, tokenId: t.id, newOwner: null });
                  }
              });
          });
          // Claim the new token
          const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
          const token = layer?.tokens.find(t => t.id === msg.tokenId);
          if (token) {
              token.peerId = peerId;
              changes.push({ layerId: layer.id, tokenId: token.id, newOwner: peerId });
          }
          this.ui.renderVtt();
          this.ui.updateDistanceBasedAudio();
          this.broadcastMessage({ type: 'token-ownership-changed', changes });
        }
        break;

      case 'unclaim-token-request':
        if (this.session.role === 'gm') {
            const layer = this.session.vtt.layers.find(l => l.id === msg.layerId);
            const token = layer?.tokens.find(t => t.id === msg.tokenId);
            if (token && token.peerId === peerId) {
                token.peerId = null;
                this.ui.renderVtt();
                this.ui.updateDistanceBasedAudio();
                const changes = [{ layerId: layer.id, tokenId: token.id, newOwner: null }];
                this.broadcastMessage({ type: 'token-ownership-changed', changes });
            }
        }
        break;

      case 'token-ownership-changed': {
        msg.changes.forEach(change => {
            const layer = this.session.vtt.layers.find(l => l.id === change.layerId);
            const token = layer?.tokens.find(t => t.id === change.tokenId);
            if (token) {
                token.peerId = change.newOwner;
            }
        });
        this.ui.renderVtt();
        this.ui.updateDistanceBasedAudio();
        break;
      }

      case 'player-disconnected-update': {
        const { removedTokenId, unclaimedTokens } = msg.changes;
        // Remove the disconnected player's original token
        this.session.vtt.layers.forEach(l => {
          l.tokens = l.tokens.filter(t => t.id !== removedTokenId);
        });
        // Unclaim any other tokens they were controlling
        unclaimedTokens.forEach(change => {
          const layer = this.session.vtt.layers.find(l => l.id === change.layerId);
          const token = layer?.tokens.find(t => t.id === change.tokenId);
          if (token) {
            token.peerId = null;
          }
        });
        this.ui.renderVtt();
        this.ui.updateDistanceBasedAudio();
        break;
      }

      case 'p2p-offer':
        if (this.session.role === 'gm') {
          this.session.p2pOffers.set(peerId, msg.offer);
          for (const [id, peer] of this.session.peers) {
            if (id !== peerId) {
              peer.send({ type: 'p2p-offer-list', offers: [[peerId, msg.offer]] });
            }
          }
        }
        break;

      case 'request-p2p-offer':
        if (this.session.role === 'player') {
          this._generateAndSendP2POffer(peerId); // peerId here is the GM's ID
        }
        break;

      case 'p2p-offer-list':
        this._handleP2POfferList(msg.offers);
        break;

      case 'p2p-answer':
        if (this.session.role === 'gm') {
          const targetPeer = this.session.peers.get(msg.to);
          if (targetPeer) {
            targetPeer.send(msg);
          }
        } else {
          const p2pManager = this.session.peers.get(msg.from);
          if (p2pManager) {
            this.ui.updateStatus(`Received answer from ${msg.from}. Connecting...`);
            p2pManager.setRemoteDescription(msg.answer);
          }
        }
        break;
    }
  }

  /**
   * Player: Generates a P2P offer and sends it to the GM.
   * @param {string} gmId The ID of the GM to send the offer to.
   */
  async _generateAndSendP2POffer(gmId) {
    this.ui.updateStatus('GM requested a P2P offer. Generating...');
    try {
      const p2pOfferManager = new WebRTCManager('p2p-offer-template');
      const icePromise = new Promise(resolve => p2pOfferManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

      if (this.session.localStream) {
        this.session.localStream.getTracks().forEach(track => p2pOfferManager.peerConnection.addTrack(track, this.session.localStream));
      }
      p2pOfferManager.setupDataChannel('p2p-data');

      await p2pOfferManager.createOffer();
      await icePromise;

      const gmConnection = this.session.peers.get(gmId);
      if (gmConnection) {
        gmConnection.send({ type: 'p2p-offer', offer: p2pOfferManager.peerConnection.localDescription });
        this.ui.updateStatus('P2P offer sent to GM.');
      }

      p2pOfferManager.close();
    } catch (err) {
      console.error("Failed to generate P2P offer:", err);
      this.ui.updateStatus("Error: Failed to generate P2P offer.");
    }
  }

  /**
   * Player: Handles a list of P2P offers from other players, sent by the GM.
   * @param {Array<[string, RTCSessionDescriptionInit]>} offers - An array of [peerId, offer] tuples.
   */
  _handleP2POfferList(offers) {
    offers.forEach(async ([otherPeerId, offer]) => {
      if (this.session.peers.has(otherPeerId) || otherPeerId === this.session.myId) {
        return;
      }
      this.ui.updateStatus(`Received offer to connect with ${otherPeerId}.`);
      const p2pManager = new WebRTCManager(otherPeerId);
      this.session.peers.set(otherPeerId, p2pManager);
      this.ui.updatePeerList();

      const icePromise = new Promise(resolve => p2pManager.peerConnection.onicecandidate = e => e.candidate === null && resolve());

      try {
        if (this.session.localStream) {
          this.session.localStream.getTracks().forEach(track => p2pManager.peerConnection.addTrack(track, this.session.localStream));
        }

        this._setupConnectionHandlers(p2pManager, otherPeerId);

        await p2pManager.setRemoteDescription(offer);
        await p2pManager.createAnswer();
        await icePromise;

        const gmConnection = this.session.peers.get(this.session.gmId);
        if (gmConnection) {
          gmConnection.send({ type: 'p2p-answer', to: otherPeerId, from: this.session.myId, answer: p2pManager.peerConnection.localDescription });
          this.ui.updateStatus(`Answer for ${otherPeerId} sent to GM for forwarding.`);
        }
      } catch (err) {
        console.error(`Failed to create P2P connection with ${otherPeerId}:`, err);
        this.ui.updateStatus(`Error connecting to ${otherPeerId}.`);
        this.session.peers.delete(otherPeerId);
        this.ui.updatePeerList();
      }
    });
  }
}