# Texas Hold'em

A simple heads-up Texas Hold'em game: you against one computer player.

## How to play

Open `index.html` in any web browser. You don't need to install or build anything.

- Each player starts with 1000 chips. Blinds are 10/20, and the dealer button switches every hand.
- Betting is fixed-limit: bets are 20 before the flop and on the flop, and 40 on the turn and river. Each street allows at most 4 bets.
- Use **Fold**, **Check/Call** and **Bet/Raise** to act, then **Next Hand** to continue.
- If either player runs out of chips, both stacks reset to 1000.

## Stats

The top bar shows hands played, wins, losses, ties (split pots) and your **win percentage** (wins ÷ hands played).
A fold counts as a loss for the player who folded.
Stats are saved in your browser, so they're still there next time you open the game. **Reset Stats** clears them.

## Files

- `poker.js`: deck, hand evaluator and equity estimate
- `game.js`: game flow, the computer player and the display
- `index.html`: page layout and styling
