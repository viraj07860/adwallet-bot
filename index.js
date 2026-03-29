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
const CHANNEL = process.env.CHANNEL || '@AdWalletCommunity';

const bot = new Telegraf(BOT_TOKEN);

// In-memory storage
const users = {};
const withdrawals = [];

// ----- Helpers -----
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
      lastAdTime: 0,
      dailyAds: 0,
      lastReset: Date.now(),
      isSubscribed: false
    };
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
  const base = process.env.RAILWAY_STATIC_URL;
  if (!base) return `/?id=${encodeURIComponent(userId)}`;
  return `https://${base}/?id=${encodeURIComponent(userId)}`;
}

// ----- Root route -----
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----- Telegram bot -----
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const refPayload = ctx.payload ? String(ctx.payload).trim() : '';

  const user = ensureUser(userId, username);

  // Referral handling
  if (refPayload && refPayload !== userId) {
    const refUser = ensureUser(refPayload, 'User');

    if (refPayload !== userId) {
      const isFirstTimeReferral = !user.referredBy;
      if (isFirstTimeReferral) {
        user.referredBy = refPayload;
        refUser.balance += 5;
        refUser.referralCount += 1;
        refUser.referralEarnings += 5;
        refUser.referralList.push({
          username,
          date: new Date().toLocaleDateString()
        });

        try {
          await ctx.telegram.sendMessage(
            refPayload,
            `🎉 New referral joined!\n👤 ${username}\n💰 ₹5 added`
          );
        } catch (e) {
          console.log('Referral notify failed:', e.message);
        }
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
});

bot.action('check_sub', async (ctx) => {
  const userId = String(ctx.from.id);
  ensureUser(userId, ctx.from.username || ctx.from.first_name || 'User');

  try {
    const member = await ctx.telegram.getChatMember(CHANNEL, userId);
    const ok = ['member', 'administrator', 'creator'].includes(member.status);
    if (ok) {
      users[userId].isSubscribed = true;
      return ctx.answerCbQuery('✅ Joined!');
    }
    return ctx.answerCbQuery(`❌ Please join ${CHANNEL} first!`, { show_alert: true });
  } catch (err) {
    console.log('Sub check error:', err.message);
    return ctx.answerCbQuery('⚠️ Error checking subscription', { show_alert: true });
  }
});

// ----- APIs -----
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
    isSubscribed: !!user.isSubscribed
  });
});

app.get('/api/referrals/:id', (req, res) => {
  const userId = String(req.params.id);
  const user = ensureUser(userId);

  res.json({
    total: user.referralCount || 0,
    earnings: user.referralEarnings || 0,
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

  res.send('OK');
});

app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, details } = req.body;
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
    details: details || {},
    status: 'pending',
    date: new Date().toISOString()
  });

  res.json({ success: true });
});

app.get('/admin/withdrawals', (req, res) => {
  res.json(withdrawals);
});

// ----- Start server -----
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  if (!BOT_TOKEN) {
    console.log('⚠️ BOT_TOKEN missing');
  } else {
    bot.launch().catch(err => console.error('Bot launch failed:', err));
  }
});

// ----- Graceful shutdown -----
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
