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
    constructor(boardState) {
        this.boardState = boardState;
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
        }
    }
}

class Board {
    constructor(canvas, boardState, config = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.boardState = boardState;
        this.onTokenMoveRequested = config.onTokenMoveRequested || (() => {});
        this.onPingRequested = config.onPingRequested || (() => {});
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.draggedToken = null;
        this.draggedTokenLayerId = null;
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

        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));

        this.startAnimationLoop();
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
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.translate(this.panX, this.panY);
        this.ctx.scale(this.scale, this.scale);

        this.drawGrid();
        this.drawTokens();
        this.drawPings();

        this.ctx.restore();
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
            if (layer.visible) {
                layer.tokens.forEach(token => {
                    this.ctx.beginPath();
                    this.ctx.arc(token.x, token.y, 20, 0, 2 * Math.PI);
                    this.ctx.fillStyle = token.color;
                    this.ctx.fill();
                    this.ctx.stroke();
                });
            }
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
        const pos = this.getMousePos(e);

        for (const layer of [...this.boardState.layers].reverse()) {
            if (!layer.visible) continue;
            for (const token of [...layer.tokens].reverse()) {
                const dx = pos.x - token.x;
                const dy = pos.y - token.y;
                if (Math.sqrt(dx * dx + dy * dy) < 20) {
                    this.draggedToken = token;
                    this.draggedTokenLayerId = layer.id;
                    return;
                }
            }
        }

        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
    }

    onMouseUp(e) {
        if (this.draggedToken) {
            const pos = this.getMousePos(e);
            this.onTokenMoveRequested(this.draggedTokenLayerId, this.draggedToken.id, pos.x, pos.y);
            this.draggedToken = null;
            this.draggedTokenLayerId = null;
        }
        this.isPanning = false;
    }

    onDoubleClick(e) {
        const pos = this.getMousePos(e);
        this.onPingRequested(pos);
    }

    onMouseMove(e) {
        if (this.draggedToken) {
            const pos = this.getMousePos(e);
            this.draggedToken.x = pos.x;
            this.draggedToken.y = pos.y;
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
            const pos = this.getMousePos(e.touches[0]);
            for (const layer of [...this.boardState.layers].reverse()) {
                if (!layer.visible) continue;
                for (const token of [...layer.tokens].reverse()) {
                    const dx = pos.x - token.x;
                    const dy = pos.y - token.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 20) {
                        this.draggedToken = token;
                        this.draggedTokenLayerId = layer.id;
                        return;
                    }
                }
            }
            this.isPanning = true;
            this.lastTouchX = e.touches[0].clientX;
            this.lastTouchY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            this.isPanning = false;
            this.initialPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    }

    onTouchEnd(e) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - this.lastTap;
        if (tapLength < 300 && tapLength > 0) {
            e.preventDefault();
            this.onPingRequested(this.getMousePos(e.changedTouches[0]));
            this.draggedToken = null; // Cancel drag on double tap
        } else if (this.draggedToken) {
            this.onTokenMoveRequested(this.draggedTokenLayerId, this.draggedToken.id, this.draggedToken.x, this.draggedToken.y);
            this.draggedToken = null;
            this.draggedTokenLayerId = null;
        }
        this.lastTap = currentTime;
        this.isPanning = false;
        this.initialPinchDistance = 0;
    }

    onTouchMove(e) {
        e.preventDefault();
        if (this.draggedToken && e.touches.length === 1) {
            const pos = this.getMousePos(e.touches[0]);
            this.draggedToken.x = pos.x;
            this.draggedToken.y = pos.y;
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
