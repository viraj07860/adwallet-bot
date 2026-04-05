require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- CONFIGURATION ---------------- */
const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = String(process.env.BOT_TOKEN || '').trim();
const ADMIN_ID = 6259396688; // Replace with your actual Telegram User ID
const REWARD_SECRET = String(process.env.REWARD_SECRET || 'adwallet7062').trim();
const WEBAPP_URL = String(process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const FORCE_CHANNEL = String(process.env.CHANNEL || '@AdWalletCommunity').trim();
const ADMIN_ID = String(process.env.ADMIN_ID || '').trim();
const MONGO_URL = String(process.env.MONGO_URL || '').trim();

if (!BOT_TOKEN || !WEBAPP_URL || !MONGO_URL || !ADMIN_ID) {
  console.error('CRITICAL: BOT_TOKEN, WEBAPP_URL, MONGO_URL, or ADMIN_ID is missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- DATABASE CONNECTION ---------------- */
mongoose.set('strictQuery', true);

mongoose
  .connect(MONGO_URL)
  .then(() => console.log('Connected to MongoDB - data will persist'))
  .catch((err) => {
    console.error('MongoDB Connection Error:', err);
    process.exit(1);
  });

/* ---------------- DATABASE SCHEMA ---------------- */
const withdrawSchema = new mongoose.Schema(
  {
    txId: { type: String, required: true },
    amount: { type: Number, default: 0 },
    method: { type: String, default: '' },
    details: { type: String, default: '' },
    status: { type: String, default: 'pending' },
    date: { type: Date, default: Date.now },
    rejectedReason: { type: String, default: '' }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, default: 'User' },
  balance: { type: Number, default: 0 },
  feePaid: { type: Boolean, default:
false },
  tasks: { type: Number, default: 0 },
  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  claimedReferralVipRewards: { type: [String], default: [] },
  referredBy: { type: String, default: '' },
  referralCredited: { type: Boolean, default: false },
  lastReward: { type: Number, default: 0 },
  lastDailyBonus: { type: String, default: '' },
  welcomeBonusClaimed: { type: Boolean, default: false },
  vip: { type: Boolean, default: false },
  vipPlan: { type: String, default: null },
  pendingVipPlan: { type: String, default: null },
  isWaitingForProof: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  deviceFingerprint: { type: String, default: '' },
  lastRewardIp: { type: String, default: '' },
  withdrawHistory: { type: [withdrawSchema], default: [] }
});

const User = mongoose.model('User', userSchema);

/* ---------------- ECONOMY SETTINGS ---------------- */
const AD_REWARD_BASE = 0.05;
const REF_REWARD = 0.075;
const DAILY_BONUS = 0.25;

const VIP_PLANS = {
  Bronze: 425,
  Silver: 850,
  Gold: 1275,
  Platinum: 2125,
  Diamond: 3200,
  Elite: 4250
};

const REFERRAL_VIP_REWARDS = {
  Bronze: 60,
  Silver: 150,
  Gold: 300,
  Platinum: 500,
  Diamond: 800,
  Elite: 1200
};

const VIP_ORDER = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  Platinum: 4,
  Diamond: 5,
  Elite: 6
};

const VIP_REWARD_BOOST = {
  Bronze: 1.2,
  Silver: 1.5,
  Gold: 2,
  Platinum: 2.5,
  Diamond: 3,
  Elite: 4
};

/* ---------------- HELPERS ---------------- */
async function ensureUser(userId, username = 'User') {
  const uid = String(userId || '').trim();
  const uname = String(username || 'User').trim() || 'User';

  let user = await User.findOne({ userId: uid });

  if (!user) {
    user = new User({
      userId: uid,
      username: uname,
      isAdmin: uid === ADMIN_ID
    });
    await user.save();
    return user;
  }

  let changed = false;

  if (uname && uname !== user.username && uname !== 'User') {
    user.username = uname;
    changed = true;
  }

  if (uid === ADMIN_ID && !user.isAdmin) {
    user.isAdmin = true;
    changed = true;
  }

  if (changed) {
    await user.save();
  }

  return user;
}

async function isUserJoined(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    return false;
  }
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${value.trim()}`)
    .join(' | ');
}

function getIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return String(req.socket?.remoteAddress || '');
}

async function createStarsInvoice(plan) {
  const amount = VIP_PLANS[plan];
  if (!amount) {
    throw new Error('Invalid VIP plan');
  }

  return await bot.telegram.callApi('createInvoiceLink', {
    title: `${plan} VIP`,
    description: `Purchase ${plan} VIP with Telegram Stars`,
    payload: `vip_${plan}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `${plan} VIP`, amount }]
  });
}

async function handleReward(req, res, payload) {
  try {
    const userId = String(payload?.userId || '').trim();
    const key = String(payload?.key || '').trim();
    const adCompleted = payload?.adCompleted;
    const fingerprint = String(payload?.fingerprint || '').trim();
    const ip = getIp(req);

    if (!userId) {
      return req.method === 'GET'
        ? res.status(400).send('Missing userId')
        : res.status(400).json({ success: false, message: 'Missing userId' });
    }

    if (req.method === 'GET') {
      if (key !== REWARD_SECRET) {
        return res.status(403).send('Forbidden');
      }
    } else {
      if (key && key !== REWARD_SECRET) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      if (adCompleted !== true) {
        return res.status(400).json({ success: false, message: 'Invalid request' });
      }
    }

    const user = await ensureUser(userId);
    const now = Date.now();

    if (now - Number(user.lastReward || 0) < 5000) {
      return req.method === 'GET'
        ? res.status(429).send('Wait 5 seconds')
        : res.status(429).json({ success: false, message: 'Please wait 5 seconds' });
    }

    let reward = AD_REWARD_BASE;
    if (user.vip && user.vipPlan) {
      reward *= VIP_REWARD_BOOST[user.vipPlan] || 1;
    }

    const isFirstAd = Number(user.tasks || 0) === 0;

    user.balance += reward;
    user.tasks += 1;
    user.lastReward = now;
    user.lastRewardIp = ip;

    if (fingerprint && !user.deviceFingerprint) {
      user.deviceFingerprint = fingerprint;
    }

    if (
      isFirstAd &&
      user.referredBy &&
      user.referredBy !== user.userId &&
      !user.referralCredited
    ) {
      const referrer = await User.findOne({ userId: String(user.referredBy).trim() });

      if (referrer) {
        referrer.balance += REF_REWARD;
        referrer.referralEarnings += REF_REWARD;
        referrer.referralCount += 1;
        await referrer.save();
      }

      user.referralCredited = true;
    }

    await user.save();

    if (req.method === 'GET') {
      return res.send('OK');
    }

    return res.json({
      success: true,
      reward,
      balance: Number(user.balance.toFixed(4))
    });
  } catch (err) {
    console.error('Reward error:', err);
    return req.method === 'GET'
      ? res.status(500).send('Error')
      : res.status(500).json({ success: false, message: 'Server error' });
  }
}

/* ---------------- API ROUTES ---------------- */
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/user/:id', async (req, res) => {
  try {
    const user = await ensureUser(req.params.id);

    if (!user.welcomeBonusClaimed) {
      user.balance += 5;
      user.welcomeBonusClaimed = true;
      await user.save();
      console.log(`Welcome bonus given to ${user.userId}`);
    }

    return res.json({
      userId: user.userId,
    feePaid: user.feePaid,
      username: user.username,
      balance: Number(user.balance.toFixed(4)),
      tasks: Number(user.tasks || 0),
      vip: Boolean(user.vip),
      vipPlan: user.vipPlan,
      pendingVipPlan: user.pendingVipPlan || null,
      referralCount: Number(user.referralCount || 0),
      referralEarnings: Number(Number(user.referralEarnings || 0).toFixed(4)),
      claimedReferralVipRewards: user.claimedReferralVipRewards || [],
      welcomeBonusClaimed: Boolean(user.welcomeBonusClaimed),
      isAdmin: Boolean(user.isAdmin),
      withdrawHistory: user.withdrawHistory || []
    });
  } catch (err) {
    console.error('GET /user/:id error:', err);
    return res.status(500).json({ error: 'Failed to load user' });
  }
});

app.get('/api/reward', async (req, res) => {
  await handleReward(req, res, req.query);
});

app.post('/api/reward', async (req, res) => {
  await handleReward(req, res, req.body);
});

app.post('/api/reward-monetag', async (req, res) => {
  await handleReward(req, res, req.body);
});

app.post('/api/claim-daily-bonus', async (req, res) => {
  try {
    const { userId } = req.body || {};

    if (!userId) {
      return res.json({ success: false, message: 'Invalid request' });
    }

  if (!user.feePaid) {
    return res.json({ success: false, message: 'Withdrawal fee not paid.' });
  }

    const user = await ensureUser(userId);
    const today = new Date().toDateString();

    if (user.lastDailyBonus === today) {
      return res.json({ success: false, message: 'Come back tomorrow!' });
    }

    user.balance += DAILY_BONUS;
    user.lastDailyBonus = today;
    await user.save();

    console.log(`Daily bonus claimed by ${user.username}`);

    return res.json({
      success: true,
      newBalance: Number(user.balance.toFixed(4))
    });
  } catch (err) {
    console.error('POST /api/claim-daily-bonus error:', err);
    return res.json({ success: false, message: 'Server error' });
  }
});

app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, amount, method, details } = req.body || {};

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId' });
    }

    const user = await ensureUser(userId);
    const amt = Number(amount);

    if (!amt || amt < 100) {
      return res.json({ success: false, message: 'Minimum withdrawal is $100' });
    }

    if (amt > Number(user.balance || 0)) {
      return res.json({ success: false, message: 'Insufficient balance' });
    }

    const txId = `WD${Date.now()}${Math.floor(Math.random() * 1000)}`;

    user.withdrawHistory.push({
      txId,
      amount: amt,
      method: method || 'Unknown',
      details: normalizeDetails(details),
      status: 'pending',
      date: new Date(),
      rejectedReason: ''
    });

    await user.save();

    try {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `New Withdrawal Request\n\nUser: ${user.username}\nID: ${user.userId}\nAmount: $${amt}\nMethod: ${method || 'Unknown'}\nTX: ${txId}\nStatus: pending`
      );
    } catch (notifyErr) {
      console.error('Failed to notify admin about withdrawal:', notifyErr);
    }

    return res.json({ success: true, message: 'Withdrawal request submitted' });
  } catch (err) {
    console.error('POST /api/withdraw error:', err);
    return res.status(500).json({ success: false, message: 'Withdraw failed' });
  }
});

app.get('/api/top-users', async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ balance: -1 })
      .limit(20)
      .select('username balance userId');

    return res.json(users);
  } catch (err) {
    console.error('GET /api/top-users error:', err);
    return res.status(500).json([]);
  }
});

app.get('/api/top-referrals', async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ referralCount: -1 })
      .limit(20)
      .select('username referralCount referralEarnings userId');

    return res.json(users);
  } catch (err) {
    console.error('GET /api/top-referrals error:', err);
    return res.status(500).json([]);
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const adminId = String(req.query.adminId || '').trim();

    if (adminId !== ADMIN_ID) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const users = await User.find({});
    const totalUsers = users.length;
    const totalBalance = users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
    const totalReferrals = users.reduce((sum, u) => sum + Number(u.referralCount || 0), 0);

    let pendingWithdrawals = 0;
    for (const user of users) {
      for (const w of user.withdrawHistory || []) {
        if (w.status === 'pending') pendingWithdrawals += 1;
      }
    }

    return res.json({
      success: true,
      totalUsers,
      totalBalance: Number(totalBalance.toFixed(4)),
      totalReferrals,
      pendingWithdrawals
    });
  } catch (err) {
    console.error('GET /api/admin/stats error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const adminId = String(req.query.adminId || '').trim();

    if (adminId !== ADMIN_ID) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const users = await User.find({ 'withdrawHistory.status': 'pending' }).select(
      'username userId withdrawHistory'
    );

    const withdrawals = [];
    for (const user of users) {
      for (const w of user.withdrawHistory || []) {
        if (w.status === 'pending') {
          withdrawals.push({
            userId: user.userId,
            username: user.username,
            amount: w.amount,
            method: w.method,
            details: w.details,
            date: w.date,
            txId: w.txId,
            status: w.status
          });
        }
      }
    }

    return res.json({ success: true, withdrawals });
  } catch (err) {
    console.error('GET /api/admin/withdrawals error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/approve-withdrawal', async (req, res) => {
  try {
    const { adminId, userId, txId } = req.body || {};

    if (String(adminId || '').trim() !== ADMIN_ID) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const user = await User.findOne({ userId: String(userId || '').trim() });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const withdrawal = (user.withdrawHistory || []).find((w) => w.txId === txId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Already processed' });
    }

    if (Number(user.balance || 0) < Number(withdrawal.amount || 0)) {
      withdrawal.status = 'rejected';
      withdrawal.rejectedReason = 'Insufficient balance';
      await user.save();

      try {
        await bot.telegram.sendMessage(
          user.userId,
          `Your withdrawal of $${withdrawal.amount} was rejected.\nReason: Insufficient balance`
        );
      } catch (_) {}

      return res.status(400).json({ success: false, message: 'User balance too low' });
    }

    user.balance -= Number(withdrawal.amount || 0);
    withdrawal.status = 'approved';
    withdrawal.rejectedReason = '';

    await user.save();

    try {
      await bot.telegram.sendMessage(
        user.userId,
        `Your withdrawal of $${withdrawal.amount} has been approved.`
      );
    } catch (_) {}

    return res.json({ success: true, message: 'Withdrawal approved' });
  } catch (err) {
    console.error('POST /api/admin/approve-withdrawal error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/reject-withdrawal', async (req, res) => {
  try {
    const { adminId, userId, txId, reason } = req.body || {};

    if (String(adminId || '').trim() !== ADMIN_ID) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const user = await User.findOne({ userId: String(userId || '').trim() });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const withdrawal = (user.withdrawHistory || []).find((w) => w.txId === txId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Already processed' });
    }

    withdrawal.status = 'rejected';
    withdrawal.rejectedReason = reason || 'Rejected by admin';

    await user.save();

    try {
      await bot.telegram.sendMessage(
        user.userId,
        `Your withdrawal of $${withdrawal.amount} has been rejected.\nReason: ${withdrawal.rejectedReason}`
      );
    } catch (_) {}

    return res.json({ success: true, message: 'Withdrawal rejected' });
  } catch (err) {
    console.error('POST /api/admin/reject-withdrawal error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/vip-invoice', async (req, res) => {
  try {
    const plan = String(req.query.plan || '').trim();
    const invoiceUrl = await createStarsInvoice(plan);
    return res.json({ ok: true, invoiceUrl });
  } catch (err) {
    console.error('VIP invoice error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Could not create invoice'
    });
  }
});

app.get('/api/fee-invoice', async (req, res) => {
  try {
    const invoiceUrl = await bot.telegram.createInvoiceLink({
      title: 'Withdrawal Verification Fee',
      description: 'One-time $5.00 fee to unlock withdrawals.',
      payload: 'withdrawal_fee_payment',
      provider_token: '', 
      currency: 'XTR',
      prices: [{ label: 'Fee', amount: 100 }] 
    });

    res.json({ ok: true, invoiceUrl });
  } catch (error) {
    console.error('Fee invoice error:', error);
    res.status(500).json({ ok: false, error: 'Failed to generate invoice' });
  }
});

app.post('/api/start-vip-proof', async (req, res) => {
  try {
    const { userId, plan } = req.body || {};

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId' });
    }

    const user = await ensureUser(userId);

    if (plan && Object.prototype.hasOwnProperty.call(VIP_PLANS, String(plan))) {
      user.pendingVipPlan = String(plan);
    }

    user.isWaitingForProof = true;
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/start-vip-proof error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/claim-referral-vip', async (req, res) => {
  try {
    const { userId, plan } = req.body || {};

    if (!userId || !plan || !REFERRAL_VIP_REWARDS[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const user = await ensureUser(userId);
    const requiredReferrals = REFERRAL_VIP_REWARDS[plan];

    if (Number(user.referralCount || 0) < requiredReferrals) {
      return res.json({
        success: false,
        message: `You need ${requiredReferrals} referrals to claim ${plan} VIP`
      });
    }

    user.claimedReferralVipRewards = user.claimedReferralVipRewards || [];

    if (user.claimedReferralVipRewards.includes(plan)) {
      return res.json({
        success: false,
        message: `${plan} VIP already claimed`
      });
    }

    user.claimedReferralVipRewards.push(plan);

    const currentRank = VIP_ORDER[user.vipPlan] || 0;
    const newRank = VIP_ORDER[plan] || 0;

    if (newRank > currentRank) {
      user.vip = true;
      user.vipPlan = plan;
    }

    await user.save();

    return res.json({
      success: true,
      message: `${plan} VIP unlocked successfully`
    });
  } catch (err) {
    console.error('POST /api/claim-referral-vip error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ---------------- BOT LOGIC ---------------- */
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx?.updateType || 'unknown'}:`, err);
});

// --- NEW BROADCAST COMMAND ---
bot.command('broadcast', async (ctx) => {
  const myId = String(ctx.from.id).trim();
  const adminId = String(ADMIN_ID).trim();

  // DEBUG: Check if the IDs match
  console.log(`📡 Broadcast requested by: ${myId} | Admin is: ${adminId}`);

  if (myId !== adminId) {
    return ctx.reply(`❌ Access Denied!\nYour ID: ${myId}\nAdmin ID: ${adminId}\n(Please update the ADMIN_ID in Railway settings to match Your ID)`);
  }

  // Extract the text after "/broadcast "
  const broadcastText = ctx.message.text.replace('/broadcast ', '').trim();

  // Prevent sending empty broadcasts
  if (!broadcastText || broadcastText === '/broadcast') {
    return ctx.reply('⚠️ Please include a message!\nExample: /broadcast Hello AdWallet users!');
  }

  try {
    const users = await User.find({});
    await ctx.reply(`🚀 Starting broadcast to ${users.length} users...\n(This will take about ${Math.ceil(users.length * 0.04)} seconds)`);

    let successCount = 0;
    let failCount = 0;

    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.userId, broadcastText);
        successCount++;
        // 40ms delay to respect Telegram's 30 msg/sec limit
        await new Promise(resolve => setTimeout(resolve, 40)); 
      } catch (err) {
        failCount++; // User blocked the bot or deleted account
        continue;
      }
    }

    await ctx.reply(`✅ Broadcast Complete!\n\n📬 Successfully Sent: ${successCount}\n🚫 Blocked/Failed: ${failCount}`);
  } catch (dbErr) {
    console.error('Broadcast DB Error:', dbErr);
    ctx.reply('❌ Error fetching user list from the database.');
  }
});

bot.start(async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const refId = String(ctx.startPayload || '').trim();
    const joined = await isUserJoined(ctx, userId);

    if (!joined) {
      return ctx.reply(`Please join ${FORCE_CHANNEL} to use this bot.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Join Channel', url: `https://t.me/${FORCE_CHANNEL.replace('@', '')}` }],
            [{ text: 'I Have Joined', callback_data: 'check_join' }]
          ]
        }
      });
    }

    const user = await ensureUser(userId, username);

    if (refId && refId !== userId && !user.referredBy) {
      user.referredBy = refId;
      await user.save();
    }

    return ctx.reply('Welcome to AdWallet!\nEarn money by watching ads.', {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Open AdWallet', web_app: { url: `${WEBAPP_URL}/?id=${userId}` } }
        ]]
      }
    });
  } catch (err) {
    console.error('bot.start error:', err);
  }
});

bot.command('activate', async (ctx) => {
  try {
    const senderId = String(ctx.from.id);

    if (senderId === ADMIN_ID) {
      const args = String(ctx.message?.text || '').trim().split(/\s+/);

      if (args.length !== 3) {
        return ctx.reply(
          '<b>Usage:</b> <code>/activate UserID Plan</code>\nExample: <code>/activate 123456789 Gold</code>',
          { parse_mode: 'HTML' }
        );
      }

bot.command('broadcast', async (ctx) => {
  // 1. Security Check: Only the admin can use this
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply("❌ You are not authorized to use this command.");
  }

  // 2. Extract the message
  // Command format: /broadcast Hello Everyone!
  const message = ctx.message.text.replace('/broadcast', '').trim();

  if (!message) {
    return ctx.reply("Please provide a message: /broadcast [your message]");
  }

  // 3. Fetch all users from your database
  try {
    const allUsers = await User.find({}); // Assuming your model is named 'User'
    let successCount = 0;
    let failureCount = 0;

    ctx.reply(`🚀 Starting broadcast to ${allUsers.length} users...`);

    // 4. Loop and Send
    for (const user of allUsers) {
      try {
        await ctx.telegram.sendMessage(user.telegramId, message);
        successCount++;
        
        // Anti-flood: Small delay so Telegram doesn't block the bot
        await new Promise(resolve => setTimeout(resolve, 50)); 
      } catch (err) {
        // If a user blocked the bot, it will fail
        failureCount++;
      }
    }

    ctx.reply(`✅ Broadcast Complete!\n\nSent to: ${successCount}\nFailed: ${failureCount}`);

  } catch (error) {
    console.error("Broadcast Error:", error);
    ctx.reply("❌ An error occurred during the broadcast.");
  }
});

      const targetUserId = String(args[1]).trim();
      const targetPlan = String(args[2]).trim();

      if (!Object.prototype.hasOwnProperty.call(VIP_PLANS, targetPlan)) {
        return ctx.reply('Invalid plan');
      }

      const targetUser = await ensureUser(targetUserId);

      targetUser.vip = true;
      targetUser.vipPlan = targetPlan;
      targetUser.pendingVipPlan = null;
      targetUser.isWaitingForProof = false;

      await targetUser.save();

      await ctx.reply(
        `User <code>${targetUserId}</code> upgraded to <b>${targetPlan} VIP</b>`,
        { parse_mode: 'HTML' }
      );

      try {
        await bot.telegram.sendMessage(
          targetUserId,
          `Congratulations!\nYour <b>${targetPlan} VIP</b> has been activated!`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: 'Open App', web_app: { url: `${WEBAPP_URL}/?id=${targetUserId}` } }
              ]]
            }
          }
        );
      } catch (_) {}

      return;
    }

    const user = await ensureUser(senderId);
    user.isWaitingForProof = true;
    await user.save();

    return ctx.reply('Manual VIP Activation\n\nSend payment screenshot here.', {
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('bot.command activate error:', err);
  }
});

bot.command('buyvip', async (ctx) => {
  try {
    const keyboard = Object.keys(VIP_PLANS).map((plan) => [
      { text: `Buy ${plan} (${VIP_PLANS[plan]} Stars)`, callback_data: `vipplan_${plan}` }
    ]);

    return ctx.reply('Choose a VIP plan:', {
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    console.error('bot.command buyvip error:', err);
  }
});

bot.action(/^vipplan_(.+)$/, async (ctx) => {
  try {
    const plan = String(ctx.match?.[1] || '').trim();
    await ctx.answerCbQuery();

    const invoiceUrl = await createStarsInvoice(plan);

    await ctx.reply('Open this invoice inside Telegram:', {
      reply_markup: {
        inline_keyboard: [[
          { text: `Pay ${plan} VIP`, url: invoiceUrl }
        ]]
      }
    });
  } catch (err) {
    console.error('VIP plan action error:', err);
    try {
      await ctx.answerCbQuery('Could not create invoice', { show_alert: true });
    } catch (_) {}
  }
});

bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('pre_checkout_query error:', err);
  }
});

bot.on('photo', async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const user = await ensureUser(userId);

    if (!user.isWaitingForProof) {
      return ctx.reply('Please tap "I have paid, send screenshot" first.');
    }

    user.isWaitingForProof = false;
    await user.save();

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const planText = user.pendingVipPlan || 'Gold';

    await ctx.reply('Screenshot received! Admin will review it soon.');

    await bot.telegram.sendPhoto(String(ADMIN_ID), photoId, {
      caption: `New VIP Proof\n\nUser: ${user.username}\nID: ${userId}\nPlan: ${planText}\n\nApprove with:\n/activate ${userId} ${planText}`
    });

    user.pendingVipPlan = null;
    await user.save();
  } catch (err) {
    console.error('PHOTO SEND ERROR:', err);
  }
});

bot.on('message', async (ctx) => {
  try {
    if (!ctx.message?.successful_payment) return;

    const userId = String(ctx.from.id);
    const payload = String(ctx.message.successful_payment.invoice_payload || '');
    const plan = payload.replace(/^vip_/, '');

    const user = await ensureUser(userId);

    if (Object.prototype.hasOwnProperty.call(VIP_PLANS, plan)) {
      user.vip = true;
      user.vipPlan = plan;
      user.pendingVipPlan = null;
      user.isWaitingForProof = false;
      await user.save();

      await ctx.reply(`Your ${plan} VIP is now active!`);
    } else {
      await ctx.reply('Payment received, but VIP plan could not be identified.');
    }
  } catch (err) {
    console.error('message handler error:', err);
  }
});

bot.action('check_join', async (ctx) => {
  try {
    const joined = await isUserJoined(ctx, ctx.from.id);

    if (joined) {
      await ctx.answerCbQuery('Access granted!');
      return ctx.reply('Verified! Use /start to begin.');
    }

    await ctx.answerCbQuery('You must join the channel first!', { show_alert: true });
  } catch (err) {
    console.error('check_join error:', err);
  }
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    console.log('Bot started successfully');
  } catch (err) {
    console.error('Bot launch error:', err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
