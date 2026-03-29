require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REWARD_SECRET = process.env.REWARD_SECRET || 'adwallet7062';
const BOT_USERNAME = process.env.BOT_USERNAME || 'AdzwalletBot';

const bot = new Telegraf(BOT_TOKEN);

// In-memory storage
const users = {};
const withdrawals = [];

function getBaseUrl() {
  const raw = (process.env.WEBAPP_URL || process.env.RAILWAY_STATIC_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return 'http://localhost:8080';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `https://${raw}`;
}

function ensureUser(userId, username = 'User') {
  const id = String(userId);

  if (!users[id]) {
    users[id] = {
      userId: id,
      username,
      balance: 0,
      tasks: 0,
      referralCount: 0,
      referralEarnings: 0,
      referralList: [],
      referredBy: '',
      lastAdTime: 0,
      dailyAds: 0,
      lastReset: Date.now()
    };
  } else if (username && users[id].username === 'User') {
    users[id].username = username;
  }

  return users[id];
}

function checkDailyLimit(user) {
  const now = Date.now();

  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.dailyAds = 0;
    user.lastReset = now;
  }

  return user.dailyAds < 20;
}

// Serve app root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Telegram bot start
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const startPayload = String(ctx.startPayload || ctx.payload || '').trim();

  const user = ensureUser(userId, username);

  // Referral reward only if referrer already exists and it's not self
  if (startPayload && startPayload !== userId && !user.referredBy) {
    const referrer = users[startPayload];

    if (referrer) {
      user.referredBy = startPayload;
      referrer.balance += 5;
      referrer.referralCount += 1;
      referrer.referralEarnings += 5;
      referrer.referralList.push({
        username,
        date: new Date().toLocaleDateString()
      });

      try {
        await ctx.telegram.sendMessage(
          startPayload,
          `🎉 New referral joined!\n👤 ${username}\n💰 $5 added`
        );
      } catch (e) {
        console.log('Referral notify failed:', e.message);
      }
    }
  }

  const webAppUrl = `${getBaseUrl()}/?id=${encodeURIComponent(userId)}`;

  return ctx.reply('✨ Access Granted! Start earning now:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Open AdzWallet', web_app: { url: webAppUrl } }]
      ]
    }
  });
});

// User API for UI
app.get('/user/:id', (req, res) => {
  const userId = String(req.params.id);
  const user = ensureUser(userId);

  res.json({
    userId: user.userId,
    username: user.username,
    balance: Number(user.balance || 0),
    tasks: Number(user.tasks || 0),
    referralCount: Number(user.referralCount || 0),
    referralEarnings: Number(user.referralEarnings || 0),
    referralList: user.referralList || []
  });
});

// Referrals API
app.get('/api/referrals/:id', (req, res) => {
  const userId = String(req.params.id);
  const user = ensureUser(userId);

  res.json({
    total: Number(user.referralCount || 0),
    earnings: Number(user.referralEarnings || 0),
    list: user.referralList || []
  });
});

// Reward callback from Adsgram
app.get('/api/reward', (req, res) => {
  const { userid, userId, key } = req.query;
  const id = String(userid || userId || '');

  if (key !== REWARD_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  if (!id) {
    return res.status(400).send('Missing user');
  }

  const user = ensureUser(id);
  const now = Date.now();

  if (now - user.lastAdTime < 30000) {
    return res.status(429).send('Cooldown');
  }

  if (!checkDailyLimit(user)) {
    return res.status(429).send('Daily limit reached');
  }

  user.balance += 20;
  user.tasks += 1;
  user.dailyAds += 1;
  user.lastAdTime = now;

  return res.send('OK');
});

// Withdraw endpoint
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, account, details } = req.body;
  const id = String(userId || '');

  if (!id) {
    return res.json({ success: false, message: 'Missing user' });
  }

  const user = ensureUser(id);
  const amt = Number(amount);

  if (!Number.isFinite(amt) || amt <= 0) {
    return res.json({ success: false, message: 'Invalid amount' });
  }

  if (amt < 10) {
    return res.json({ success: false, message: 'Minimum $10' });
  }

  if (user.balance < amt) {
    return res.json({ success: false, message: 'Insufficient balance' });
  }

  user.balance -= amt;

  withdrawals.unshift({
    userId: id,
    amount: amt,
    method: method || 'Unknown',
    account: account || '',
    details: details || {},
    status: 'pending',
    date: new Date().toISOString()
  });

  return res.json({ success: true });
});

// Admin view of withdrawals
app.get('/admin/withdrawals', (req, res) => {
  res.json(withdrawals);
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);

  if (!BOT_TOKEN) {
    console.log('⚠️ BOT_TOKEN missing');
    return;
  }

  bot.launch().catch(err => console.error('Bot launch failed:', err));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
