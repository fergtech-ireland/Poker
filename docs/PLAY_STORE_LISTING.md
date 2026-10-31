# Google Play: step-by-step and everything to paste

App: **Texas Hold'em** by FergTech · package `ie.fergtech.holdem` · site `https://poker.fergtech.ie`

---

## Step 1. Point poker.fergtech.ie at the game (you)

1. **DNS**: wherever `fergtech.ie` is managed (your domain registrar or DNS host), add:

   | Type  | Name / Host | Value                         |
   |-------|-------------|-------------------------------|
   | CNAME | `poker`     | `fergtech-ireland.github.io`  |

2. **GitHub**: go to github.com/fergtech-ireland/Poker → **Settings → Pages → Custom domain**, enter
   `poker.fergtech.ie`, then **Save**. Wait for the DNS check to go green (minutes to a few hours), then tick
   **Enforce HTTPS**.
3. Recommended, to stop anyone else claiming the domain on GitHub: **your GitHub profile → Settings →
   Pages → Add a domain** → `fergtech.ie`, then add the TXT record GitHub shows you.
4. Open https://poker.fergtech.ie: the game should load. The old github.io link redirects there.

> Players' saved data is tied to the web address. Profiles made on the old github.io address won't
> appear on the new one. Anyone who needs to keep theirs can use **Profile & privacy → Move to another
> phone** before the switch, and enter the code on the new address.

## Step 2. Create the upload signing key (you, once)

On any computer with Java installed (or Android Studio):

```
keytool -genkeypair -v -keystore holdem-upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Choose a strong password and **store the file and password safely** (e.g. a password manager). With Play App
Signing, Google holds the real app signing key, and this upload key can be reset if lost, but avoid that.

Then turn the file into text for GitHub:
- macOS: `base64 -i holdem-upload.keystore | pbcopy`
- Linux: `base64 -w0 holdem-upload.keystore`
- Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("holdem-upload.keystore")) | Set-Clipboard`

In github.com/fergtech-ireland/Poker → **Settings → Secrets and variables → Actions → New repository secret**, add:
- `ANDROID_KEYSTORE_BASE64`: the base64 text
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password
- `ANDROID_KEY_PASSWORD`: the key password (the same, unless you chose a different one)

## Step 3. Build the app (Claude, or you via the Actions tab)

GitHub → **Actions → Build Android app → Run workflow**. When it finishes, download **holdem-android**:
`app-release-bundle.aab` (upload this to Play), `app-release-signed.apk` (for installing on a test phone),
and `fingerprint.txt` (the upload key's SHA-256 fingerprint).

## Step 4. Google Play Console (you)

1. Create a developer account at play.google.com/console ($25 one-off).
   - **Personal** account: before going public you must run a **closed test with at least 12 testers for
     14 days in a row**.
   - **Organisation** account: no tester requirement, but needs a D-U-N-S number for FergTech.
2. **Create app**: name "Texas Hold'em", default language English (Ireland or UK), **Game**, **Free**.
3. **Play App Signing**: accept (default). Then **Setup → App signing** shows the **app signing key
   SHA-256 fingerprint**. Send me that and the one from `fingerprint.txt`, and I'll publish
   `/.well-known/assetlinks.json`. That's what makes the app open full-screen with no browser address bar.
4. Fill in the sections below, upload the .aab to **Testing → Closed testing**, add testers, roll out.
5. After 14 days with 12+ testers (personal accounts), **apply for production**.

---

## Store listing

**App name** (max 30): `Texas Hold'em`

**Short description** (max 80):
```
Play Texas Hold'em with friends: private tables, tournaments and league tables.
```

**Full description**:
```
Simple, fast Texas Hold'em: play the computer, or sit down with friends on your own phones.

PLAY WITH FRIENDS
• Create a table and share the link or 4-letter code. 2 to 6 players
• Cards are dealt by the server, so nobody can see anyone else's hand
• Cash games, or tournaments where the blinds rise and the last player standing wins
• Add friends with your friend code and invite them to your table

LEAGUES
• Start a league for your group and keep a league table across every game
• Points for every tournament, plus wins, average finish and hands won

PLAY THE COMPUTER
• Heads-up against a computer opponent, offline
• Your wins, losses, ties and win percentage are tracked

HANDY EXTRAS
• Your chance of winning after every card is dealt
• No sign-up: pick a name and play. No email, no password
• No ads

No real money. You can't buy chips and there are no prizes. Texas Hold'em is a free poker game for
adults, for fun only.

Made in Ireland by FergTech.
```

**Graphics** (in the repo's `store/` folder):
- App icon: `store/icon-512.png` (512×512)
- Feature graphic: `store/feature-graphic-1024x500.png`
- Phone screenshots (1080×1920): `store/screenshot-1-friends-table.png`, `-2-league.png`,
  `-3-tournament-win.png`, `-4-vs-computer.png`, `-5-friends-home.png`

Regenerate them any time with `NODE_PATH=$(npm root -g) node tools/store-assets.mjs`.

**Category**: Games → Card · **Tags**: Poker, Card, Multiplayer, Casual
**Contact email**: a FergTech support email (required, shown publicly). Please choose one.
**Website**: https://poker.fergtech.ie · **Privacy policy**: https://poker.fergtech.ie/privacy.html

---

## App content answers

**Privacy policy URL**: `https://poker.fergtech.ie/privacy.html`

**Ads**: No, the app does not contain ads.

**App access**: All functionality is available without special access (no login needed).

**Target audience and content**: age group **18 and over** only. The app is not designed for children.

**Content rating (IARC questionnaire)**: category **Game**.
- Violence, sexuality, language, controlled substances: **No**
- **Simulated gambling: Yes** (poker with play chips; no real money, nothing of value can be won)
- Real-money gambling: **No**
- Users can interact or exchange content: **Yes**. Players see each other's chosen names at tables;
  there is no chat or free-text messaging.
- Shares user location: **No** · Digital purchases: **No**

**Government app / financial features / health**: No.

### Data safety form

Does your app collect or share any of the required user data types? **Yes** (collects; does not share).
Is all data encrypted in transit? **Yes** (HTTPS).
Do you provide a way for users to request deletion? **Yes**: `https://poker.fergtech.ie/delete-data.html`

| Data type (Play's name)                        | Collected | Shared | Optional? | Purpose               |
|------------------------------------------------|-----------|--------|-----------|-----------------------|
| Personal info → **Name** (the player name you choose) | Yes | No | Required for friends play | App functionality |
| App activity → **Other actions** (game moves, results, league stats) | Yes | No | Required for friends play | App functionality |
| Device or other IDs → **Device or other IDs** (random profile ID; scrambled IP address kept up to a day for abuse limits) | Yes | No | Required | App functionality, Fraud prevention & security |

Not collected: email, phone, location, contacts, photos, financial info, health, messages, browsing history.
Data is **not** used for advertising or analytics, and is **not** processed ephemerally only (it's stored).
The vs-Computer mode keeps everything on the device and sends nothing.

**Account deletion** (Play's requirement for apps with accounts):
- In app: With Friends → Profile & privacy → Delete my profile
- Web: `https://poker.fergtech.ie/delete-data.html`

---

## assetlinks.json (filled in once fingerprints are known)

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "ie.fergtech.holdem",
    "sha256_cert_fingerprints": ["<Play app signing key SHA-256>", "<upload key SHA-256>"]
  }
}]
```
