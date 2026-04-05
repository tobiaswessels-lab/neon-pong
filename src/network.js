// =============================================================================
// Tron/Cyberpunk Pong — network.js
// PeerJS wrapper for WebRTC peer-to-peer multiplayer.
// Uses the global Peer constructor injected by the PeerJS CDN script in
// index.html. No Node imports — pure browser ES module.
//
// Role model:
//   Host  — creates a room, owns all game physics, sends full state each frame.
//   Guest — joins by room code, sends only local paddle Y each frame.
// =============================================================================

// Character set deliberately omits visually ambiguous characters O, 0, I, 1.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX  = 'neonpong-';
const MAX_RETRIES  = 3;

// ---------------------------------------------------------------------------
// Module-level state (single connection model — one game at a time)
// ---------------------------------------------------------------------------

let peer             = null;  // Our own Peer instance
let connection       = null;  // The single DataConnection we care about

// Callbacks registered by game.js
let onDataCallback         = null;
let onConnectedCallback    = null;
let onDisconnectedCallback = null;
let onErrorCallback        = null;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Generate a 4-character room code from the unambiguous character set.
 * @returns {string}
 */
export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Destroy the current Peer (if any) so we can create a fresh one without
 * leaving zombie connections behind.
 */
function destroyPeer() {
  if (connection) {
    try { connection.close(); } catch (_) {}
    connection = null;
  }
  if (peer) {
    try { peer.destroy(); } catch (_) {}
    peer = null;
  }
}

/**
 * Wire up the standard data / close / error handlers on a DataConnection.
 * Used by both host and guest after a connection is established.
 */
function attachConnectionHandlers(conn) {
  conn.on('data', (msg) => {
    if (onDataCallback) onDataCallback(msg);
  });

  conn.on('close', () => {
    connection = null;
    if (onDisconnectedCallback) onDisconnectedCallback();
  });

  conn.on('error', (err) => {
    connection = null;
    if (onErrorCallback) onErrorCallback(err.message || String(err));
  });
}

// ---------------------------------------------------------------------------
// Host — createRoom
// ---------------------------------------------------------------------------

/**
 * Create a room as host.
 *
 * Generates a room code and attempts to register a Peer with the matching
 * ID. If the ID is already taken (peer 'unavailable-id' error) it retries
 * with a new code, up to MAX_RETRIES times.
 *
 * @param {function(string):void}  onGuestJoined  Called with the guest's name
 *                                                when a guest connects and
 *                                                sends their 'join' message.
 * @param {function(string):void}  onError        Called with an error string.
 * @param {string}                [forcedCode]    Internal — used for retries.
 * @param {number}                [retryCount]    Internal — retry depth.
 */
export function createRoom(onGuestJoined, onError, forcedCode, retryCount = 0) {
  destroyPeer();

  const code   = forcedCode || generateRoomCode();
  const peerId = PEER_PREFIX + code;

  // Expose the code immediately so the lobby screen can display it while we
  // wait for the Peer server handshake.
  if (window.pongState) {
    window.pongState.roomCode = code;
  }

  peer = new Peer(peerId);

  peer.on('open', () => {
    // Successfully claimed the ID — now wait for a guest to connect.
  });

  peer.on('connection', (conn) => {
    connection = conn;

    conn.on('open', () => {
      // Guest sends a join message first with their name.
      // We wait for that before calling onGuestJoined.
    });

    conn.on('data', (msg) => {
      if (msg && msg.type === 'join') {
        // First message from guest: registration with name.
        attachConnectionHandlers(conn);
        // Re-register data handler so game.js receives subsequent messages.
        // attachConnectionHandlers sets up conn.on('data', ...) but the join
        // message already consumed; further messages (type:'input') go through.
        onGuestJoined(msg.name || 'GUEST');

        // Route all future data (paddle input) through onDataCallback.
        // The handler set inside attachConnectionHandlers will handle these.
      } else {
        // Already past join phase — normal data routing.
        if (onDataCallback) onDataCallback(msg);
      }
    });

    conn.on('close', () => {
      connection = null;
      if (onDisconnectedCallback) onDisconnectedCallback();
    });

    conn.on('error', (err) => {
      connection = null;
      if (onErrorCallback) onErrorCallback(err.message || String(err));
    });
  });

  peer.on('error', (err) => {
    const type = err.type || '';

    if (type === 'unavailable-id') {
      // Room code collision — retry with a fresh code.
      if (retryCount < MAX_RETRIES) {
        peer.destroy();
        peer = null;
        createRoom(onGuestJoined, onError, undefined, retryCount + 1);
      } else {
        if (onError) onError('Could not reserve a room code after ' + MAX_RETRIES + ' attempts.');
      }
      return;
    }

    if (onError) onError(err.message || type || 'PeerJS error');
  });
}

// ---------------------------------------------------------------------------
// Guest — joinRoom
// ---------------------------------------------------------------------------

/**
 * Join an existing room as a guest.
 *
 * @param {string}   roomCode    4-character code (case-insensitive).
 * @param {string}   playerName  Local player's display name.
 * @param {function} onConnected Called when the WebRTC data channel is open
 *                               and the join message has been sent.
 * @param {function(string):void} onError  Called with an error string.
 */
export function joinRoom(roomCode, playerName, onConnected, onError) {
  destroyPeer();

  // Guest uses a random ID — it is not discoverable by other peers.
  peer = new Peer();

  peer.on('open', (myId) => {
    const hostId = PEER_PREFIX + roomCode.toUpperCase();
    const conn   = peer.connect(hostId, { reliable: true });
    connection   = conn;

    conn.on('open', () => {
      // Introduce ourselves to the host.
      conn.send({ type: 'join', name: playerName });

      // Wire up ongoing data / disconnect handlers.
      attachConnectionHandlers(conn);

      if (onConnected) onConnected();
    });

    conn.on('error', (err) => {
      connection = null;
      if (onError) onError(err.message || String(err));
    });
  });

  peer.on('error', (err) => {
    const type = err.type || '';
    let msg = err.message || type || 'PeerJS error';

    if (type === 'peer-unavailable') {
      msg = 'Room "' + roomCode.toUpperCase() + '" not found. Check the code and try again.';
    }

    if (onError) onError(msg);
  });
}

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

/**
 * Host → Guest: full game state snapshot (called every frame during PLAYING).
 * @param {object} stateMsg
 */
export function sendToGuest(stateMsg) {
  if (connection && connection.open) {
    connection.send(stateMsg);
  }
}

/**
 * Guest → Host: local paddle position (called every frame during PLAYING).
 * @param {object} inputMsg  { type: 'input', y: number }
 */
export function sendToHost(inputMsg) {
  if (connection && connection.open) {
    connection.send(inputMsg);
  }
}

// ---------------------------------------------------------------------------
// Callback registration
// ---------------------------------------------------------------------------

/**
 * Register a callback for all incoming data messages.
 * @param {function(object):void} callback
 */
export function onData(callback) {
  onDataCallback = callback;
}

/**
 * Register a callback for connection close / peer leave.
 * @param {function():void} callback
 */
export function onDisconnect(callback) {
  onDisconnectedCallback = callback;
}

/**
 * Register a callback for connection errors.
 * @param {function(string):void} callback
 */
export function onNetworkError(callback) {
  onErrorCallback = callback;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Cleanly close the active connection and destroy our Peer.
 * Call on GAMEOVER → MENU navigation or on tab unload.
 */
export function disconnect() {
  destroyPeer();
}
