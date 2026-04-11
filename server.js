const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// JSON body parsing for API
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Fallback to index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Ladybug Gamez running on port ${PORT}`);
});
