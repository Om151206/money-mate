# Money Mate

A student-first money tracker for pocket money and monthly spending: account login, income and expense entries, daily safe-to-spend guidance, category limits with 80% alerts, savings goals, interactive charts, CSV reports, and browser sharing.

## Run locally with MySQL

1. Install and start MySQL 8.0 or newer, then create a database and an app user:

   ```sql
   CREATE DATABASE money_mate CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'money_mate'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
   GRANT ALL PRIVILEGES ON money_mate.* TO 'money_mate'@'localhost';
   ```

2. Copy `.env.example` to `.env`, then enter the database credentials and a long random `SESSION_SECRET`. You can alternatively set `DATABASE_URL`.
3. Load the environment variables in your shell, then run the app:

   ```bash
   npm install
   npm start
   ```

   On Windows PowerShell, you can set the required variables for the current terminal like this:

   ```powershell
   $env:DB_HOST = '127.0.0.1'
   $env:DB_USER = 'money_mate'
   $env:DB_PASSWORD = 'choose-a-strong-password'
   $env:DB_NAME = 'money_mate'
   $env:SESSION_SECRET = 'a-long-random-secret'
   npm start
   ```

Open `http://localhost:3000`, create an account, and begin by adding income such as a monthly allowance. On its first successful connection, Money Mate automatically creates its `users`, `transactions`, `budgets`, and `goals` tables.

### Keep existing JSON data

If this app already has data in `data/db.json`, configure MySQL first, then run the one-time, repeat-safe migration before starting the app:

```bash
npm run migrate:json
```

The source JSON file is not deleted. To migrate a file stored elsewhere, set `LEGACY_DATA_PATH` to its path.

## Deploy on Render

1. Create a new GitHub repository and upload the complete `money-mate` folder.
2. In Render, choose **New +** then **Blueprint**. Connect the GitHub repository and select it. Render reads `render.yaml` automatically.
3. Deploy. The app uses `npm ci` to build and `npm start` to run. Render supplies the required `PORT` automatically.
4. Add one of the following database configurations under the service's environment variables:
   - `DATABASE_URL` with your managed MySQL connection URL, or
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
5. If the provider requires TLS, set `MYSQL_SSL=true`. Render generates `SESSION_SECRET`; set a long random value when deploying without the Blueprint.

## Use it

- **Add entry:** choose *Received* for allowance, gifts, or refunds, and *Spent* for expenses.
- **Daily amount:** your current balance divided by the remaining days in the calendar month.
- **Limits:** a yellow warning begins at 80% of a category budget, red at 100%.
- **Report:** choose a month on Activity and download a CSV. The Share button uses your phone's share sheet or copies a short summary for sending to parents.

## Security note

Passwords are hashed with bcrypt before storage. Database queries use prepared statements and all financial records are scoped to the signed-in user. Never commit `.env` or a production database URL.
