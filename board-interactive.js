class BoardState {
    constructor() {
        this.layers = [];
        this.pings = [];
    }

    findLayer(layerId) {
        return this.layers.find(l => l.id === layerId);
    }

    findToken(layerId, tokenId) {
        const layer = this.findLayer(layerId);
        return layer ? layer.tokens.find(t => t.id === tokenId) : undefined;
    }

    addToken(layerId, tokenData) {
        const layer = this.findLayer(layerId);
        if (layer && !layer.tokens.some(t => t.id === tokenData.id)) {
            layer.tokens.push(tokenData);
        }
    }

    removeToken(layerId, tokenId) {
        const layer = this.findLayer(layerId);
        if (layer) {
            layer.tokens = layer.tokens.filter(t => t.id !== tokenId);
        }
    }
}

class EventHandler {
    constructor(boardState, onStateChange) {
        this.boardState = boardState;
        this.onStateChange = onStateChange || (() => {});
    }

    handleEvent(event) {
        switch (event.type) {
            case 'game-state-update':
                this.boardState.layers = event.vtt.layers;
                break;
            case 'token-moved':
                const tokenToMove = this.boardState.findToken(event.layerId, event.tokenId);
                if (tokenToMove) {
                    tokenToMove.x = event.x;
                    tokenToMove.y = event.y;
                }
                break;
            case 'token-deleted':
                this.boardState.removeToken(event.layerId, event.tokenId);
                break;
            case 'token-added':
                this.boardState.addToken(event.layerId, event.tokenData);
                break;
            case 'token-property-changed':
                const tokenToChange = this.boardState.findToken(event.layerId, event.tokenId);
                if (tokenToChange && event.properties) {
                    Object.assign(tokenToChange, event.properties);
                }
                break;
            case 'token-ownership-changed':
                event.changes.forEach(change => {
                    const token = this.boardState.findToken(change.layerId, change.tokenId);
                    if (token) {
                        token.peerId = change.newOwner;
                    }
                });
                break;
            case 'player-disconnected-update':
                const { removedTokenId, unclaimedTokens } = event.changes;
                this.boardState.layers.forEach(l => {
                    l.tokens = l.tokens.filter(t => t.id !== removedTokenId);
                });
                unclaimedTokens.forEach(change => {
                    const token = this.boardState.findToken(change.layerId, change.tokenId);
                    if (token) {
                        token.peerId = null;
                    }
                });
                break;
            case 'ping':
                this.boardState.pings.push({
                    x: event.x,
                    y: event.y,
                    startTime: Date.now(),
                    durationMillis: event.durationMillis || 2000
                });
                break;
            case 'layer-added':
                this.boardState.layers.push(event.layer);
                break;
            case 'layer-deleted':
                this.boardState.layers = this.boardState.layers.filter(l => l.id !== event.layerId);
                break;
            case 'layer-visibility-changed':
                const layerToToggle = this.boardState.findLayer(event.layerId);
                if (layerToToggle) {
                    layerToToggle.visible = event.visible;
                }
                break;
            case 'layer-renamed':
                const layerToRename = this.boardState.findLayer(event.layerId);
                if (layerToRename) {
                    layerToRename.name = event.name;
                }
                break;
            case 'layer-background-changed':
                const layerToChangeBg = this.boardState.findLayer(event.layerId);
                if (layerToChangeBg) {
                    layerToChangeBg.background = event.background;
                }
                break;
            case 'layer-background-cleared':
                const layerToClearBg = this.boardState.findLayer(event.layerId);
                if (layerToClearBg) {
                    layerToClearBg.background = null;
                }
                break;
            case 'layer-background-scaled':
                const layerToScaleBg = this.boardState.findLayer(event.layerId);
                if (layerToScaleBg && layerToScaleBg.background) {
                    layerToScaleBg.background.scale = event.scale;
                }
                break;
            case 'layer-background-moved':
                const layerToMoveBg = this.boardState.findLayer(event.layerId);
                if (layerToMoveBg && layerToMoveBg.background) {
                    layerToMoveBg.background.x = event.x;
                    layerToMoveBg.background.y = event.y;
                }
                break;
        }
        this.onStateChange();
    }
}

class Board {
    constructor(canvas, boardState, config = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.boardState = boardState;
        this.role = config.role || 'player';
        this.onTokenMoveRequested = config.onTokenMoveRequested || (() => {});
        this.onPingRequested = config.onPingRequested || (() => {});
        this.onTokenSelected = config.onTokenSelected || (() => {});
        this.onTokenContextMenu = config.onTokenContextMenu || (() => {});
        this.onBackgroundMoveRequested = config.onBackgroundMoveRequested || (() => {});

        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.draggedToken = null;
        this.draggedTokenLayerId = null;
        this.draggedTokenOriginalPos = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.selectedTokenId = null;
        this.selectedTokenLayerId = null;
        this.mouseDownPos = null;
        this.backgroundImages = new Map();
        this.backgroundEditLayerId = null;
        this.isDraggingBackground = false;
        this.longPressTimeout = null;

        this.sizeMap = { t: 10, s: 15, m: 20, l: 45, h: 67.5, g: 90 };

        this.lastPanX = 0;
        this.lastPanY = 0;
        this.lastTouchX = 0;
        this.lastTouchY = 0;
        this.initialPinchDistance = 0;
        this.lastTap = 0;

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));

        this.startAnimationLoop();
    }

    toggleBackgroundEditMode(layerId) {
        if (this.backgroundEditLayerId === layerId) {
            this.backgroundEditLayerId = null;
        } else {
            this.backgroundEditLayerId = layerId;
        }
    }

    centerOn(x, y) {
        this.panX = (this.canvas.width / 2) - (x * this.scale);
        this.panY = (this.canvas.height / 2) - (y * this.scale);
    }

    getViewportCenter() {
        return {
            x: (this.canvas.width / 2 - this.panX) / this.scale,
            y: (this.canvas.height / 2 - this.panY) / this.scale,
        };
    }

    startAnimationLoop() {
        const loop = () => {
            this.draw();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    getMousePos(evt) {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = evt.clientX || (evt.touches && evt.touches[0].clientX);
        const clientY = evt.clientY || (evt.touches && evt.touches[0].clientY);
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        return {
            x: (mouseX - this.panX) / this.scale,
            y: (mouseY - this.panY) / this.scale,
        };
    }

    resizeCanvas() {
        const displayWidth  = this.canvas.clientWidth;
        const displayHeight = this.canvas.clientHeight;

        if (this.canvas.width  !== displayWidth ||
            this.canvas.height !== displayHeight) {

          this.canvas.width  = displayWidth;
          this.canvas.height = displayHeight;
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.translate(this.panX, this.panY);
        this.ctx.scale(this.scale, this.scale);

        this.drawBackgrounds();
        this.drawGrid();
        this.drawTokens();
        this.drawPings();

        this.ctx.restore();
    }

    drawBackgrounds() {
        this.boardState.layers.forEach(layer => {
            const isVisible = layer.visible || this.role === 'gm';
            if (!isVisible || !layer.background || !layer.background.url) return;

            const originalAlpha = this.ctx.globalAlpha;
            if (!layer.visible && this.role === 'gm') {
                this.ctx.globalAlpha = 0.5;
            }

            if (!this.backgroundImages.has(layer.background.url)) {
                const img = new Image();
                img.src = layer.background.url;
                this.backgroundImages.set(layer.background.url, img);
            }
            const img = this.backgroundImages.get(layer.background.url);
            if (img.complete) {
                this.ctx.drawImage(img, layer.background.x || 0, layer.background.y || 0, layer.background.width * layer.background.scale, layer.background.height * layer.background.scale);
            }

            this.ctx.globalAlpha = originalAlpha;
        });
    }

    drawGrid() {
        const gridSize = 50;
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 1 / this.scale;

        const startX = Math.floor(-this.panX / this.scale / gridSize) * gridSize;
        const startY = Math.floor(-this.panY / this.scale / gridSize) * gridSize;
        const endX = startX + Math.ceil(this.canvas.width / this.scale / gridSize) * gridSize;
        const endY = startY + Math.ceil(this.canvas.height / this.scale / gridSize) * gridSize;

        for (let x = startX; x <= endX; x += gridSize) {
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += gridSize) {
            this.ctx.moveTo(startX, y);
            this.ctx.lineTo(endX, y);
        }
        this.ctx.stroke();
    }

    drawTokens() {
        this.boardState.layers.forEach(layer => {
            const isVisible = layer.visible || this.role === 'gm';
            if (!isVisible) return;

            const originalAlpha = this.ctx.globalAlpha;
            if (!layer.visible && this.role === 'gm') {
                this.ctx.globalAlpha = 0.5;
            }

            layer.tokens.forEach(token => {
                const radius = this.sizeMap[token.size] || 20;

                this.ctx.beginPath();
                this.ctx.arc(token.x, token.y, radius, 0, 2 * Math.PI);

                if (token.peerId) {
                    this.ctx.shadowColor = 'white';
                    this.ctx.shadowBlur = 15;
                }

                this.ctx.fillStyle = token.color;
                this.ctx.fill();

                this.ctx.shadowBlur = 0;

                if (token.id === this.selectedTokenId) {
                    this.ctx.strokeStyle = 'yellow';
                    this.ctx.lineWidth = 3 / this.scale;
                } else {
                    this.ctx.strokeStyle = 'black';
                    this.ctx.lineWidth = 1 / this.scale;
                }
                this.ctx.stroke();
            });

            this.ctx.globalAlpha = originalAlpha;
        });
    }

    drawPings() {
        const now = Date.now();
        this.boardState.pings = this.boardState.pings.filter(ping => {
            return now - ping.startTime < ping.durationMillis;
        });

        this.boardState.pings.forEach(ping => {
            const elapsedTime = now - ping.startTime;
            const progress = elapsedTime / ping.durationMillis;
            const pulse = Math.sin(progress * Math.PI * 4);
            const radius = 10 + pulse * 10;
            const alpha = 1 - progress;

            this.ctx.beginPath();
            this.ctx.arc(ping.x, ping.y, radius, 0, 2 * Math.PI);
            this.ctx.strokeStyle = `rgba(255, 255, 0, ${alpha})`;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        });
    }

    onMouseDown(e) {
        if (e.button === 2) { // Right-click
            return;
        }
        const pos = this.getMousePos(e);
        this.mouseDownPos = { x: e.clientX, y: e.clientY };

        if (this.backgroundEditLayerId) {
            const layer = this.boardState.findLayer(this.backgroundEditLayerId);
            if (layer && layer.background) {
                this.isDraggingBackground = true;
                return;
            }
        }

        for (const layer of [...this.boardState.layers].reverse()) {
            const isInteractable = layer.visible || this.role === 'gm';
            if (!isInteractable) continue;

            for (const token of [...layer.tokens].reverse()) {
                const dx = pos.x - token.x;
                const dy = pos.y - token.y;
                const radius = this.sizeMap[token.size] || 20;
                if (Math.sqrt(dx * dx + dy * dy) < radius) {
                    this.draggedToken = token;
                    this.draggedTokenLayerId = layer.id;
                    this.draggedTokenOriginalPos = { x: token.x, y: token.y };
                    this.dragOffsetX = dx; // Store the offset from token center to mouse click
                    this.dragOffsetY = dy;
                    return;
                }
            }
        }

        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
    }

    onMouseUp(e) {
        if (e.button === 2) { // Right-click
            this.draggedToken = null;
            this.draggedTokenLayerId = null;
            this.isPanning = false;
            return;
        }

        if (this.isDraggingBackground) {
            const layer = this.boardState.findLayer(this.backgroundEditLayerId);
            if (layer && layer.background) {
                this.onBackgroundMoveRequested(this.backgroundEditLayerId, layer.background.x, layer.background.y);
            }
            this.isDraggingBackground = false;
        } else if (this.draggedToken) {
            const mouseUpPos = { x: e.clientX, y: e.clientY };
            const moveDist = Math.sqrt(Math.pow(mouseUpPos.x - this.mouseDownPos.x, 2) + Math.pow(mouseUpPos.y - this.mouseDownPos.y, 2));

            if (moveDist < 5) { // It's a click
                this.draggedToken.x = this.draggedTokenOriginalPos.x;
                this.draggedToken.y = this.draggedTokenOriginalPos.y;

                if (this.selectedTokenId === this.draggedToken.id) {
                    this.selectedTokenId = null;
                    this.selectedTokenLayerId = null;
                } else {
                    this.selectedTokenId = this.draggedToken.id;
                    this.selectedTokenLayerId = this.draggedTokenLayerId;
                }
                this.onTokenSelected(this.selectedTokenLayerId, this.selectedTokenId);
            } else { // It's a drag
                const pos = this.getMousePos(e);
                this.onTokenMoveRequested(this.draggedTokenLayerId, this.draggedToken.id, pos.x, pos.y);
            }
        }

        this.draggedToken = null;
        this.draggedTokenLayerId = null;
        this.draggedTokenOriginalPos = null;
        this.isPanning = false;
    }

    onContextMenu(e) {
        e.preventDefault();
        const pos = this.getMousePos(e);
        for (const layer of [...this.boardState.layers].reverse()) {
            const isInteractable = layer.visible || this.role === 'gm';
            if (!isInteractable) continue;

            for (const token of [...layer.tokens].reverse()) {
                const dx = pos.x - token.x;
                const dy = pos.y - token.y;
                const radius = this.sizeMap[token.size] || 20;
                if (Math.sqrt(dx * dx + dy * dy) < radius) {
                    this.onTokenContextMenu(layer.id, token.id, e.clientX, e.clientY);
                    return;
                }
            }
        }
    }

    onDoubleClick(e) {
        const pos = this.getMousePos(e);
        this.onPingRequested(pos);
    }

    onMouseMove(e) {
        if (this.isDraggingBackground) {
            const layer = this.boardState.findLayer(this.backgroundEditLayerId);
            if (layer && layer.background) {
                const pos = this.getMousePos(e);
                layer.background.x = pos.x - (layer.background.width * layer.background.scale / 2);
                layer.background.y = pos.y - (layer.background.height * layer.background.scale / 2);
            }
        } else if (this.draggedToken) {
            const pos = this.getMousePos(e);
            this.draggedToken.x = pos.x - this.dragOffsetX;
            this.draggedToken.y = pos.y - this.dragOffsetY;
        } else if (this.isPanning) {
            const dx = e.clientX - this.lastPanX;
            const dy = e.clientY - this.lastPanY;
            this.panX += dx;
            this.panY += dy;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
        }
    }

    onWheel(e) {
        e.preventDefault();
        const scaleAmount = 1.1;
        const mouseX = e.clientX - this.panX;
        const mouseY = e.clientY - this.panY;

        if (e.deltaY < 0) {
            this.scale *= scaleAmount;
            this.panX -= (mouseX * (scaleAmount - 1));
            this.panY -= (mouseY * (scaleAmount - 1));
        } else {
            this.scale /= scaleAmount;
            this.panX += (mouseX * (1 - 1 / scaleAmount));
            this.panY += (mouseY * (1 - 1 / scaleAmount));
        }
    }

    onTouchStart(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const pos = this.getMousePos(touch);
            this.mouseDownPos = { x: touch.clientX, y: touch.clientY };

            this.longPressTimeout = setTimeout(() => {
                for (const layer of [...this.boardState.layers].reverse()) {
                    const isInteractable = layer.visible || this.role === 'gm';
                    if (!isInteractable) continue;

                    for (const token of [...layer.tokens].reverse()) {
                    const dx = pos.x - token.x;
                    const dy = pos.y - token.y;
                    const radius = this.sizeMap[token.size] || 20;
                    if (Math.sqrt(dx * dx + dy * dy) < radius) {
                        this.onTokenContextMenu(layer.id, token.id, touch.clientX, touch.clientY);
                        this.longPressTimeout = null;
                        return;
                    }
                }
                }
            }, 500);

            if (this.backgroundEditLayerId) {
                const layer = this.boardState.findLayer(this.backgroundEditLayerId);
                if (layer && layer.background) {
                    this.isDraggingBackground = true;
                    return;
                }
            }

            for (const layer of [...this.boardState.layers].reverse()) {
                const isInteractable = layer.visible || this.role === 'gm';
                if (!isInteractable) continue;

                for (const token of [...layer.tokens].reverse()) {
                    const dx = pos.x - token.x;
                    const dy = pos.y - token.y;
                    const radius = this.sizeMap[token.size] || 20;
                    if (Math.sqrt(dx * dx + dy * dy) < radius) {
                    this.draggedToken = token;
                    this.draggedTokenLayerId = layer.id;
                    this.draggedTokenOriginalPos = { x: token.x, y: token.y };
                    this.dragOffsetX = dx; // Store the offset from token center to mouse click
                    this.dragOffsetY = dy;
                    return;
                }
                }
            }
            this.isPanning = true;
            this.lastTouchX = touch.clientX;
            this.lastTouchY = touch.clientY;
        } else if (e.touches.length === 2) {
            this.isPanning = false;
            this.initialPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    }

    onTouchEnd(e) {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
        }

        const currentTime = new Date().getTime();
        const tapLength = currentTime - this.lastTap;

        if (this.isDraggingBackground) {
            const layer = this.boardState.findLayer(this.backgroundEditLayerId);
            if (layer && layer.background) {
                this.onBackgroundMoveRequested(this.backgroundEditLayerId, layer.background.x, layer.background.y);
            }
            this.isDraggingBackground = false;
        } else if (this.draggedToken) {
            const touch = e.changedTouches[0];
            const moveDist = Math.sqrt(Math.pow(touch.clientX - this.mouseDownPos.x, 2) + Math.pow(touch.clientY - this.mouseDownPos.y, 2));

            if (moveDist < 10) { // It's a tap
                this.draggedToken.x = this.draggedTokenOriginalPos.x;
                this.draggedToken.y = this.draggedTokenOriginalPos.y;

                if (tapLength < 300 && tapLength > 0) { // Double tap
                    e.preventDefault();
                    this.onPingRequested(this.getMousePos(touch));
                    this.lastTap = 0;
                } else { // Single tap
                    if (this.selectedTokenId === this.draggedToken.id) {
                        this.selectedTokenId = null;
                        this.selectedTokenLayerId = null;
                    } else {
                        this.selectedTokenId = this.draggedToken.id;
                        this.selectedTokenLayerId = this.draggedTokenLayerId;
                    }
                    this.onTokenSelected(this.selectedTokenLayerId, this.selectedTokenId);
                    this.lastTap = currentTime;
                }
            } else { // It's a drag
                this.onTokenMoveRequested(this.draggedTokenLayerId, this.draggedToken.id, this.draggedToken.x, this.draggedToken.y);
            }
        }

        this.draggedToken = null;
        this.draggedTokenLayerId = null;
        this.draggedTokenOriginalPos = null;
        this.isPanning = false;
        this.initialPinchDistance = 0;
    }

    onTouchMove(e) {
        e.preventDefault();
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
        }
        if (this.isDraggingBackground && e.touches.length === 1) {
            const layer = this.boardState.findLayer(this.backgroundEditLayerId);
            if (layer && layer.background) {
                const pos = this.getMousePos(e.touches[0]);
                layer.background.x = pos.x - (layer.background.width * layer.background.scale / 2);
                layer.background.y = pos.y - (layer.background.height * layer.background.scale / 2);
            }
        } else if (this.draggedToken && e.touches.length === 1) {
            const pos = this.getMousePos(e.touches[0]);
            this.draggedToken.x = pos.x - this.dragOffsetX;
            this.draggedToken.y = pos.y - this.dragOffsetY;
        } else if (e.touches.length === 1 && this.isPanning) {
            const dx = e.touches[0].clientX - this.lastTouchX;
            const dy = e.touches[0].clientY - this.lastTouchY;
            this.panX += dx;
            this.panY += dy;
            this.lastTouchX = e.touches[0].clientX;
            this.lastTouchY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            const currentPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const scaleAmount = currentPinchDistance / this.initialPinchDistance;
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - this.panX;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - this.panY;

            this.scale *= scaleAmount;
            this.panX -= (centerX * (scaleAmount - 1));
            this.panY -= (centerY * (scaleAmount - 1));

            this.initialPinchDistance = currentPinchDistance;
        }
    }
}

export { Board, BoardState, EventHandler };