rrequire('dotenv').config();
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
  console.error('❌ CRITICAL: BOT_TOKEN, WEBAPP_URL, or MONGO_URL is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- DATABASE CONNECTION ---------------- */
mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ Connected to MongoDB - Data will NOT reset on restart'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

/* ---------------- DATABASE SCHEMA ---------------- */
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: 'User' },
  balance: { type: Number, default: 0 },
  tasks: { type: Number, default: 0 },
  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  referredBy: { type: String, default: '' },
  referralCredited: { type: Boolean, default: false },
  rewardHistory: { type: [Number], default: [] },
  lastIp: { type: String, default: '' },
  deviceFingerprint: { type: String, default: '' },
  isBlocked: { type: Boolean, default: false },
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
        account: String,
        status: String,
        date: String,
        txId: String
      }
    ],
    default: []
  }
});

const User = mongoose.model('User', userSchema);

/* ---------------- ECONOMY SETTINGS ---------------- */
const AD_REWARD_BASE = 0.05;
const REF_REWARD = 0.075;

const VIP_PLANS = {
  Bronze: 425,
  Silver: 850,
  Gold: 1275,
  Platinum: 2125,
  Diamond: 3200,
  Elite: 4250
};

/* ---------------- HELPERS ---------------- */
async function ensureUser(userId, username = 'User') {
  const uid = String(userId);
  let user = await User.findOne({ userId: uid });

  if (!user) {
    user = new User({ userId: uid, username });
    if (uid === ADMIN_ID) user.isAdmin = true;
    await user.save();
  } else if (username && username !== 'User' && user.username === 'User') {
    user.username = username;
    if (uid === ADMIN_ID) user.isAdmin = true;
    await user.save();
  }

  if (uid === ADMIN_ID && !user.isAdmin) {
    user.isAdmin = true;
    await user.save();
  }

  return user;
}

async function isUserJoined(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return String(req.socket?.remoteAddress || '');
}

function getAccountValue(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.values(details)
    .filter(v => typeof v === 'string' && v.trim())
    .join(' | ');
}

/* ---------------- API ROUTES ---------------- */

// Get user data for Mini App
app.get('/user/:id', async (req, res) => {
  try {
    const user = await ensureUser(req.params.id);

    if (!user.welcomeBonusClaimed) {
      user.balance += 5;
      user.welcomeBonusClaimed = true;
      await user.save();
      console.log(`🎁 Welcome bonus given to ${user.userId}`);
    }

    res.json({
      balance: Number(user.balance.toFixed(4)),
      tasks: user.tasks,
      vip: user.vip,
      vipPlan: user.vipPlan,
      referralCount: user.referralCount,
      referralEarnings: user.referralEarnings,
      withdrawHistory: user.withdrawHistory,
      isAdmin: user.isAdmin
    });
  } catch (err) {
    console.error('GET /user/:id error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// Reward from watching ads
app.post('/api/reward', async (req, res) => {
  try {
    const { userId, adCompleted, fingerprint, key } = req.body;

    if (key && key !== REWARD_SECRET) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (!userId || adCompleted !== true) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const user = await ensureUser(userId);
    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account blocked' });
    }

    const now = Date.now();
    const ip = getClientIp(req);

    if (now - user.lastReward < 15000) {
      return res.status(429).json({ success: false, message: 'Please wait before claiming again' });
    }

    if (fingerprint && !user.deviceFingerprint) {
      user.deviceFingerprint = String(fingerprint);
    }

    user.lastIp = ip;

    if (fingerprint) {
      const sameDeviceUser = await User.findOne({
        deviceFingerprint: String(fingerprint),
        userId: { $ne: user.userId }
      });

      if (sameDeviceUser) {
        return res.status(403).json({
          success: false,
          message: 'Multiple accounts on same device detected'
        });
      }
    }

    user.rewardHistory.push(now);
    user.rewardHistory = user.rewardHistory.slice(-10);

    const recentRewards = user.rewardHistory.filter(t => now - t < 5 * 60 * 1000);
    if (recentRewards.length > 10) {
      user.isBlocked = true;
      await user.save();
      return res.status(403).json({
        success: false,
        message: 'Suspicious activity detected'
      });
    }

    let reward = AD_REWARD_BASE;
    if (user.vip) {
      const boost = { Bronze: 1.2, Silver: 1.5, Gold: 2, Platinum: 2.5, Diamond: 3, Elite: 4 };
      reward *= boost[user.vipPlan] || 1;
    }

    const isFirstAd = user.tasks === 0;

    user.balance += reward;
    user.tasks += 1;
    user.lastReward = now;

    if (isFirstAd && user.referredBy && user.referredBy !== user.userId && !user.referralCredited) {
      const referrer = await User.findOne({ userId: String(user.referredBy) });
      if (referrer) {
        if (fingerprint && referrer.deviceFingerprint && referrer.deviceFingerprint === String(fingerprint)) {
          return res.status(403).json({
            success: false,
            message: 'Self referral detected'
          });
        }

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
      balance: user.balance
    });
  } catch (err) {
    console.error('POST /api/reward error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Daily Bonus
app.post('/api/claim-daily-bonus', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.json({ success: false, message: 'Invalid request' });

    const user = await ensureUser(userId);
    const today = new Date().toDateString();

    if (user.lastDailyBonus === today) {
      return res.json({ success: false, message: 'Come back tomorrow!' });
    }

    const bonusAmount = 5.00;
    user.balance += bonusAmount;
    user.lastDailyBonus = today;
    await user.save();

    console.log(`🎁 Daily Bonus Claimed by ${user.username}`);
    return res.json({ success: true, newBalance: user.balance });
  } catch (err) {
    console.error('POST /api/claim-daily-bonus error:', err);
    return res.json({ success: false, message: 'Server error' });
  }
});

// Withdrawal
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, amount, method, details } = req.body;
    if (!userId) return res.json({ success: false, message: 'Invalid user' });

    const user = await ensureUser(userId);
    const amt = Number(amount);

    if (!amt || amt < 100) {
      return res.json({ success: false, message: 'Minimum withdrawal is $100' });
    }

    if (amt > user.balance) {
      return res.json({ success: false, message: 'Insufficient balance' });
    }

    const txId = 'WD' + Date.now();
    user.withdrawHistory.push({
      amount: amt,
      method: method || 'Unknown',
      account: getAccountValue(details),
      status: 'Pending',
      date: new Date().toLocaleString(),
      txId
    });

    await user.save();

    return res.json({
      success: true,
      message: 'Withdrawal request submitted and waiting for admin approval.',
      txId
    });
  } catch (err) {
    console.error('POST /api/withdraw error:', err);
    res.status(500).json({ success: false, message: 'Withdraw failed' });
  }
});

// Leaderboards
app.get('/api/top-users', async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ balance: -1 })
      .limit(20)
      .select('username balance');

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

app.get('/api/top-referrals', async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ referralCount: -1 })
      .limit(20)
      .select('username referralCount referralEarnings');

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// Admin stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const adminId = String(req.query.adminId || '');
    const admin = await User.findOne({ userId: adminId });

    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false });
    }

    const users = await User.find({});
    const totalUsers = users.length;
    const totalBalance = users.reduce((sum, u) => sum + (u.balance || 0), 0);
    const totalReferrals = users.reduce((sum, u) => sum + (u.referralCount || 0), 0);

    let pendingWithdrawals = 0;
    users.forEach(user => {
      user.withdrawHistory.forEach(w => {
        if (w.status === 'Pending') pendingWithdrawals += 1;
      });
    });

    res.json({
      totalUsers,
      totalBalance,
      totalReferrals,
      pendingWithdrawals
    });
  } catch (err) {
    console.error('GET /api/admin/stats error:', err);
    res.status(500).json({ success: false });
  }
});

// Admin withdrawal list
app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const adminId = String(req.query.adminId || '');
    const admin = await User.findOne({ userId: adminId });

    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const users = await User.find({
      'withdrawHistory.status': 'Pending'
    }).select('username userId withdrawHistory');

    const pending = [];

    users.forEach(user => {
      user.withdrawHistory.forEach(w => {
        if (w.status === 'Pending') {
          pending.push({
            userId: user.userId,
            username: user.username,
            amount: w.amount,
            method: w.method,
            account: w.account,
            date: w.date,
            txId: w.txId
          });
        }
      });
    });

    res.json({ success: true, withdrawals: pending });
  } catch (err) {
    console.error('GET /api/admin/withdrawals error:', err);
    res.status(500).json({ success: false });
  }
});

// Admin approve withdrawal
app.post('/api/admin/approve-withdrawal', async (req, res) => {
  try {
    const { adminId, userId, txId } = req.body;

    const admin = await User.findOne({ userId: String(adminId || '') });
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const user = await User.findOne({ userId: String(userId || '') });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const withdrawal = user.withdrawHistory.find(w => w.txId === txId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Already processed' });
    }

    if (user.balance < withdrawal.amount) {
      withdrawal.status = 'Rejected';
      await user.save();
      return res.status(400).json({ success: false, message: 'User balance too low' });
    }

    user.balance -= withdrawal.amount;
    withdrawal.status = 'Approved';
    await user.save();

    res.json({ success: true, message: 'Withdrawal approved' });
  } catch (err) {
    console.error('POST /api/admin/approve-withdrawal error:', err);
    res.status(500).json({ success: false });
  }
});

// Admin reject withdrawal
app.post('/api/admin/reject-withdrawal', async (req, res) => {
  try {
    const { adminId, userId, txId } = req.body;

    const admin = await User.findOne({ userId: String(adminId || '') });
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const user = await User.findOne({ userId: String(userId || '') });
    if (!user) {
      return res.status(404).json({ success: false });
    }

    const withdrawal = user.withdrawHistory.find(w => w.txId === txId);
    if (!withdrawal) {
      return res.status(404).json({ success: false });
    }

    withdrawal.status = 'Rejected';
    await user.save();

    res.json({ success: true, message: 'Withdrawal rejected' });
  } catch (err) {
    console.error('POST /api/admin/reject-withdrawal error:', err);
    res.status(500).json({ success: false });
  }
});

/* ---------------- BOT LOGIC ---------------- */
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const refId = String(ctx.startPayload || '').trim();

  const joined = await isUserJoined(ctx, userId);
  if (!joined) {
    return ctx.reply(`🚫 Please join ${FORCE_CHANNEL} to use this bot.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 Join Channel', url: `https://t.me/${FORCE_CHANNEL.replace('@', '')}` }],
          [{ text: '✅ I Have Joined', callback_data: 'check_join' }]
        ]
      }
    });
  }

  const newUser = await ensureUser(userId, username);

  if (refId && refId !== userId) {
    if (!newUser.referredBy) {
      newUser.referredBy = refId;
      await newUser.save();
    }
  }

  ctx.reply(`🚀 Welcome to AdWallet!\nEarn money by watching ads.`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '💰 Open AdWallet', web_app: { url: `${WEBAPP_URL}/?id=${userId}` } }
      ]]
    }
  });
});

// Activate Command (Admin + User)
bot.command('activate', async (ctx) => {
  const senderId = String(ctx.from.id);

  if (senderId === ADMIN_ID) {
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length !== 3) {
      return ctx.reply(
        `⚠️ <b>Usage:</b> <code>/activate UserID Plan</code>\nExample: <code>/activate 123456789 Gold</code>`,
        { parse_mode: 'HTML' }
      );
    }

    const targetUserId = args[1];
    const targetPlan = args[2];

    if (!Object.keys(VIP_PLANS).includes(targetPlan)) {
      return ctx.reply('❌ Invalid Plan');
    }

    const targetUser = await ensureUser(targetUserId);
    targetUser.vip = true;
    targetUser.vipPlan = targetPlan;
    targetUser.isWaitingForProof = false;
    await targetUser.save();

    await ctx.reply(`✅ User <code>${targetUserId}</code> upgraded to <b>${targetPlan} VIP</b>`, {
      parse_mode: 'HTML'
    });

    try {
      await bot.telegram.sendMessage(
        targetUserId,
        `🎉 <b>Congratulations!</b>\nYour <b>${targetPlan} VIP</b> has been activated!`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 Open App', web_app: { url: `${WEBAPP_URL}/?id=${targetUserId}` } }
            ]]
          }
        }
      );
    } catch (e) {}

    return;
  }

  const user = await ensureUser(senderId);
  user.isWaitingForProof = true;
  await user.save();

  await ctx.reply(`💎 <b>Manual VIP Activation</b>\n\nSend payment screenshot here.`, {
    parse_mode: 'HTML'
  });
});

// Handle payment screenshots
bot.on('photo', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = await ensureUser(userId);

  if (user.isWaitingForProof) {
    user.isWaitingForProof = false;
    await user.save();

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    await ctx.reply('✅ Screenshot received! Admin will review it soon.');

    await ctx.telegram.sendPhoto(ADMIN_ID, photoId, {
      caption: `🔔 <b>New VIP Proof</b>\nUser: ${user.username}\nID: <code>${userId}</code>\n\nApprove with:\n/activate ${userId} Gold`,
      parse_mode: 'HTML'
    });
  }
});

// Telegram Stars Payment
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('message', async (ctx) => {
  if (ctx.message?.successful_payment) {
    const userId = String(ctx.from.id);
    const plan = ctx.message.successful_payment.invoice_payload.replace('vip_', '');
    const user = await ensureUser(userId);
    user.vip = true;
    user.vipPlan = plan;
    await user.save();
    await ctx.reply(`✅ Your ${plan} VIP is now active!`);
  }
});

bot.action('check_join', async (ctx) => {
  const joined = await isUserJoined(ctx, ctx.from.id);
  if (joined) {
    await ctx.answerCbQuery('Access Granted!');
    return ctx.reply('✅ Verified! Use /start to begin.');
  }
  await ctx.answerCbQuery('❌ You must join the channel first!', { show_alert: true });
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  try {
    await bot.launch();
    console.log('🤖 Bot started successfully');
  } catch (err) {
    console.error('Bot launch error:', err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
