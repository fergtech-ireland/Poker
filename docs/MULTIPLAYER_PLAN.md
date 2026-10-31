# Play with friends: plan

## Goal
You and 1–5 friends sit at the same table on your own phones or computers. One person creates a
room and shares a link or 4-letter code; everyone else joins from that link. Same simple fixed-limit
Hold'em as the single-player game, with win/loss stats and per-deal win chance.

## Why a server is needed
In the single-player game everything runs on one device. With friends, something has to be trusted
to shuffle and deal, keep each player's hole cards secret from everyone else, and make sure every
phone sees the same table. If a phone did this, its owner could peek at everyone's cards.

## Architecture (Supabase, free tier)

```
 Phone A ─┐                         ┌──────────────────────────────┐
 Phone B ─┼─ HTTPS POST actions ──▶ │ Edge Function "poker"        │
 Phone C ─┘                         │  - shuffles, deals, enforces │
     ▲                              │    turns & betting rules     │
     │                              │  - runs the same poker.js    │
     │  realtime "room changed"     └─────────────┬────────────────┘
     └──────────────────────────────┐             │ save (version-checked)
                                    │             ▼
                              ┌─────┴─────────────────────────────┐
                              │ Postgres                          │
                              │  rooms         public table view  │──▶ Realtime
                              │  room_secrets  deck, hole cards,  │
                              │                player tokens      │
                              │                (no public access) │
                              └───────────────────────────────────┘
```

- **Edge Function** (`supabase/functions/poker`) is the only thing that changes game state.
  Actions: `create`, `join`, `state`, `start`, `act`, `next`, `timeout`, `rebuy`, `leave`.
- **Players** get a random secret token when they join (saved on their device). Only a hash is
  stored server-side. No sign-up or passwords.
- **rooms** holds what everyone may see (names, chips, bets, board, whose turn). It's readable by
  anyone and pushed live with Supabase Realtime.
- **room_secrets** holds the deck, everyone's hole cards and token hashes. Row-level security
  with no policies, so only the Edge Function can read it.
- Each save checks a version number, so two players acting at the same moment can't corrupt the
  table. The loser of the race retries.
- No background timers: clients ask the server to start the next hand a few seconds after a hand
  ends, or to auto-fold a player who has taken more than 45 seconds. The server checks the clock
  before agreeing.
- Phones also poll every few seconds, so the game still works if the realtime connection drops.

## Game rules for friends' tables
- 2–6 players, 1000 starting chips, blinds 10/20, fixed limit (20 / 40 bets, max 4 bets per street).
- Correct multi-way pots: side pots when someone is all-in, split pots, odd chips.
- Join mid-hand → dealt in next hand. Out of chips → **Rebuy** for another 1000.
- Leave → folded and removed at the end of the hand.
- The host (room creator) presses **Start**. After that, hands follow on automatically.

## Stats
- Per-room table showing each player's hands played, hands won and win %.
- Your device also keeps lifetime friends-game stats (wins / losses / ties / win %), separate from
  the vs-computer stats.
- Win chance after each deal, against the number of opponents still in the hand.

## Steps
1. [x] Supabase project `poker` (eu-west-1, free plan).
2. [x] Multi-player game engine (pure JS, unit-tested with thousands of random hands: chips always
   conserved, side pots correct).
3. [x] Database: tables, row-level security, version-checked save function, realtime.
4. [x] Edge Function wrapping the engine; deploy; test against the live project.
5. [x] Friends page: create/join, lobby, table for up to 6, share link, reconnect after closing
   the app.
6. [x] Navigation between "vs Computer" and "With Friends", offline caching, README.
7. [x] End-to-end browser test with several simulated players; deploy to GitHub Pages.

## Later ideas (not in this version)
- No-limit betting with a bet slider.
- Accounts so stats follow you across devices.
- Chat / emoji reactions.
- Clean up of old rooms with a scheduled job (currently: rooms idle for 2 days are deleted
  whenever a new room is created).
