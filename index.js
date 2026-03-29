require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const REWARD_SECRET = (process.env.REWARD_SECRET || 'adwallet7062').trim();
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const BOT_USERNAME = (process.env.BOT_USERNAME || 'AdzwalletBot').trim();

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing');
  process.exit(1);
}

if (!WEBAPP_URL) {
  console.error('❌ WEBAPP_URL is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ----- TEMP STORAGE -----
const users = {};
const withdrawals = [];

// ----- HELPERS -----
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
      lastReset: Date.now(),
      isSubscribed: false
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

function getWebAppUrl(userId) {
  return `${WEBAPP_URL}/?id=${encodeURIComponent(userId)}`;
}

// ----- BASIC ROUTES -----
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/user/:id', (req, res) => {
  const user = ensureUser(req.params.id);
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

app.get('/api/referrals/:id', (req, res) => {
  const user = ensureUser(req.params.id);
  res.json({
    total: Number(user.referralCount || 0),
    earnings: Number(user.referralEarnings || 0),
    list: user.referralList || []
  });
});

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

  console.log('✅ Reward added for', id);
  return res.send('OK');
});

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

  console.log('💸 Withdraw request:', withdrawals[0]);
  return res.json({ success: true });
});

app.get('/admin/withdrawals', (req, res) => {
  res.json(withdrawals);
});

// ----- TELEGRAM BOT -----
bot.use(async (ctx, next) => {
  console.log('📩 Update:', ctx.updateType, ctx.from?.id || 'unknown');
  return next();
});

bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  if (ctx?.update) {
    console.error('Update:', JSON.stringify(ctx.update, null, 2));
  }
});

async function handleStart(ctx) {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const payload = String(ctx.startPayload || ctx.payload || '').trim();

  console.log('▶️ /start received from', userId, 'payload:', payload || '(none)');

  const user = ensureUser(userId, username);

  if (payload && payload !== userId && !user.referredBy) {
    const referrer = ensureUser(payload, 'User');
    if (referrer && payload !== userId) {
      user.referredBy = payload;
      referrer.balance += 5;
      referrer.referralCount += 1;
      referrer.referralEarnings += 5;
      referrer.referralList.push({
        username,
        date: new Date().toLocaleDateString()
      });

      try {
        await ctx.telegram.sendMessage(
          payload,
          `🎉 New referral joined!\n👤 ${username}\n💰 $5 added`
        );
      } catch (e) {
        console.log('Referral notify failed:', e.message);
      }
    }
  }

  const webAppUrl = getWebAppUrl(userId);

  return ctx.reply('✨ Access Granted! Start earning now:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Open AdzWallet', web_app: { url: webAppUrl } }]
      ]
    }
  });
}

bot.start(handleStart);
bot.command('start', handleStart);

bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery('WEBAPP_URL is not set correctly.', { show_alert: true });
});

// ----- STARTUP -----
async function startBot() {
  try {
    console.log('🔧 Deleting old webhook...');
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });

    console.log('🤖 Launching bot...');
    await bot.launch({
      dropPendingUpdates: true
    });

    const me = await bot.telegram.getMe();
    console.log(`✅ Bot launched as @${me.username}`);
  } catch (err) {
    console.error('❌ Bot launch failed:', err);
  }
}

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  await startBot();
});

// graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
