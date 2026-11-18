// Browser client for the chat. Plain WebSocket API, no library.
const $ = (id) => document.getElementById(id);
let ws;
let joined = null; // { room, name } to re-join after a reconnect
let retry = 0;
let typingTimer;

function addLine(text, { sys = false, at } = {}) {
  const li = document.createElement('li');
  if (sys) li.className = 'sys';
  if (at) {
    const t = document.createElement('time');
    t.textContent = new Date(at).toLocaleTimeString();
    li.append(t);
  }
  li.append(text); // textContent only: chat text is never parsed as HTML (no XSS)
  $('log').append(li);
  $('log').scrollTop = $('log').scrollHeight;
}

function setOnline(on) {
  $('status').textContent = on ? 'connected' : 'reconnecting...';
  for (const el of $('send').elements) el.disabled = !on || !joined;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'; // wss = WebSocket over TLS
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    retry = 0;
    setOnline(true);
    if (joined) ws.send(JSON.stringify({ type: 'join', ...joined }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'joined':
        $('log').replaceChildren();
        addLine(`You joined #${msg.room}`, { sys: true });
        msg.history.forEach((m) => addLine(`${m.user}: ${m.text}`, { at: m.createdAt }));
        $('users').textContent = msg.users.join(', ');
        setOnline(true);
        break;
      case 'presence':
        $('users').textContent = msg.users.join(', ');
        break;
      case 'message':
        addLine(`${msg.user}: ${msg.text}`, { at: msg.createdAt });
        break;
      case 'typing':
        $('typing').textContent = `${msg.user} is typing...`;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => ($('typing').textContent = ''), 2000);
        break;
      case 'error':
        addLine(`Error: ${msg.message}`, { sys: true });
        break;
    }
  };

  // Reconnect with exponential backoff + jitter, so a restarted server is not hit by everyone at once.
  ws.onclose = () => {
    setOnline(false);
    const delay = Math.min(30_000, 500 * 2 ** retry++) * (0.5 + Math.random() / 2);
    setTimeout(connect, delay);
  };
}

$('join').addEventListener('submit', (e) => {
  e.preventDefault();
  joined = { room: $('room').value.trim(), name: $('name').value.trim() };
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'join', ...joined }));
});

$('send').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'message', text }));
  $('text').value = '';
});

let lastTyping = 0;
$('text').addEventListener('input', () => {
  if (Date.now() - lastTyping < 1500 || ws.readyState !== WebSocket.OPEN) return; // throttle typing events
  lastTyping = Date.now();
  ws.send(JSON.stringify({ type: 'typing' }));
});

connect();
