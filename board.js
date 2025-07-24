/**
 * Manages all aspects of the VTT board, including rendering,
 * layer controls, and token interactions.
 */
export class BoardManager {
  /**
   * @param {object} session - The global session state object.
   * @param {object} callbacks - An object containing callback functions for communication.
   * @param {function} callbacks.broadcastMessage - Function to send a message to all peers.
   * @param {function} callbacks.sendTokenMoveRequest - Function for players to request a token move.
   * @param {object} elements - An object containing required DOM elements.
   */
  constructor(session, callbacks, elements) {
    this.session = session;
    this.callbacks = callbacks;
    this.elements = elements;

    this.backgroundEditStates = new Map(); // <layerId, boolean>

    if (!this.elements.vttBoard || !this.elements.layerList || !this.elements.addLayerBtn || !this.elements.tokenScaleSlider) {
      console.error("BoardManager is missing required DOM elements.");
    }
  }

  /**
   * Initializes all event listeners managed by the BoardManager.
   * This should be called once after the manager is created.
   */
  initializeEventListeners() {
    console.log("initializing board");
    if (this.session.role === 'gm') {
      this.elements.addLayerBtn.addEventListener('click', () => this.addNewLayer());
      this.elements.tokenScaleSlider.addEventListener('input', (e) => {
        const newScale = parseFloat(e.target.value);
        this.session.vtt.tokenScale = newScale;
        this.renderVtt();
        // This could be debounced in the future if performance becomes an issue.
        this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
      });
    }
  }

  /**
   * Renders the entire VTT board based on the current session state.
   */
  renderVtt() {
    this.elements.vttBoard.innerHTML = '';

    // Create a sorted copy of layers to ensure the Player Layer is always on top.
    const sortedLayers = [...this.session.vtt.layers].sort((a, b) => {
      if (a.name === 'Player Layer') return 1; // Move a to the end
      if (b.name === 'Player Layer') return -1; // Move b to the end
      return 0; // Keep original order for other layers
    });

    sortedLayers.forEach(layer => {
      // For players, only render layers marked as visible
      if (this.session.role === 'player' && !layer.visibleToPlayers) {
        return;
      }

      const layerEl = document.createElement('div');
      layerEl.className = 'vtt-layer';
      layerEl.dataset.layerId = layer.id;

      // For GM, make hidden layers semi-transparent instead of hiding them
      if (this.session.role === 'gm' && !layer.visibleToPlayers) {
        layerEl.style.opacity = '0.25';
      }

      if (layer.background) {
        layerEl.style.left = `${layer.background.x || 0}px`;
        layerEl.style.top = `${layer.background.y || 0}px`;
        layerEl.style.width = `${layer.background.width * layer.background.scale}px`;
        layerEl.style.height = `${layer.background.height * layer.background.scale}px`;
        layerEl.style.backgroundImage = `url(${layer.background.url})`;

        if (this.session.role === 'gm' && this.backgroundEditStates.get(layer.id)) {
            layerEl.classList.add('editing-background');
            this._makeBackgroundDraggable(layerEl, layer);
        }
      } else {
        // If a layer has no background, it should not intercept mouse events,
        // allowing clicks to pass through to layers below.
        // Tokens on this layer will still be interactive.
        layerEl.style.pointerEvents = 'none';
        layerEl.style.width = '100%';
        layerEl.style.height = '100%';
      }

      layer.tokens.forEach(token => {
        const tokenEl = document.createElement('div');
        tokenEl.className = 'token';
        tokenEl.dataset.tokenId = token.id;
        const baseTokenSize = 40;
        const globalTokenScale = this.session.vtt.tokenScale || 1;
        const individualTokenScale = token.scale || 1;
        const finalTokenSize = baseTokenSize * globalTokenScale * individualTokenScale;
        tokenEl.style.width = `${finalTokenSize}px`;
        tokenEl.style.height = `${finalTokenSize}px`;
        tokenEl.style.left = `${token.x}px`;
        tokenEl.style.top = `${token.y}px`;
        tokenEl.style.backgroundColor = token.color;
        tokenEl.textContent = token.name || (token.peerId ? token.peerId.substring(0, 5) : 'NPC');

        // Add a highlight for the user's own token
        if (token.peerId === this.session.myId) {
            tokenEl.style.borderColor = '#64caff';
            tokenEl.style.boxShadow = '0 0 8px #64caff';
        }

        // Add a tooltip to explain interactions
        tokenEl.title = `Token: ${token.name || 'Unnamed'}\nRight-click: Claim/Unclaim`;
        if (this.session.role === 'gm') {
            tokenEl.title += '\nShift + Right-click: Delete';
        }

        this.makeTokenDraggable(tokenEl, layerEl, layer.id, token);
        layerEl.appendChild(tokenEl);
      });

      this.elements.vttBoard.appendChild(layerEl);
    });
  }

  /**
   * Renders the layer management controls for the GM.
   */
  renderLayerControls() {
    if (this.session.role !== 'gm' || !this.elements.layerList) return;
    this.elements.layerList.innerHTML = '';

    // Set initial value for the token scale slider
    if (this.elements.tokenScaleSlider) {
      this.elements.tokenScaleSlider.value = this.session.vtt.tokenScale || 1;
    }

    this.session.vtt.layers.forEach(layer => {
      const li = document.createElement('li');
      li.className = 'layer-item';
      li.dataset.layerId = layer.id;

      // --- Top Row ---
      const topRow = document.createElement('div');
      topRow.className = 'layer-controls-row';

      const layerName = document.createElement('span');
      layerName.className = 'peer-id-text';
      layerName.textContent = layer.name;
      topRow.appendChild(layerName);

      const topRowControls = document.createElement('div');
      topRowControls.className = 'layer-item-controls';

      const visibilityBtn = document.createElement('button');
      visibilityBtn.textContent = layer.visibleToPlayers ? 'Visible' : 'Hidden';
      visibilityBtn.title = layer.visibleToPlayers ? 'Visible to players' : 'Hidden from players';
      visibilityBtn.onclick = () => this.toggleLayerVisibility(layer.id);
      topRowControls.appendChild(visibilityBtn);

      const backgroundLabel = document.createElement('label');
      backgroundLabel.className = 'button-like-label';
      backgroundLabel.textContent = 'BG';
      backgroundLabel.title = 'Set background image';

      const backgroundInput = document.createElement('input');
      backgroundInput.type = 'file';
      backgroundInput.accept = 'image/*';
      backgroundInput.style.display = 'none';
      backgroundInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.setLayerBackground(layer.id, e.target.files[0]);
        }
      };

      backgroundLabel.appendChild(backgroundInput);
      topRowControls.appendChild(backgroundLabel);

      const isEditing = this.backgroundEditStates.get(layer.id);

      // Background editing controls are only shown for the GM
      if (layer.background) {
        const editBgBtn = document.createElement('button');
        editBgBtn.textContent = isEditing ? 'Done' : 'Edit BG';
        editBgBtn.title = 'Toggle background editing';
        editBgBtn.onclick = () => this._toggleBackgroundEditMode(layer.id);
        topRowControls.appendChild(editBgBtn);
      }

      // Add NPC Token Button
      const addNpcBtn = document.createElement('button');
      addNpcBtn.textContent = 'NPC+';
      addNpcBtn.title = 'Add NPC Token';
      addNpcBtn.onclick = () => this._addNpcToken(layer.id);
      topRowControls.appendChild(addNpcBtn);

      topRow.appendChild(topRowControls);
      li.appendChild(topRow);

      // --- Bottom Row (Conditional) ---
      if (isEditing && layer.background) {
        const bottomRow = document.createElement('div');
        bottomRow.className = 'layer-edit-controls';

        const clearBgBtn = document.createElement('button');
        clearBgBtn.className = 'clear-bg-btn';
        clearBgBtn.textContent = '✕';
        clearBgBtn.title = 'Clear background image';
        clearBgBtn.onclick = () => this.clearLayerBackground(layer.id);
        bottomRow.appendChild(clearBgBtn);

        const scaleDownBtn = document.createElement('button');
        scaleDownBtn.className = 'bg-scale-btn';
        scaleDownBtn.textContent = '-';
        scaleDownBtn.title = 'Scale Down Background';
        scaleDownBtn.onclick = () => this._scaleLayerBackground(layer.id, 0.9);
        bottomRow.appendChild(scaleDownBtn);

        const scaleUpBtn = document.createElement('button');
        scaleUpBtn.className = 'bg-scale-btn';
        scaleUpBtn.textContent = '+';
        scaleUpBtn.title = 'Scale Up Background';
        scaleUpBtn.onclick = () => this._scaleLayerBackground(layer.id, 1.1);
        bottomRow.appendChild(scaleUpBtn);

        li.appendChild(bottomRow);
      }

      this.elements.layerList.appendChild(li);
    });
  }

  /**
   * Adds drag-and-drop functionality to a token element.
   * @private
   * @param {HTMLElement} tokenEl The token's DOM element.
   * @param {HTMLElement} layerEl The layer element the token is on.
   * @param {string} layerId The ID of the layer the token belongs to.
   * @param {object} tokenData The token's data object from the session state.
   */
  makeTokenDraggable(tokenEl, layerEl, layerId, tokenData) {
    tokenEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (this.session.role === 'gm' && e.shiftKey) {
            // GM-only delete action
            if (confirm(`DELETE token "${tokenData.name || tokenData.id}"?`)) {
                this._deleteToken(layerId, tokenData.id);
            }
        } else {
            // Claim/Unclaim action for everyone
            const isMyToken = tokenData.peerId === this.session.myId;
            const isUnclaimed = tokenData.peerId === null;

            if (isMyToken) {
                if (confirm('Unclaim this token?')) this._unclaimToken(layerId, tokenData.id);
            } else if (isUnclaimed) {
                if (confirm('Claim this token for yourself?')) this._claimToken(layerId, tokenData.id);
            }
        }
    });

    if (this.session.role === 'gm') {
      tokenEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._editToken(layerId, tokenData.id);
      });
    }

    tokenEl.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // Prevent background drag from firing
      e.preventDefault();
      let startX = e.clientX;
      let startY = e.clientY;

      const onMouseMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        const boardWidth = this.elements.vttBoard.offsetWidth;
        const boardHeight = this.elements.vttBoard.offsetHeight;

        // Calculate the token's new desired absolute position relative to the board
        const newAbsoluteX = layerEl.offsetLeft + tokenEl.offsetLeft + dx;
        const newAbsoluteY = layerEl.offsetTop + tokenEl.offsetTop + dy;

        // Clamp the absolute position to the board's boundaries
        const clampedAbsoluteX = Math.max(0, Math.min(boardWidth - tokenEl.offsetWidth, newAbsoluteX));
        const clampedAbsoluteY = Math.max(0, Math.min(boardHeight - tokenEl.offsetHeight, newAbsoluteY));

        // Convert the clamped absolute position back to a position relative to the layer
        const newLeft = clampedAbsoluteX - layerEl.offsetLeft;
        const newTop = clampedAbsoluteY - layerEl.offsetTop;

        tokenEl.style.left = `${newLeft}px`;
        tokenEl.style.top = `${newTop}px`;
        startX = moveEvent.clientX;
        startY = moveEvent.clientY;
      };

      const onMouseUp = (e) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const newX = tokenEl.offsetLeft;
        const newY = tokenEl.offsetTop;
        const tokenId = tokenEl.dataset.tokenId;

        if (this.session.role === 'gm' && e.button != 2) {
          // GM is authoritative, so update local state and broadcast.
          const layer = this.session.vtt.layers.find(l => l.id === layerId);
          const token = layer?.tokens.find(t => t.id === tokenId);
          if (token) {
            token.x = newX;
            token.y = newY;
          }
          this.callbacks.broadcastMessage({ type: 'token-moved', layerId, tokenId, x: newX, y: newY });
          this.callbacks.updateDistanceBasedAudio();
        } else {
          // Player just sends request. Does not modify local session state.
          // The visual element is already moved optimistically.
          this.callbacks.sendTokenMoveRequest(layerId, tokenId, newX, newY);
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  /** @private */
  _toggleBackgroundEditMode(layerId) {
    const currentState = this.backgroundEditStates.get(layerId) || false;
    this.backgroundEditStates.set(layerId, !currentState);
    this.renderLayerControls();
    this.renderVtt();
  }

  /**
   * Adds drag-and-drop functionality to a layer background.
   * @private
   */
  _makeBackgroundDraggable(layerEl, layer) {
    layerEl.addEventListener('mousedown', (e) => {
        // Prevent token drag from firing on the same click
        e.stopPropagation();
        e.preventDefault();

        let startX = e.clientX;
        let startY = e.clientY;

        const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            const newLeft = layerEl.offsetLeft + dx;
            const newTop = layerEl.offsetTop + dy;
            layerEl.style.left = `${newLeft}px`;
            layerEl.style.top = `${newTop}px`;
            startX = moveEvent.clientX;
            startY = moveEvent.clientY;
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const newX = layerEl.offsetLeft;
            const newY = layerEl.offsetTop;

            if (layer.background) {
                layer.background.x = newX;
                layer.background.y = newY;
                this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
  }

  /** @private */
  addNewLayer() {
    const layerName = prompt('Enter a name for the new layer:', `Layer ${this.session.vtt.layers.length + 1}`);
    if (!layerName || layerName.trim() === '') return;

    const newLayer = {
      id: `layer_${Math.random().toString(36).substring(2, 9)}`,
      name: layerName,
      visibleToPlayers: true,
      background: null,
      tokens: [],
    };
    this.session.vtt.layers.push(newLayer);
    this.renderLayerControls();
    this.renderVtt(); // Re-render the VTT to show the new empty layer for the GM.
    this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
  }

  /** @private */
  _addNpcToken(layerId) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (!layer) return;

    const npcName = prompt('Enter a name for the NPC token:', 'Goblin');
    if (!npcName || npcName.trim() === '') return;

    const newNpcToken = {
      id: `token_${Math.random().toString(36).substring(2, 9)}`,
      peerId: null, // This marks it as an NPC
      name: npcName,
      x: 50,
      y: 50,
      color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`,
      scale: 1,
    };

    layer.tokens.push(newNpcToken);
    this.renderVtt();
    this.callbacks.broadcastMessage({ type: 'token-added', layerId, tokenData: newNpcToken });
  }

  /** @private */
  _editToken(layerId, tokenId) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    const token = layer?.tokens.find(t => t.id === tokenId);
    if (!token) return;

    const currentScale = token.scale || 1;
    const newScaleStr = prompt(`Enter new size multiplier for token "${token.name || token.id}" (e.g., 0.5, 1, 2):`, currentScale);

    if (newScaleStr) {
        const newScale = parseFloat(newScaleStr);
        if (!isNaN(newScale) && newScale > 0) {
            token.scale = newScale;
            this.renderVtt();
            this.callbacks.broadcastMessage({ type: 'token-property-changed', layerId, tokenId, properties: { scale: newScale } });
        } else {
            alert("Invalid size. Please enter a positive number.");
        }
    }
  }

  /** @private */
  _claimToken(layerId, tokenId) {
    if (this.session.role === 'gm') {
        const changes = [];
        // First, unclaim any other token this user currently owns
        this.session.vtt.layers.forEach(l => {
            l.tokens.forEach(t => {
                if (t.peerId === this.session.myId) {
                    t.peerId = null;
                    changes.push({ layerId: l.id, tokenId: t.id, newOwner: null });
                }
            });
        });

        // Then, claim the new token
        const layer = this.session.vtt.layers.find(l => l.id === layerId);
        const token = layer?.tokens.find(t => t.id === tokenId);
        if (token) {
            token.peerId = this.session.myId;
            changes.push({ layerId: layer.id, tokenId: token.id, newOwner: this.session.myId });
        }

        this.renderVtt();
        this.callbacks.updateDistanceBasedAudio();
        this.callbacks.broadcastMessage({ type: 'token-ownership-changed', changes });
    } else {
        // Player sends a request to the GM
        this.callbacks.sendClaimTokenRequest(layerId, tokenId);
    }
  }

  /** @private */
  _unclaimToken(layerId, tokenId) {
    if (this.session.role === 'gm') {
        const layer = this.session.vtt.layers.find(l => l.id === layerId);
        const token = layer?.tokens.find(t => t.id === tokenId);
        if (token && token.peerId === this.session.myId) {
            token.peerId = null;
            this.renderVtt();
            this.callbacks.updateDistanceBasedAudio();
            const changes = [{ layerId: layer.id, tokenId: token.id, newOwner: null }];
            this.callbacks.broadcastMessage({ type: 'token-ownership-changed', changes });
        }
    } else {
        this.callbacks.sendUnclaimTokenRequest(layerId, tokenId);
    }
  }

  /** @private */
  _deleteToken(layerId, tokenId) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (!layer) return;

    // Also works for player tokens, giving GM full control.
    layer.tokens = layer.tokens.filter(token => token.id !== tokenId);
    this.renderVtt();
    this.callbacks.broadcastMessage({ type: 'token-deleted', layerId, tokenId });
  }

  /** @private */
  clearLayerBackground(layerId) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (layer && layer.background) {
      layer.background = null;
      this.renderVtt();
      this.renderLayerControls(); // Re-render controls to hide the button
      this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
    }
  }

  /** @private */
  _scaleLayerBackground(layerId, factor) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (layer && layer.background) {
      layer.background.scale *= factor;
      // Clamp scale to a minimum reasonable value
      layer.background.scale = Math.max(0.05, layer.background.scale);
      this.renderVtt();
      this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
    }
  }

  /** @private */
  toggleLayerVisibility(layerId) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (layer) {
      layer.visibleToPlayers = !layer.visibleToPlayers;
      this.renderLayerControls();
      this.renderVtt(); // Re-render for the GM to apply opacity change.
      this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
    }
  }

  /** @private */
  setLayerBackground(layerId, file) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (!layer || !file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target.result;
      const image = new Image();
      image.onload = () => {
        // Now we have the dimensions
        layer.background = {
          url: imageUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
          scale: 1,
          x: layer.background?.x || 0, // Preserve position if replacing background
          y: layer.background?.y || 0,
        };
        this.renderVtt();
        this.renderLayerControls(); // Re-render controls to show the clear button
        this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
      };
      image.src = imageUrl;
    };
    reader.readAsDataURL(file);
  }
}