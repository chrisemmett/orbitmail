# Installing Orbit Mail

Two ways in: install a package, or build your own copy. Either way, **Gmail and
Microsoft sign-in need OAuth credentials you register yourself** — no build of
Orbit Mail contains any, so a package is safe to pass on. Plain IMAP and POP3
accounts need none of this and work straight away.

- [Install a package](#install-a-package)
- [Build your own copy](#build-your-own-copy)
- [Register an OAuth app](#register-an-oauth-app) — only for Gmail / Microsoft
- [Adding your account](#adding-your-account)
- [Updating and removing](#updating-and-removing)

For architecture, contributing and the deep OAuth reference, see
[DEVELOPERS.md](DEVELOPERS.md).

## Install a package

Packages exist for Linux. On **macOS** there is nothing to download — skip to
[Build your own copy](#build-your-own-copy), which is the supported route there.

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

If you only use IMAP or POP3 accounts, you are done — skip to
[Adding your account](#adding-your-account).

## Build your own copy

About 15 minutes and a terminal. No coding.

**1. Prerequisites.**

Debian / Ubuntu / Mint:

```bash
sudo apt install git nodejs npm build-essential python3
```

macOS (11 or later, Apple Silicon or Intel) — the compiler comes from Apple's
command line tools, which is a one-off download of a few hundred megabytes:

```bash
xcode-select --install
brew install node
```

Node.js 22.12 or newer is required — check with `node --version`. That floor is
Electron's own (`engines.node`), and it is the strictest in the toolchain. If your
distro ships an older Node, install a current one from
[nodejs.org](https://nodejs.org/) or via `nvm`.

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

…or build a package and install that.

On Linux:

```bash
npm run dist
sudo dpkg -i release/orbit-mail-*.deb
```

`npm run dist` builds both a `.deb` and an AppImage; `npm run dist:deb` and
`npm run dist:appimage` build one at a time.

On macOS:

```bash
npm run dist:mac
```

That writes `Orbit Mail.app` inside `release/mac-arm64/` (or `release/mac/` on an
Intel Mac) along with a `.dmg`. Drag the app into `/Applications` and open it.

The app is **ad-hoc signed** — signed just well enough that macOS will run it,
because an unsigned build is refused outright on Apple Silicon. It is not signed
with an Apple Developer ID and not notarized, so it is a copy for the machine
that built it. If you move the `.dmg` to another Mac, macOS quarantines it and
refuses to open the app; that Mac can clear the flag with:

```bash
xattr -dr com.apple.quarantine "/Applications/Orbit Mail.app"
```

Only do that for a build you made yourself. Notarized distribution needs a paid
Apple Developer account and is not something this project does.

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
  create `~/.config/orbit-mail/.env`) and paste the values in. Leave blank any
  provider you do not use.

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
npm run dist                            # Linux
sudo dpkg -i release/orbit-mail-*.deb
```

```bash
git pull
npm install
npm run dist:mac                        # macOS, then replace the app in /Applications
```

**Uninstall** the Debian package with `sudo apt remove orbit-mail`, or just
delete the AppImage. On macOS, drag `Orbit Mail.app` to the Trash.

Your mail cache, accounts and settings live in `~/.config/orbit-mail/` (on macOS,
`~/Library/Application Support/Orbit Mail/`) and are left alone by an uninstall.
Delete that directory to remove them too — it contains your cached mail,
downloaded attachments and stored credentials.
