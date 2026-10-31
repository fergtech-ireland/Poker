# Getting Texas Hold'em onto Google Play

**Route:** the game is already an installable web app (PWA). For Play we wrap it in a
**Trusted Web Activity (TWA)**: a tiny Android app that opens the web app full-screen, built with
Google's Bubblewrap tool. Updates to the website reach Android users without a new Play release.

Legend: 🤖 = Claude does it in the repo · 🙋 = needs you (accounts, money, legal, decisions) · ✅ done

---

## 1. Profiles, friends and account deletion

Friends and leagues need a lasting identity, so people need a **profile**. To keep it simple and
private there's **no email or password**: the profile is created the first time someone opens Play with
Friends.

- [ ] 🤖 Server-side profiles: display name, private key kept on the phone, friend code
- [ ] 🤖 Rename yourself; your name is used at tables and in leagues
- [ ] 🤖 Friends: add by friend code or link, list, remove
- [ ] 🤖 Invite friends to your table (they see the invite in the app)
- [ ] 🤖 Move your profile to a new phone with a transfer code
- [ ] 🤖 **Delete my profile** in the app: removes the profile and friends, and anonymises league history
- [ ] 🤖 Web page explaining how to delete your data (Play requires one)
- [ ] 🙋 Later, optional: sign in with Google or email so profiles can't be lost with the phone

## 2. Security and privacy

- [ ] 🤖 Rooms no longer publicly readable: live updates become content-free "something changed" pings,
      and everything else goes through the server, which checks who you are
- [ ] 🤖 Server only accepts requests from the app's own website (CORS)
- [ ] 🤖 Rate limits on creating rooms, leagues and profiles (stops spam and abuse)
- [ ] 🤖 Content Security Policy on the pages (blocks injected scripts)
- [ ] 🤖 Remove the `pg_net` test extension from the database
- [ ] 🙋 Approve deleting the test data (room `JUCC`, league `QULZMJ`); Supabase will ask you to confirm
- [ ] 🤖 Privacy policy page (what's stored, why, how long, how to delete)
- [ ] 🤖 Re-run Supabase security advisors; fix anything they flag
- [ ] 🙋 Supabase: consider the Pro plan before launch (free projects pause after a week without use)

## 3. Android app (TWA)

- [ ] 🤖 Store-ready icons (including an Android "maskable" icon) and manifest details
- [ ] 🤖 `twa-manifest.json` (Bubblewrap config): package `ie.fergtech.holdem`, name, colours
- [ ] 🤖 GitHub Actions workflow that builds the signed Android App Bundle (.aab)
- [ ] 🙋 **Website address for the app.** Android has to verify the site with a file at the domain root
      (`/.well-known/assetlinks.json`). `fergtech-ireland.github.io/Poker` is a subfolder, so choose one:
      - (a) a custom domain such as `poker.fergtech.ie` (recommended, looks professional), or
      - (b) a repo named `fergtech-ireland.github.io` to host that one file (Claude can set it up).
- [ ] 🙋 Create the upload signing key (Claude can generate it; you keep the file and passwords safe) and
      add it as GitHub secrets
- [ ] 🤖 Publish `assetlinks.json` with the key fingerprints once known

## 4. Google Play Console

- [ ] 🙋 Developer account ($25 one-off). **Personal** accounts must run a closed test with
      **12 testers for 14 days** before going public. **Organisation** accounts skip that but need a
      D-U-N-S number for FergTech.
- [ ] 🙋 Create the app, upload the .aab, turn on Play App Signing
- [ ] 🤖 Store listing text (short and full description) for you to paste
- [ ] 🤖 Screenshots (phone) and feature graphic (1024×500)
- [ ] 🙋 Content rating questionnaire: answer **yes to simulated gambling**; no real money
- [ ] 🙋 Target audience: **18+** (simulated gambling; keeps it out of Families policy)
- [ ] 🙋 Data safety form (Claude will prepare the answers): name and app activity collected,
      not shared, deletable, no ads
- [ ] 🙋 Privacy policy URL and account deletion URL
- [ ] 🙋 Closed test with 12 testers for 14 days (personal account), then apply for production

## 5. Nice to have before a wide launch

- [ ] Report or block a player; profanity filter on names (user-generated names are visible to others)
- [ ] Push notifications for invites and "your turn"
- [ ] No-limit betting option

---

### What "simulated gambling" means for us
No real money, no prizes, no buying chips. Keep it that way: selling chips or adding prizes would turn
it into a social casino, which brings ad and age-gating rules, or into real gambling, which needs a
licence (see earlier notes).
