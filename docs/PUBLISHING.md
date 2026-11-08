# Sharing and publishing

## Option A: friends, without the store (free)

1. Push the repo to GitHub (private repos need you to add friends as collaborators, or make it public).
2. Friends download the ZIP (**Code > Download ZIP**), unzip, and use `chrome://extensions` > Developer mode > **Load unpacked**.
3. Chrome shows a developer-mode warning. It works, but updates are manual.

## Option B: Chrome Web Store (recommended for public use)

Check Google's current rules and fees on the Developer Dashboard before starting. At the time of writing there is a one-time registration fee (about $5) and 2-Step Verification is required on the account.

### Prepare

1. Finish and run the **release checklist** in `docs/SECURITY.md`.
2. Bump `version` in `manifest.json` and `package.json`.
3. Build the package with `npm run package`. It writes `dist/MAD-Blocker-v<version>.zip` with only `manifest.json`, `rules/`, `src/` and `icons/`, and `manifest.json` at the top. It refuses to build if the two version numbers differ, if a file the manifest needs is missing, or if personal information is found in the project files. (Do not use `tar -a` in Git Bash: its `tar` cannot make zip files.)
4. Run `npm run check:privacy` too. It also checks your Git history, which the package step does not.
5. Test the zip: unzip it into a new folder and **Load unpacked** it.

### Host the privacy policy

The store needs a public URL. Easiest: make the repo public (or use GitHub Pages) and link to `docs/PRIVACY.md`.

### Submit

1. Open the Chrome Web Store Developer Dashboard, **Add new item**, upload `MAD-Blocker.zip`.
2. **Store listing:** short description, detailed description, category (Productivity), screenshots (1280x800 recommended), and a small icon. Describe only what it really does.
3. **Privacy tab:**
   - Single purpose: "Block advertisements and trackers while browsing."
   - Permission reasons: copy the table at the end of `docs/SECURITY.md`. It includes the optional pop-up permission.
   - Data usage: declare that no user data is collected.
   - Privacy policy URL: your hosted `PRIVACY.md`.
4. **Distribution:** choose **Unlisted** first (only people with the link can install), then switch to **Public** once you are comfortable.
5. Submit for review. Reviews often take a few days. More if there is anything unusual.

### Listing rules of thumb

- Expect the install warning "Read and change all your data on all websites". Explain it in the privacy tab: "Needed to hide advertising elements on every page the user visits. No page content is read or sent." The extra YouTube script needs its own sentence: "Skips advertisements in the YouTube player."
- Keep it single-purpose: ads and trackers only. No unrelated features.
- Don't promise more than you deliver: say "helps reduce ads", never "blocks all ads", and don't claim YouTube blocking works permanently.
- Don't mention piracy, or name movie or anime streaming sites, in the listing or screenshots.
- Check that the name "MAD Blocker" isn't already taken or confusingly close to another product.
- If you bundle third-party filter lists (like EasyList), follow their licenses and credit them.

### Updating

Make the change in a branch, pass CI, merge, bump the version, build the zip, upload as a new version. Review every change to `manifest.json` and `rules/` first.

## Public-release readiness

Before going Public: README with screenshots, working CI, 2FA everywhere, an issue template, a way to report broken sites, and a plan for the weekly maintenance that ad blocking requires.
