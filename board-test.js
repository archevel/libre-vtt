const canvas = document.getElementById('board-canvas');
const boardState = new BoardState();
const eventHandler = new EventHandler(boardState);

const board = new Board(canvas, boardState, {
    onTokenMoveRequested: (layerId, tokenId, x, y) => {
        eventHandler.handleEvent({
            type: 'token-moved',
            layerId,
            tokenId,
            x,
            y
        });
    },
    onPingRequested: (pos) => {
        eventHandler.handleEvent({
            type: 'ping',
            x: pos.x,
            y: pos.y,
            durationMillis: 3000
        });
    }
});

// Example Usage
const initialGameState = {
    vtt: {
        layers: [
            { id: 'layer1', name: 'Player Layer', visible: true, tokens: [{ id: 1, x: 100, y: 100, color: 'red' }] },
            { id: 'layer2', name: 'Hidden Layer', visible: false, tokens: [{ id: 2, x: 200, y: 200, color: 'blue' }] }
        ]
    }
};

eventHandler.handleEvent({ type: 'game-state-update', ...initialGameState });

// --- Test Controls --- //

document.getElementById('add-token-btn').addEventListener('click', () => {
    const layerId = document.getElementById('add-token-layer-id').value;
    const tokenId = document.getElementById('add-token-id').value;
    const color = document.getElementById('add-token-color').value;
    const x = parseInt(document.getElementById('add-token-x').value, 10);
    const y = parseInt(document.getElementById('add-token-y').value, 10);

    if (layerId && tokenId && color) {
        eventHandler.handleEvent({
            type: 'token-added',
            layerId: layerId,
            tokenData: { id: tokenId, x, y, color }
        });
    }
});

document.getElementById('move-token-btn').addEventListener('click', () => {
    const layerId = document.getElementById('move-token-layer-id').value;
    const tokenId = document.getElementById('move-token-id').value;
    const x = parseInt(document.getElementById('move-token-x').value, 10);
    const y = parseInt(document.getElementById('move-token-y').value, 10);

    if (layerId && tokenId) {
        eventHandler.handleEvent({
            type: 'token-moved',
            layerId: layerId,
            tokenId: tokenId,
            x, y
        });
    }
});

document.getElementById('delete-token-btn').addEventListener('click', () => {
    const layerId = document.getElementById('delete-token-layer-id').value;
    const tokenId = document.getElementById('delete-token-id').value;

    if (layerId && tokenId) {
        eventHandler.handleEvent({
            type: 'token-deleted',
            layerId: layerId,
            tokenId: tokenId
        });
    }
});