# Google Sheets Setup Guide

This connects the LeadPilot backend to a Google Sheet, so leads survive server restarts.
It takes about 10–15 minutes. You only do it once.

> **What you'll create**
> 1. A **Google Cloud project**: a free container for the API settings.
> 2. A **service account**: a "robot user" with its own email address. The backend signs in as this robot, not as you.
> 3. A **key** for the robot: a password file. **Treat it like a password.**
> 4. A **spreadsheet** shared with the robot.
>
> Google sometimes renames buttons. If a label differs slightly, look for the closest match.

---

## Step 1: Create a Google Cloud project
1. Go to **https://console.cloud.google.com** and sign in with your Google account.
2. Accept the terms if asked. **You do not need to add billing** for the Sheets API.
3. At the top left, click the **project picker** (next to "Google Cloud"), then **New project**.
4. Project name: `leadpilot` → **Create**.
5. Wait a few seconds, then make sure `leadpilot` is selected in the project picker.

## Step 2: Turn on the Google Sheets API
1. Open the menu (☰) → **APIs & Services** → **Library**.
2. Search for **Google Sheets API** → click it → **Enable**.

## Step 3: Create the service account (the robot)
1. Menu (☰) → **IAM & Admin** → **Service Accounts** → **+ Create service account**.
2. Name: `leadpilot-sheets`. Description (optional): `Backend access to the LeadPilot spreadsheet` → **Create and continue**.
3. **Permissions / roles: leave empty → Continue → Done.**
   *Why:* the robot needs no access to your Google Cloud project. It only gets access to ONE spreadsheet, which you share with it in step 5. This is the **principle of least privilege**: give only the access that is needed.
4. You'll see the new account's email, something like
   `leadpilot-sheets@leadpilot-123456.iam.gserviceaccount.com`. You'll need it in step 5.

## Step 4: Create the key
1. Click the service account → **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**.
2. A `.json` file downloads. **This is the robot's password.**
3. Move it **outside** the project folder, e.g. `C:\Users\<you>\Documents\secrets\leadpilot-key.json`.
   - Never put it in the project, email it, upload it, or paste it into a chat.
   - The project's `.gitignore` also blocks common key file names, as a safety net.

> **"Key creation is disabled" / "iam.disableServiceAccountKeyCreation"?**
> Some Google accounts belong to an organisation that blocks keys. Use a personal Gmail account
> for this project, or ask the organisation's admin.

## Step 5: Create the spreadsheet and share it with the robot
1. Go to **https://sheets.new** (creates a blank spreadsheet).
2. Rename it (top left): `LeadPilot Data`.
3. Click **Share** (top right).
4. Paste the **service account email** from step 3 → role **Editor**.
5. Untick **Notify people** (the robot can't read email) → **Share**.
6. Keep the sheet private: don't change "General access" to "Anyone with the link". **It will contain customer personal data.**

## Step 6: Copy the spreadsheet ID
The ID is the long part of the URL between `/d/` and `/edit`:
```
https://docs.google.com/spreadsheets/d/1AbCdEf...XyZ/edit#gid=0
                                       └── this ──┘
```
(Pasting the whole URL also works: the backend extracts the ID.)

## Step 7: Fill in `backend/.env`
In PowerShell (this copies the template to a new `.env` file):
```powershell
cd "C:\Users\GibTek\Desktop\lead management\backend"
Copy-Item .env.example .env
notepad .env
```
Open the downloaded JSON key file in a **second** Notepad window, and fill in `.env`:

| `.env` setting | Where to find it |
|---|---|
| `DATA_STORE` | Change `memory` to `sheets` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Step 6 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The JSON file's `"client_email"` value |
| `GOOGLE_PRIVATE_KEY` | The JSON file's `"private_key"` value: see below |

**The private key:** in the JSON file it looks like
`"private_key": "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n",`

Copy everything **from the first `"` after the colon to the closing `"`** (including both quotes), and paste it after `GOOGLE_PRIVATE_KEY=`:
```
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```
Keep it on **one line** and leave the `\n` as they are. Save `.env`.

`.env` is ignored by Git and will never be committed.

## Step 8: Check the connection
```powershell
npm run sheets:check
```
It only reads, and never changes anything. Each problem comes with a **Fix:** line:

| You see | Meaning | Fix |
|---|---|---|
| `... is missing` / `does not look like ...` | A setting in `.env` is empty or wrong | Re-copy that value (step 7) |
| `Google rejected the service account credentials` | Email/key are wrong, or don't belong together | Re-copy `client_email` and `private_key` from the SAME JSON file |
| `Google Sheets API is not enabled` | Step 2 was skipped, or it was enabled in another project | Enable it in the `leadpilot` project, wait a minute |
| `no access to this spreadsheet` | The sheet isn't shared with the robot | Step 5: share with the service account email as Editor |
| `Spreadsheet not found` | Wrong ID | Step 6 |
| `Tab "Leads" is missing` | Expected on a new sheet | Go to step 9 |

## Step 9: Create the tabs
```powershell
npm run sheets:setup            # creates the tabs Leads, Activity, WorkflowRuns with header rows
npm run sheets:setup -- --seed  # ...and also adds the 10 SIMULATED sample leads (optional)
```
- It **never deletes or overwrites** anything. It's safe to run more than once.
- A tab with a different header is left alone and reported (it might hold real data).
- `--seed` only fills tabs that are still empty. Sample data is fictional (555-01xx numbers, example.com emails).
- You can delete the empty default tab "Sheet1" if you like.

Then run `npm run sheets:check` again. It should say **All checks passed**.

## Step 10: Start the app
```powershell
npm run dev
```
You should see `store: sheets` and `Google Sheets connection OK`. Start the frontend as usual, create a lead, and watch it appear in the spreadsheet.

---

## Security checklist
- [ ] The JSON key file is **outside** the project folder.
- [ ] `git status` does **not** list `.env` or any `.json` key file.
- [ ] The spreadsheet is shared only with you and the service account.
- [ ] The service account has **no** project roles.

**If the key ever leaks** (committed, shared, pasted somewhere): Google Cloud → IAM & Admin → Service Accounts → the account → **Keys** → delete that key, create a new one, and update `.env`. The old key stops working immediately.

## Switching back to sample data
Set `DATA_STORE=memory` in `.env` (or remove the line) and restart. The spreadsheet is left untouched.

## Good to know
- **Hand edits** to the sheet show up in the app within ~10 seconds (the read cache).
- **Rows broken by hand** (e.g. text in the `score` column) are skipped with a warning in the server log. `npm run sheets:check` lists them.
- **Don't rename tabs or header names.** You can reorder columns or add extra columns (e.g. `notes`).
- **Limits:** Google allows about 60 reads and 60 writes per minute. The cache keeps normal use well below that.
