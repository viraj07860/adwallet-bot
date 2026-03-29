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
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const BOT_USERNAME = (process.env.BOT_USERNAME || 'AdzwalletBot').trim();

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing');
  process.exit(1);
}

if (!WEBAPP_URL) {
  console.error('❌ WEBAPP_URL missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- TEMP MEMORY STORAGE ---------------- */
const users = {};
const withdrawals = [];

/* ---------------- VIP PRICING ---------------- */
const VIP_PLANS = {
  Bronze: 425,
  Silver: 850,
  Gold: 1275,
  Platinum: 2125,
  Diamond: 3200,
  Elite: 4250
};

function vipStarsAmount(plan) {
  return VIP_PLANS[plan] || 425;
}

function isValidVipPlan(plan) {
  return Object.prototype.hasOwnProperty.call(VIP_PLANS, plan);
}

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
  } else if (username && users[id].username === 'User') {
    users[id].username = username;
  }

  return users[id];
}

function getWebAppUrl(userId) {
  return `${WEBAPP_URL}/?id=${encodeURIComponent(userId)}`;
}

/* ---------------- ROUTES ---------------- */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  const user = ensureUser(id);

  res.json({
    balance: Number(user.balance || 0),
    tasks: Number(user.tasks || 0),
    referralCount: Number(user.referralCount || 0),
    referralEarnings: Number(user.referralEarnings || 0),
    vip: Boolean(user.vip),
    vipPlan: user.vipPlan || null
  });
});

app.get('/api/reward', (req, res) => {
  const { userid, userId, key } = req.query;
  const id = String(userid || userId || '');

  if (key !== REWARD_SECRET) {
    return res.status(403).send('INVALID_KEY');
  }

  if (!id) {
    return res.status(400).send('NO_USER');
  }

  const user = ensureUser(id);
  const now = Date.now();

  if (now - user.lastReward < 5000) {
    return res.status(429).send('TOO_FAST');
  }

  user.balance += 0.08;
  user.tasks += 1;
  user.lastReward = now;

  return res.send('OK');
});

app.get('/api/vip-invoice', async (req, res) => {
  try {
    const plan = String(req.query.plan || '').trim();

    if (!isValidVipPlan(plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan' });
    }

    const amount = vipStarsAmount(plan);

    const invoiceUrl = await bot.telegram.createInvoiceLink({
      title: `${plan} VIP Plan`,
      description: `Activate ${plan} VIP in AdWallet`,
      payload: `vip_${plan}`,
      provider_token: '',
      currency: 'XTR',
      prices: [
        { label: `${plan} VIP`, amount }
      ]
    });

    console.log(`💰 Invoice Created: ${plan} → ${amount} Stars`);
    return res.json({ ok: true, invoiceUrl });
  } catch (err) {
    console.error('VIP invoice error:', err);
    return res.status(500).json({ ok: false, error: 'Invoice error' });
  }
});

app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, details } = req.body;
  const id = String(userId || '');
  const amt = Number(amount);

  if (!id || !Number.isFinite(amt)) {
    return res.json({ success: false, message: 'Invalid request' });
  }

  const user = ensureUser(id);

  if (amt < 100) {
    return res.json({ success: false, message: 'Minimum $100' });
  }

  if (amt > user.balance) {
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

  console.log('💸 Withdraw Request:', withdrawals[0]);
  return res.json({ success: true });
});

app.get('/admin/withdrawals', (req, res) => {
  res.json(withdrawals);
});

/* ---------------- TELEGRAM BOT ---------------- */
bot.use(async (ctx, next) => {
  console.log('📩 Update:', ctx.updateType, ctx.message?.text || '');
  return next();
});

bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  if (ctx?.update) {
    console.error('Update:', JSON.stringify(ctx.update, null, 2));
  }
});

async function handleStart(ctx) {
  try {
    const userId = String(ctx.from.id);
    const username = ctx.from.username || ctx.from.first_name || 'User';
    const refId = String(ctx.startPayload || '').trim();
    const webAppUrl = getWebAppUrl(userId);

    const user = ensureUser(userId, username);

    if (refId && refId !== userId && !user.referredBy) {
      const referrer = ensureUser(refId);
      user.referredBy = refId;

      referrer.referralCount += 1;
      referrer.referralEarnings += 0.075;
      referrer.balance += 0.075;
      referrer.referralList.push({
        username,
        date: new Date().toLocaleDateString()
      });

      try {
        await ctx.telegram.sendMessage(
          refId,
          `👥 New referral joined!\n${username} started using AdWallet.\n💰 +$0.075 added`
        );
      } catch (e) {
        console.log('Referral notify failed:', e.message);
      }
    }

    await ctx.reply(
      `🚀 Welcome ${username}!\n\nStart earning by watching ads 💰`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Open AdzWallet', web_app: { url: webAppUrl } }]
          ]
        }
      }
    );
  } catch (err) {
    console.error('Start Error:', err);
    ctx.reply('❌ Something went wrong.');
  }
}

bot.start(handleStart);
bot.command('start', handleStart);

bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error('pre_checkout_query error:', e);
  }
});

bot.on('message', async (ctx, next) => {
  if (!ctx.message?.successful_payment) return next();

  const userId = String(ctx.from.id);
  const payload = String(ctx.message.successful_payment.invoice_payload || '');
  const user = ensureUser(userId, ctx.from.username || ctx.from.first_name || 'User');

  if (payload.startsWith('vip_')) {
    const plan = payload.replace('vip_', '');

    user.vip = true;
    user.vipPlan = plan;

    console.log(`✅ VIP Activated: ${userId} → ${plan}`);
    try {
      await ctx.reply(`✅ ${plan} VIP activated successfully!`);
    } catch (e) {}
    return;
  }

  return next();
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, async () => {
  console.log(`✅ Server running on ${PORT}`);

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    console.log('🤖 Bot started successfully');
  } catch (err) {
    console.error('Bot launch error:', err);
  }
});

/* ---------------- STOP HANDLERS ---------------- */
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
