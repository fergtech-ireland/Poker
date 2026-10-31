// Edge Function "poker": the referee for friends' games.
// POST { action, code?, token?, name?, move?, profile?, ... } -> { ok, ... } or { error }
// Room actions: create, join, state, start, act, next, timeout, rebuy, leave.
// League actions: league_create, league_join, league_view.
// Players authenticate with the random token they got when joining (verify_jwt is off).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './api.mjs';
import { GameError } from './engine.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const store = {
  async load(code: string) {
    const { data, error } = await db.from('room_secrets').select('version, data').eq('code', code).maybeSingle();
    if (error) throw error;
    return data ? { version: data.version, room: data.data } : null;
  },
  async save(code: string, expected: number, room: unknown, view: unknown) {
    const { data, error } = await db.rpc('save_room', {
      p_code: code, p_expected: expected, p_state: view, p_secret: room,
    });
    if (error) throw error;
    return data === true;
  },
  async loadLeague(code: string) {
    const { data, error } = await db.from('leagues').select('version, data').eq('code', code).maybeSingle();
    if (error) throw error;
    return data ? { version: data.version, league: data.data } : null;
  },
  async saveLeague(code: string, expected: number, league: unknown) {
    const { data, error } = await db.rpc('save_league', { p_code: code, p_expected: expected, p_data: league });
    if (error) throw error;
    return data === true;
  },
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const body = await req.json();
    return reply(await handle(body, store));
  } catch (e) {
    if (e instanceof GameError) return reply({ error: e.message }, 400);
    if (e instanceof SyntaxError) return reply({ error: 'Bad request.' }, 400);
    console.error(e);
    return reply({ error: 'Something went wrong on the server.' }, 500);
  }
});
