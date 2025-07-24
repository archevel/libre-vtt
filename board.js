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

    if (!this.elements.vttBoard || !this.elements.layerList || !this.elements.addLayerBtn) {
      console.error("BoardManager is missing required DOM elements.");
    }
  }

  /**
   * Initializes all event listeners managed by the BoardManager.
   * This should be called once after the manager is created.
   */
  initializeEventListeners() {
    if (this.session.role === 'gm') {
      this.elements.addLayerBtn.addEventListener('click', () => this.addNewLayer());
    }
  }

  /**
   * Renders the entire VTT board based on the current session state.
   */
  renderVtt() {
    this.elements.vttBoard.innerHTML = '';
    this.session.vtt.layers.forEach(layer => {
      // For players, only render layers marked as visible
      if (this.session.role === 'player' && !layer.visibleToPlayers) {
        return;
      }

      const layerEl = document.createElement('div');
      layerEl.className = 'vtt-layer';
      layerEl.dataset.layerId = layer.id;

      if (layer.backgroundImage) {
        layerEl.style.backgroundImage = `url(${layer.backgroundImage})`;
      }

      layer.tokens.forEach(token => {
        const tokenEl = document.createElement('div');
        tokenEl.className = 'token';
        tokenEl.dataset.tokenId = token.id;
        tokenEl.style.left = `${token.x}px`;
        tokenEl.style.top = `${token.y}px`;
        tokenEl.style.backgroundColor = token.color;
        tokenEl.textContent = token.peerId ? token.peerId.substring(0, 5) : 'NPC';

        this.makeTokenDraggable(tokenEl, layer.id);
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

    this.session.vtt.layers.forEach(layer => {
      const li = document.createElement('li');
      li.className = 'layer-item';
      li.dataset.layerId = layer.id;

      const layerName = document.createElement('span');
      layerName.className = 'peer-id-text';
      layerName.textContent = layer.name;
      li.appendChild(layerName);

      const controls = document.createElement('div');
      controls.className = 'layer-item-controls';

      const visibilityBtn = document.createElement('button');
      visibilityBtn.textContent = layer.visibleToPlayers ? 'Visible' : 'Hidden';
      visibilityBtn.title = layer.visibleToPlayers ? 'Visible to players' : 'Hidden from players';
      visibilityBtn.onclick = () => this.toggleLayerVisibility(layer.id);
      controls.appendChild(visibilityBtn);

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
      controls.appendChild(backgroundLabel);

      li.appendChild(controls);
      this.elements.layerList.appendChild(li);
    });
  }

  /**
   * Adds drag-and-drop functionality to a token element.
   * @private
   */
  makeTokenDraggable(tokenEl, layerId) {
    tokenEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const boardRect = this.elements.vttBoard.getBoundingClientRect();
      let startX = e.clientX;
      let startY = e.clientY;

      const onMouseMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const newLeft = Math.max(0, Math.min(boardRect.width - tokenEl.offsetWidth, tokenEl.offsetLeft + dx));
        const newTop = Math.max(0, Math.min(boardRect.height - tokenEl.offsetHeight, tokenEl.offsetTop + dy));
        tokenEl.style.left = `${newLeft}px`;
        tokenEl.style.top = `${newTop}px`;
        startX = moveEvent.clientX;
        startY = moveEvent.clientY;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const newX = tokenEl.offsetLeft;
        const newY = tokenEl.offsetTop;
        const tokenId = tokenEl.dataset.tokenId;

        const layer = this.session.vtt.layers.find(l => l.id === layerId);
        const token = layer?.tokens.find(t => t.id === tokenId);
        if (token) {
          token.x = newX;
          token.y = newY;
        }

        if (this.session.role === 'gm') {
          this.callbacks.broadcastMessage({ type: 'token-moved', layerId, tokenId, x: newX, y: newY });
        } else {
          this.callbacks.sendTokenMoveRequest(layerId, tokenId, newX, newY);
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
      backgroundImage: null,
      tokens: [],
    };
    this.session.vtt.layers.push(newLayer);
    this.renderLayerControls();
    this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
  }

  /** @private */
  toggleLayerVisibility(layerId) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (layer) {
      layer.visibleToPlayers = !layer.visibleToPlayers;
      this.renderLayerControls();
      this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
    }
  }

  /** @private */
  setLayerBackground(layerId, file) {
    const layer = this.session.vtt.layers.find(l => l.id === layerId);
    if (!layer || !file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      layer.backgroundImage = e.target.result;
      this.renderVtt();
      this.callbacks.broadcastMessage({ type: 'game-state-update', vtt: this.session.vtt });
    };
    reader.readAsDataURL(file);
  }
}