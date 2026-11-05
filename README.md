# Money Mate

A student-first money tracker for pocket money and monthly spending: account login, income and expense entries, daily safe-to-spend guidance, category limits with 80% alerts, savings goals, interactive charts, CSV reports, and browser sharing.

## Run locally

```bash
cd money-mate
npm install
npm start
```

Open `http://localhost:3000`, create an account, and begin by adding income such as a monthly allowance.

## Deploy on Render

1. Create a new GitHub repository and upload the complete `money-mate` folder.
2. In Render, choose **New +** then **Blueprint**. Connect the GitHub repository and select it. Render reads `render.yaml` automatically.
3. Deploy. The app uses `npm ci` to build and `npm start` to run. Render supplies the required `PORT` automatically.
4. Render generates `SESSION_SECRET`. For an existing Web Service instead of Blueprint, add it yourself under **Environment** as a long, random value and set `NODE_ENV=production`.
5. **Important for real use:** this first version stores data in a JSON file. Free Render instances have an ephemeral filesystem, so data can be erased when the service restarts or is redeployed. To keep data, use a paid Render persistent disk mounted at `/var/data`, then set `DATA_PATH=/var/data/db.json` in Environment. For a larger multi-user launch, migrate to Render Postgres.

## Use it

- **Add entry:** choose *Received* for allowance, gifts, or refunds, and *Spent* for expenses.
- **Daily amount:** your current balance divided by the remaining days in the calendar month.
- **Limits:** a yellow warning begins at 80% of a category budget, red at 100%.
- **Report:** choose a month on Activity and download a CSV. The Share button uses your phone's share sheet or copies a short summary for sending to parents.

## Security note

Passwords are hashed with bcrypt before storage. Do not use the default local session secret in production. The included Render configuration automatically creates a secret.
