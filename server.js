const express = require("express");
const http = require("http");
const path = require("path");
const { attachGameWebSocketServer } = require("./game-ws-server");

const app = express();
const PORT = process.env.PORT || 3001;

// JSON body parsing for API
app.use(express.json());

// Static files — serves /public/... directly. The 30 game lives at
// public/30/index.html and is reachable at /30 (no auth, as requested).
app.use(express.static(path.join(__dirname, "public")));

// Root route — the main arcade landing page. 30 is intentionally NOT
// linked from here yet (deep-link only via /30 for now).
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Create a plain http.Server so we can share the port between Express
// and the WebSocket upgrade handler.
const server = http.createServer(app);

// Attach the WebSocket game-room server. This is the CENTRAL hub used by
// both this site and by wbcgamez — wbcgamez's client connects back here
// at wss://<ladybug-gamez-host>/ws.
attachGameWebSocketServer(server, { path: "/ws" });

server.listen(PORT, () => {
  console.log(`Ladybug Gamez running on port ${PORT} (HTTP + /ws WebSocket)`);
});
