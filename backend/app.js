const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
// On Vercel, /var/task is read-only — use /tmp which is always writable.
const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const dataDirectory  = path.join(__dirname, "data");
const tmpDirectory   = isVercel ? "/tmp" : dataDirectory;
const usersFile      = path.join(tmpDirectory, "users.json");
const expensesFile   = path.join(tmpDirectory, "expenses.json");
const bundledUsers   = path.join(dataDirectory, "users.json");
const bundledExpenses = path.join(dataDirectory, "expenses.json");

// On a cold start, seed /tmp from the bundled JSON so existing users are preserved.
if (isVercel) {
  if (!fs.existsSync(usersFile) && fs.existsSync(bundledUsers))
    fs.copyFileSync(bundledUsers, usersFile);
  if (!fs.existsSync(expensesFile) && fs.existsSync(bundledExpenses))
    fs.copyFileSync(bundledExpenses, expensesFile);
}
const expenseCategories = [
  "Food", "Groceries", "Transport", "Shopping", "Electronics",
  "Health", "Entertainment", "Bills & Utilities", "Housing",
  "Education", "Travel", "Other"
];

fs.mkdirSync(dataDirectory, { recursive: true });

function readData(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return fallback; }
}

function writeData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const users = new Map(Object.entries(readData(usersFile, {})));
const expenses = readData(expensesFile, {});
let nextExpenseId = Object.values(expenses).flat().reduce(
  (max, e) => Math.max(max, e.id || 0), 0
) + 1;

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

function restoreSnapshot(snapshot) {
  users.clear();
  for (const [email, userData] of Object.entries(snapshot.users)) users.set(email, userData);
  for (const key of Object.keys(expenses)) delete expenses[key];
  Object.assign(expenses, snapshot.expenses);
}

async function runTransaction(operation) {
  const snapshot = { users: deepClone(Object.fromEntries(users)), expenses: deepClone(expenses) };
  try {
    await operation();
    writeData(usersFile, Object.fromEntries(users));
    writeData(expensesFile, expenses);
    return true;
  } catch (error) {
    restoreSnapshot(snapshot);
    throw error;
  }
}

// Hash a raw reset token for safe storage (SHA-256)
function hashResetToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function knownCategoryHint(description) {
  const text = description.toLowerCase();
  const hints = {
    Food: ["pizza","lunch","dinner","breakfast","chips","biryani","burger","tea","coffee"],
    Groceries: ["grocery","groceries","vegetables","vegetable","sabzi","flour","rice","milk"],
    Transport: ["uber","taxi","petrol","fuel","diesel","bus","train"],
    Electronics: ["mobile","phone","laptop","computer","tablet","charger","headphones"],
    Health: ["doctor","medicine","medical","hospital","clinic","pharmacy"],
    Entertainment: ["movie","cinema","netflix","music","concert","game"],
    "Bills & Utilities": ["electricity","water bill","internet bill","phone bill","utility"],
    Housing: ["rent","mortgage","maintenance"],
    Education: ["college","school","course","tuition","fees"]
  };
  return Object.entries(hints).find(([, kw]) => kw.some(k => text.includes(k)))?.[0] || "Other";
}

function getAiConfig() {
  const apiKey  = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
  const model   = process.env.OPENROUTER_MODEL   || process.env.OPENAI_MODEL   || "openai/gpt-4o-mini";
  const siteUrl = process.env.OPENROUTER_SITE_URL || process.env.OPENAI_SITE_URL || "http://localhost:3001";
  const appName = process.env.OPENROUTER_APP_NAME || process.env.OPENAI_APP_NAME || "Expense Tracker";
  return { apiKey, model, siteUrl, appName };
}

async function suggestCategory(description) {
  const { apiKey, model, siteUrl, appName } = getAiConfig();
  if (!apiKey) {
    console.warn("OpenRouter API key not configured. Using fallback for:", description);
    return { category: knownCategoryHint(description), source: "fallback" };
  }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": siteUrl,
        "X-Title": appName
      },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 12,
        messages: [
          { role: "system", content: `Classify an expense into exactly one category: ${expenseCategories.join(", ")}. Reply with only the category.` },
          { role: "user", content: description }
        ]
      })
    });
    if (!response.ok) {
      let providerError = {};
      try { providerError = (await response.json())?.error || {}; } catch {}
      console.warn("OpenRouter error:", { status: response.status, message: providerError.message || response.statusText });
      return { category: knownCategoryHint(description), source: "fallback" };
    }
    const result = await response.json();
    const category = result.choices?.[0]?.message?.content?.trim().replace(/[.\n]/g, "");
    if (expenseCategories.includes(category)) {
      return { category: category === "Other" ? knownCategoryHint(description) : category, source: "ai" };
    }
  } catch (error) {
    console.warn("OpenRouter request error:", error.message);
  }
  return { category: knownCategoryHint(description), source: "fallback" };
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "../frontend/login.html")));

// ── Signup ────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!name || !normalizedEmail || !password)
    return res.status(400).json({ message: "Name, email and password are required." });
  try {
    const hashedPassword = await bcrypt.hash(String(password), 10);
    await runTransaction(async () => {
      if (users.has(normalizedEmail))
        throw Object.assign(new Error("An account with this email already exists."), { statusCode: 409 });
      users.set(normalizedEmail, { name: String(name).trim(), password: hashedPassword });
    });
    return res.status(201).json({ message: "Account created successfully." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Could not create account." });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName  = String(name  || "").trim();
  const user = users.get(normalizedEmail);
  if (!user || user.name !== normalizedName)
    return res.status(401).json({ message: "Invalid email or password." });
  const passwordMatch = await bcrypt.compare(String(password || ""), user.password);
  if (!passwordMatch)
    return res.status(401).json({ message: "Invalid email or password." });
  return res.json({ message: "Login successful.", user: { name: user.name, email: normalizedEmail } });
});

// ── Forgot Password ───────────────────────────────────────────────────────────
app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ message: "Email is required." });
  if (!users.has(email))
    return res.status(200).json({ message: "If an account exists for this email, a reset link has been sent." });

  const rawToken  = crypto.randomUUID();
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

  try {
    await runTransaction(async () => {
      const user = users.get(email);
      user.resetTokenHash   = tokenHash;
      user.resetTokenExpiry = expiresAt;
    });
  } catch (err) {
    console.error("forgot-password error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }

  const resetUrl = `/reset-password.html?token=${encodeURIComponent(rawToken)}`;
  return res.status(200).json({ message: "Password reset link created successfully.", resetToken: rawToken, resetUrl });
});

// ── Reset Password ────────────────────────────────────────────────────────────
app.post("/api/auth/reset-password", async (req, res) => {
  const token    = String(req.body.token    || "").trim();
  const password = String(req.body.password || "").trim();
  if (!token || !password)
    return res.status(400).json({ message: "Reset token and password are required." });
  if (password.length < 6)
    return res.status(400).json({ message: "Password must be at least 6 characters long." });

  const tokenHash = hashResetToken(token);
  let matchedEmail = null, matchedUser = null;
  for (const [email, user] of users.entries()) {
    if (user.resetTokenHash && user.resetTokenHash === tokenHash) {
      matchedEmail = email; matchedUser = user; break;
    }
  }
  if (!matchedUser)
    return res.status(400).json({ message: "Invalid or expired reset token." });
  if (!matchedUser.resetTokenExpiry || Date.now() > matchedUser.resetTokenExpiry)
    return res.status(400).json({ message: "Invalid or expired reset token." });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await runTransaction(async () => {
      matchedUser.password        = hashedPassword;
      delete matchedUser.resetTokenHash;
      delete matchedUser.resetTokenExpiry;
    });
    return res.status(200).json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("reset-password error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ── Expenses ──────────────────────────────────────────────────────────────────
app.get("/api/expenses", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  return res.json(expenses[email] || []);
});

async function categorizeExpense(req, res) {
  const description = String(req.body.description || "").trim();
  if (!description) return res.status(400).json({ message: "Description is required." });
  return res.json(await suggestCategory(description));
}
app.post("/api/categorize-expense", categorizeExpense);
app.post("/api/ai/categorize",      categorizeExpense);

app.post("/api/expenses", async (req, res) => {
  const { email, amount, description, category, categorySource } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const numericAmount   = Number(amount);
  if (!normalizedEmail || !Number.isFinite(numericAmount) || numericAmount <= 0 || !String(description || "").trim())
    return res.status(400).json({ message: "Email, valid amount and description are required." });
  try {
    const normalizedDescription = String(description).trim();
    const categoryResult = expenseCategories.includes(category)
      ? { category, source: categorySource === "ai" ? "ai" : "fallback" }
      : await suggestCategory(normalizedDescription);
    await runTransaction(async () => {
      const userExpenses = expenses[normalizedEmail] || [];
      userExpenses.push({ id: nextExpenseId++, amount: numericAmount, description: normalizedDescription, category: categoryResult.category, categorySource: categoryResult.source });
      expenses[normalizedEmail] = userExpenses;
    });
    return res.status(201).json({ id: nextExpenseId - 1, amount: numericAmount, description: String(description).trim(), category: categoryResult.category, categorySource: categoryResult.source });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not add expense." });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  const email     = String(req.query.email || "").trim().toLowerCase();
  const expenseId = Number.parseInt(req.params.id, 10);
  if (!email || !Number.isInteger(expenseId))
    return res.status(404).json({ message: "Expense not found." });
  try {
    let deleted = false;
    await runTransaction(async () => {
      const userExpenses = expenses[email] || [];
      const idx = userExpenses.findIndex(e => e.id === expenseId);
      if (idx === -1) throw Object.assign(new Error("Expense not found."), { statusCode: 404 });
      userExpenses.splice(idx, 1);
      expenses[email] = userExpenses;
      deleted = true;
    });
    if (!deleted) return res.status(404).json({ message: "Expense not found." });
    return res.json({ message: "Expense deleted successfully." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Expense not found." });
  }
});

app.get("/api/leaderboard", (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
  const totalsByEmail = {};
  for (const [email, userExpenses] of Object.entries(expenses))
    totalsByEmail[email] = userExpenses.reduce((t, e) => t + Number(e.amount || 0), 0);
  const leaderboard = Array.from(users.entries())
    .map(([email, user]) => ({ name: user.name, email, totalExpense: totalsByEmail[email] || 0 }))
    .sort((a, b) => b.totalExpense - a.totalExpense)
    .slice(0, limit)
    .map((user, i) => ({ rank: i + 1, ...user }));
  return res.json(leaderboard);
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
