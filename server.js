const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const dataPath = process.env.DATA_PATH || path.join(__dirname, 'data', 'db.json');

if (process.env.NODE_ENV === 'production') app.set('trust proxy', true);

function readDb() {
  try { return JSON.parse(fs.readFileSync(dataPath, 'utf8')); }
  catch { return { users: [], transactions: [], budgets: [], goals: [] }; }
}
function writeDb(db) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  const temporaryPath = `${dataPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(db, null, 2));
  fs.renameSync(temporaryPath, dataPath);
}
function id() { return crypto.randomUUID(); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
function roundMoney(value) { return Math.round(value * 100) / 100; }
function categoryKey(category) { return category.trim().toLocaleLowerCase(); }
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
function own(items, userId) { return items.filter((item) => item.userId === userId); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-before-production',
  resave: false,
  saveUninitialized: false,
  proxy: process.env.NODE_ENV === 'production',
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 }
}));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.includes('@') || !password || password.length < 6) {
    return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 6 characters.' });
  }
  const db = readDb();
  if (db.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'That email is already registered.' });
  const user = { id: id(), name: name.trim(), email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  db.users.push(user); writeDb(db); req.session.userId = user.id;
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
});
app.post('/api/auth/login', async (req, res) => {
  const db = readDb(); const user = db.users.find((item) => item.email === String(req.body.email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.userId = user.id; res.json({ user: { id: user.id, name: user.name, email: user.email } });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireAuth, (req, res) => {
  const user = readDb().users.find((item) => item.id === req.session.userId);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/data', requireAuth, (req, res) => {
  const db = readDb();
  res.json({ transactions: own(db.transactions, req.session.userId), budgets: own(db.budgets, req.session.userId), goals: own(db.goals, req.session.userId) });
});
app.post('/api/transactions', requireAuth, (req, res) => {
  const { type, amount, category, note, date } = req.body;
  const value = Number(amount);
  if (!['income', 'expense'].includes(type) || !Number.isFinite(value) || value <= 0 || value > 1000000000 || !category?.trim() || !isValidDate(date)) return res.status(400).json({ error: 'Fill in a valid transaction.' });
  const db = readDb(); const transaction = { id: id(), userId: req.session.userId, type, amount: roundMoney(value), category: category.trim(), note: String(note || '').trim(), date };
  db.transactions.push(transaction); writeDb(db); res.status(201).json(transaction);
});
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const db = readDb(); const item = db.transactions.find((transaction) => transaction.id === req.params.id && transaction.userId === req.session.userId);
  if (!item) return res.status(404).json({ error: 'Transaction not found.' });
  db.transactions = db.transactions.filter((transaction) => transaction.id !== item.id); writeDb(db); res.json({ ok: true });
});
app.post('/api/budgets', requireAuth, (req, res) => {
  const { category, limit } = req.body; const value = Number(limit);
  if (!category?.trim() || !Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Enter a category and a positive monthly limit.' });
  const db = readDb(); const existing = db.budgets.find((budget) => budget.userId === req.session.userId && categoryKey(budget.category) === categoryKey(category));
  if (existing) existing.limit = roundMoney(value);
  else db.budgets.push({ id: id(), userId: req.session.userId, category: category.trim(), limit: roundMoney(value) });
  writeDb(db); res.json({ ok: true });
});
app.delete('/api/budgets/:id', requireAuth, (req, res) => {
  const db = readDb(); db.budgets = db.budgets.filter((budget) => !(budget.id === req.params.id && budget.userId === req.session.userId)); writeDb(db); res.json({ ok: true });
});
app.post('/api/goals', requireAuth, (req, res) => {
  const { name, target, saved } = req.body; const targetValue = Number(target); const savedValue = Number(saved || 0);
  if (!name?.trim() || !Number.isFinite(targetValue) || targetValue <= 0 || !Number.isFinite(savedValue) || savedValue < 0) return res.status(400).json({ error: 'Enter a goal and valid amounts.' });
  const db = readDb(); db.goals.push({ id: id(), userId: req.session.userId, name: name.trim(), target: roundMoney(targetValue), saved: roundMoney(savedValue) }); writeDb(db); res.status(201).json({ ok: true });
});
app.patch('/api/goals/:id', requireAuth, (req, res) => {
  const db = readDb(); const goal = db.goals.find((item) => item.id === req.params.id && item.userId === req.session.userId);
  if (!goal) return res.status(404).json({ error: 'Goal not found.' }); const saved = Number(req.body.saved);
  if (!Number.isFinite(saved) || saved < 0) return res.status(400).json({ error: 'Enter a valid saved amount.' }); goal.saved = roundMoney(saved); writeDb(db); res.json(goal);
});
app.delete('/api/goals/:id', requireAuth, (req, res) => {
  const db = readDb(); db.goals = db.goals.filter((goal) => !(goal.id === req.params.id && goal.userId === req.session.userId)); writeDb(db); res.json({ ok: true });
});

app.get('/api/export/:month', requireAuth, (req, res) => {
  if (!isValidMonth(req.params.month)) return res.status(400).json({ error: 'Invalid month.' });
  const db = readDb(); const rows = own(db.transactions, req.session.userId).filter((item) => item.date.startsWith(req.params.month));
  const csv = ['Date,Type,Category,Note,Amount', ...rows.map((item) => [item.date, item.type, item.category, item.note, item.amount].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="money-mate-${req.params.month}.csv"`); res.send(csv);
});

app.get('*splat', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Money Mate running on port ${PORT}`));
