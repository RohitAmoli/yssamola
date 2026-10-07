const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 10000);
const MEETING_CODE = String(process.env.MEETING_CODE || "")
  .trim()
  .toUpperCase();

const MAX_MEMBERS = Math.max(
  2,
  Number(process.env.MAX_MEMBERS || 30)
);

const rooms = new Map();

function splitUrls(value) {
  return String(value || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function getIceServers() {
  const servers = [
    {
      urls: "stun:stun.l.google.com:19302"
    },
    {
      urls: "stun:stun1.l.google.com:19302"
    }
  ];

  const turnUrls = splitUrls(process.env.TURN_URLS);
  const username = String(process.env.TURN_USERNAME || "").trim();
  const credential = String(process.env.TURN_CREDENTIAL || "").trim();

  if (turnUrls.length && username && credential) {
    servers.push({
      urls: turnUrls,
      username,
      credential
    });
  }

  return servers;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end("YSSAMOLA signaling server is running.");
});

const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024
});

function send(ws, data) {
  if (!ws || ws.readyState !== 1) return;

  try {
    ws.send(JSON.stringify(data));
  } catch {}
}

function getRoom(client) {
  if (!client.roomCode) return null;
  return rooms.get(client.roomCode) || null;
}

function leaveClient(client) {
  const roomCode = client.roomCode;
  if (!roomCode) return;

  const room = rooms.get(roomCode);

  if (!room) {
    client.roomCode = null;
    return;
  }

  room.members.delete(client.id);

  console.log(
    `[LEAVE] ${client.id} "${client.name}" room=${roomCode} members=${room.members.size}`
  );

  for (const member of room.members.values()) {
    send(member.ws, {
      type: "peer-left",
      id: client.id
    });
  }

  client.roomCode = null;

  if (room.members.size === 0) {
    rooms.delete(roomCode);

    console.log(`[ROOM CLOSED] ${roomCode}`);
  }
}

wss.on("connection", ws => {

  const client = {
    id: crypto.randomUUID(),
    name: "Member",
    roomCode: null,
    ws
  };

  ws._yssamolaAlive = true;

  console.log(`[CONNECT] ${client.id}`);

  ws.on("pong", () => {
    ws._yssamolaAlive = true;
  });

  ws.on("message", raw => {

    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!message || typeof message.type !== "string") {
      return;
    }

    /*
     * =========================================================
     * JOIN
     * =========================================================
     */

    if (message.type === "join") {

      const roomCode = String(message.room || "")
        .replace(/\s+/g, "")
        .trim()
        .toUpperCase();

      const name =
        String(message.name || "Member")
          .trim()
          .slice(0, 40) || "Member";

      if (!MEETING_CODE) {

        console.error(
          "[JOIN ERROR] MEETING_CODE environment variable is empty"
        );

        send(ws, {
          type: "join-rejected",
          reason: "Meeting server is not configured."
        });

        return;
      }

      if (roomCode !== MEETING_CODE) {

        console.log(
          `[JOIN REJECTED] ${client.id} invalid code`
        );

        send(ws, {
          type: "join-rejected",
          reason:
            "Invalid meeting code. Please use the official YSSAMOLA meeting code."
        });

        return;
      }

      leaveClient(client);

      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, {
          members: new Map(),
          chat: []
        });
      }

      const room = rooms.get(roomCode);

      if (room.members.size >= MAX_MEMBERS) {

        send(ws, {
          type: "join-rejected",
          reason:
            "This meeting is full. Please try again later."
        });

        return;
      }

      client.name = name;
      client.roomCode = roomCode;

      /*
       * Capture the existing participants BEFORE adding
       * the new participant.
       */
      const existingMembers =
        Array.from(room.members.values()).map(member => ({
          id: member.id,
          name: member.name
        }));

      /*
       * Add new participant.
       */
      room.members.set(client.id, client);

      console.log(
        `[JOIN] ${client.id} "${client.name}" room=${roomCode} members=${room.members.size}`
      );

      /*
       * IMPORTANT:
       * Welcome MUST be sent before peer-list.
       */
      send(ws, {
        type: "welcome",
        id: client.id,
        room: roomCode,
        memberCount: room.members.size,
        iceServers: getIceServers()
      });

      /*
       * Send existing participants in ONE message.
       *
       * This removes the old existing-peer timing race.
       */
      send(ws, {
        type: "peer-list",
        peers: existingMembers
      });

      /*
       * Restore chat history.
       */
      send(ws, {
        type: "chat-history",
        messages: room.chat
      });

      /*
       * Tell existing members about new member.
       */
      for (const member of room.members.values()) {

        if (member.id === client.id) continue;

        send(member.ws, {
          type: "peer-joined",
          id: client.id,
          name: client.name,
          memberCount: room.members.size
        });
      }

      return;
    }

    /*
     * =========================================================
     * LEAVE
     * =========================================================
     */

    if (message.type === "leave") {
      leaveClient(client);
      return;
    }

    const room = getRoom(client);

    if (!room) {
      return;
    }

    /*
     * =========================================================
     * WEBRTC SIGNALING
     * =========================================================
     */

    if (
      message.type === "offer" ||
      message.type === "answer" ||
      message.type === "candidate"
    ) {

      const targetId = String(message.to || "");

      if (!targetId) return;

      const target = room.members.get(targetId);

      if (!target) {
        console.log(
          `[SIGNAL DROP] target=${targetId} not found`
        );
        return;
      }

      const outgoing = {
        type: message.type,
        from: client.id,
        name: client.name
      };

      if (message.offer) {
        outgoing.offer = message.offer;
      }

      if (message.answer) {
        outgoing.answer = message.answer;
      }

      if (message.candidate) {
        outgoing.candidate = message.candidate;
      }

      if (message.restart === true) {
        outgoing.restart = true;
      }

      console.log(
        `[SIGNAL] ${message.type} ${client.id} -> ${targetId}`
      );

      send(target.ws, outgoing);

      return;
    }

    /*
     * =========================================================
     * CHAT
     * =========================================================
     */

    if (message.type === "chat") {

      const text = String(message.text || "")
        .trim()
        .slice(0, 500);

      if (!text) return;

      const chatMessage = {
        id: client.id,
        name: client.name,
        text,
        time: new Date().toISOString()
      };

      room.chat.push(chatMessage);

      if (room.chat.length > 500) {
        room.chat.shift();
      }

      for (const member of room.members.values()) {
        send(member.ws, {
          type: "chat",
          ...chatMessage
        });
      }

      return;
    }
  });

  ws.on("close", () => {
    console.log(`[CLOSE] ${client.id}`);
    leaveClient(client);
  });

  ws.on("error", error => {
    console.error(
      `[WS ERROR] ${client.id}`,
      error?.message || error
    );

    leaveClient(client);
  });
});


/*
 * ============================================================
 * HEARTBEAT
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

wss.on("close", () => {
  clearInterval(heartbeat);
});


server.listen(PORT, () => {
  console.log(
    `YSSAMOLA signaling server listening on port ${PORT}`
  );

  console.log(
    `Meeting code configured: ${MEETING_CODE ? "YES" : "NO"}`
  );

  console.log(
    `Maximum members: ${MAX_MEMBERS}`
  );
});
