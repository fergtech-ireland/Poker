// Edge Function "poker": the referee for friends' games.
// POST { action, ... } -> { ok, ... } or { error }
// Room actions: create, join, state, start, act, next, timeout, rebuy, leave.
// League actions: league_create, league_join, league_view.
// Profile actions: profile_save, profile_get, profile_delete, friend_add, friend_remove, invite, invite_dismiss.
// Players prove who they are with the room token or profile secret their device holds (verify_jwt is off).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './api.mjs';
import { GameError } from './engine.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const one = async (q: PromiseLike<{ data: any; error: any }>) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const store = {
  async load(code: string) {
    const d = await one(db.from('room_secrets').select('version, data').eq('code', code).maybeSingle());
    return d ? { version: d.version, room: d.data } : null;
  },
  async save(code: string, expected: number, room: unknown, view: unknown) {
    return (await one(db.rpc('save_room', { p_code: code, p_expected: expected, p_state: view, p_secret: room }))) === true;
  },
  async loadLeague(code: string) {
    const d = await one(db.from('leagues').select('version, data').eq('code', code).maybeSingle());
    return d ? { version: d.version, league: d.data } : null;
  },
  async saveLeague(code: string, expected: number, league: unknown) {
    return (await one(db.rpc('save_league', { p_code: code, p_expected: expected, p_data: league }))) === true;
  },
  async loadProfile(id: string) {
    const d = await one(db.from('profiles').select('version, data').eq('id', id).maybeSingle());
    return d ? { version: d.version, profile: d.data } : null;
  },
  async findProfileByFriendCode(code: string) {
    const d = await one(db.from('profiles').select('id').eq('friend_code', code).maybeSingle());
    return d ? d.id : null;
  },
  async saveProfile(id: string, friendCode: string, expected: number, profile: unknown) {
    return (await one(db.rpc('save_profile', { p_id: id, p_friend_code: friendCode, p_expected: expected, p_data: profile }))) === true;
  },
  async deleteProfile(id: string) {
    await one(db.from('profiles').delete().eq('id', id));
  },
  async rateLimit(key: string, limit: number, seconds: number) {
    return (await one(db.rpc('hit_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: seconds }))) === true;
  },
};

// Only the game's own website (and local testing) may call this from a browser.
const ALLOWED_ORIGINS = [
  'https://poker.fergtech.ie',
  'https://fergtech-ireland.github.io',
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
const originAllowed = (o: string | null) =>
  !!o && ALLOWED_ORIGINS.some(a => (typeof a === 'string' ? a === o : a.test(o)));

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': originAllowed(origin) ? origin! : ALLOWED_ORIGINS[0] as string,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const origin = req.headers.get('Origin');
  if (origin && !originAllowed(origin)) return reply({ error: 'Not allowed.' }, 403);
  const length = Number(req.headers.get('Content-Length') || 0);
  if (length > 10000) return reply({ error: 'Request too large.' }, 413);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || '';
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Bad request.' }, 400);
    return reply(await handle(body, store, Date.now(), { ip }));
  } catch (e) {
    if (e instanceof GameError) return reply({ error: e.message, code: (e as any).code }, 400);
    if (e instanceof SyntaxError) return reply({ error: 'Bad request.' }, 400);
    console.error(e);
    return reply({ error: 'Something went wrong on the server.' }, 500);
  }
});
