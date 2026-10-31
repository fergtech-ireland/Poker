// Turns a request ({ action, code, token, ... }) into a game change.
// Storage is passed in, so the same code runs in the Edge Function (Postgres)
// and in local tests (in memory).
//
// store.load(code)                              -> { version, room } | null
// store.save(code, expectedVersion, room, view) -> true if saved, false if someone else saved first
//   (expectedVersion 0 means "create")
import * as E from './engine.mjs';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, to avoid confusion with 1 and 0

export function secureRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(secureRandom() * CODE_CHARS.length)];
  return code;
}

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

function views(room, playerId, now, extra = {}) {
  return {
    ok: true,
    state: E.publicView(room, now),
    me: playerId && room.players.some(p => p.id === playerId) ? E.privateView(room, playerId) : null,
    ...extra,
  };
}

export async function handle(body, store, now = Date.now()) {
  const action = String(body.action || '');

  if (action === 'create') {
    E.cleanName(body.name);
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode();
      const room = E.newRoom(code, now);
      const token = crypto.randomUUID();
      const id = newId();
      E.addPlayer(room, { id, name: body.name, tokenHash: await sha256(token) });
      if (await store.save(code, 0, room, E.publicView(room, now))) {
        return views(room, id, now, { code, playerId: id, token });
      }
    }
    throw new E.GameError('Could not create a room, please try again.');
  }

  const code = String(body.code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) throw new E.GameError('Room codes are 4 letters.');
  const tokenHash = body.token ? await sha256(body.token) : null;

  // Retry if another player's move was saved between our load and save.
  for (let attempt = 0; attempt < 8; attempt++) {
    const loaded = await store.load(code);
    if (!loaded) throw new E.GameError(`Room ${code} not found.`);
    const { version, room } = loaded;
    const me = tokenHash ? room.players.find(p => p.tokenHash === tokenHash) : null;
    let extra = {};
    let changed = true;

    if (action === 'join') {
      if (me) return views(room, me.id, now, { code, playerId: me.id, token: body.token }); // rejoining
      const token = crypto.randomUUID();
      const id = newId();
      E.addPlayer(room, { id, name: body.name, tokenHash: await sha256(token) });
      extra = { code, playerId: id, token };
    } else {
      if (!me) throw new E.GameError('You are not at this table.');
      switch (action) {
        case 'state': changed = false; break;
        case 'start': E.startGame(room, me.id, secureRandom, now); break;
        case 'act': E.act(room, me.id, String(body.move), now); break;
        case 'next': changed = E.nextHand(room, secureRandom, now); break;
        case 'timeout': changed = E.timeout(room, now); break;
        case 'rebuy': E.rebuy(room, me.id); break;
        case 'leave': E.leave(room, me.id, now); break;
        default: throw new E.GameError('Unknown action.');
      }
    }

    if (!changed) return views(room, me.id, now);
    if (await store.save(code, version, room, E.publicView(room, now))) {
      return views(room, extra.playerId || me.id, now, extra);
    }
  }
  throw new E.GameError('The table is busy, please try again.');
}
