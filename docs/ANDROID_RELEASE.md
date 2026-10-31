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

- [x] ✅ Server-side profiles: display name, private key kept on the phone, friend code
- [x] ✅ Rename yourself; your name is used at tables and in leagues
- [x] ✅ Friends: add by friend code or link, list, remove
- [x] ✅ Invite friends to your table (they see the invite in the app)
- [x] ✅ Move your profile to a new phone with a transfer code
- [x] ✅ **Delete my profile** in the app: removes the profile and friends, and anonymises league history
- [x] ✅ Web page explaining how to delete your data (Play requires one)
- [ ] 🙋 Later, optional: sign in with Google or email so profiles can't be lost with the phone

## 2. Security and privacy

- [x] ✅ Rooms no longer publicly readable: live updates become content-free "something changed" pings,
      and everything else goes through the server, which checks who you are
- [x] ✅ Server only accepts requests from the app's own website (CORS)
- [x] ✅ Rate limits on creating rooms, leagues and profiles (stops spam and abuse)
- [x] ✅ Content Security Policy on the pages (blocks injected scripts)
- [ ] 🙋 Remove the `pg_net` test extension (still used for live testing; one SQL line when we're done: `drop extension pg_net;`)
- [ ] 🙋 Delete the test data before launch (league `QULZMJ` and other test leagues; test rooms delete themselves)
- [x] ✅ Privacy policy page (what's stored, why, how long, how to delete)
- [x] ✅ Re-run Supabase security advisors; fix anything they flag
- [ ] 🙋 Supabase: consider the Pro plan before launch (free projects pause after a week without use)

## 3. Android app (TWA)

Step-by-step instructions for every 🙋 item below are in **[PLAY_STORE_LISTING.md](PLAY_STORE_LISTING.md)**.

- [x] ✅ Store-ready icons (including an Android "maskable" icon) and manifest details
- [x] ✅ `android/twa-manifest.json` (Bubblewrap config): package `ie.fergtech.holdem`, name, colours
- [x] ✅ GitHub Actions workflow `Build Android app` that builds the signed App Bundle (.aab).
      Untested until the domain and signing secrets exist; the first run may need a small fix.
- [x] ✅ Website address chosen: **poker.fergtech.ie**. Site files (`CNAME`, `.well-known/`) and the
      server's allowed origins are ready.
- [ ] 🙋 DNS: CNAME `poker` → `fergtech-ireland.github.io`, then GitHub → Settings → Pages → Custom domain
      `poker.fergtech.ie` → Enforce HTTPS
- [ ] 🙋 Create the upload signing key and add the 3 GitHub secrets
- [ ] 🤖 Run the build, then publish `assetlinks.json` with the key fingerprints

## 4. Google Play Console

- [ ] 🙋 Developer account ($25 one-off). **Personal** accounts must run a closed test with
      **12 testers for 14 days** before going public. **Organisation** accounts skip that but need a
      D-U-N-S number for FergTech.
- [ ] 🙋 Create the app, upload the .aab, turn on Play App Signing
- [x] ✅ Store listing text (short and full description) for you to paste
- [x] ✅ Screenshots (phone, 1080×1920) and feature graphic (1024×500) in `store/`
- [ ] 🙋 Content rating questionnaire: answers prepared (**yes to simulated gambling**; no real money)
- [ ] 🙋 Target audience: **18+**
- [ ] 🙋 Data safety form: answers prepared
- [ ] 🙋 Privacy policy URL `https://poker.fergtech.ie/privacy.html` and deletion URL
      `https://poker.fergtech.ie/delete-data.html`
- [ ] 🙋 Support email address for the listing (shown publicly)
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
