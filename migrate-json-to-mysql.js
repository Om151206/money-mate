require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool, initializeDatabase } = require('./db');

const sourcePath = process.env.LEGACY_DATA_PATH || path.join(__dirname, 'data', 'db.json');

async function migrate() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`No legacy JSON data found at ${sourcePath}`);
  }

  const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const connection = await pool.getConnection();
  try {
    await initializeDatabase();
    await connection.beginTransaction();

    for (const user of data.users || []) {
      await connection.execute(
        'INSERT IGNORE INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [user.id, user.name, user.email, user.passwordHash, user.createdAt || new Date()],
      );
    }
    for (const transaction of data.transactions || []) {
      await connection.execute(
        'INSERT IGNORE INTO transactions (id, user_id, type, amount, category, note, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [transaction.id, transaction.userId, transaction.type, transaction.amount, transaction.category, transaction.note || '', transaction.date],
      );
    }
    for (const budget of data.budgets || []) {
      await connection.execute(
        'INSERT INTO budgets (id, user_id, category, budget_limit) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE budget_limit = VALUES(budget_limit)',
        [budget.id, budget.userId, budget.category, budget.limit],
      );
    }
    for (const goal of data.goals || []) {
      await connection.execute(
        'INSERT IGNORE INTO goals (id, user_id, name, target_amount, saved_amount) VALUES (?, ?, ?, ?, ?)',
        [goal.id, goal.userId, goal.name, goal.target, goal.saved],
      );
    }

    await connection.commit();
    console.log(`Migrated ${data.users?.length || 0} users, ${data.transactions?.length || 0} transactions, ${data.budgets?.length || 0} budgets, and ${data.goals?.length || 0} goals from ${sourcePath}.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('JSON migration failed:', error.message);
  process.exit(1);
});
