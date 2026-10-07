const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const MEETING_CODE = String(process.env.MEETING_CODE || '').trim().toUpperCase();
const MAX_MEMBERS = Math.max(2, Number(process.env.MAX_MEMBERS || 30));

const rooms = new Map();

function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function iceServers() {
  const list = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const urls = splitUrls(process.env.TURN_URLS);
  const username = String(process.env.TURN_USERNAME || '').trim();
  const credential = String(process.env.TURN_CREDENTIAL || '').trim();

  if (urls.length && username && credential) {
    list.push({
      urls,
      username,
      credential
    });
  }

  return list;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end('YSSAMOLA signaling server is running.');
});

const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024
});

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function roomFor(client) {
  return client.room ? rooms.get(client.room) : null;
}

function leaveClient(client) {
  const roomCode = client.room;
  const room = roomFor(client);

  if (!room) {
    client.room = null;
    return;
  }

  room.members.delete(client.id);

  for (const member of room.members.values()) {
    send(member.ws, {
      type: 'peer-left',
      id: client.id
    });
  }

  client.room = null;
  client.roomCode = null;

  if (room.members.size === 0) {
    rooms.delete(roomCode);
  }
}

wss.on('connection', ws => {

  const client = {
    id: crypto.randomUUID(),
    name: 'Member',
    room: null,
    roomCode: null,
    ws,
    alive: true
  };

  ws._yssamolaAlive = true;

  ws.on('pong', () => {
    client.alive = true;
    ws._yssamolaAlive = true;
  });

  ws.on('message', raw => {

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      return;
    }

    /*
     * ==========================================================
     * JOIN
     * ==========================================================
     */

    if (msg.type === 'join') {

      const code = String(msg.room || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();

      const name = String(msg.name || 'Member')
        .trim()
        .slice(0, 40) || 'Member';

      if (!MEETING_CODE || code !== MEETING_CODE) {

        send(ws, {
          type: 'join-rejected',
          reason:
            'Invalid meeting code. Please use the official YSSAMOLA meeting code.'
        });

        return;
      }

      /*
       * Remove this client from any previous room.
       */
      leaveClient(client);

      /*
       * Create room if required.
       */
      if (!rooms.has(code)) {
        rooms.set(code, {
          members: new Map(),
          chat: []
        });
      }

      const room = rooms.get(code);

      /*
       * Maximum members check.
       */
      if (room.members.size >= MAX_MEMBERS) {

        send(ws, {
          type: 'join-rejected',
          reason:
            'This meeting is full. Please try again later.'
        });

        return;
      }

      /*
       * ========================================================
       * IMPORTANT FIX
       *
       * Add the new client to the room BEFORE sending the
       * welcome message.
       *
       * The browser must receive "welcome" first so that its
       * JavaScript sets:
       *
       *     joined = true
       *
       * BEFORE it receives "existing-peer".
       *
       * Otherwise makePeer() does not create the initial offer.
       * ========================================================
       */

      client.room = code;
      client.roomCode = code;
      client.name = name;

      room.members.set(client.id, client);

      /*
       * 1. SEND WELCOME FIRST
       */
      send(ws, {
        type: 'welcome',
        id: client.id,
        room: code,
        memberCount: room.members.size,
        iceServers: iceServers()
      });

      /*
       * 2. SEND CHAT HISTORY
       */
      send(ws, {
        type: 'chat-history',
        messages: room.chat
      });

      /*
       * 3. NOW SEND EXISTING PEERS
       *
       * At this point the browser has already received welcome
       * and therefore has joined=true.
       */
      for (const [id, member] of room.members) {

        if (id === client.id) {
          continue;
        }

        send(ws, {
          type: 'existing-peer',
          id,
          name: member.name
        });
      }

      /*
       * 4. TELL EXISTING MEMBERS ABOUT THE NEW MEMBER
       */
      for (const [id, member] of room.members) {

        if (id === client.id) {
          continue;
        }

        send(member.ws, {
          type: 'peer-joined',
          id: client.id,
          name: client.name,
          memberCount: room.members.size
        });
      }

      return;
    }

    /*
     * ==========================================================
     * LEAVE
     * ==========================================================
     */

    if (msg.type === 'leave') {
      leaveClient(client);
      return;
    }

    const room = roomFor(client);

    if (!room) {
      return;
    }

    /*
     * ==========================================================
     * WEBRTC SIGNALING
     * ==========================================================
     */

    if (
      msg.type === 'offer' ||
      msg.type === 'answer' ||
      msg.type === 'candidate'
    ) {

      const targetId = String(msg.to || '');

      const target = room.members.get(targetId);

      if (!target) {
        return;
      }

      const payload = {
        type: msg.type,
        from: client.id,
        name: client.name
      };

      if (msg.offer) {
        payload.offer = msg.offer;
      }

      if (msg.answer) {
        payload.answer = msg.answer;
      }

      if (msg.candidate) {
        payload.candidate = msg.candidate;
      }

      if (msg.restart === true) {
        payload.restart = true;
      }

      send(target.ws, payload);

      return;
    }

    /*
     * ==========================================================
     * CHAT
     * ==========================================================
     */

    if (msg.type === 'chat') {

      const text = String(msg.text || '')
        .trim()
        .slice(0, 500);

      if (!text) {
        return;
      }

      const message = {
        id: client.id,
        name: client.name,
        text,
        time: new Date().toISOString()
      };

      room.chat.push(message);

      if (room.chat.length > 500) {
        room.chat.shift();
      }

      for (const member of room.members.values()) {

        send(member.ws, {
          type: 'chat',
          ...message
        });

      }

      return;
    }

  });

  /*
   * ==========================================================
   * CONNECTION CLOSED
   * ==========================================================
   */

  ws.on('close', () => {
    leaveClient(client);
  });

  ws.on('error', () => {
    leaveClient(client);
  });

});


/*
 * ============================================================
 * WEBSOCKET HEARTBEAT
 * ============================================================
 */

const heartbeat = setInterval(() => {

  for (const ws of wss.clients) {

    if (ws.readyState !== 1) {
      continue;
    }

    if (ws._yssamolaAlive === false) {

      try {
        ws.terminate();
      } catch {}

      continue;
    }

    ws._yssamolaAlive = false;

    try {
      ws.ping();
    } catch {}

  }

}, 20000);

wss.on('close', () => {
  clearInterval(heartbeat);
});


/*
 * ============================================================
 * START SERVER
 * ============================================================
 */

server.listen(PORT, () => {
  console.log(
    `YSSAMOLA signaling server listening on port ${PORT}`
  );
});
