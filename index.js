require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- CONFIGURATION ---------------- */
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REWARD_SECRET = process.env.REWARD_SECRET || 'adwallet7062';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const FORCE_CHANNEL = '@AdWalletCommunity';
const ADMIN_ID = String(process.env.ADMIN_ID || '6259396688');
const MONGO_URL = process.env.MONGO_URL;

if (!BOT_TOKEN || !WEBAPP_URL || !MONGO_URL) {
  console.error('❌ BOT_TOKEN, WEBAPP_URL or MONGO_URL missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- DATABASE ---------------- */
mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: 'User' },

  balance: { type: Number, default: 0 },
  tasks: { type: Number, default: 0 },

  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  referredBy: { type: String, default: '' },
  referralCredited: { type: Boolean, default: false },

  lastReward: { type: Number, default: 0 },
  lastDailyBonus: { type: String, default: '' },
  welcomeBonusClaimed: { type: Boolean, default: false },

  vip: { type: Boolean, default: false },
  vipPlan: { type: String, default: null },
  isWaitingForProof: { type: Boolean, default: false },

  isAdmin: { type: Boolean, default: false },

  withdrawHistory: {
    type: [
      {
        amount: Number,
        method: String,
        details: String,
        status: { type: String, default: 'pending' },
        date: { type: Date, default: Date.now }
      }
    ],
    default: []
  }
});

const User = mongoose.model('User', userSchema);

/* ---------------- SETTINGS ---------------- */
const AD_REWARD_BASE = 0.05;
const REF_REWARD = 0.075;

/* ---------------- HELPERS ---------------- */
async function ensureUser(userId, username = 'User') {
  userId = String(userId);

  let user = await User.findOne({ userId });

  if (!user) {
    user = new User({
      userId,
      username,
      isAdmin: userId === ADMIN_ID
    });
    await user.save();
  }

  if (username && username !== 'User' && user.username === 'User') {
    user.username = username;
    await user.save();
  }

  return user;
}

async function isUserJoined(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

/* ---------------- API ROUTES ---------------- */

// User Info
app.get('/user/:id', async (req, res) => {
  try {
    const user = await ensureUser(req.params.id);

    // One-time welcome bonus
    if (!user.welcomeBonusClaimed) {
      user.balance += 5;
      user.welcomeBonusClaimed = true;
      await user.save();
    }

    res.json({
      balance: Number(user.balance.toFixed(4)),
      tasks: user.tasks,
      vip: user.vip,
      vipPlan: user.vipPlan,
      referralCount: user.referralCount,
      referralEarnings: Number(user.referralEarnings.toFixed(4)),
      withdrawHistory: user.withdrawHistory,
      isAdmin: user.isAdmin
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reward API
app.get('/api/reward', async (req, res) => {
  try {
    const { userId, key } = req.query;

    if (key !== REWARD_SECRET) {
      return res.status(403).send('Forbidden');
    }

    const user = await ensureUser(userId);
    const now = Date.now();

    if (now - user.lastReward < 5000) {
      return res.status(429).send('Please wait');
    }

    let reward = AD_REWARD_BASE;

    if (user.vip) {
      const boost = {
        Bronze: 1.2,
        Silver: 1.5,
        Gold: 2,
        Platinum: 2.5,
        Diamond: 3,
        Elite: 4
      };

      reward *= boost[user.vipPlan] || 1;
    }

    const isFirstAd = user.tasks === 0;

    user.balance += reward;
    user.tasks += 1;
    user.lastReward = now;

    // Referral reward only once when referred user watches first ad
    if (
      isFirstAd &&
      user.referredBy &&
      user.referredBy !== user.userId &&
      !user.referralCredited
    ) {
      const referrer = await User.findOne({ userId: String(user.referredBy) });

      if (referrer) {
        referrer.balance += REF_REWARD;
        referrer.referralEarnings += REF_REWARD;
        referrer.referralCount += 1;
        await referrer.save();
      }

      user.referralCredited = true;
    }

    await user.save();

    res.json({
      success: true,
      reward,
      balance: Number(user.balance.toFixed(4))
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

// Daily Bonus
app.post('/api/claim-daily-bonus', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'Invalid request' });
    }

    const user = await ensureUser(userId);
    const today = new Date().toDateString();

    if (user.lastDailyBonus === today) {
      return res.json({ success: false, message: 'Already claimed today' });
    }

    user.balance += 0.25;
    user.lastDailyBonus = today;
    await user.save();

    res.json({
      success: true,
      balance: Number(user.balance.toFixed(4))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// Withdraw Request
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, amount, method, details } = req.body;

    const user = await ensureUser(userId);
    const amt = Number(amount);

    if (!amt || amt < 100 || amt > user.balance) {
      return res.json({ success: false, message: 'Invalid amount' });
    }

    user.balance -= amt;

    user.withdrawHistory.push({
      amount: amt,
      method,
      details,
      status: 'pending',
      date: new Date()
    });

    await user.save();

    // Send to admin
    try {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `💸 New Withdrawal Request\n\nUser ID: ${user.userId}\nUsername: ${user.username}\nAmount: $${amt}\nMethod: ${method}\nDetails: ${details}`
      );
    } catch {}

    res.json({ success: true, message: 'Withdrawal request sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const top = await User.find({})
      .sort({ balance: -1 })
      .limit(20)
      .select('username balance tasks referralCount vip vipPlan');

    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/* ---------------- TELEGRAM BOT ---------------- */

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const refId = String(ctx.startPayload || '').trim();

  const joined = await isUserJoined(ctx, userId);

  if (!joined) {
    return ctx.reply(`🚫 Please join ${FORCE_CHANNEL} first`, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📢 Join Channel',
              url: `https://t.me/${FORCE_CHANNEL.replace('@', '')}`
            }
          ],
          [
            {
              text: '✅ I Joined',
              callback_data: 'check_join'
            }
          ]
        ]
      }
    });
  }

  const user = await ensureUser(userId, username);

  if (refId && refId !== userId && !user.referredBy) {
    user.referredBy = refId;
    await user.save();
  }

  ctx.reply('🚀 Welcome to AdWallet!', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '💰 Open AdWallet',
          web_app: {
            url: `${WEBAPP_URL}/?id=${userId}`
          }
        }
      ]]
    }
  });
});

bot.action('check_join', async (ctx) => {
  const joined = await isUserJoined(ctx, ctx.from.id);

  if (joined) {
    await ctx.answerCbQuery('Verified');
    return ctx.reply('✅ Now send /start');
  }

  await ctx.answerCbQuery('Join the channel first', { show_alert: true });
});

/* ---------------- START ---------------- */
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);

  try {
    await bot.launch();
    console.log('🤖 Bot started');
  } catch (err) {
    console.error('❌ Bot launch error:', err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
