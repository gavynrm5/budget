# Pay Period Budget

A personal budget app that runs on pay periods (the 15th through the 14th) instead of calendar months. It replaces a spreadsheet, works on a phone and a computer, syncs between them, works offline, and costs $0 to run.

- **Frontend:** React, TypeScript, Vite, Tailwind CSS. Built as a static site.
- **Hosting:** Cloudflare Pages or GitHub Pages (both free).
- **Data and sign-in:** Firebase on the free Spark plan. Google sign-in plus Cloud Firestore with offline persistence.
- **Installable:** PWA, so it can live on your phone's home screen and open like an app.

Only one person (you) can ever read or write the data. That is enforced by the Firestore security rules, not by the app.

---

## What you need

- A Google account (for Firebase and for signing in to the app).
- A GitHub account (free), to store the code and deploy it.
- **Node.js 20 or newer** on your computer. Download the "LTS" installer from https://nodejs.org. To check it worked, open a terminal (Terminal on Mac, PowerShell on Windows) and run `node -v`.
- **Git.** Mac: run `git --version` and accept the prompt to install. Windows: https://git-scm.com.

No credit card is needed anywhere in these steps.

---

## Step 1. Create the Firebase project

1. Go to https://console.firebase.google.com and click **Create a project** (or **Add project**).
2. Name it something like `my-budget`. Google Analytics is not needed, so you can turn it off. Click **Create project**.
3. The project starts on the free **Spark** plan. Leave it there. Do not upgrade to Blaze.
4. On the project home page, click the **Web** icon (`</>`) to add a web app. Give it a nickname like `budget-web`. Leave "Firebase Hosting" unchecked. Click **Register app**.
5. Firebase shows a code snippet containing `const firebaseConfig = { ... }`. Keep this tab open for Step 3.

## Step 2. Turn on Google sign-in and Firestore

**Google sign-in**

1. In the left menu, open **Build > Authentication** and click **Get started**.
2. On the **Sign-in method** tab, click **Google**, switch it to **Enable**, pick your email as the support email, and click **Save**.

**Firestore database**

1. In the left menu, open **Build > Firestore Database** and click **Create database**.
2. Pick a location close to you (for example `nam5 (United States)`). This cannot be changed later.
3. Choose **Start in production mode**. This locks everything down until you add your rules in Step 4. Click **Create**.

## Step 3. Paste your Firebase config

Open `src/config/firebase.ts` in any text editor (VS Code is a good free one). It looks like this:

```ts
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};
```

Replace each value with the matching value from the snippet Firebase showed you. Keep the quotes. Save the file.

Lost the snippet? Firebase console > gear icon > **Project settings** > **General** > scroll to **Your apps** > **SDK setup and configuration** > **Config**.

These values are not secrets. Anyone who opens your site can see them, which is normal for Firebase. Your data is protected by the security rules in the next step.

## Step 4. Run it locally and lock the database to your account

In a terminal, go into the project folder and run:

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) and click **Sign in with Google**.

Because the database is still fully locked, the app shows a screen titled **"This account cannot read the data yet"** along with your **user ID**. Copy it with the copy button. (You can also find it in Firebase console > **Authentication** > **Users**, in the **User UID** column.)

Now set the rules:

1. Open `firestore.rules` from this project.
2. Replace `PASTE_YOUR_UID_HERE` with your user ID. Keep the quotes. It should look like `userId == "a1B2c3D4e5..."`.
3. In Firebase console, open **Firestore Database > Rules**, delete everything in the editor, paste in the whole file, and click **Publish**.
4. Back in the app, click **I updated the rules, reload**.

The app now loads with your settings, categories, and fixed expenses already seeded. Any other Google account that signs in sees the locked screen and cannot read or write anything.

Tip: your user ID is always available later in the app under **Settings > Account**.

## Step 5. Put the code on GitHub

1. On https://github.com, click **New repository**. Name it (for example `budget`). **Private** is fine for Cloudflare Pages. For free GitHub Pages hosting the repository must be **Public** (the Firebase config is safe to be public). Do not add a README; click **Create repository**.
2. In your terminal, inside the project folder:

```bash
git init
git add .
git commit -m "First version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/budget.git
git push -u origin main
```

## Step 6. Deploy (pick one)

The build uses relative paths and hash URLs (like `/#/budget`), so the same build works on either host with no changes.

### Option A: Cloudflare Pages (recommended, works with a private repo)

1. Sign up free at https://dash.cloudflare.com.
2. Go to **Workers & Pages** > **Create** > choose the **Pages** option > **Connect to Git**, and pick your repository.
3. Build settings:
   - Framework preset: **None** (or Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Under environment variables, add `NODE_VERSION` = `20`
4. Click **Save and Deploy**. After a minute you get an address like `https://budget-abc.pages.dev`.

Every `git push` redeploys automatically.

### Option B: GitHub Pages

1. In your repository on GitHub: **Settings > Pages > Build and deployment > Source**, choose **GitHub Actions**.
2. The included workflow (`.github/workflows/deploy.yml`) runs on every push to `main`. Push any change, or open the **Actions** tab and run "Deploy to GitHub Pages" by hand.
3. Your site will be at `https://YOUR-USERNAME.github.io/budget/`.

### After deploying: authorize the domain (required)

Google sign-in only works on domains you approve.

Firebase console > **Authentication** > **Settings** > **Authorized domains** > **Add domain**, then add your site's domain only, without `https://` or a path:

- Cloudflare: `budget-abc.pages.dev`
- GitHub Pages: `YOUR-USERNAME.github.io`

`localhost` is already on the list, which is why Step 4 worked.

## Step 7. Install it on your phone

Open your site's address on the phone and sign in.

- **iPhone (Safari):** tap the **Share** button > **Add to Home Screen**.
- **Android (Chrome):** tap the **⋮** menu > **Install app** (or **Add to Home screen**).

It opens full screen like a native app. On iPhone, the home screen app keeps its own sign-in, separate from Safari, so you will sign in once more inside it.

---

## Bringing over your spreadsheet

1. In your spreadsheet, make a sheet with exactly these columns: `Date, Amount, Category, Sub-Category, Description, Notes`.
   - **Date:** `2026-03-16` or `3/16/2026`
   - **Amount:** a number, or simple math like `29.76+5.83`
   - **Category:** `Essentials`, `Wants`, or `Savings` (`Savings & Debt` also works)
   - **Sub-Category:** matched by name. Unknown names become new sub-categories under that category.
2. Export it as CSV (File > Download > CSV in Google Sheets, or Save As > CSV in Excel).
3. In the app: **Settings > Backup and import > Import transactions CSV**. You get a preview with any problem rows listed before anything is saved.

`sample-transactions.csv` in this project shows the format, and **Settings > CSV template** downloads the same thing.

Budget amounts per period are not part of the CSV. Set them on the **Period Budget** screen for your first period. Each new period copies the one before it.

## Accounts and cards

The **Accounts** page tracks your bank accounts and credit cards by nickname only (like "Local" or "Main"). Never put account or card numbers in the app.

- **Set balance:** type the real balance from your bank or card app. After that, balances update on their own. Spending with **Paid with** set lowers a bank account or raises what a card owes, extra income adds to the account it went into, and transfers move money between two accounts. Entries logged later but dated before the day you set the balance are ignored, because the bank already counted them.
- **Transfers and card payments:** use **Transfer** or **Pay card**. They change both balances and never count as spending.
- **Cards:** add a credit limit to see how much of it you're using (under 30% is the usual goal) and a due day to get a reminder on the Dashboard the week it's due.
- **Add account** adds a new card or bank account. An account with entries can be archived but not deleted, so its history stays.

## Wishlist lists and goals

The **Wishlist** holds lists (folders), each with its own savings goal, like Furniture or a trip.

- **New list:** name it, and optionally set a goal amount (blank uses the total of its items), a target date, and how much is already saved. **Track in my budget** adds a "<list> fund" line under Savings. Whatever you log to that line counts toward the goal, and the line shows the goal's progress.
- **Dropdowns:** each list has its own, like Room or Style. Add them in **Edit list**, or type a new choice while adding an item and it's saved to the dropdown.
- **Items:** name, price, quantity, a link to the store, and a photo. **Upload photo** shrinks it (to about 900px wide) and stores it with your data for free. You can also paste an image link that starts with https. Check **Bought** when you buy it, and use the arrows to put the most important items first.
- With a target date, the list shows how much to save each pay period to get there.

Items from before lists existed were moved into a list called Furniture, with their categories, rooms and status as its dropdowns.

## Extra income

Money outside your paycheck, like a birthday gift or gambling winnings, goes under **Extra income** on the Period Budget. After adding it, **Assign** it: lines that are over budget are listed first with a one-tap **Cover**, and any amount can go into any sub-category. Assigned money raises what's available on that line for that pay period without changing your planned budget. Anything not assigned stays in that period to assign later.

## Tracking your stocks

The **Portfolio** page (under **More** on a phone) tracks stocks and ETFs with live and past prices from [Twelve Data](https://twelvedata.com)'s free plan.

1. Create a free account at https://twelvedata.com/register and copy your API key from the Twelve Data dashboard.
2. Open **Portfolio**, tap **Add API key**, and paste it. It is saved with the rest of your data, so only you can read it.
3. Tap **Add trade** for each order in your brokerage history: bought or sold, the date, the number of shares, and the price per share. In Robinhood these are under **Account > History**. Buying more of a stock you own is just another buy.

What you get:

- **Summary:** market value, gain or loss on what you hold, today's change, the amount invested, and gains locked in by sales.
- **Value over time:** your portfolio's value on every trading day since your first buy, against the amount invested, with each buy and sale marked.
- **A page per stock:** tap a stock for its price history (up to 5 years) with your trades marked, a chart of what your own shares were worth, and its list of trades.
- **Sold positions** and an **activity** list of every trade, with edit and delete.

Gains use the average cost method, the same one Robinhood shows. A sale can't sell more shares than you owned on that date. Prices can be delayed and are for tracking only.

The free plan allows 8 price requests a minute and 800 a day. Each stock uses about two a day, because prices are saved on the device: live quotes for a minute and past prices for the day. If the per-minute limit is reached, the page waits a minute and loads the rest by itself.

## Backups

Everything already lives in Firestore, but you can keep your own copies:

- **Settings > Full backup (JSON)** saves everything: settings and accounts, every period budget, transactions, transfers, extra income, wishlist lists and items, planning lines, and your portfolio.
- **Restore JSON backup** replaces all current data with a backup (it asks first).
- Transactions and wishlist can also be exported as CSV to open in a spreadsheet.

---

## Will it really stay free?

Yes, for one person. The Spark plan gives 50,000 document reads and 20,000 writes per day, plus 1 GiB of storage, with no billing account attached, so Firebase cannot charge you. Even years of transactions are a few thousand small documents. The app reads from its offline cache first and only downloads changes, so normal daily use stays far below the limits. Cloudflare Pages and GitHub Pages are free for a static site like this.

## Offline use

Firestore offline persistence is on. After you have signed in once while online:

- The app opens and shows your data with no signal.
- New or edited entries save to the phone immediately and the header shows **"Offline, saved on this device."**
- When the connection returns, changes upload on their own and the header briefly shows **Syncing**.

## Updating the app

Edit the code, then `git add .`, `git commit -m "what changed"`, `git push`. Your host rebuilds automatically. Installed copies pick up the new version the next time they are opened (close and reopen once if you do not see it).

---

## Troubleshooting

| What you see | Fix |
| --- | --- |
| "Almost there: connect Firebase" | `src/config/firebase.ts` still has `PASTE_` values. Do Step 3. |
| "This web address is not on the Firebase authorized domains list" | Do "After deploying: authorize the domain" above. |
| "This account cannot read the data yet" | Your UID is not in the published rules, or you signed in with a different Google account. Check Step 4. |
| Google sign-in window opens and nothing happens on iPhone home screen app | Close the app fully and try again. If it keeps failing, confirm the domain is authorized, then remove and re-add the home screen icon. |
| "Could not save to the cloud" toast | Usually the rules were changed. Reload; the app shows the locked screen if access is denied. |
| Changes on one device not showing on the other | Make sure both are online and signed in with the same Google account. Pull down or reopen the app. |

---

## How the numbers work

These match the original spreadsheet exactly (see `src/lib/calc.ts`; tests in `src/lib/__tests__/calc.test.ts`, run with `npm test`).

- **Periods:** the 15th of one month through the 14th of the next, named for the starting month. A transaction's period comes from its date unless you set it by hand.
- **Income** = take-home + other income.
- **Line item:** Target % = budgeted / income. Spent = that period's transactions for that sub-category. Remaining = budgeted - spent. % Used = spent / budgeted, shown as "-" when budgeted is $0.
- **Group (Essentials, Wants, Savings):** Budgeted = sum of the group's lines. Spent = that period's transactions whose **category** is the group (summed by category, not sub-category, just like the sheet). Target $ = income x the group's target %.
- **Totals:** Unallocated (slack) = income - total budgeted, red when negative. Dashboard "Left from Income" = income - total spent.
- **Status:** over 100% used is Over Budget, over 85% is Near Limit, otherwise On Track.
- Money is rounded to cents, and totals are summed in whole cents so they never drift.

## Where things are

```
src/
  config/firebase.ts      <- paste your Firebase config here
  lib/                    <- periods, calculations, math parser, CSV, Firebase setup
  store/data.tsx          <- live sync with Firestore, all saves and deletes
  store/ui.tsx            <- toasts, confirm + undo, add-transaction sheet
  components/             <- layout, navigation, sheets, charts, shared pieces
  pages/                  <- Dashboard, Period Budget, Annual, Wishlist, Portfolio, Planning, Settings
firestore.rules           <- paste your UID, then publish in the Firebase console
.github/workflows/        <- GitHub Pages deploy
public/icons/             <- app icons for the home screen
```

Firestore layout, all under `users/{your uid}/`:

- `meta/settings` holds income, targets, fixed expenses, sub-categories, wishlist options, and accounts
- `meta/planning` holds the planning scratchpad lines
- `periods/{YYYY-MM}` holds that period's budget lines
- `transactions/{id}` and `wishlist/{id}` hold one document each
- `trades/{id}` holds one buy or sale each
- `wishLists/{id}` holds one wishlist folder with its goal and dropdowns; each `wishlist/{id}` item points to its list
- `transfers/{id}` holds one transfer between accounts, and `extraIncome/{id}` one extra income entry with where it was assigned
- Accounts and cards live in `meta/settings` with their nickname, last set balance, limit, and due day

## Handy commands

```bash
npm run dev       # run locally with live reload
npm test          # run the calculation tests
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

Keyboard shortcut on desktop: press **N** anywhere to add a transaction.
