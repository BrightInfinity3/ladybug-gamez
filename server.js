const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
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

// ---- Solitairra Leaderboard API ----
// Mirrors the SoloTerra leaderboard on wbcgamez/server.js. Distinct
// data file so this leaderboard is independent of SoloTerra's. Uses
// RAILWAY_VOLUME_MOUNT_PATH if a persistent volume is attached, else
// falls back to ./data (ephemeral on Railway without a volume).
const SOLITAIRRA_DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "solitairra")
  : path.join(__dirname, "data");
const SOLITAIRRA_LEADERBOARD_FILE = path.join(SOLITAIRRA_DATA_DIR, "solitairra-leaderboard.json");
const SOLITAIRRA_LEADERBOARD_MAX = 60;

function ensureSolitairraDataDir() {
  if (!fs.existsSync(SOLITAIRRA_DATA_DIR)) {
    fs.mkdirSync(SOLITAIRRA_DATA_DIR, { recursive: true });
  }
}

function readSolitairraLeaderboard() {
  try {
    if (!fs.existsSync(SOLITAIRRA_LEADERBOARD_FILE)) return [];
    const raw = fs.readFileSync(SOLITAIRRA_LEADERBOARD_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to read solitairra leaderboard:", e.message);
    return [];
  }
}

function writeSolitairraLeaderboard(board) {
  try {
    ensureSolitairraDataDir();
    fs.writeFileSync(SOLITAIRRA_LEADERBOARD_FILE, JSON.stringify(board, null, 2), "utf8");
    return true;
  } catch (e) {
    console.warn("Failed to write solitairra leaderboard:", e.message);
    return false;
  }
}

function sortSolitairraLeaderboard(board) {
  // Score desc → moves asc → most recent first
  board.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.moves !== b.moves) return a.moves - b.moves;
    return b.timestamp - a.timestamp;
  });
  return board;
}

app.get("/api/solitairra/leaderboard", (req, res) => {
  const board = readSolitairraLeaderboard();
  res.json(sortSolitairraLeaderboard(board).slice(0, SOLITAIRRA_LEADERBOARD_MAX));
});

app.post("/api/solitairra/leaderboard", (req, res) => {
  const { name, score, moves } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (typeof score !== "number" || score < 0 || score > 60) {
    return res.status(400).json({ error: "Invalid score" });
  }
  if (typeof moves !== "number" || moves < 1 || moves > 9999) {
    return res.status(400).json({ error: "Invalid moves" });
  }
  const board = readSolitairraLeaderboard();
  board.push({
    name: name.trim().substring(0, 20),
    score: score,
    moves: moves,
    timestamp: Date.now()
  });
  const sorted = sortSolitairraLeaderboard(board);
  const trimmed = sorted.slice(0, SOLITAIRRA_LEADERBOARD_MAX * 2);
  const ok = writeSolitairraLeaderboard(trimmed);
  if (!ok) {
    return res.status(503).json({ error: "Leaderboard storage unavailable" });
  }
  res.json({ success: true, leaderboard: sorted.slice(0, SOLITAIRRA_LEADERBOARD_MAX) });
});

app.delete("/api/solitairra/leaderboard", (req, res) => {
  const ok = writeSolitairraLeaderboard([]);
  if (!ok) {
    return res.status(503).json({ error: "Leaderboard storage unavailable" });
  }
  res.json({ success: true, message: "Leaderboard wiped" });
});

ensureSolitairraDataDir();
console.log(`Solitairra leaderboard data: ${SOLITAIRRA_LEADERBOARD_FILE}`);

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
