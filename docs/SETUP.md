# MAD Blocker: complete setup guide (Windows + VS Code)

Follow these steps in order. Each step says how to check that it worked.

## 1. Install the tools (about 15 minutes)

| Tool | Where | Check in a terminal |
|---|---|---|
| Google Chrome | google.com/chrome | open `chrome://version` |
| VS Code | code.visualstudio.com | open it |
| Node.js LTS (v22 or newer) | nodejs.org | `node -v` shows v22 or higher |
| Git for Windows | git-scm.com | `git --version` |

Use the default options in each installer. Restart VS Code after installing Node and Git.

## 2. Open the project

1. Unzip `MAD-Blocker.zip` to a short folder such as `C:\Dev\MAD-Blocker`. Don't leave it inside the zip.
2. VS Code: **File > Open Folder** and choose that folder. Click **Yes, I trust the authors**.
3. Open the terminal with **Ctrl + `** (backtick).

## 3. Run the automated tests

```
npm test
```

You should see `# pass 46` and `# fail 0`. There is nothing to install: the project has **no dependencies**, which is deliberate (less code from strangers means less attack surface).

## 4. Load the extension in Chrome

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Click the puzzle-piece icon in Chrome's toolbar and **pin** MAD Blocker.

If Chrome shows an **Errors** button on the card, click it and send me the text.

After you change any code, click the circular **reload** arrow on the MAD Blocker card. After changing a content script, also reload the web page.

## 5. Check that it really blocks

1. Open `https://example.com` (it has no restrictions of its own, so the test is fair).
2. Press **F12**, open the **Console** tab, paste this and press Enter:

```js
fetch('https://pagead2.googlesyndication.com/x.js', { mode: 'no-cors' })
  .then(() => console.log('NOT blocked'))
  .catch(() => console.log('BLOCKED by MAD Blocker'))
```

Expected: `BLOCKED by MAD Blocker`. In the **Network** tab the request shows `net::ERR_BLOCKED_BY_CLIENT`.

3. Click the MAD Blocker icon, choose **Pause MAD Blocker here**, **reload the page**, and run the snippet again. Expected: `NOT blocked`. (Chrome evaluates the pause when the page loads, so the reload is required.)
4. Set it back to **Default** and confirm it is blocked again.
5. Turn the main switch off, reload, and confirm nothing is blocked. Turn it back on.

To test the pop-up settings, follow the "Pop-up behaviour" section of `docs/TESTING.md`.

Also try the **Black / White / Collapse** selector on a news site with ads. It affects only the recognized ad containers (see `src/content/page-cleanup.css`).

## 6. Put it on GitHub

1. Create a GitHub account if needed, and **turn on two-factor authentication first** (step 7).
2. On github.com click **New repository**. Name: `MAD-Blocker`. Choose **Private** for now. Do not add a README (we already have one).
3. In the VS Code terminal:

```
git config --global user.name "Sai Chintala"
git config --global user.email "338782225+Sai-Chintala12@users.noreply.github.com"
git init -b main
git add .
git commit -m "Initial commit: MAD Blocker Phase 1"
git remote add origin https://github.com/YOUR-USERNAME/MAD-Blocker.git
git push -u origin main
```

A browser window opens to sign in the first time. On GitHub, open the **Actions** tab and check that **CI** turns green.

Tip for the email: in GitHub **Settings > Emails**, tick "Keep my email addresses private" and use the `noreply` address it shows, so your real email isn't in every commit.

## 7. Lock down your accounts (do this before going public)

A stolen account is the most common way a popular extension turns malicious, so this step matters more than any code.

1. **Google account:** enable 2-Step Verification and add a **passkey** or hardware security key. Remove SMS as the only second factor if you can.
2. **GitHub account:** Settings > Password and authentication > enable 2FA with a passkey or authenticator app. Save the recovery codes offline.
3. **Repository settings** (Settings > Rules > Rulesets > New branch ruleset, target `main`):
   - Require a pull request before merging
   - Require status checks to pass (select **CI**)
   - Block force pushes and deletions
4. **Settings > Code security:** turn on **Dependabot alerts**, **Dependabot security updates**, **Secret scanning**, **Push protection**, **Code scanning (CodeQL)** and **Private vulnerability reporting**.
5. **Signed commits (recommended):**

```
ssh-keygen -t ed25519 -C "you@example.com"
git config --global gpg.format ssh
git config --global user.signingkey C:/Users/YOU/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then add the contents of `id_ed25519.pub` in GitHub Settings > SSH and GPG keys as a **Signing key**.
6. Never commit passwords, API keys or `.pem` files. `.gitignore` already blocks `.pem`, `.crx`, `.env` and zip files.

## 8. Daily workflow

```
git switch -c feature/short-name      # new branch
# edit code in VS Code
npm test                              # must pass
# reload the extension in chrome://extensions and try it
git add -A
git commit -m "Describe the change"
git push -u origin feature/short-name
# open a Pull Request on GitHub, wait for CI, then merge
```

## 9. What to do next

- Phases 2 to 6 are in `docs/PROJECT_PLAN.md`. Tell me which phase to build next.
- Before sharing with the public, read `docs/PUBLISHING.md` and `docs/SECURITY.md`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm` is not recognized | Restart VS Code (or Windows) after installing Node. |
| `Load unpacked` says the manifest is missing | You selected the wrong folder. Pick the one that directly contains `manifest.json`. |
| Popup says "MAD Blocker does not run on this page" | Normal on `chrome://` pages and the Web Store. Try an ordinary website. |
| A site looks broken | Open MAD Blocker on that site and choose **Pause MAD Blocker here**, then tell me the site so a rule can be fixed. |
| Test snippet says BLOCKED even after pausing | You forgot to reload the page after pausing. |
