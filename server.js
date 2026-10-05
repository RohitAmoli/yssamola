const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 10000;
const FIXED_MEETING_CODE = 'mission@2026';
const rooms = new Map();

function parseUrls(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function buildIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  const urls = parseUrls(process.env.TURN_URLS);
  const username = String(process.env.TURN_USERNAME || '').trim();
  const credential = String(process.env.TURN_CREDENTIAL || '').trim();
  if (urls.length && username && credential) {
    servers.push({ urls, username, credential });
  }
  return servers;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('YSSAMOLA meeting signaling server is running.');
});
const wss = new WebSocketServer({ server });

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function leaveClient(client) {
  if (!client.room || !rooms.has(client.room)) return;
  const room = rooms.get(client.room);
  room.members.delete(client.id);
  for (const member of room.members.values()) send(member.ws, { type: 'peer-left', id: client.id });
  if (room.members.size === 0) rooms.delete(client.room);
  client.room = null;
}

wss.on('connection', ws => {
  const client = { id: crypto.randomUUID(), name: 'Member', room: null, ws };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const roomCode = String(msg.room || '').trim().toUpperCase();
      const name = String(msg.name || 'Member').trim().slice(0, 40) || 'Member';
      if (roomCode !== FIXED_MEETING_CODE.toUpperCase()) {
        return send(ws, { type: 'join-rejected', reason: 'Invalid meeting code. Please use the official YSSAMOLA meeting code.' });
      }

      leaveClient(client);
      if (!rooms.has(roomCode)) rooms.set(roomCode, { members: new Map(), chat: [] });
      const room = rooms.get(roomCode);

      for (const [id, member] of room.members) send(ws, { type: 'existing-peer', id, name: member.name });
      client.room = roomCode;
      client.name = name;
      room.members.set(client.id, client);

      send(ws, { type: 'welcome', id: client.id, room: roomCode, iceServers: buildIceServers() });
      send(ws, { type: 'chat-history', messages: room.chat });
      for (const [id, member] of room.members) {
        if (id !== client.id) send(member.ws, { type: 'peer-joined', id: client.id, name: client.name });
      }
      return;
    }

    if (!client.room) return;

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'candidate') {
      const target = rooms.get(client.room)?.members.get(msg.to);
      if (!target) return;
      send(target.ws, {
        type: msg.type,
        from: client.id,
        name: client.name,
        ...(msg.offer ? { offer: msg.offer } : {}),
        ...(msg.answer ? { answer: msg.answer } : {}),
        ...(msg.candidate ? { candidate: msg.candidate } : {})
      });
      return;
    }

    if (msg.type === 'chat') {
      const room = rooms.get(client.room);
      if (!room) return;
      const text = String(msg.text || '').trim().slice(0, 500);
      if (!text) return;
      const message = { id: client.id, name: client.name, text, time: new Date().toISOString() };
      room.chat.push(message);
      if (room.chat.length > 500) room.chat.shift();
      for (const member of room.members.values()) send(member.ws, { type: 'chat', ...message });
    }
  });

  ws.on('close', () => leaveClient(client));
  ws.on('error', () => leaveClient(client));
});

server.listen(PORT, () => console.log(`YSSAMOLA signaling server listening on port ${PORT}`));
