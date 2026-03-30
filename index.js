require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- CONFIGURATION ---------------- */
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const REWARD_SECRET = process.env.REWARD_SECRET || 'adwallet7062';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const FORCE_CHANNEL = '@AdWalletCommunity';

if (!BOT_TOKEN || !MONGO_URL || !WEBAPP_URL) {
  console.error('❌ Critical Environment Variables Missing!');
  process.exit(1);
}

/* ---------------- DATABASE SCHEMAS ---------------- */
const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  username: { type: String, default: 'User' },
  balance: { type: Number, default: 0 },
  tasks: { type: Number, default: 0 },
  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  referredBy: { type: String, default: null },
  lastReward: { type: Number, default: 0 },
  vip: { type: Boolean, default: false },
  vipPlan: { type: String, default: null },
  joinDate: { type: Date, default: Date.now }
});

const WithdrawalSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  method: String,
  details: Object,
  status: { type: String, default: 'pending' },
  date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

/* ---------------- HELPERS ---------------- */
async function ensureUser(userId, username = 'User') {
  let user = await User.findOne({ userId: String(userId) });
  if (!user) {
    user = await User.create({ userId: String(userId), username });
  } else if (username && user.username !== username) {
    user.username = username;
    await user.save();
  }
  return user;
}

const VIP_PLANS = {
  Bronze: 425, Silver: 850, Gold: 1275, 
  Platinum: 2125, Diamond: 3200, Elite: 4250
};

const VIP_BOOSTS = {
  Bronze: 1.2, Silver: 1.5, Gold: 2, 
  Platinum: 2.5, Diamond: 3, Elite: 4
};

/* ---------------- API ROUTES ---------------- */

// Fetch user data for Mini App
app.get('/user/:id', async (req, res) => {
  try {
    const user = await ensureUser(req.params.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'DB Error' });
  }
});

// Reward logic (Secured with REWARD_SECRET)
app.get('/api/reward', async (req, res) => {
  const { userid, key } = req.query;
  if (key !== REWARD_SECRET) return res.status(403).send('INVALID_KEY');

  try {
    const user = await ensureUser(userid);
    const now = Date.now();

    if (now - user.lastReward < 5000) return res.status(429).send('TOO_FAST');

    let reward = 0.008; // Base
    if (user.vip && VIP_BOOSTS[user.vipPlan]) {
      reward *= VIP_BOOSTS[user.vipPlan];
    }

    user.balance += reward;
    user.tasks += 1;
    user.lastReward = now;
    await user.save();

    res.send('OK');
  } catch (err) {
    res.status(500).send('ERROR');
  }
});

// Create VIP Star Invoice
app.get('/api/vip-invoice', async (req, res) => {
  const { plan, userId } = req.query;
  if (!VIP_PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  try {
    const invoiceUrl = await bot.telegram.createInvoiceLink({
      title: `${plan} VIP Upgrade`,
      description: `Unlock ${VIP_BOOSTS[plan]}x earnings in AdWallet`,
      payload: `vip_${plan}_${userId}`,
      provider_token: '', // Empty for Telegram Stars
      currency: 'XTR',
      prices: [{ label: `${plan} Plan`, amount: VIP_PLANS[plan] }]
    });
    res.json({ ok: true, invoiceUrl });
  } catch (err) {
    res.status(500).json({ error: 'Invoice failed' });
  }
});

// Handle Withdrawals
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, method, details } = req.body;
  const user = await ensureUser(userId);

  if (amount < 100 || amount > user.balance) {
    return res.json({ success: false, message: 'Invalid Amount/Balance' });
  }

  user.balance -= amount;
  await user.save();

  await Withdrawal.create({ userId, amount, method, details });
  res.json({ success: true });
});

/* ---------------- TELEGRAM BOT ---------------- */
const bot = new Telegraf(BOT_TOKEN);

async function checkMembership(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) { return false; }
}

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const refId = String(ctx.startPayload || '').trim();
  
  const isJoined = await checkMembership(ctx, userId);
  if (!isJoined) {
    return ctx.reply(`🚫 Join ${FORCE_CHANNEL} to earn!`, {
      reply_markup: {
        inline_keyboard: [[{ text: '📢 Join Now', url: `https://t.me/${FORCE_CHANNEL.replace('@','')}` }],
        [{ text: '✅ Joined', callback_data: 'check_join' }]]
      }
    });
  }

  const user = await ensureUser(userId, ctx.from.username || ctx.from.first_name);

  // Referral Logic
  if (refId && refId !== userId && !user.referredBy) {
    const referrer = await User.findOne({ userId: refId });
    if (referrer) {
      user.referredBy = refId;
      referrer.referralCount += 1;
      referrer.balance += 0.01;
      await referrer.save();
      await user.save();
      ctx.telegram.sendMessage(refId, `👥 New referral! +$0.01`).catch(() => {});
    }
  }

  ctx.reply(`🚀 Welcome to AdWallet!`, {
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Open AdWallet', web_app: { url: `${WEBAPP_URL}/?id=${userId}` } }]]
    }
  });
});

bot.action('check_join', async (ctx) => {
  const isJoined = await checkMembership(ctx, ctx.from.id);
  if (isJoined) {
    await ctx.answerCbQuery('✅ Welcome!');
    await ctx.editMessageText('🎉 Access granted! Click below to start.');
    // Repeat Start Logic or send WebApp button
  } else {
    await ctx.answerCbQuery('❌ You haven\'t joined yet!', { show_alert: true });
  }
});

// Handle Star Payments
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));
bot.on('successful_payment', async (ctx) => {
  const payload = ctx.message.successful_payment.invoice_payload;
  const parts = payload.split('_'); // vip_PlanName_UserId
  if (parts[0] === 'vip') {
    const plan = parts[1];
    const uid = parts[2];
    await User.findOneAndUpdate({ userId: uid }, { vip: true, vipPlan: plan });
    ctx.reply(`✅ ${plan} VIP Activated!`);
  }
});

/* ---------------- SERVER START ---------------- */
const start = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    console.log('✅ MongoDB Connected');

    app.listen(PORT, () => console.log(`✅ Web Server on ${PORT}`));

    await bot.launch();
    console.log('🤖 Bot Online');
  } catch (err) {
    console.error('Startup Error:', err);
  }
};

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

