const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#333';
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.fillStyle = '#fff';
ctx.font = '32px sans-serif';
ctx.textAlign = 'center';
ctx.fillText('Bot will go here', canvas.width / 2, canvas.height / 2); 