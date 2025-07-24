/**
 * Manages the WebRTC peer connection and signaling process.
 */
class WebRTCManager {
  /**
   * @param {string} id A unique identifier for this connection instance.
   * @param {RTCConfiguration} [config] - Configuration for the RTCPeerConnection.
   * Defaults to using public Google STUN servers if not provided.
   */
  constructor(id, config) {
    const defaultConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
    this.id = id;
    this.peerConnection = new RTCPeerConnection(config || defaultConfig);
    this.dataChannel = null;

    // Public event handlers that can be set from outside the class.
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
    this.ondatachannelopen = null;
    this.ondatachannelclose = null;
    this.onmessage = null;

    // Wire up the internal RTCPeerConnection events to our public handlers.
    this.peerConnection.onicecandidate = (event) => {
      if (this.onicecandidate) {
        this.onicecandidate(event);
      }
    };

    this.peerConnection.ontrack = (event) => {
      if (this.ontrack) {
        this.ontrack(event);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (this.onconnectionstatechange) {
        this.onconnectionstatechange(this.peerConnection.connectionState);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      console.log(`[${this.id}] Data channel received: ${event.channel.label}`);
      this.dataChannel = event.channel;
      this.setupDataChannelEventHandlers();
    };
  }

  /**
   * Creates a new data channel. Should be called by the peer initiating the connection.
   * @param {string} label A label for the data channel.
   */
  setupDataChannel(label = 'data') {
    if (this.dataChannel) return;
    console.log(`[${this.id}] Creating data channel: ${label}`);
    this.dataChannel = this.peerConnection.createDataChannel(label);
    this.setupDataChannelEventHandlers();
  }

  /** Wires up the event handlers for an existing or new data channel. */
  setupDataChannelEventHandlers() {
    this.dataChannel.onopen = () => {
      console.log(`[${this.id}] Data channel is open`);
      if (this.ondatachannelopen) {
        this.ondatachannelopen();
      }
    };
    this.dataChannel.onclose = () => {
      console.log(`[${this.id}] Data channel is closed`);
      if (this.ondatachannelclose) {
        this.ondatachannelclose();
      }
    };
    this.dataChannel.onmessage = (event) => {
      // All messages are expected to be JSON strings.
      if (this.onmessage) {
        try {
          this.onmessage(JSON.parse(event.data));
        } catch (e) {
          console.error("Failed to parse incoming message:", event.data, e);
        }
      }
    };
  }

  /**
   * Creates an SDP offer and sets it as the local description.
   * @returns {Promise<RTCSessionDescriptionInit>} The created offer.
   */
  async createOffer() {
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  /**
   * Creates an SDP answer to a received offer.
   * Note: You must call setRemoteDescription with the offer before calling this.
   * @returns {Promise<RTCSessionDescriptionInit>} The created answer.
   */
  async createAnswer() {
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  /**
   * Sets the remote session description (for an offer or an answer).
   * @param {RTCSessionDescriptionInit} sdp The session description from the remote peer.
   * @returns {Promise<void>}
   */
  async setRemoteDescription(sdp) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  /**
   * Adds an ICE candidate received from the remote peer.
   * @param {RTCIceCandidateInit} candidate The ICE candidate from the remote peer.
   * @returns {Promise<void>}
   */
  async addIceCandidate(candidate) {
    if (candidate) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  /**
   * Sends data through the data channel if it's open.
   * @param {object} data The data object to send (will be stringified).
   */
  send(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    } else {
      console.error(`[${this.id}] Data channel is not open. Cannot send data.`);
    }
  }

  /** Closes the peer connection and its data channel. */
  close() {
    console.log(`[${this.id}] Closing peer connection.`);
    if (this.dataChannel) this.dataChannel.close();
    if (this.peerConnection) this.peerConnection.close();
  }
}