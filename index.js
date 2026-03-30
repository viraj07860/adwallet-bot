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
const WEBAPP_URL = (process.env.WEBAPP_URL || '').trim().replace(/\/+$/, '');
const FORCE_CHANNEL = '@AdWalletCommunity';

// Admin ID set here so you don't even need to worry about the .env variable
const ADMIN_ID = process.env.ADMIN_ID || '6259396688'; 

if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('❌ CRITICAL: BOT_TOKEN or WEBAPP_URL missing');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- DATA STORAGE (In-Memory) ---------------- */
const users = {};
const withdrawals = [];
const manualRequests = [];

/* ---------------- ECONOMY SETTINGS ---------------- */
const AD_REWARD_BASE = 0.05;
const REF_REWARD = 0.075;

const VIP_PLANS = {
  Bronze: 425, Silver: 850, Gold: 1275,
  Platinum: 2125, Diamond: 3200, Elite: 4250
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
      lastDailyBonus: '', // Added to track daily bonus
      vip: false,
      vipPlan: null,
      isWaitingForProof: false
    };
  }
  return users[id];
}

async function isUserJoined(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) { return false; }
}

/* ---------------- API ROUTES ---------------- */

// Get User Profile
app.get('/user/:id', (req, res) => {
  const user = ensureUser(req.params.id);
  res.json({
    balance: Number(user.balance.toFixed(4)),
    tasks: user.tasks,
    vip: user.vip,
    vipPlan: user.vipPlan,
    referralCount: user.referralCount
  });
});

// Reward for Ads
app.get('/api/reward', (req, res) => {
  const { userId, key } = req.query;
  if (key !== REWARD_SECRET) return res.status(403).send('Forbidden');

  const user = ensureUser(userId);
  const now = Date.now();
  if (now - user.lastReward < 5000) return res.status(429).send('Wait');

  let reward = AD_REWARD_BASE;
  if (user.vip) {
    const boost = { Bronze: 1.2, Silver: 1.5, Gold: 2, Platinum: 2.5, Diamond: 3, Elite: 4 };
    reward *= boost[user.vipPlan] || 1;
  }

  user.balance += reward;
  user.tasks += 1;
  user.lastReward = now;
  res.send('OK');
});

// Daily Bonus Claim
app.post('/api/claim-daily-bonus', (req, res) => {
  const { userId } = req.body;
  const id = String(userId || '');

  if (!id) return res.json({ success: false, message: 'Invalid request' });

  const user = ensureUser(id);
  const today = new Date().toDateString();

  if (user.lastDailyBonus === today) {
    return res.json({ success: false, message: 'Come back tomorrow!' });
  }

  const bonusAmount = 5.00; // $5 daily bonus
  user.balance += bonusAmount;
  user.lastDailyBonus = today;

  console.log(`🎁 Daily Bonus Claimed: ${user.username} got $${bonusAmount}`);
  return res.json({ success: true, newBalance: user.balance });
});

// Withdrawal Request
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, details } = req.body;
  const user = ensureUser(userId);
  const amt = Number(amount);

  if (amt < 100 || amt > user.balance) return res.json({ success: false, message: 'Invalid Amount' });

  user.balance -= amt;
  withdrawals.unshift({ userId, amount: amt, method, details, status: 'pending', date: new Date() });
  res.json({ success: true });
});

/* ---------------- BOT LOGIC ---------------- */

// /start command
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'User';
  const refId = String(ctx.startPayload || '').trim();

  const joined = await isUserJoined(ctx, userId);
  if (!joined) {
    return ctx.reply(`🚫 Please join ${FORCE_CHANNEL} to use this bot.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 Join Channel', url: `https://t.me/${FORCE_CHANNEL.replace('@','')}` }],
          [{ text: '✅ I Have Joined', callback_data: 'check_join' }]
        ]
      }
    });
  }

  const user = ensureUser(userId, username);

  if (refId && refId !== userId && !user.referredBy) {
    const referrer = ensureUser(refId);
    user.referredBy = refId;
    referrer.balance += REF_REWARD;
    referrer.referralCount += 1;
    referrer.referralEarnings += REF_REWARD;
    try {
      await ctx.telegram.sendMessage(refId, `👥 New Referral: ${username}\n💰 +$${REF_REWARD} added!`);
    } catch (e) {}
  }

  ctx.reply(`🚀 Welcome to AdWallet!\nEarn money by watching ads.`, {
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Open AdWallet', web_app: { url: `${WEBAPP_URL}/?id=${userId}` } }]]
    }
  });
});

// Manual /activate command (Handles both Admin and Users)
bot.command('activate', async (ctx) => {
  const userId = String(ctx.from.id);

  // 1. ADMIN LOGIC: If YOU send the command
  if (userId === ADMIN_ID) {
    const messageText = ctx.message.text.trim();
    const args = messageText.split(/\s+/); 

    if (args.length !== 3) {
      return ctx.reply(
        `⚠️ <b>Admin Command Usage:</b>\n<code>/activate &lt;UserId&gt; &lt;Plan&gt;</code>\n\n<b>Example:</b> <code>/activate 123456789 Gold</code>\n\n<b>Valid Plans:</b> Bronze, Silver, Gold, Platinum, Diamond, Elite`,
        { parse_mode: 'HTML' }
      );
    }

    const targetUserId = args[1];
    const targetPlan = args[2];

    if (!Object.keys(VIP_PLANS).includes(targetPlan)) {
      return ctx.reply(`❌ Invalid VIP Plan. Choose from: Bronze, Silver, Gold, Platinum, Diamond, Elite`);
    }

    const targetUser = ensureUser(targetUserId);
    targetUser.vip = true;
    targetUser.vipPlan = targetPlan;
    targetUser.isWaitingForProof = false;

    await ctx.reply(`✅ <b>Success!</b>\nUser <code>${targetUserId}</code> has been upgraded to <b>${targetPlan} VIP</b>.`, { parse_mode: 'HTML' });

    try {
      await bot.telegram.sendMessage(
        targetUserId,
        `🎉 <b>Congratulations!</b>\n\nYour payment has been verified and your <b>${targetPlan} VIP</b> plan is now active!\n\nOpen the app to start earning with your new multiplier.`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Open App', web_app: { url: `${WEBAPP_URL}/?id=${targetUserId}` } }]]
          }
        }
      );
    } catch (err) {
      await ctx.reply(`⚠️ Note: User account upgraded, but they could not be notified (they may have blocked the bot).`);
    }
    return; 
  }

  // 2. REGULAR USER LOGIC
  const user = ensureUser(userId);
  user.isWaitingForProof = true;

  await ctx.reply(
    `💎 <b>Manual VIP Activation</b>\n\n1. Send payment to the crypto address in the App.\n2. <b>Send the Screenshot (Photo)</b> of your payment here.\n\nAdmin will verify and activate your account within 24h.`,
    { parse_mode: 'HTML' }
  );
});

// Handling Photos (Screenshots)
bot.on('photo', async (ctx) => {
  const userId = String(ctx.from.id);
  const user = ensureUser(userId);

  if (user.isWaitingForProof) {
    user.isWaitingForProof = false;
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    manualRequests.push({ userId, photoId, status: 'pending' });

    await ctx.reply('✅ Screenshot received! Admin will review your payment shortly.');

    if (ADMIN_ID) {
      await ctx.telegram.sendPhoto(ADMIN_ID, photoId, {
        caption: `🔔 <b>New VIP Proof</b>\nUser: ${user.username}\nID: <code>${userId}</code>\n\nTo approve, type:\n<code>/activate ${userId} Gold</code>`,
        parse_mode: 'HTML'
      });
    }
  }
});

// Handle successful Telegram Stars payments
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('message', async (ctx, next) => {
  if (ctx.message?.successful_payment) {
    const userId = String(ctx.from.id);
    const plan = ctx.message.successful_payment.invoice_payload.replace('vip_', '');
    const user = ensureUser(userId);
    user.vip = true;
    user.vipPlan = plan;
    await ctx.reply(`✅ Congratulations! Your ${plan} VIP is now active.`);
  }
  return next();
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
  console.log(`✅ Web Server running on port ${PORT}`);
  try {
    await bot.launch();
    console.log('🤖 Telegram Bot connected');
  } catch (err) {
    console.error('Bot launch error:', err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
