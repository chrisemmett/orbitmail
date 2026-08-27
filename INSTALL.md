# Installing Orbit Mail

Two ways in: install a package, or build your own copy. Either way, **Gmail and
Microsoft sign-in need OAuth credentials you register yourself** — no build of
Orbit Mail contains any, so a package is safe to pass on. Plain IMAP and POP3
accounts need none of this and work straight away.

- [Install a package](#install-a-package)
  - [Linux](#linux) · [macOS](#macos)
- [Build your own copy](#build-your-own-copy)
- [Register an OAuth app](#register-an-oauth-app) — only for Gmail / Microsoft
- [Adding your account](#adding-your-account)
- [Updating and removing](#updating-and-removing)

For architecture, contributing and the deep OAuth reference, see
[DEVELOPERS.md](DEVELOPERS.md).

## Install a package

Linux and macOS. There is no Windows build.

### Linux

**Debian / Ubuntu / Mint:**

```bash
sudo dpkg -i orbit-mail-*.deb
```

**AppImage** — make it executable and run it:

```bash
chmod +x orbit-mail-*.AppImage
./orbit-mail-*.AppImage
```

Packaged builds install a `.desktop` launcher so the app groups and pins
correctly in your taskbar, and can handle `mailto:` links once you opt in
through your system's default-applications settings.

### macOS

Open the `.dmg` and drag **Orbit Mail** to Applications. macOS 11 or newer;
`orbit-mail-*-mac-arm64.dmg` is for Apple Silicon, `-x64` for Intel.

**The first launch needs one extra step.** Orbit Mail is not signed by an
identified Apple developer, so double-clicking it gets you *"Orbit Mail cannot
be opened because the developer cannot be verified"*. Instead:

1. **Right-click** (or Control-click) Orbit Mail in Applications.
2. Choose **Open**.
3. Click **Open** again in the dialog.

Only the first launch needs this; after that it opens normally. On newer macOS
versions the dialog may instead appear under **System Settings → Privacy &
Security**, as an **Open Anyway** button below a note about Orbit Mail.

This is deliberate rather than an oversight. Signing a release would mean
putting an Apple Developer ID into a public repository, and no build of Orbit
Mail contains credentials that identify whoever made it — the same rule that
keeps OAuth secrets out of a package. If you would rather not take a stranger's
word for it, [build your own copy](#build-your-own-copy); a build you make
yourself launches the same way, but you know what went into it.

If you only use IMAP or POP3 accounts, you are done — skip to
[Adding your account](#adding-your-account).

## Build your own copy

About 15 minutes and a terminal. No coding.

**1. Prerequisites.**

Debian / Ubuntu / Mint:

```bash
sudo apt install git nodejs npm build-essential python3
```

macOS — Node.js from [nodejs.org](https://nodejs.org/) or Homebrew, plus the
Xcode Command Line Tools, which supply the compiler that builds the database
module:

```bash
xcode-select --install
```

Node.js 22.12 or newer is required on either platform — check with
`node --version`. That floor is Electron's own (`engines.node`), and it is the
strictest in the toolchain. If your distro ships an older Node, install a
current one from [nodejs.org](https://nodejs.org/) or via `nvm`.

**2. Get the code:**

```bash
git clone <your-repo-url> orbit-mail
cd orbit-mail
npm install
```

**3. Run it**, either straight from source:

```bash
npm run dev
```

…or build a package and install that. `npm run dist` builds for whichever
platform you are on.

On Linux it produces a `.deb` and an AppImage:

```bash
npm run dist
sudo dpkg -i release/orbit-mail-*.deb
```

`npm run dist:deb` and `npm run dist:appimage` build one at a time.

On macOS it produces a `.dmg` and a `.zip` for your Mac's own architecture:

```bash
npm run dist:mac
open release/
```

`npm run dist:mac:x64` builds for Intel from an Apple Silicon Mac. A copy you
build yourself is ad-hoc signed, so it still needs the right-click **Open** on
first launch described [above](#macos).

## Register an OAuth app

Only for Gmail and Microsoft 365 accounts. You register an app once with the
provider and give Orbit Mail its details; they are stored encrypted on your
machine and never end up inside a build.

- **Gmail** → [Google OAuth setup](DEVELOPERS.md#google-gmail). Create a Google
  Cloud project, enable the Gmail API, set the consent screen to **External**
  and **Publish** it, create a **Desktop app** credential, and copy the Client
  ID and Secret.
- **Microsoft 365 / Outlook** →
  [Microsoft OAuth setup](DEVELOPERS.md#microsoft-office-365--outlook). Register
  an app in Entra, add the `http://127.0.0.1/callback` redirect, enable public
  client flows, and copy the Application (client) ID.

Give Orbit Mail the details either way round:

- **In the app** — click **Add Account**, choose the provider, and paste them
  when asked. They are stored encrypted on this machine.
- **In a file** — copy `.env.example` to `.env` in the project directory (or
  create a `.env` in your settings folder: `~/.config/orbit-mail/.env` on Linux,
  `~/Library/Application Support/Orbit Mail/.env` on macOS) and paste the values
  in. Leave blank any provider you do not use. The Add Account dialog prints the
  exact path for your machine, so you do not have to work it out from here.

No rebuild is needed after changing credentials: they are read when the app
starts, so editing the file and restarting is enough.

## Adding your account

1. Launch Orbit Mail, click **Add Account**, and pick your provider.
2. For Gmail or Microsoft, sign in through the browser window that opens.
3. For anything else, choose **Other (IMAP / POP3)**, enter your email address
   and password, and click **Autodetect** to fill in the server settings. Adjust
   incoming and outgoing servers if needed — the connection is verified before
   the account is saved.

### Two Google screens that are easy to get wrong

- **"Google hasn't verified this app"** — click **Advanced → Go to Orbit Mail
  (unsafe)**. Expected for a copy you run yourself; once per account.
- **The permissions screen** — tick **"Read, compose, send and permanently
  delete all your email from Gmail"**. Google leaves this box **unticked by
  default**, and without it sign-in completes but Orbit Mail cannot read your
  mail, so it refuses the account and asks you to try again.

## Updating and removing

**Update a built copy:**

```bash
git pull
npm install
npm run dist
```

Then reinstall: `sudo dpkg -i release/orbit-mail-*.deb` on Linux, or drag the
new app out of the `.dmg` on macOS, replacing the old one.

**Uninstall** the Debian package with `sudo apt remove orbit-mail`, or just
delete the AppImage. On macOS, drag Orbit Mail from Applications to the Bin.

Your mail cache, accounts and settings are left alone by an uninstall:

| Platform | Settings folder |
|----------|-----------------|
| Linux | `~/.config/orbit-mail/` |
| macOS | `~/Library/Application Support/Orbit Mail/` |

Delete that folder to remove them too — it contains your cached mail,
downloaded attachments and stored credentials.
