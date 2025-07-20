import { Player } from './player.js';
// No canvg import, use window.canvg.default

const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 500;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const players = {};
let myId = null;
let mySkin = null;
let lastUpdateTime = 0;
const interpolationDelay = 100; // ms

const socket = new WebSocket(
  window.location.protocol === 'https:' 
    ? `wss://${window.location.host}` 
    : `ws://${window.location.host}`
);

socket.addEventListener('message', (event) => {
  // If the message is JSON, it's an init packet
  if (event.data[0] === '{') {
    const data = JSON.parse(event.data);
    if (data.type === 'init') {
      myId = data.id;
      mySkin = data.skin;
      console.log('Received init packet, myId:', myId);
    }
    return;
  }
  // Otherwise, it's a compact state packet
  const currentTime = Date.now();
  for (const id in players) {
    // Store previous position for interpolation
    if (players[id]) {
      players[id].prevX = players[id].x;
      players[id].prevY = players[id].y;
      players[id].prevTime = players[id].updateTime || currentTime;
    }
  }
  for (const id in players) delete players[id];
  const str = event.data;
  let i = 0;
  while (i < str.length) {
    const id = str.charCodeAt(i).toString();
    const xSign = str[i+1] === '1' ? -1 : 1;
    const x = xSign * ((str.charCodeAt(i+2) << 8) | str.charCodeAt(i+3));
    const ySign = str[i+4] === '1' ? -1 : 1;
    const y = ySign * ((str.charCodeAt(i+5) << 8) | str.charCodeAt(i+6));
    const facing = str[i+7] === '1' ? 1 : -1;
    
    players[id] = new Player(x, y, mySkin);
    players[id].facing = facing;
    players[id].updateTime = currentTime;
    
    // Parse the SVG to determine how many eye circles there are
    const eyeCircles = parseEyeCircles(mySkin);
    const numEyes = eyeCircles.length;
    console.log('Player', id, 'numEyes:', numEyes);
    
    // Decode eye angles (2 bytes each)
    const eyeAngles = [];
    let angleIndex = i + 8;
    for (let j = 0; j < numEyes; j++) {
      if (angleIndex + 1 < str.length) {
        const angleBytes = (str.charCodeAt(angleIndex) << 8) | str.charCodeAt(angleIndex + 1);
        const normalized = angleBytes / 65535;
        const angle = (normalized * 2 * Math.PI) - Math.PI;
        eyeAngles.push(angle);
        console.log('Decoded eye', j, 'angle:', angle);
        angleIndex += 2;
      }
    }
    players[id].eyeAngles = eyeAngles;
    console.log('Player', id, 'eyeAngles:', eyeAngles);
    
    i = angleIndex; // Move to next player
  }
  lastUpdateTime = currentTime;
});

const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key] = true; });
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

const mouse = { x: 0, y: 0 };

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  
  // Send mouse position to server
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ 
      type: 'mouse', 
      x: mouse.x + (players[myId] ? players[myId].x - canvas.width / 2 : 0), 
      y: mouse.y + (players[myId] ? players[myId].y - canvas.height / 2 : 0) 
    }));
  }
});

function parseEyeCircles(svgContent) {
  const eyeCircles = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');
  const paths = doc.querySelectorAll('path');
  
  paths.forEach(path => {
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
  });
  
  return eyeCircles;
}

function renderEyeCircles(ctx, player, pos, cameraX, cameraY) {
  if (!player.eyeAngles || player.eyeAngles.length === 0 || !player.skin) {
    console.log('Skipping eye rendering - missing data:', {
      hasAngles: !!player.eyeAngles,
      anglesLength: player.eyeAngles?.length,
      hasSkin: !!player.skin
    });
    return;
  }
  
  const eyeCircles = parseEyeCircles(player.skin);
  
  if (eyeCircles.length === 0) {
    return;
  }
  
  ctx.save();
  ctx.translate(pos.x - cameraX, pos.y - cameraY);
  

  if (player.facing < 0) {
    ctx.scale(-1, 1);
  }
  
  eyeCircles.forEach((eyeCircle, index) => {
    if (player.eyeAngles[index] !== undefined) {
      const angle = player.eyeAngles[index];
      console.log('Rendering eye', index, 'angle:', angle, 'circle:', eyeCircle);
      
      // Convert SVG coordinates to canvas coordinates
      // The image is drawn at -img.width/2, -img.height/2, so we need to offset
      const img = loadImage(player.skin);
      const offsetX = img.width / 2;
      const offsetY = img.height / 2;
      
      // For rotated eye circles, we need to convert from rotated coordinates to original coordinates
      let adjustedCx = eyeCircle.cx;
      let adjustedCy = eyeCircle.cy;
      
      if (eyeCircle.rotation !== 0) {
        // Apply rotation to get the position in the original coordinate system
        const cos = Math.cos(eyeCircle.rotation);
        const sin = Math.sin(eyeCircle.rotation);
        const originalX = adjustedCx * cos - adjustedCy * sin;
        const originalY = adjustedCx * sin + adjustedCy * cos;
        adjustedCx = originalX;
        adjustedCy = originalY;
      }
      
      // Adjust eye coordinates to be relative to the image center
      adjustedCx = adjustedCx - offsetX;
      adjustedCy = adjustedCy - offsetY;
      
      // Calculate pupil position on the eye circle - preserve original coordinates and sizes
      const pupilX = adjustedCx + Math.cos(angle) * (eyeCircle.rx * 0.8);
      const pupilY = adjustedCy + Math.sin(angle) * (eyeCircle.ry * 0.8);
      
      console.log('Pupil position:', { pupilX, pupilY, adjustedCx, adjustedCy, eyeCircle });
      
      // Draw pupil with rotation
      ctx.save();
      ctx.translate(adjustedCx, adjustedCy);
      ctx.rotate(eyeCircle.rotation);
      ctx.translate(-adjustedCx, -adjustedCy);
      
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(pupilX, pupilY, eyeCircle.rx * 2, eyeCircle.ry * 2, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    }
  });
  
  ctx.restore();
}

function sendMove(dx, dy) {
  socket.send(JSON.stringify({ type: 'move', dx, dy }));
}

function resizeCanvas() {
  // 16:10 aspect ratio
  const aspect = 16 / 10;
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (w / h > aspect) {
    w = h * aspect;
  } else {
    h = w / aspect;
  }
  canvas.width = w;
  canvas.height = h;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const Images = {};

function loadImage(src) {
  // If src is SVG content (starts with <?xml), convert to data URL
  if (src.startsWith('<?xml') || src.startsWith('<svg')) {
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(src);
    if (!Images[dataUrl]) {
      Images[dataUrl] = new Image();
      Images[dataUrl].src = dataUrl;
      Images[dataUrl].onerror = () => {
        console.log('Failed to load SVG data URL');
      };
    }
    return Images[dataUrl];
  }
  
  // Otherwise, treat as file path
  if (!Images[src]) {
    Images[src] = new Image();
    Images[src].src = src;
    Images[src].onerror = () => {
      console.log('Failed to load image:', src);
    };
  }
  return Images[src];
}

function getInterpolatedPosition(player, currentTime) {
  if (!player.prevX || !player.prevY || !player.prevTime) {
    return { x: player.x, y: player.y };
  }
  
  const timeDiff = currentTime - player.prevTime;
  const alpha = Math.min(timeDiff / interpolationDelay, 1);
  
  return {
    x: player.prevX + (player.x - player.prevX) * alpha,
    y: player.prevY + (player.y - player.prevY) * alpha
  };
}

function renderPlayer(ctx, player, isLocal, cameraX, cameraY, currentTime) {
  const pos = getInterpolatedPosition(player, currentTime);
  const drawX = pos.x - cameraX;
  const drawY = pos.y - cameraY;
  
  const img = loadImage(player.skin);
  
  try {
    ctx.save();
    ctx.translate(drawX, drawY);
    // Flip horizontally if facing left
    if (player.facing < 0) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
    ctx.restore();
    
    // Render eye circles on top
    renderEyeCircles(ctx, player, pos, cameraX, cameraY);
  } catch (e) {
    console.log('Error drawing image:', e);
    ctx.fillStyle = isLocal ? 'red' : '#fff';
    ctx.fillRect(drawX - 32, drawY - 32, 64, 64);
  }
}

function gameLoop() {
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!myId || !players[myId]) {
    requestAnimationFrame(gameLoop);
    return;
  }
  const cameraX = players[myId].x - canvas.width / 2;
  const cameraY = players[myId].y - canvas.height / 2;
  const currentTime = Date.now();

  for (const id in players) {
    const player = players[id];
    const isLocal = id === String(myId);
    renderPlayer(ctx, player, isLocal, cameraX, cameraY, currentTime);
  }
  requestAnimationFrame(gameLoop);
}

gameLoop();

setInterval(() => {
  if (!myId || !players[myId]) return;
  let dx = 0, dy = 0;
  if (keys['ArrowUp'] || keys['w'] || keys['W']) dy -= 4;
  if (keys['ArrowDown'] || keys['s'] || keys['S']) dy += 4;
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= 4;
  if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 4;
  if (dx !== 0 || dy !== 0) {
    sendMove(dx, dy);
  }
}, 1000 / 60); 