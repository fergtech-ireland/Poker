# Texas Hold'em

A simple Texas Hold'em game. Play heads-up against the computer, or at a table with up to 5 friends.

## Play it

**https://fergtech-ireland.github.io/Poker/**

You can also open `index.html` directly in any browser.

### Install it on your phone

- **iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

After it's installed, it opens full-screen like a normal app and works offline.

## Play with friends

1. Open the game and tap **With Friends**.
2. Enter your name and tap **Create Room**, then **Share invite link** and send it to your friends.
   They can also type the 4-letter room code.
3. When everyone's in (2–6 players), the host taps **Start Game**. Hands then follow on automatically.

When creating a room, pick:

- **Cash game**: play as long as you like. Everyone starts with 1000 chips, and if you run out, tap **Rebuy**.
- **Tournament**: everyone starts with 1000 chips and there are no rebuys. Blinds go up every 8 hands
  (or every 4 on "fast"): 10/20, 15/30, 25/50, 40/80 and so on. When you run out you're knocked out and
  get a finishing place. **The last player with chips wins.** People who join mid-tournament watch and
  play in the next one. The host can tap **Play again** for another round.
- If someone takes longer than 45 seconds on their turn, they're automatically checked or folded.
- Close the app and come back later: you'll go straight back to your seat.
- The **Table scores** panel shows everyone's hands played, hands won and win %. The stats bar at the top counts
  your own friends games on this device, separately from your games against the computer.

### Leagues

A league is a private group with its own **league table** covering all your games together.

- Create one under **Leagues** on the With Friends page, then share the league link (or 6-letter code).
- Tap **New tournament** or **New cash game** from the league page, or pick the league when creating a room.
  Anyone who joins a league table joins the league.
- **Tournament points** = number of players you finish above + 1. Winning a 6-player tournament scores 6
  and last place scores 1. The table is sorted by points, then wins. It also shows tournaments played,
  wins, average finishing place, and hands won across all league games (cash games included).
- Your phone remembers you with a private ID; there's no sign-up. A different phone or browser counts as a
  different player.

## How to play (vs Computer)

- Each player starts with 1000 chips. Blinds are 10/20, and the dealer button switches every hand.
- Betting is fixed-limit: bets are 20 before the flop and on the flop, and 40 on the turn and river. Each street allows at most 4 bets.
- Use **Fold**, **Check/Call** and **Bet/Raise** to act, then **Next Hand** to continue.
- Under your cards, **Win chance** shows your chance of winning the hand after each deal (pre-flop, flop, turn, river). The computer's cards are hidden, so it's worked out against every hand it could hold; ties count as half a win. The log records it too.
- If either player runs out of chips, both stacks reset to 1000.

## Stats

The top bar shows hands played, wins, losses, ties (split pots) and your **win percentage** (wins ÷ hands played).
A fold counts as a loss for the player who folded.
Stats are saved in your browser, so they're still there next time you open the game. **Reset Stats** clears them.

## How friends games work

The server shuffles and deals, so nobody can see anyone else's cards. It runs on
[Supabase](https://supabase.com) (free plan, project `poker`):

- `supabase/functions/poker/`: the server function. `engine.mjs` has the multiplayer rules (side pots,
  split pots, timeouts) and `api.mjs` handles requests. It uses the same `poker.js` as the browser (symlinked).
- `supabase/migrations/`: the database. `rooms` holds what every player may see and is pushed live to phones.
  `room_secrets` holds the deck, hole cards and player tokens, and only the server function can read it.
  `leagues` holds league tables and member profile hashes, and also has no public access.
- `config.js`: the project URL and publishable key. These are safe to be public.
- `docs/MULTIPLAYER_PLAN.md`: the design.

To redeploy the server after changing it: `supabase functions deploy poker --no-verify-jwt`.

## Version, copyright and trademark

Every screen ends with the FergTech footer, the same release line as other FergTech apps:

> FERGTECH™
> Texas Hold'em v0.5.0 · © 2026 FergTech · Built by FergTech
> build abc1234, built 2026-10-31
> FergTech™ is a trademark of FergTech.

- The version lives in `version.js`. The deploy workflow stamps in the build commit and date.
- To release: bump the version in `version.js`, add an entry to `CHANGELOG.md`, and bump `CACHE` in `sw.js`.

## Tests

- `node tests/release.test.mjs`: the version/copyright line and the deploy stamping.
- `node tests/engine.test.mjs`: game rules, side pots, tournaments, leagues, and thousands of random hands.
- `NODE_PATH=$(npm root -g) node tests/friends.e2e.mjs`: several players in separate browsers, including a league tournament (needs Playwright).

## Files

- `version.js`: version number and the FergTech copyright/trademark footer
- `CHANGELOG.md`: what changed in each version
- `poker.js`: deck, hand evaluator and equity estimate
- `index.html`, `game.js`: the vs-computer game
- `friends.html`, `friends.js`: play with friends
- `style.css`: styles shared by both pages
- `vendor/supabase.js`: Supabase browser library (v2.118.0, MIT), stored here so the app doesn't depend on a CDN
- `manifest.webmanifest`, `sw.js`, `icons/`: what lets the game be installed on a phone and work offline
- `.github/workflows/pages.yml`: publishes the game to GitHub Pages on every push

When you change any game file, bump `CACHE` in `sw.js` (e.g. `holdem-v2`) so installed copies pick up the update.

---

© 2026 FergTech. FergTech™ is a trademark of FergTech.
