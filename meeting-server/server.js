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

// Single fixed meeting code. The backend is the source of truth;
// clients cannot create arbitrary room codes.
const FIXED_MEETING_CODE = "mission@2026";

// Optional TURN relay configuration. Prefer Metered credential API on Render
// so TURN credentials do not have to be placed in the website HTML.
const METERED_DOMAIN = String(process.env.METERED_DOMAIN || "").trim();
const METERED_API_KEY = String(process.env.METERED_API_KEY || "").trim();
const METERED_REGION = String(process.env.METERED_REGION || "").trim();

// Static TURN fallback for any TURN provider.
const TURN_URLS = String(process.env.TURN_URLS || "").split(",").map(s => s.trim()).filter(Boolean);
const TURN_USERNAME = String(process.env.TURN_USERNAME || "");
const TURN_CREDENTIAL = String(process.env.TURN_CREDENTIAL || "");

const BASE_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

let cachedMeteredIceServers = null;
let cachedMeteredAt = 0;

async function getIceServers() {
  // Refresh Metered credentials periodically. This also supports credentials
  // configured with an expiry time.
  if (METERED_DOMAIN && METERED_API_KEY) {
    const now = Date.now();
    if (cachedMeteredIceServers && now - cachedMeteredAt < 5 * 60 * 1000) {
      return cachedMeteredIceServers;
    }

    try {
      const region = METERED_REGION ? `&region=${encodeURIComponent(METERED_REGION)}` : "";
      const url = `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED_API_KEY)}${region}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Metered returned HTTP ${response.status}`);
      const servers = await response.json();
      if (Array.isArray(servers) && servers.length) {
        cachedMeteredIceServers = servers;
        cachedMeteredAt = now;
        return servers;
      }
    } catch (err) {
      console.error("TURN credential fetch failed:", err.message);
    }
  }

  const servers = [...BASE_ICE_SERVERS];
  if (TURN_URLS.length && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }
  return servers;
}

const rooms = new Map(); // room -> { members: Map(clientId -> { ws, name }), chat: [] }

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
  room.members.delete(client.id);

  for (const [id, member] of room.members) {
    send(member.ws, { type:"peer-left", id:client.id });
  }

  // Keep chat history while at least one member remains. When the last
  // member disconnects, the whole room (including its chat) is removed.
  if (room.members.size === 0) rooms.delete(client.room);
  client.room = null;
}

wss.on("connection", (ws) => {
  const client = {
    id: crypto.randomUUID(),
    name: "Member",
    room: null,
    ws
  };

  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    if (msg.type === "join") {
      const roomCode = String(msg.room || "").trim().toUpperCase();
      const name = String(msg.name || "Member").trim().slice(0, 40);

      if (!roomCode) return;

      // Only the configured meeting code is accepted.
      // Comparison is case-insensitive so users may type MISSION@2026.
      if (roomCode !== FIXED_MEETING_CODE.toUpperCase()) {
        send(ws, {
          type: "join-rejected",
          reason: "Invalid meeting code. Please use the official YSSAMOLA meeting code."
        });
        return;
      }

      leaveClient(client);

      if (!rooms.has(roomCode)) rooms.set(roomCode, { members:new Map(), chat:[] });
      const room = rooms.get(roomCode);

      // Tell the newcomer about everyone already in the room.
      for (const [id, member] of room.members) {
        send(ws, { type:"existing-peer", id, name:member.name });
      }

      client.room = roomCode;
      client.name = name;
      room.members.set(client.id, client);

      const iceServers = await getIceServers();
      send(ws, { type:"welcome", id:client.id, room:roomCode, iceServers });
      send(ws, { type:"chat-history", messages:room.chat });

      // Tell existing members that the newcomer is here.
      for (const [id, member] of room.members) {
        if (id !== client.id) {
          send(member.ws, { type:"peer-joined", id:client.id, name:client.name });
        }
      }
      return;
    }

    if (!client.room) return;

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "candidate") {
      const target = rooms.get(client.room)?.members.get(msg.to);
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

      const message = {
        id:client.id,
        name:client.name,
        text,
        time:new Date().toISOString()
      };
      room.chat.push(message);
      if (room.chat.length > 500) room.chat.shift();

      for (const member of room.members.values()) {
        send(member.ws, {type:"chat", ...message});
      }
    }
  });

  ws.on("close", () => leaveClient(client));
  ws.on("error", () => leaveClient(client));
});

server.listen(PORT, () => {
  console.log(`YSSAMOLA signaling server listening on port ${PORT}`);
});
