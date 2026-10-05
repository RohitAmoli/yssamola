// YSSAMOLA Member Meeting - WebRTC signaling server
// Node.js 18+ recommended.
// Install: npm install ws
// Run: node server.js
//
// Production: put this behind HTTPS/WSS (for example Nginx) and route
// /meeting-ws to this server on port 8080.

const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const rooms = new Map(); // room -> Map(clientId -> { ws, name })

const server = http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type":"text/plain; charset=utf-8"});
  res.end("YSSAMOLA meeting signaling server is running.");
});

const wss = new WebSocketServer({ server });

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function leaveClient(client) {
  if (!client.room || !rooms.has(client.room)) return;

  const room = rooms.get(client.room);
  room.delete(client.id);

  for (const [id, member] of room) {
    send(member.ws, { type:"peer-left", id:client.id });
  }

  if (room.size === 0) rooms.delete(client.room);
  client.room = null;
}

wss.on("connection", (ws) => {
  const client = {
    id: crypto.randomUUID(),
    name: "Member",
    room: null,
    ws
  };

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    if (msg.type === "join") {
      const roomCode = String(msg.room || "").trim().toUpperCase();
      const name = String(msg.name || "Member").trim().slice(0, 40);

      if (!roomCode) return;

      leaveClient(client);

      if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
      const room = rooms.get(roomCode);

      // Tell the newcomer about everyone already in the room.
      for (const [id, member] of room) {
        send(ws, { type:"existing-peer", id, name:member.name });
      }

      client.room = roomCode;
      client.name = name;
      room.set(client.id, client);

      send(ws, { type:"welcome", id:client.id, room:roomCode });

      // Tell existing members that the newcomer is here.
      for (const [id, member] of room) {
        if (id !== client.id) {
          send(member.ws, { type:"peer-joined", id:client.id, name:client.name });
        }
      }
      return;
    }

    if (!client.room) return;

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "candidate") {
      const target = rooms.get(client.room)?.get(msg.to);
      if (!target) return;

      send(target.ws, {
        type:msg.type,
        from:client.id,
        name:client.name,
        ...(msg.offer ? {offer:msg.offer} : {}),
        ...(msg.answer ? {answer:msg.answer} : {}),
        ...(msg.candidate ? {candidate:msg.candidate} : {})
      });
      return;
    }

    if (msg.type === "chat") {
      const room = rooms.get(client.room);
      const text = String(msg.text || "").trim().slice(0, 500);
      if (!text) return;

      for (const member of room.values()) {
        send(member.ws, {type:"chat", name:client.name, text});
      }
    }
  });

  ws.on("close", () => leaveClient(client));
  ws.on("error", () => leaveClient(client));
});

server.listen(PORT, () => {
  console.log(`YSSAMOLA signaling server listening on port ${PORT}`);
});
