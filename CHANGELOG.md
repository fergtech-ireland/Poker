# Changelog

Texas Hold'em by FergTech. The version is shown at the foot of every screen
("Texas Hold'em v0.5.0 · © 2026 FergTech · Built by FergTech"), with the build commit and date under it.

To release: bump `version` in `version.js`, add an entry here, and bump `CACHE` in `sw.js`
so installed copies pick up the update.

## 0.6.1 (31 October 2026)
- Ready for poker.fergtech.ie and the Android app: domain file, app verification file, maskable icon,
  Android build workflow, Play Store graphics and listing.
- Tournament winner shows "Winner"; tidier table header on small phones; blind speed option only
  shows for tournaments.

## 0.6.0 (31 October 2026)
- Player profiles: choose a name on first visit; no email or password.
- Friends: add by friend code or link, invite friends to your table.
- Move your profile to a new phone with a transfer code; Delete my profile.
- Privacy policy and data deletion pages.
- Security: tables are no longer publicly readable, the server only accepts requests from the app's
  website, rate limits stop spam, and a Content Security Policy blocks injected scripts.

## 0.5.0 (31 October 2026)
- Tournaments: no rebuys, rising blinds, knock-outs with finishing places, last one standing wins.
- Leagues: private groups with a league table (points, wins, average finish, hands won).
- Copyright, trademark and version line on every screen.

## 0.4.0 (31 October 2026)
- Play with friends: rooms with a link or 4-letter code, 2–6 players, live updates,
  table scores, rebuys, turn timer.

## 0.3.0 (31 October 2026)
- Win chance after each deal.

## 0.2.0 (31 October 2026)
- Installable on phones, works offline, phone-friendly layout. Published on GitHub Pages.

## 0.1.0 (31 October 2026)
- Heads-up Texas Hold'em against the computer, with wins, losses, ties and win %.
