const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { DOMParser } = require('xmldom');

const app = express();
const PORT = 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

let nextId = 1;
const players = {};
const playerMice = {}; // Track mouse position for each player

// Available skin filenames
const skinFiles = ['watcher.svg', 'standard issue.svg'];

function getRandomSkin() {
  const randomSkin = skinFiles[Math.floor(Math.random() * skinFiles.length)];
  const content = fs.readFileSync(path.join(__dirname, 'skins', randomSkin), 'utf8');
  return { name: randomSkin, content };
}

function parseEyeCircles(svgContent) {
  const eyeCircles = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');
  const paths = doc.getElementsByTagName('path');
  
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const label = path.getAttribute('inkscape:label');
    const type = path.getAttribute('sodipodi:type');
    
    if (label === 'eye_circle' && type === 'arc') {
      const cx = parseFloat(path.getAttribute('sodipodi:cx'));
      const cy = parseFloat(path.getAttribute('sodipodi:cy'));
      const rx = parseFloat(path.getAttribute('sodipodi:rx'));
      const ry = parseFloat(path.getAttribute('sodipodi:ry'));
      
      // Check for rotation transform
      const transform = path.getAttribute('transform');
      let rotation = 0;
      if (transform && transform.includes('rotate(')) {
        const rotationMatch = transform.match(/rotate\(([\d.-]+)\)/);
        if (rotationMatch) {
          rotation = parseFloat(rotationMatch[1]) * Math.PI / 180; // Convert to radians
        }
      }
      
      eyeCircles.push({ cx, cy, rx, ry, rotation });
    }
  }
  
  return eyeCircles;
}

function calculateEyeAngles(playerId, mouseX, mouseY) {
  const player = players[playerId];
  if (!player) return [];
  
  const eyeCircles = parseEyeCircles(player.skin);
  const angles = [];
  
  eyeCircles.forEach((eyeCircle, index) => {
    // The eye circle coordinates are relative to the SVG's top-left corner
    // The player position is at the center of the image
    let eyeX = player.x + (eyeCircle.cx - 85); // 85 is roughly the center X of the SVG
    let eyeY = player.y + (eyeCircle.cy - 60); // 60 is roughly the center Y of the SVG
    
    // For rotated eye circles, we need to convert from rotated coordinates to original coordinates
    if (eyeCircle.rotation !== 0) {
      const cos = Math.cos(eyeCircle.rotation);
      const sin = Math.sin(eyeCircle.rotation);
      const originalX = eyeCircle.cx * cos - eyeCircle.cy * sin;
      const originalY = eyeCircle.cx * sin + eyeCircle.cy * cos;
      eyeX = player.x + (originalX - 85);
      eyeY = player.y + (originalY - 60);
    }
    
    // If player is facing left, flip the eye position horizontally
    if (player.facing == -1) eyeX = player.x - (eyeCircle.cx - 85);
    
    // Calculate angle from eye to mouse
    const dx = mouseX - eyeX;
    const dy = mouseY - eyeY;
    let angle = Math.atan2(dy, dx);
    
    // Add rotation for rotated eyes
    
    if (player.facing == -1) angle = Math.PI - angle;

    angle -= eyeCircle.rotation;

    angles.push(angle);
  });
  
  return angles;
}

function encodePlayer(id, x, y, facing, eyeAngles) {
  // id: 1 char, xSign: 1 char, x: 2 chars, ySign: 1 char, y: 2 chars, facing: 1 char, eyeAngles: 2 chars each
  const xSign = x < 0 ? '1' : '0';
  const ySign = y < 0 ? '1' : '0';
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  let encoded = String.fromCharCode(Number(id)) +
         xSign +
         String.fromCharCode((absX >> 8) & 0xff, absX & 0xff) +
         ySign +
         String.fromCharCode((absY >> 8) & 0xff, absY & 0xff) +
         (facing > 0 ? '1' : '0');
  
  // Encode eye angles (2 bytes each, -π to π mapped to 0-65535)
  eyeAngles.forEach(angle => {
    const normalized = ((angle + Math.PI) / (2 * Math.PI)) * 65535;
    const angleBytes = Math.round(normalized);
    encoded += String.fromCharCode((angleBytes >> 8) & 0xff, angleBytes & 0xff);
  });
  
  return encoded;
}

const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 500;

function getVisiblePlayers(forPlayer) {
  const visible = [];
  const minX = forPlayer.x - VIEWPORT_WIDTH * 1.2;
  const maxX = forPlayer.x + VIEWPORT_WIDTH * 1.2;
  const minY = forPlayer.y - VIEWPORT_HEIGHT * 1.2;
  const maxY = forPlayer.y + VIEWPORT_HEIGHT * 1.2;
  for (const id in players) {
    const p = players[id];
    if (
      p.x >= minX &&
      p.x <= maxX &&
      p.y >= minY &&
      p.y <= maxY
    ) {
      const mouse = playerMice[id] || { x: p.x, y: p.y };
      const eyeAngles = calculateEyeAngles(id, mouse.x, mouse.y);
      visible.push([id, p.x, p.y, p.skin, p.facing, eyeAngles]);
    }
  }
  return visible;
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const { name: skinName, content: skinContent } = getRandomSkin();
  players[id] = { x: 100, y: 100, skin: skinContent, _ws: ws, facing: 1 };
  playerMice[id] = { x: 100, y: 100 }; // Initialize mouse at player position
  ws.send(JSON.stringify({ type: 'init', id, skin: skinContent }));
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    if (data.type === 'move') {
      if (players[id]) {
        players[id].x += data.dx;
        players[id].y += data.dy;
        // Update facing direction based on horizontal movement only
        if (data.dx !== 0) {
          players[id].facing = data.dx > 0 ? 1 : -1;
        }
      }
    } else if (data.type === 'mouse') {
      // Update mouse position for this player
      playerMice[id] = { x: data.x, y: data.y };
    }
  });
  ws.on('close', () => {
    delete players[id];
    delete playerMice[id];
  });
});

setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState !== 1) return;
    let clientId = null;
    for (const id in players) {
      if (players[id]._ws === client) {
        clientId = id;
        break;
      }
    }
    if (!clientId) return;
    const player = players[clientId];
    if (!player) return;
    // Use the player object for culling
    const visible = getVisiblePlayers(player);
    let encoded = '';
    for (const arr of visible) {
      const [id, x, y, skin, facing, eyeAngles] = arr;
      encoded += encodePlayer(id, x, y, facing, eyeAngles);
    }
    client.send(encoded);
  });
}, 1000 / 60); 