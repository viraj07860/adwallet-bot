require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- CONFIGURATION ---------------- */
const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REWARD_SECRET = process.env.REWARD_SECRET || 'adwallet7062';
// Ensure URL doesn't have trailing slash for consistency
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const FORCE_CHANNEL = '@AdWalletCommunity';

// Error check for environment variables
if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('❌ CRITICAL: BOT_TOKEN or WEBAPP_URL missing in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- DATA STORAGE (In-Memory) ---------------- */
// NOTE: On Railway/Render, this resets every time the server restarts.
const users = {};
const withdrawals = [];

/* ---------------- ECONOMY SETTINGS ---------------- */
const AD_REWARD_BASE = 0.05;   // Matches frontend display
const REF_REWARD = 0.075;      // Matches frontend display
const DAILY_BONUS = 0.25;     // Matches frontend display

const VIP_PLANS = {
  Bronze: 425,
  Silver: 850,
  Gold: 1275,
  Platinum: 2125,
  Diamond: 3200,
  Elite: 4250
};

/* ---------------- HELPERS ---------------- */
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
      lastReward: 0,
      vip: false,
      vipPlan: null
    };
  } else if (username && (users[id].username === 'User' || !users[id].username)) {
    users[id].username = username;
  }
  return users[id];
}

async function isUserJoined(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    console.log('Join check error:', e.message);
    return false;
  }
}

/* ---------------- API ROUTES ---------------- */

// Get user profile data
app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  const user = ensureUser(id);
  res.json({
    username: user.username,
    balance: Number(user.balance || 0),
    tasks: Number(user.tasks || 0),
    referralCount: Number(user.referralCount || 0),
    referralEarnings: Number(user.referralEarnings || 0),
    vip: Boolean(user.vip),
    vipPlan: user.vipPlan || null
  });
});

// Reward logic for watching ads
app.get('/api/reward', (req, res) => {
  const { userid, userId, key } = req.query;
  const id = String(userid || userId || '');

  if (key !== REWARD_SECRET) return res.status(403).send('INVALID_KEY');
  if (!id) return res.status(400).send('NO_USER');

  const user = ensureUser(id);
  const now = Date.now();

  // 5-second cooldown between rewards
  if (now - user.lastReward < 5000) return res.status(429).send('TOO_FAST');

  let reward = AD_REWARD_BASE;

  // VIP Multipliers
  if (user.vip) {
    const boost = {
      Bronze: 1.2, Silver: 1.5, Gold: 2, 
      Platinum: 2.5, Diamond: 3, Elite: 4
    };
    reward *= boost[user.vipPlan] || 1;
  }

  user.balance += reward;
  user.tasks += 1;
  user.lastReward = now;

  return res.send('OK');
});

// Generate Stars Invoice Link
app.get('/api/vip-invoice', async (req, res) => {
  try {
    const plan = req.query.plan;
    if (!VIP_PLANS[plan]) return res.status(400).json({ ok: false, error: 'Invalid plan' });

    const amount = VIP_PLANS[plan];
    const invoiceUrl = await bot.telegram.createInvoiceLink({
      title: `${plan} VIP Plan`,
      description: `Upgrade to ${plan} for higher ad rewards and bonuses!`,
      payload: `vip_${plan}`,
      provider_token: '', // Empty for Telegram Stars (XTR)
      currency: 'XTR',
      prices: [{ label: `${plan} VIP`, amount }]
    });

    res.json({ ok: true, invoiceUrl });
  } catch (err) {
    console.error('Invoice Error:', err);
    res.status(500).json({ ok: false, error: 'Could not create invoice' });
  }
});

// Handle Withdrawal Requests
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, details } = req.body;
  const id = String(userId || '');
  const amt = Number(amount);

  if (!id || isNaN(amt)) return res.json({ success: false, message: 'Invalid request' });

  const user = ensureUser(id);

  if (amt < 100) return res.json({ success: false, message: 'Minimum $100 required' });
  if (amt > user.balance) return res.json({ success: false, message: 'Insufficient balance' });

  user.balance -= amt;
  withdrawals.unshift({
    userId: id,
    username: user.username,
    amount: amt,
    method,
    details,
    status: 'pending',
    time: new Date().toLocaleTimeString()
  });

  res.json({ success: true });
});

/* ---------------- TELEGRAM BOT LOGIC ---------------- */

async function handleStart(ctx) {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const refId = String(ctx.startPayload || '').trim();

  // 1. Check Channel Subscription
  const joined = await isUserJoined(ctx, userId);
  if (!joined) {
    return ctx.reply(
      `👋 Hello ${username}!\n\nTo use AdWallet, you must join our official community first.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Join Community', url: `https://t.me/${FORCE_CHANNEL.replace('@','')}` }],
            [{ text: "✅ I've Joined", callback_data: 'check_join' }]
          ]
        }
      }
    );
  }

  const user = ensureUser(userId, username);

  // 2. Handle Referral Logic
  if (refId && refId !== userId && !user.referredBy) {
    const referrer = ensureUser(refId);
    user.referredBy = refId;
    
    referrer.referralCount += 1;
    referrer.referralEarnings += REF_REWARD;
    referrer.balance += REF_REWARD;
    referrer.referralList.push({ username, date: new Date().toLocaleDateString() });

    try {
      await ctx.telegram.sendMessage(refId, `👥 New Referral! <b>${username}</b> joined.\n💰 <b>+$${REF_REWARD}</b> added to your balance.`, { parse_mode: 'HTML' });
    } catch (e) {}
  }

  // 3. Welcome Message with WebApp Button
  await ctx.reply(
    `🚀 <b>Welcome to AdWallet, ${username}!</b>\n\nWatch ads, complete offers, and earn real money directly to your wallet.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Open AdWallet', web_app: { url: `${WEBAPP_URL}/?id=${userId}` } }],
          [{ text: '📢 Join Community', url: `https://t.me/${FORCE_CHANNEL.replace('@','')}` }]
        ]
      }
    }
  );
}

bot.start(handleStart);

bot.action('check_join', async (ctx) => {
  const joined = await isUserJoined(ctx, ctx.from.id);
  if (joined) {
    await ctx.answerCbQuery('✅ Welcome to AdWallet!');
    return handleStart(ctx);
  }
  await ctx.answerCbQuery('❌ You haven\'t joined @AdWalletCommunity yet!', { show_alert: true });
});

// Handle Payments (Telegram Stars)
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('message', async (ctx) => {
  if (ctx.message.successful_payment) {
    const userId = String(ctx.from.id);
    const payload = ctx.message.successful_payment.invoice_payload;
    const user = ensureUser(userId);

    if (payload.startsWith('vip_')) {
      const plan = payload.split('_')[1];
      user.vip = true;
      user.vipPlan = plan;
      await ctx.reply(`💎 <b>Payment Received!</b>\nYour <b>${plan} VIP</b> status has been activated. Enjoy boosted rewards!`, { parse_mode: 'HTML' });
    }
  }
});

/* ---------------- SERVER START ---------------- */
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  try {
    await bot.launch();
    console.log('🤖 Bot is online');
  } catch (err) {
    console.error('Bot launch failed:', err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
