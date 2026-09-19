const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const User = require("../models/User");
const Expense = require("../models/Expense");
const PasswordResetToken = require("../models/PasswordResetToken");

const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const dataDirectory = path.join(__dirname, "../data");
const tmpDirectory  = isVercel ? "/tmp" : dataDirectory;

fs.mkdirSync(dataDirectory, { recursive: true });
if (isVercel && !fs.existsSync(tmpDirectory)) {
  try { fs.mkdirSync(tmpDirectory, { recursive: true }); } catch {}
}

const usersFile      = path.join(tmpDirectory, "users.json");
const expensesFile   = path.join(tmpDirectory, "expenses.json");
const tokensFile     = path.join(tmpDirectory, "password-reset-tokens.json");

const bundledUsers    = path.join(dataDirectory, "users.json");
const bundledExpenses = path.join(dataDirectory, "expenses.json");
const bundledTokens   = path.join(dataDirectory, "password-reset-tokens.json");

// On cold start on Vercel, copy seed JSON files if they don't exist in tmp
if (isVercel) {
  if (!fs.existsSync(usersFile) && fs.existsSync(bundledUsers)) {
    try { fs.copyFileSync(bundledUsers, usersFile); } catch {}
  }
  if (!fs.existsSync(expensesFile) && fs.existsSync(bundledExpenses)) {
    try { fs.copyFileSync(bundledExpenses, expensesFile); } catch {}
  }
  if (!fs.existsSync(tokensFile) && fs.existsSync(bundledTokens)) {
    try { fs.copyFileSync(bundledTokens, tokensFile); } catch {}
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    // If running on local server, also keep bundled file updated
    if (!isVercel && filePath !== bundledUsers && filePath.includes("tmp")) {
      const base = path.basename(filePath);
      fs.writeFileSync(path.join(dataDirectory, base), JSON.stringify(data, null, 2), "utf8");
    }
  } catch (err) {
    console.error("writeJson error:", err.message);
  }
}

let isMongoConnected = false;
let mongoConnectingPromise = null;

async function connectMongo() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) return false;
  if (isMongoConnected) return true;
  if (mongoConnectingPromise) return mongoConnectingPromise;

  mongoConnectingPromise = (async () => {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      isMongoConnected = true;
      console.log("Connected to persistent MongoDB Atlas database.");

      // Seed MongoDB if empty
      const userCount = await User.countDocuments();
      if (userCount === 0 && fs.existsSync(bundledUsers)) {
        const seedUsersMap = readJson(bundledUsers, {});
        const userDocs = Object.entries(seedUsersMap).map(([email, u]) => ({
          email: email.toLowerCase(),
          name: u.name,
          password: u.password
        }));
        if (userDocs.length > 0) {
          await User.insertMany(userDocs);
          console.log(`Seeded ${userDocs.length} users into MongoDB.`);
        }
      }

      const expenseCount = await Expense.countDocuments();
      if (expenseCount === 0 && fs.existsSync(bundledExpenses)) {
        const seedExpensesMap = readJson(bundledExpenses, {});
        const expenseDocs = [];
        for (const [email, list] of Object.entries(seedExpensesMap)) {
          for (const item of list) {
            expenseDocs.push({
              id: item.id,
              email: email.toLowerCase(),
              amount: item.amount,
              description: item.description,
              category: item.category,
              categorySource: item.categorySource || "fallback"
            });
          }
        }
        if (expenseDocs.length > 0) {
          await Expense.insertMany(expenseDocs);
          console.log(`Seeded ${expenseDocs.length} expenses into MongoDB.`);
        }
      }

      const tokenCount = await PasswordResetToken.MongooseModel.countDocuments();
      if (tokenCount === 0 && fs.existsSync(bundledTokens)) {
        const seedTokens = readJson(bundledTokens, []);
        if (Array.isArray(seedTokens) && seedTokens.length > 0) {
          await PasswordResetToken.MongooseModel.insertMany(seedTokens.map(t => ({
            id: t.id,
            userId: t.userId,
            tokenHash: t.tokenHash,
            createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
            expiresAt: t.expiresAt ? new Date(t.expiresAt) : new Date(Date.now() + 15 * 60 * 1000),
            usedAt: t.usedAt ? new Date(t.usedAt) : null
          })));
          console.log(`Seeded ${seedTokens.length} reset tokens into MongoDB.`);
        }
      }

      return true;
    } catch (error) {
      console.warn("MongoDB connection failed, falling back to persistent JSON storage:", error.message);
      isMongoConnected = false;
      mongoConnectingPromise = null;
      return false;
    }
  })();

  return mongoConnectingPromise;
}

// Initialize on load
connectMongo().catch(() => {});

// --- DATABASE API ---

async function getUser(email) {
  const normEmail = String(email || "").trim().toLowerCase();
  if (await connectMongo()) {
    const userDoc = await User.findOne({ email: normEmail }).lean();
    if (!userDoc) return null;
    return { name: userDoc.name, password: userDoc.password, email: userDoc.email };
  }
  const usersMap = readJson(usersFile, readJson(bundledUsers, {}));
  const u = usersMap[normEmail];
  if (!u) return null;
  return { name: u.name, password: u.password, email: normEmail };
}

async function createUser({ name, email, password }) {
  const normEmail = String(email || "").trim().toLowerCase();
  const trimmedName = String(name || "").trim();
  if (await connectMongo()) {
    const existing = await User.findOne({ email: normEmail });
    if (existing) {
      const err = new Error("An account with this email already exists.");
      err.statusCode = 409;
      throw err;
    }
    const newUser = await User.create({ email: normEmail, name: trimmedName, password });
    return { name: newUser.name, email: newUser.email };
  }
  const usersMap = readJson(usersFile, readJson(bundledUsers, {}));
  if (usersMap[normEmail]) {
    const err = new Error("An account with this email already exists.");
    err.statusCode = 409;
    throw err;
  }
  usersMap[normEmail] = { name: trimmedName, password };
  writeJson(usersFile, usersMap);
  return { name: trimmedName, email: normEmail };
}

async function updateUserPassword(email, hashedPassword) {
  const normEmail = String(email || "").trim().toLowerCase();
  if (await connectMongo()) {
    const updated = await User.findOneAndUpdate(
      { email: normEmail },
      { password: hashedPassword },
      { new: true }
    );
    if (!updated) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      throw err;
    }
    return true;
  }
  const usersMap = readJson(usersFile, readJson(bundledUsers, {}));
  if (!usersMap[normEmail]) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }
  usersMap[normEmail].password = hashedPassword;
  writeJson(usersFile, usersMap);
  return true;
}

async function getExpenses(email) {
  const normEmail = String(email || "").trim().toLowerCase();
  if (await connectMongo()) {
    const list = await Expense.find({ email: normEmail }).sort({ id: 1 }).lean();
    return list.map(e => ({
      id: e.id,
      amount: e.amount,
      description: e.description,
      category: e.category,
      categorySource: e.categorySource || "fallback"
    }));
  }
  const expensesMap = readJson(expensesFile, readJson(bundledExpenses, {}));
  return expensesMap[normEmail] || [];
}

async function getNextExpenseId() {
  if (await connectMongo()) {
    const maxDoc = await Expense.findOne().sort({ id: -1 }).lean();
    return (maxDoc ? maxDoc.id : 0) + 1;
  }
  const expensesMap = readJson(expensesFile, readJson(bundledExpenses, {}));
  const allExpenses = Object.values(expensesMap).flat();
  return allExpenses.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
}

async function addExpense({ email, amount, description, category, categorySource }) {
  const normEmail = String(email || "").trim().toLowerCase();
  const nextId = await getNextExpenseId();
  const newRecord = {
    id: nextId,
    amount: Number(amount),
    description: String(description).trim(),
    category: String(category),
    categorySource: categorySource || "fallback"
  };

  if (await connectMongo()) {
    await Expense.create({
      id: nextId,
      email: normEmail,
      amount: newRecord.amount,
      description: newRecord.description,
      category: newRecord.category,
      categorySource: newRecord.categorySource
    });
    return newRecord;
  }

  const expensesMap = readJson(expensesFile, readJson(bundledExpenses, {}));
  const userList = expensesMap[normEmail] || [];
  userList.push(newRecord);
  expensesMap[normEmail] = userList;
  writeJson(expensesFile, expensesMap);
  return newRecord;
}

async function deleteExpense(email, expenseId) {
  const normEmail = String(email || "").trim().toLowerCase();
  const idNum = Number.parseInt(expenseId, 10);
  if (await connectMongo()) {
    const res = await Expense.deleteOne({ email: normEmail, id: idNum });
    if (res.deletedCount === 0) {
      const err = new Error("Expense not found.");
      err.statusCode = 404;
      throw err;
    }
    return true;
  }
  const expensesMap = readJson(expensesFile, readJson(bundledExpenses, {}));
  const userList = expensesMap[normEmail] || [];
  const idx = userList.findIndex(e => e.id === idNum);
  if (idx === -1) {
    const err = new Error("Expense not found.");
    err.statusCode = 404;
    throw err;
  }
  userList.splice(idx, 1);
  expensesMap[normEmail] = userList;
  writeJson(expensesFile, expensesMap);
  return true;
}

async function getLeaderboard(limit = 10) {
  if (await connectMongo()) {
    const users = await User.find().lean();
    const expenses = await Expense.find().lean();
    const totalsByEmail = {};
    for (const e of expenses) {
      totalsByEmail[e.email] = (totalsByEmail[e.email] || 0) + Number(e.amount || 0);
    }
    return users
      .map(u => ({ name: u.name, email: u.email, totalExpense: totalsByEmail[u.email] || 0 }))
      .sort((a, b) => b.totalExpense - a.totalExpense)
      .slice(0, limit)
      .map((u, i) => ({ rank: i + 1, ...u }));
  }
  const usersMap = readJson(usersFile, readJson(bundledUsers, {}));
  const expensesMap = readJson(expensesFile, readJson(bundledExpenses, {}));
  const totalsByEmail = {};
  for (const [email, list] of Object.entries(expensesMap)) {
    totalsByEmail[email] = (list || []).reduce((t, e) => t + Number(e.amount || 0), 0);
  }
  return Object.entries(usersMap)
    .map(([email, user]) => ({ name: user.name, email, totalExpense: totalsByEmail[email] || 0 }))
    .sort((a, b) => b.totalExpense - a.totalExpense)
    .slice(0, limit)
    .map((u, i) => ({ rank: i + 1, ...u }));
}

// --- PASSWORD RESET TOKEN API ---

async function createResetToken({ email, rawToken, expiresInMs = 15 * 60 * 1000 }) {
  const record = PasswordResetToken.create({ userId: email, rawToken, expiresInMs });

  if (await connectMongo()) {
    await PasswordResetToken.MongooseModel.create({
      id: record.id,
      userId: record.userId,
      tokenHash: record.tokenHash,
      createdAt: new Date(record.createdAt),
      expiresAt: new Date(record.expiresAt),
      usedAt: null
    });
    return record;
  }

  const tokensList = readJson(tokensFile, readJson(bundledTokens, []));
  tokensList.push(record);
  writeJson(tokensFile, tokensList);
  return record;
}

async function getResetTokenByHash(tokenHash) {
  if (!tokenHash) return null;
  if (await connectMongo()) {
    const doc = await PasswordResetToken.MongooseModel.findOne({ tokenHash }).lean();
    if (!doc) return null;
    return {
      id: doc.id,
      userId: doc.userId,
      tokenHash: doc.tokenHash,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
      usedAt: doc.usedAt ? new Date(doc.usedAt).toISOString() : null
    };
  }

  const tokensList = readJson(tokensFile, readJson(bundledTokens, []));
  const record = tokensList.find(t => t.tokenHash === tokenHash);
  return record || null;
}

async function markTokenUsed(tokenIdOrHash) {
  const nowStr = new Date().toISOString();
  if (await connectMongo()) {
    await PasswordResetToken.MongooseModel.updateOne(
      { $or: [{ id: tokenIdOrHash }, { tokenHash: tokenIdOrHash }] },
      { usedAt: new Date() }
    );
    return true;
  }

  const tokensList = readJson(tokensFile, readJson(bundledTokens, []));
  const record = tokensList.find(t => t.id === tokenIdOrHash || t.tokenHash === tokenIdOrHash);
  if (record) {
    record.usedAt = nowStr;
    writeJson(tokensFile, tokensList);
  }
  return true;
}

module.exports = {
  getUser,
  createUser,
  updateUserPassword,
  getExpenses,
  addExpense,
  deleteExpense,
  getLeaderboard,
  createResetToken,
  getResetTokenByHash,
  markTokenUsed,
  connectMongo
};
