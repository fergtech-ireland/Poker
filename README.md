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

- Each player starts with 1000 chips. If you run out, tap **Rebuy**.
- If someone takes longer than 45 seconds on their turn, they're automatically checked or folded.
- Close the app and come back later: you'll go straight back to your seat.
- The **Table scores** panel shows everyone's hands played, hands won and win %. The stats bar at the top counts
  your own friends games on this device, separately from your games against the computer.

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
- `config.js`: the project URL and publishable key. These are safe to be public.
- `docs/MULTIPLAYER_PLAN.md`: the design.

To redeploy the server after changing it: `supabase functions deploy poker --no-verify-jwt`.

## Tests

- `node tests/engine.test.mjs`: game rules, side pots, and thousands of random hands.
- `NODE_PATH=$(npm root -g) node tests/friends.e2e.mjs`: three players in three browsers (needs Playwright).

## Files

- `poker.js`: deck, hand evaluator and equity estimate
- `index.html`, `game.js`: the vs-computer game
- `friends.html`, `friends.js`: play with friends
- `style.css`: styles shared by both pages
- `vendor/supabase.js`: Supabase browser library (v2.118.0, MIT), stored here so the app doesn't depend on a CDN
- `manifest.webmanifest`, `sw.js`, `icons/`: what lets the game be installed on a phone and work offline
- `.github/workflows/pages.yml`: publishes the game to GitHub Pages on every push

When you change any game file, bump `CACHE` in `sw.js` (e.g. `holdem-v2`) so installed copies pick up the update.
