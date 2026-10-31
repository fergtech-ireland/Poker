// Player profiles, friends and invites.
// A profile is created on the phone: a random id plus a secret that never leaves the device
// (only its hash is stored). No email or password. Friends are added with a short friend code.
//
// store.loadProfile(id)                                   -> { version, profile } | null
// store.findProfileByFriendCode(code)                     -> id | null
// store.saveProfile(id, friendCode, expectedVersion, p)   -> true / false (0 = create)
// store.deleteProfile(id)
import { GameError } from './engine.mjs';

const FRIEND_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1
const MAX_FRIENDS = 100;
const INVITE_HOURS = 3;
export const DELETED_NAME = 'Deleted player';

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function friendCode(rand) {
  let c = '';
  for (let i = 0; i < 8; i++) c += FRIEND_CHARS[Math.floor(rand() * FRIEND_CHARS.length)];
  return c;
}

export function cleanName(name) {
  name = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!name) throw new GameError('Please enter a name.');
  return name;
}

export function cleanProfileKey(profile) {
  if (!profile) throw new GameError('Missing player profile. Please reload the page.');
  const id = String(profile.id || ''), secret = String(profile.secret || '');
  if (!/^[a-z0-9]{12,40}$/.test(id) || secret.length < 16 || secret.length > 100) throw new GameError('Invalid player profile.');
  return { id, secret };
}

// Load a profile and check the caller holds its secret.
export async function verifiedProfile(store, key) {
  key = cleanProfileKey(key);
  const loaded = await store.loadProfile(key.id);
  if (!loaded) { const e = new GameError('Profile not found.'); e.code = 'NO_PROFILE'; throw e; }
  if (loaded.profile.secretHash !== await sha256(key.secret)) throw new GameError('Could not verify your profile.');
  return loaded;
}

// Load, change and save a profile, retrying if it was saved in between.
async function updateProfile(store, id, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const loaded = await store.loadProfile(id);
    if (!loaded) return null;
    const result = await change(loaded.profile);
    if (result === false) return loaded.profile; // nothing to save
    if (await store.saveProfile(id, loaded.profile.friendCode, loaded.version, loaded.profile)) return loaded.profile;
  }
  throw new GameError('The server is busy, please try again.');
}

const freshInvites = (p, now) => (p.invites || []).filter(i => now - i.at < INVITE_HOURS * 3600 * 1000);

async function profileView(store, p, now) {
  const friends = [];
  for (const fid of p.friends || []) {
    const f = await store.loadProfile(fid);
    if (f) friends.push({ id: fid, name: f.profile.name, friendCode: f.profile.friendCode });
  }
  friends.sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: p.id, name: p.name, friendCode: p.friendCode, createdAt: p.createdAt,
    friends, invites: freshInvites(p, now).map(({ fromName, room, mode, at }) => ({ fromName, room, mode, at })),
  };
}

// Remember which leagues a profile is in, so deleting the profile can clean them up.
export async function noteLeague(store, profileId, leagueCode) {
  try {
    await updateProfile(store, profileId, p => {
      p.leagues = p.leagues || [];
      if (p.leagues.includes(leagueCode)) return false;
      p.leagues.push(leagueCode);
    });
  } catch (e) { /* best effort */ }
}

// ctx: { rateLimit(kind) -> Promise<void> (throws when over the limit), updateLeague(store, code, fn), now, rand }
export async function profileAction(action, body, store, ctx) {
  const { now } = ctx;

  if (action === 'profile_save') {
    const key = cleanProfileKey(body.profile);
    const name = cleanName(body.name);
    const existing = await store.loadProfile(key.id);
    if (!existing) {
      await ctx.rateLimit('profile_create');
      for (let attempt = 0; attempt < 6; attempt++) {
        const p = {
          id: key.id, name, secretHash: await sha256(key.secret), friendCode: friendCode(ctx.rand),
          friends: [], invites: [], leagues: [], createdAt: now, lastSeen: now,
        };
        if (await store.saveProfile(key.id, p.friendCode, 0, p)) return { ok: true, profile: await profileView(store, p, now) };
        if (await store.loadProfile(key.id)) break; // created by a double tap; fall through to verify
      }
    }
    await verifiedProfile(store, key);
    const p = await updateProfile(store, key.id, p => { p.name = name; p.lastSeen = now; });
    return { ok: true, profile: await profileView(store, p, now) };
  }

  const { profile: me } = await verifiedProfile(store, body.profile);

  if (action === 'profile_get') {
    const p = await updateProfile(store, me.id, p => {
      const before = (p.invites || []).length;
      p.invites = freshInvites(p, now);
      if (now - (p.lastSeen || 0) < 3600 * 1000 && p.invites.length === before) return false;
      p.lastSeen = now;
    });
    return { ok: true, profile: await profileView(store, p, now) };
  }

  if (action === 'friend_add') {
    await ctx.rateLimit('friend_add');
    const code = String(body.friendCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) throw new GameError('Friend codes are 8 characters.');
    const fid = await store.findProfileByFriendCode(code);
    if (!fid) throw new GameError('No player has that friend code.');
    if (fid === me.id) throw new GameError("That's your own friend code.");
    if ((me.friends || []).length >= MAX_FRIENDS) throw new GameError(`You can have up to ${MAX_FRIENDS} friends.`);
    const add = other => p => {
      p.friends = p.friends || [];
      if (p.friends.includes(other)) return false;
      p.friends.push(other);
    };
    await updateProfile(store, fid, add(me.id));
    const p = await updateProfile(store, me.id, add(fid));
    return { ok: true, profile: await profileView(store, p, now) };
  }

  if (action === 'friend_remove') {
    const fid = String(body.friendId || '');
    const remove = other => p => {
      if (!(p.friends || []).includes(other)) return false;
      p.friends = p.friends.filter(x => x !== other);
    };
    await updateProfile(store, fid, remove(me.id));
    const p = await updateProfile(store, me.id, remove(fid));
    return { ok: true, profile: await profileView(store, p, now) };
  }

  if (action === 'invite') {
    await ctx.rateLimit('invite');
    const fid = String(body.friendId || '');
    if (!(me.friends || []).includes(fid)) throw new GameError('You can only invite friends.');
    const room = String(body.room || '').toUpperCase().replace(/[^A-Z]/g, '');
    const loaded = await store.load(room);
    if (!loaded || !loaded.room.players.some(pl => pl.profileId === me.id)) throw new GameError('Join a table before inviting friends to it.');
    await updateProfile(store, fid, p => {
      p.invites = freshInvites(p, now).filter(i => !(i.room === room && i.fromId === me.id));
      p.invites.unshift({ fromId: me.id, fromName: me.name, room, mode: loaded.room.mode || 'cash', at: now });
      p.invites.length = Math.min(p.invites.length, 10);
    });
    return { ok: true };
  }

  if (action === 'invite_dismiss') {
    const room = String(body.room || '').toUpperCase();
    const p = await updateProfile(store, me.id, p => {
      const before = (p.invites || []).length;
      p.invites = (p.invites || []).filter(i => i.room !== room);
      if (p.invites.length === before) return false;
    });
    return { ok: true, profile: await profileView(store, p, now) };
  }

  if (action === 'profile_delete') {
    // Friends forget you, leagues keep the results but not your name, then the profile goes.
    for (const fid of me.friends || []) {
      await updateProfile(store, fid, p => { p.friends = (p.friends || []).filter(x => x !== me.id); });
    }
    for (const code of me.leagues || []) {
      try {
        await ctx.updateLeague(store, code, l => {
          const m = l.members[me.id];
          if (m) { m.name = DELETED_NAME; m.profileHash = null; m.deleted = true; }
          for (const t of l.tournaments || []) for (const s of t.standings) if (s.profileId === me.id) s.name = DELETED_NAME;
        });
      } catch (e) { /* league may be gone */ }
    }
    await store.deleteProfile(me.id);
    return { ok: true, deleted: true };
  }

  throw new GameError('Unknown action.');
}
