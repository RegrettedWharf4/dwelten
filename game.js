import { Player } from './player.js';

const players = {};
let myId = null;

export function setMyId(id) {
  myId = id;
}

export function getMyId() {
  return myId;
}

export function addPlayer(id, x, y, skin) {
  players[id] = new Player(x, y, skin);
}

export function removePlayer(id) {
  delete players[id];
}

export function movePlayer(id, x, y) {
  if (players[id]) {
    players[id].x = x;
    players[id].y = y;
  }
}

export function getPlayers() {
  return players;
}

export function getCamera() {
  if (!myId || !players[myId]) return { x: 0, y: 0 };
  return {
    x: players[myId].x,
    y: players[myId].y
  };
} 