// mongodbPing.js
//
// Beginner-friendly MongoDB Atlas connectivity check for Node.js.
//
// Install:
//   npm install mongodb dotenv
//
// Run:
//   node mongodbPing.js
//
// Optional local fallback file:
//   config.json
//   {
//     "MONGODB_URI": "your_mongodb_connection_string"
//   }
//
// Do not paste your real connection string into this file.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  let client;

  try {
    console.log('1. Looking for MongoDB connection string...');

    // Prefer environment variables first.
    let mongoUri = process.env.MONGODB_URI;

    // If not found, try a local config.json file.
    if (!mongoUri) {
      console.log('   MONGODB_URI not found in environment variables.');
      console.log('   Trying config.json fallback...');

      const configPath = path.join(__dirname, 'config.json');

      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(raw);
        mongoUri = config.MONGODB_URI;
      }
    }

    // Stop early if no connection string exists.
    if (!mongoUri) {
      throw new Error('MONGODB_URI was not found in environment variables or config.json');
    }

    console.log('2. Creating MongoDB client...');
    client = new MongoClient(mongoUri);

    console.log('3. Connecting to MongoDB Atlas...');
    await client.connect();

    console.log('4. Sending ping command...');
    await client.db('admin').command({ ping: 1 });

    console.log('✅ Success: Connected to MongoDB Atlas and ping succeeded.');
  } catch (error) {
    console.error('❌ Error: Could not connect to MongoDB Atlas or ping failed.');
    console.error(`   ${error.message}`);
  } finally {
    // Always close the connection so the process exits cleanly.
    if (client) {
      console.log('5. Closing MongoDB connection...');
      await client.close();
      console.log('Connection closed.');
    }
  }
}

main();
