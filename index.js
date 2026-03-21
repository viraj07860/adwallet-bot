require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const app = express();

// ✅ Railway port fix
const PORT = process.env.PORT || 8080;

// ===== MONGODB CONNECTION =====
mongoose.connect(process.env.MONGO_URL)
.then(() => console.log("MongoDB connected ✅"))
.catch(err => console.log("MongoDB error ❌", err));

// ===== BOT SETUP =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== BOT COMMANDS =====
bot.start((ctx) => {
  ctx.reply('🚀 AdWallet Bot is Live!');
});

// ===== START BOT =====
(async () => {
  try {
    console.log("Starting bot...");
    await bot.launch();
    console.log("Bot started ✅");
  } catch (err) {
    console.error("Startup error:", err);
  }
})();

// ===== WEB SERVER =====
app.get('/', (req, res) => {
  res.send('🔥 AdWallet Bot is Running Successfully!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
