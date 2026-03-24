require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const CHANNEL = "@AdWalletCommunity";
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== DATA STORAGE (Note: Data resets on restart until MongoDB is added) =====
const users = {};

// ===== BOT LOGIC =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  const startPayload = ctx.payload;

  if (!users[userId]) {
    users[userId] = {
      balance: 0,
      tasks: 0,
      username: username,
      referralList: [],
      isSubscribed: false,
      lastAdTime: 0
    };

    if (startPayload && users[startPayload] && startPayload != userId) {
      users[startPayload].balance += 5;
      users[startPayload].referralList.push({ username, date: new Date().toLocaleDateString() });
      ctx.telegram.sendMessage(startPayload, `👥 New Referral! ${username} joined. You earned ₹5!`);
    }
  }

  try {
    const member = await ctx.telegram.getChatMember(CHANNEL, userId);
    if (["member", "administrator", "creator"].includes(member.status)) {
      users[userId].isSubscribed = true;
      return sendApp(ctx);
    }
  } catch (e) { console.log("Sub check error"); }

  ctx.reply(`Welcome ${username}! 🚀\n\nJoin our community to start earning.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 Join Channel", url: "https://t.me/AdWalletCommunity" }],
        [{ text: "✅ I Have Joined", callback_data: "check_sub" }]
      ]
    }
  });
});

bot.action("check_sub", async (ctx) => {
  const userId = ctx.from.id;
  try {
    const member = await ctx.telegram.getChatMember(CHANNEL, userId);
    if (["member", "administrator", "creator"].includes(member.status)) {
      if (users[userId]) users[userId].isSubscribed = true;
      return sendApp(ctx);
    }
    await ctx.answerCbQuery("❌ Please join @AdWalletCommunity first!", { show_alert: true });
  } catch (err) { ctx.answerCbQuery("⚠️ Error"); }
});

function sendApp(ctx) {
  const userId = ctx.from.id;
  // Passing the ID to the Mini App via URL Query
  const webAppUrl = `https://${process.env.RAILWAY_STATIC_URL || 'your-app-url.up.railway.app'}/?id=${userId}`;
  
  return ctx.reply("✨ Access Granted! Start earning now:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Open AdzWallet", web_app: { url: webAppUrl } }]
      ]
    }
  });
}

// ===== API ENDPOINTS =====
app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  if (!users[id]) return res.status(404).json({ error: "User not found" });
  res.json(users[id]);
});

app.get('/api/adsgram-reward', (req, res) => {
  const { userId } = req.query;
  const now = Date.now();

  if (!userId || !users[userId]) return res.status(400).json({ success: false });

  // 30-second cooldown to prevent spamming the "Earn" button
  if (users[userId].lastAdTime && (now - users[userId].lastAdTime < 30000)) {
    return res.status(429).json({ success: false, message: "Wait 30s" });
  }

  users[userId].balance += 20;
  users[userId].tasks += 1;
  users[userId].lastAdTime = now;

  res.json({ success: true, balance: users[userId].balance, tasks: users[userId].tasks });
});

// ===== STARTUP & SHUTDOWN =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server on port ${PORT}`);
  bot.launch().catch(err => console.error("Bot fail:", err));
});

// Prevent 409 Conflicts during Railway redeploys
process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });

