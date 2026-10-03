YSSAMOLA CROSS-NETWORK MEETING - CLEAN TURN VERSION

Website file:
  member-meeting.html

Render files (inside meeting-server):
  server.js
  package.json

IMPORTANT:
Do NOT replace your main website root package.json or root server.js.

Render Root Directory:
  meeting-server

Render Start Command:
  npm start

Required Render Environment Variables:
  TURN_URLS=turn:YOUR_TURN_HOST:3478,turns:YOUR_TURN_HOST:5349
  TURN_USERNAME=YOUR_TURN_USERNAME
  TURN_CREDENTIAL=YOUR_TURN_CREDENTIAL

The TURN service/provider must supply the host, username and credential. Do not put the TURN credential in the HTML.

The backend sends the TURN ICE configuration to the browser only after a successful join.
The page also queues ICE candidates until remote SDP is set, which avoids candidate timing/race failures.

Meeting code:
  mission@2026

After changing Render environment variables, redeploy/restart the meeting-server service.
Then hard-refresh the website before testing.
