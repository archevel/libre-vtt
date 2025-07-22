import './style.css'
import { WebRTCManager } from './lib/WebRTCManager.js';

// --- DOM Elements ---
const createInviteBtn = document.getElementById('create-invite-btn');
const copyLinkBtn = document.getElementById('copy-link-btn');
const submitAnswerBtn = document.getElementById('submit-answer-btn');
const signalingText = document.getElementById('signaling-data');
const remoteAudio = document.getElementById('remote-audio');

let rtcManager;
let localStream;

/**
 * Checks the URL for an invite hash on page load. If found,
 * it automatically processes the offer and generates an answer.
 */
async function handlePageLoad() {
  if (window.location.hash) {
    const encodedOffer = window.location.hash.substring(1); // Remove the '#'
    console.log('Invite found in URL, attempting to process...');
    await processOfferAndCreateAnswer(encodedOffer);
    // Clear the hash to prevent re-processing on reload
    history.pushState("", document.title, window.location.pathname + window.location.search);
  }
}

/**
 * Creates an offer, waits for all ICE candidates, and generates
 * a shareable invite link.
 */
async function createInvite() {
  console.log('Creating invite...');
  rtcManager = new WebRTCManager();
  setupRtcEventHandlers();

  // A promise that resolves when ICE gathering is complete.
  const iceGatheringPromise = new Promise(resolve => { // The 'onicecandidate' event is fired for each candidate. // When it's done, it fires one last time with event.candidate === null.
    rtcManager.peerConnection.onicecandidate = (event) => {
      if (event.candidate === null) {
        resolve();
      }
    };
  });

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => rtcManager.peerConnection.addTrack(track, localStream));

    await rtcManager.createOffer();
    await iceGatheringPromise; // Wait until all candidates are found

    // The localDescription now contains the offer and all ICE candidates.
    const offer = rtcManager.peerConnection.localDescription;
    const encodedOffer = btoa(JSON.stringify(offer));

    const inviteLink = `${window.location.origin}${window.location.pathname}#${encodedOffer}`;
    copyLinkBtn.dataset.inviteLink = inviteLink; // Store for the copy button

    // Update UI for the initiator
    createInviteBtn.disabled = true;
    copyLinkBtn.style.display = 'inline-block';
    signalingText.placeholder = "Invite link generated. Send it to your peer, then paste their answer here.";
    console.log('Invite link created.');

  } catch (err) {
    console.error("Error creating invite:", err);
    alert("Could not create invite. Check console for errors (e.g., microphone access).");
  }
}

/**
 * Copies the generated invite link to the clipboard.
 */
function copyInviteLink() {
  const link = copyLinkBtn.dataset.inviteLink;
  console.log('Copying invite link:', link);
  navigator.clipboard.writeText(link).then(() => {
    alert('Invite link copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy link: ', err);
    alert('Failed to copy link. Please check the console.');
  });
}

/**
 * Processes a received offer (from URL), and creates an answer for the peer to send back.
 * @param {string} encodedOffer The Base64 encoded offer.
 */
async function processOfferAndCreateAnswer(encodedOffer) {
  try {
    const offer = JSON.parse(atob(encodedOffer));
    if (offer.type !== 'offer') {
      alert('Invalid invite data in URL.');
      return;
    }

    rtcManager = new WebRTCManager();
    setupRtcEventHandlers();

    const iceGatheringPromise = new Promise(resolve => {
      rtcManager.peerConnection.onicecandidate = e => e.candidate === null && resolve();
    });

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => rtcManager.peerConnection.addTrack(track, localStream));

    await rtcManager.setRemoteDescription(offer);
    await rtcManager.createAnswer();
    await iceGatheringPromise;

    const answer = rtcManager.peerConnection.localDescription;
    const encodedAnswer = btoa(JSON.stringify(answer));

    // Update UI for the peer
    signalingText.value = encodedAnswer;
    signalingText.readOnly = true;
    signalingText.placeholder = "This is your answer. Copy it and send it back to the initiator.";
    alert('Answer created! Copy the text from the text area and send it back.');
    createInviteBtn.disabled = true;
    submitAnswerBtn.disabled = true;

  } catch (err) {
    console.error("Error processing offer:", err);
    alert("Could not process invite. Is the link valid? Check console for errors.");
  }
}

/**
 * Handles submitting the final answer from the peer to complete the connection.
 */
async function submitAnswer() {
  if (!rtcManager) {
    alert("You must create an invite first before submitting an answer.");
    return;
  }
  const encodedAnswer = signalingText.value;
  try {
    const answer = JSON.parse(atob(encodedAnswer));
    await rtcManager.setRemoteDescription(answer);
  } catch (err) {
    console.error("Error submitting answer:", err);
    alert("Could not submit answer. Is the text valid? Check console for errors.");
  }
}

/**
 * Sets up the common event handlers for the WebRTCManager instance.
 */
function setupRtcEventHandlers() {
  rtcManager.onconnectionstatechange = (state) => {
    console.log(`Connection state changed: ${state}`);
    if (state === 'connected') {
      alert('Peers connected!');
      signalingText.value = 'Connection established!';
      signalingText.disabled = true;
      submitAnswerBtn.disabled = true;
      copyLinkBtn.disabled = true;
    }
  };

  rtcManager.ontrack = (event) => {
    console.log('New remote track received:', event.track);
    if (event.streams && event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.style.display = 'block';
      remoteAudio.play();
    }
  };
}

// --- Event Listeners ---
window.addEventListener('DOMContentLoaded', handlePageLoad);
createInviteBtn.addEventListener('click', createInvite);
copyLinkBtn.addEventListener('click', copyInviteLink);
submitAnswerBtn.addEventListener('click', submitAnswer);