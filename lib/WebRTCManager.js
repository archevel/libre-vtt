/**
 * Manages the WebRTC peer connection and signaling process.
 */
export class WebRTCManager {
  /**
   * @param {RTCConfiguration} [config] - Configuration for the RTCPeerConnection.
   * Defaults to using public Google STUN servers if not provided.
   */
  constructor(config) {
    const defaultConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
    this.peerConnection = new RTCPeerConnection(config || defaultConfig);

    // Public event handlers that can be set from outside the class.
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;

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
}