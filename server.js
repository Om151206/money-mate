require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const { pool, initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') app.set('trust proxy', true);

function id() { return crypto.randomUUID(); }
function roundMoney(value) { return Math.round(value * 100) / 100; }
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function isValidMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12;
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}
function transactionFromRow(row) {
  return { id: row.id, userId: row.userId, type: row.type, amount: Number(row.amount), category: row.category, note: row.note, date: row.date };
}
function budgetFromRow(row) {
  return { id: row.id, userId: row.userId, category: row.category, limit: Number(row.limit) };
}
function goalFromRow(row) {
  return { id: row.id, userId: row.userId, name: row.name, target: Number(row.target), saved: Number(row.saved) };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-production',
  resave: false,
  saveUninitialized: false,
  proxy: process.env.NODE_ENV === 'production',
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.includes('@') || !password || password.length < 6) {
    return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 6 characters.' });
  }

  const user = { id: id(), name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 12) };
  try {
    await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [user.id, user.name, user.email, user.passwordHash]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email is already registered.' });
    throw error;
  }
  req.session.userId = user.id;
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await pool.execute('SELECT id, name, email, password_hash AS passwordHash FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.userId = user.id;
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', requireAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, email FROM users WHERE id = ?', [req.session.userId]);
  const user = rows[0];
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  res.json({ user });
});

app.get('/api/data', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const [transactions, budgets, goals] = await Promise.all([
    pool.execute(`SELECT id, user_id AS userId, type, amount, category, note, DATE_FORMAT(transaction_date, '%Y-%m-%d') AS date FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC, created_at DESC`, [userId]),
    pool.execute('SELECT id, user_id AS userId, category, budget_limit AS \`limit\` FROM budgets WHERE user_id = ? ORDER BY category', [userId]),
    pool.execute('SELECT id, user_id AS userId, name, target_amount AS target, saved_amount AS saved FROM goals WHERE user_id = ? ORDER BY created_at DESC', [userId]),
  ]);
  res.json({ transactions: transactions[0].map(transactionFromRow), budgets: budgets[0].map(budgetFromRow), goals: goals[0].map(goalFromRow) });
});

app.post('/api/transactions', requireAuth, async (req, res) => {
  const { type, amount, category, note, date } = req.body;
  const value = Number(amount);
  if (!['income', 'expense'].includes(type) || !Number.isFinite(value) || value <= 0 || value > 1000000000 || !category?.trim() || !isValidDate(date)) return res.status(400).json({ error: 'Fill in a valid transaction.' });
  const transaction = { id: id(), userId: req.session.userId, type, amount: roundMoney(value), category: category.trim(), note: String(note || '').trim(), date };
  await pool.execute('INSERT INTO transactions (id, user_id, type, amount, category, note, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?)', [transaction.id, transaction.userId, transaction.type, transaction.amount, transaction.category, transaction.note, transaction.date]);
  res.status(201).json(transaction);
});

app.delete('/api/transactions/:id', requireAuth, async (req, res) => {
  const [result] = await pool.execute('DELETE FROM transactions WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Transaction not found.' });
  res.json({ ok: true });
});

app.post('/api/budgets', requireAuth, async (req, res) => {
  const { category, limit } = req.body;
  const value = Number(limit);
  if (!category?.trim() || !Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Enter a category and a positive monthly limit.' });
  await pool.execute(
    'INSERT INTO budgets (id, user_id, category, budget_limit) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE category = VALUES(category), budget_limit = VALUES(budget_limit)',
    [id(), req.session.userId, category.trim(), roundMoney(value)],
  );
  res.json({ ok: true });
});

app.delete('/api/budgets/:id', requireAuth, async (req, res) => {
  await pool.execute('DELETE FROM budgets WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.post('/api/goals', requireAuth, async (req, res) => {
  const { name, target, saved } = req.body;
  const targetValue = Number(target);
  const savedValue = Number(saved || 0);
  if (!name?.trim() || !Number.isFinite(targetValue) || targetValue <= 0 || !Number.isFinite(savedValue) || savedValue < 0) return res.status(400).json({ error: 'Enter a goal and valid amounts.' });
  await pool.execute('INSERT INTO goals (id, user_id, name, target_amount, saved_amount) VALUES (?, ?, ?, ?, ?)', [id(), req.session.userId, name.trim(), roundMoney(targetValue), roundMoney(savedValue)]);
  res.status(201).json({ ok: true });
});

app.patch('/api/goals/:id', requireAuth, async (req, res) => {
  const saved = Number(req.body.saved);
  if (!Number.isFinite(saved) || saved < 0) return res.status(400).json({ error: 'Enter a valid saved amount.' });
  const [result] = await pool.execute('UPDATE goals SET saved_amount = ? WHERE id = ? AND user_id = ?', [roundMoney(saved), req.params.id, req.session.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Goal not found.' });
  const [rows] = await pool.execute('SELECT id, user_id AS userId, name, target_amount AS target, saved_amount AS saved FROM goals WHERE id = ?', [req.params.id]);
  res.json(goalFromRow(rows[0]));
});

app.delete('/api/goals/:id', requireAuth, async (req, res) => {
  await pool.execute('DELETE FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.get('/api/export/:month', requireAuth, async (req, res) => {
  if (!isValidMonth(req.params.month)) return res.status(400).json({ error: 'Invalid month.' });
  const [rows] = await pool.execute(`SELECT type, amount, category, note, DATE_FORMAT(transaction_date, '%Y-%m-%d') AS date FROM transactions WHERE user_id = ? AND transaction_date >= ? AND transaction_date < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY transaction_date`, [req.session.userId, `${req.params.month}-01`, `${req.params.month}-01`]);
  const csv = ['Date,Type,Category,Note,Amount', ...rows.map((item) => [item.date, item.type, item.category, item.note, item.amount].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="money-mate-${req.params.month}.csv"`);
  res.send(csv);
});

app.get('*splat', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _, res, __) => {
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  await initializeDatabase();
  app.listen(PORT, () => console.log(`Money Mate running on port ${PORT} with MySQL storage`));
}

start().catch((error) => {
  console.error('Money Mate could not connect to MySQL:', error.message);
  process.exit(1);
});
