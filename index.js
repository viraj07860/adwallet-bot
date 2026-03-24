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

// ===== DATA STORAGE (Note: Use MongoDB for permanent storage later) =====
const users = {}; 

// ===== BOT: START & REFERRAL LOGIC =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  
  // Extract Referral ID from /start command (e.g., /start 12345)
  const startPayload = ctx.payload; 

  if (!users[userId]) {
    users[userId] = { 
      balance: 0, 
      tasks: 0, 
      username: username,
      referralList: [], 
      withdrawalHistory: [],
      isSubscribed: false 
    };

    // If joined via referral link
    if (startPayload && users[startPayload] && startPayload != userId) {
      users[startPayload].balance += 5; // Reward referrer
      users[startPayload].referralList.push({ 
        username: username, 
        date: new Date().toLocaleDateString() 
      });
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

  // Force Subscribe Message
  ctx.reply(`Welcome ${username}! 🚀\n\nTo use @AdzwalletBot, you must join our community channel first.`, {
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
      await ctx.answerCbQuery("✅ Verified!");
      return sendApp(ctx);
    } else {
      ctx.answerCbQuery("❌ Please join @AdWalletCommunity first!", { show_alert: true });
    }
  } catch (err) { ctx.answerCbQuery("⚠️ Verification Error"); }
});

function sendApp(ctx) {
  return ctx.reply("✨ Access Granted! Start earning now:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Open AdzWallet", web_app: { url: "https://adwallet-bot-production.up.railway.app/" } }]
      ]
    }
  });
}

// ===== API: USER DATA (Dashboard & Referrals) =====
app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  if (!users[id]) {
    users[id] = { balance: 0, tasks: 0, username: "User", referralList: [], withdrawalHistory: [], isSubscribed: false };
  }
  res.json(users[id]);
});

// ===== API: WITHDRAWAL SYSTEM =====
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, address } = req.body;
  
  if (!users[userId] || users[userId].balance < amount) {
    return res.status(400).json({ error: "Insufficient Balance" });
  }

  // Calculate Bonus
  const hasBonus = method.includes("Bitcoin") || method.includes("Crypto");
  const finalAmount = hasBonus ? amount * 1.15 : amount;

  const record = {
    amount: finalAmount.toFixed(2),
    method: method,
    address: address,
    status: "Pending",
    date: new Date().toLocaleDateString()
  };

  // Update Data
  users[userId].balance -= amount;
  users[userId].withdrawalHistory.push(record);

  res.json({ success: true, balance: users[userId].balance });
});

// ===== API: ADS REWARD =====
app.get('/api/adsgram-reward', (req, res) => {
  const { userId } = req.query;
  if (!userId || !users[userId]) return res.status(400).send("User not found");

  users[userId].balance += 20;
  users[userId].tasks += 1;
  res.json({ success: true, balance: users[userId].balance });
});

bot.launch();
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

