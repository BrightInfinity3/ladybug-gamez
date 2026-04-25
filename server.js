const express = require("express");
const http = require("http");
const path = require("path");
const { attachGameWebSocketServer } = require("./game-ws-server");

const app = express();
const PORT = process.env.PORT || 3001;

// Crash hardening. See wbcgamez/server.js for the rationale —
// Railway notifies on every non-zero exit, so we install
// process-level error handlers and a SIGTERM handler that closes
// the HTTP+WS server cleanly during deploys.
process.on("uncaughtException", (err) => {
  console.error("[ladybug-gamez] uncaughtException:", err && err.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[ladybug-gamez] unhandledRejection:", reason);
});

// JSON body parsing for API
app.use(express.json());

// Lightweight health endpoint for Railway's healthcheck.
app.get("/health", (req, res) => {
  res.status(200).type("text/plain").send("ok");
});

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

// Graceful shutdown — close HTTP+WS cleanly on SIGTERM during
// Railway deploys so the rotation isn't reported as a crash.
function gracefulShutdown(signal) {
  console.log(`[ladybug-gamez] received ${signal}, shutting down`);
  server.close(() => {
    console.log("[ladybug-gamez] HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    console.warn("[ladybug-gamez] force exit after 5s grace period");
    process.exit(0);
  }, 5000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
