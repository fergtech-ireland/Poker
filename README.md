# Texas Hold'em

A simple heads-up Texas Hold'em game: you against one computer player.

## Play it

**https://fergtech-ireland.github.io/Poker/**

You can also open `index.html` directly in any browser.

### Install it on your phone

- **iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

After it's installed, it opens full-screen like a normal app and works offline.

## How to play

- Each player starts with 1000 chips. Blinds are 10/20, and the dealer button switches every hand.
- Betting is fixed-limit: bets are 20 before the flop and on the flop, and 40 on the turn and river. Each street allows at most 4 bets.
- Use **Fold**, **Check/Call** and **Bet/Raise** to act, then **Next Hand** to continue.
- Under your cards, **Win chance** shows your chance of winning the hand after each deal (pre-flop, flop, turn, river). The computer's cards are hidden, so it's worked out against every hand it could hold; ties count as half a win. The log records it too.
- If either player runs out of chips, both stacks reset to 1000.

## Stats

The top bar shows hands played, wins, losses, ties (split pots) and your **win percentage** (wins ÷ hands played).
A fold counts as a loss for the player who folded.
Stats are saved in your browser, so they're still there next time you open the game. **Reset Stats** clears them.

## Files

- `poker.js`: deck, hand evaluator and equity estimate
- `game.js`: game flow, the computer player and the display
- `index.html`: page layout and styling
- `manifest.webmanifest`, `sw.js`, `icons/`: what lets the game be installed on a phone and work offline
- `.github/workflows/pages.yml`: publishes the game to GitHub Pages on every push

When you change any game file, bump `CACHE` in `sw.js` (e.g. `holdem-v2`) so installed copies pick up the update.
