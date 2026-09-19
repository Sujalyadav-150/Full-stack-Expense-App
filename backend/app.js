const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const db = require("./utils/db");
const PasswordResetToken = require("./models/PasswordResetToken");

const app = express();

const expenseCategories = [
  "Food", "Groceries", "Transport", "Shopping", "Electronics",
  "Health", "Entertainment", "Bills & Utilities", "Housing",
  "Education", "Travel", "Other"
];

// Compatible Password Hashing using crypto.scryptSync
function hashPassword(password) {
  return crypto.scryptSync(String(password || ""), "expense-tracker-salt", 64).toString("hex");
}

async function verifyPassword(inputPassword, storedPasswordHash) {
  if (!storedPasswordHash) return false;
  if (storedPasswordHash.startsWith("$2b$")) {
    return await bcrypt.compare(String(inputPassword || ""), storedPasswordHash);
  }
  return hashPassword(inputPassword) === storedPasswordHash;
}

// Hash a raw reset token for safe storage (SHA-256)
function hashResetToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function knownCategoryHint(description) {
  const text = String(description || "").toLowerCase();
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
  const trimmedName = String(name || "").trim();
  if (!trimmedName || !normalizedEmail || !password)
    return res.status(400).json({ message: "Name, email and password are required." });
  try {
    const hashedPassword = hashPassword(password);
    const user = await db.createUser({ name: trimmedName, email: normalizedEmail, password: hashedPassword });
    return res.status(201).json({ message: "Account created successfully.", user: { name: user.name, email: user.email } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Could not create account." });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName  = String(name  || "").trim();
  const user = await db.getUser(normalizedEmail);
  if (!user || user.name !== normalizedName)
    return res.status(401).json({ message: "Invalid email or password." });
  
  const passwordMatch = await verifyPassword(password, user.password);
  if (!passwordMatch)
    return res.status(401).json({ message: "Invalid email or password." });

  return res.json({ message: "Login successful.", user: { name: user.name, email: normalizedEmail } });
});

// ── Forgot Password ───────────────────────────────────────────────────────────
app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ message: "Email is required." });
  
  const user = await db.getUser(email);
  if (!user) {
    return res.status(200).json({ message: "If an account exists for this email, a reset link has been sent." });
  }

  // Every Forgot Password request must generate a NEW secure random token.
  const rawToken = crypto.randomUUID();
  try {
    await db.createResetToken({ email, rawToken, expiresInMs: 15 * 60 * 1000 });
  } catch (err) {
    console.error("forgot-password database error:", err.message);
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
  const tokenRecord = await db.getResetTokenByHash(tokenHash);

  if (!tokenRecord) {
    return res.status(400).json({ message: "Invalid or expired reset token." });
  }

  if (!PasswordResetToken.isValid(tokenRecord)) {
    return res.status(400).json({ message: "Invalid or expired reset token." });
  }

  try {
    const hashedPassword = hashPassword(password);
    await db.updateUserPassword(tokenRecord.userId, hashedPassword);
    await db.markTokenUsed(tokenRecord.id);
    return res.status(200).json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("reset-password error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ── Expenses ──────────────────────────────────────────────────────────────────
app.get("/api/expenses", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const list = await db.getExpenses(email);
  return res.json(list);
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
    
    const added = await db.addExpense({
      email: normalizedEmail,
      amount: numericAmount,
      description: normalizedDescription,
      category: categoryResult.category,
      categorySource: categoryResult.source
    });
    return res.status(201).json(added);
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
    await db.deleteExpense(email, expenseId);
    return res.json({ message: "Expense deleted successfully." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Expense not found." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
  const leaderboard = await db.getLeaderboard(limit);
  return res.json(leaderboard);
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
