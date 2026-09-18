const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
require("dotenv").config();

const app = express();
const dataDirectory = path.join(__dirname, "data");
const usersFile = path.join(dataDirectory, "users.json");
const expensesFile = path.join(dataDirectory, "expenses.json");
const expenseCategories = [
  "Food",
  "Groceries",
  "Transport",
  "Shopping",
  "Electronics",
  "Health",
  "Entertainment",
  "Bills & Utilities",
  "Housing",
  "Education",
  "Travel",
  "Other"
];

fs.mkdirSync(dataDirectory, { recursive: true });

function readData(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const users = new Map(Object.entries(readData(usersFile, {})));
const expenses = readData(expensesFile, {});
const resetTokens = new Map();
let nextExpenseId = Object.values(expenses).flat().reduce((highestId, expense) => Math.max(highestId, expense.id || 0), 0) + 1;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreSnapshot(snapshot) {
  users.clear();
  for (const [email, userData] of Object.entries(snapshot.users)) {
    users.set(email, userData);
  }

  for (const key of Object.keys(expenses)) {
    delete expenses[key];
  }

  Object.assign(expenses, snapshot.expenses);
}

async function runTransaction(operation) {
  const snapshot = {
    users: deepClone(Object.fromEntries(users)),
    expenses: deepClone(expenses)
  };

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

function hashPassword(password) {
  return crypto.scryptSync(password, "expense-tracker-salt", 64).toString("hex");
}

function createResetToken(email) {
  const token = crypto.randomUUID();
  resetTokens.set(token, {
    email,
    expiresAt: Date.now() + 15 * 60 * 1000
  });
  return token;
}

function knownCategoryHint(description) {
  const text = description.toLowerCase();
  const hints = {
    Food: ["pizza", "lunch", "dinner", "breakfast", "chips", "biryani", "burger", "tea", "coffee"],
    Groceries: ["grocery", "groceries", "vegetables", "vegetable", "sabzi", "flour", "rice", "milk"],
    Transport: ["uber", "taxi", "petrol", "fuel", "diesel", "bus", "train"],
    Electronics: ["mobile", "phone", "laptop", "computer", "tablet", "charger", "headphones"],
    Health: ["doctor", "medicine", "medical", "hospital", "clinic", "pharmacy"],
    Entertainment: ["movie", "cinema", "netflix", "music", "concert", "game"],
    "Bills & Utilities": ["electricity", "water bill", "internet bill", "phone bill", "utility"],
    Housing: ["rent", "mortgage", "maintenance"],
    Education: ["college", "school", "course", "tuition", "fees"]
  };

  return Object.entries(hints).find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] || "Other";
}

function getAiConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || "openai/gpt-4o-mini";
  const siteUrl = process.env.OPENROUTER_SITE_URL || process.env.OPENAI_SITE_URL || "http://localhost:3001";
  const appName = process.env.OPENROUTER_APP_NAME || process.env.OPENAI_APP_NAME || "Expense Tracker";

  return { apiKey, model, siteUrl, appName };
}

async function suggestCategory(description) {
  const { apiKey, model, siteUrl, appName } = getAiConfig();

  if (!apiKey) {
    console.warn("OpenRouter API key is not configured. Using fallback category for:", description);
    return { category: "Other", source: "fallback" };
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
        model,
        temperature: 0,
        max_tokens: 12,
        messages: [
          { role: "system", content: `Classify an expense into exactly one category: ${expenseCategories.join(", ")}. Reply with only the category.` },
          { role: "user", content: description }
        ]
      })
    });

    if (!response.ok) {
      let providerError = {};
      try {
        const errorBody = await response.json();
        providerError = errorBody?.error || {};
      } catch {
        providerError = {};
      }

      console.warn("OpenRouter categorization error:", {
        status: response.status,
        code: providerError.code || null,
        type: providerError.type || null,
        message: providerError.message || response.statusText || "Unknown OpenRouter error",
        requestId: response.headers.get("x-request-id") || null
      });

      return { category: "Other", source: "fallback" };
    }

    const result = await response.json();
    const category = result.choices?.[0]?.message?.content?.trim().replace(/[.\n]/g, "");
    if (expenseCategories.includes(category)) {
      return { category: category === "Other" ? knownCategoryHint(description) : category, source: "ai" };
    }
  } catch (error) {
    console.warn("OpenRouter categorization request error:", {
      status: error.status || null,
      code: error.code || null,
      type: error.type || null,
      message: error.message || "Unknown OpenRouter request error",
      requestId: error.requestId || null
    });
  }

  return { category: "Other", source: "fallback" };
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/login.html"));
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ message: "Name, email and password are required." });
  }

  try {
    await runTransaction(async () => {
      if (users.has(normalizedEmail)) {
        throw Object.assign(new Error("An account with this email already exists."), { statusCode: 409 });
      }

      users.set(normalizedEmail, { name: String(name).trim(), password: hashPassword(password) });
    });

    return res.status(201).json({ message: "Account created successfully." });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();
  const user = users.get(normalizedEmail);

  if (!user || user.name !== normalizedName || hashPassword(String(password || "")) !== user.password) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  return res.json({ message: "Login successful.", user: { name: user.name, email: normalizedEmail } });
});

app.post("/api/auth/forgot-password", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  if (!users.has(email)) {
    return res.status(200).json({
      message: "If an account exists for this email, a reset link has been sent."
    });
  }

  const resetToken = createResetToken(email);
  const resetUrl = `/reset-password.html?token=${encodeURIComponent(resetToken)}`;

  return res.status(200).json({
    message: "Password reset link created successfully.",
    resetToken,
    resetUrl
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = String(req.body.token || "").trim();
  const password = String(req.body.password || "").trim();

  if (!token || !password) {
    return res.status(400).json({ message: "Reset token and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long." });
  }

  const resetRequest = resetTokens.get(token);

  if (!resetRequest) {
    return res.status(400).json({ message: "Invalid or expired reset token." });
  }

  if (Date.now() > resetRequest.expiresAt) {
    resetTokens.delete(token);
    return res.status(400).json({ message: "Invalid or expired reset token." });
  }

  const { email } = resetRequest;

  if (!users.has(email)) {
    resetTokens.delete(token);
    return res.status(400).json({ message: "User not found for this reset token." });
  }

  try {
    await runTransaction(async () => {
      const user = users.get(email);
      if (!user) {
        throw Object.assign(new Error("User not found."), { statusCode: 404 });
      }
      user.password = hashPassword(password);
    });

    resetTokens.delete(token);
    return res.status(200).json({ message: "Password reset successfully." });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || "Could not reset password." });
  }
});

app.get("/api/expenses", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  return res.json(expenses[email] || []);
});

async function categorizeExpense(req, res) {
  const description = String(req.body.description || "").trim();

  if (!description) {
    return res.status(400).json({ message: "Description is required." });
  }

  const result = await suggestCategory(description);
  return res.json(result);
}

app.post("/api/categorize-expense", categorizeExpense);
app.post("/api/ai/categorize", categorizeExpense);

app.post("/api/expenses", async (req, res) => {
  const { email, amount, description, category, categorySource } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const numericAmount = Number(amount);

  if (!normalizedEmail || !Number.isFinite(numericAmount) || numericAmount <= 0 || !String(description || "").trim()) {
    return res.status(400).json({ message: "Email, valid amount and description are required." });
  }

  try {
    const normalizedDescription = String(description).trim();
    const categoryResult = expenseCategories.includes(category)
      ? { category, source: categorySource === "ai" ? "ai" : "fallback" }
      : await suggestCategory(normalizedDescription);

    await runTransaction(async () => {
      const userExpenses = expenses[normalizedEmail] || [];
      const expense = {
        id: nextExpenseId++,
        amount: numericAmount,
        description: normalizedDescription,
        category: categoryResult.category,
        categorySource: categoryResult.source
      };
      userExpenses.push(expense);
      expenses[normalizedEmail] = userExpenses;
    });

    return res.status(201).json({
      id: nextExpenseId - 1,
      amount: numericAmount,
      description: String(description).trim(),
      category: categoryResult.category,
      categorySource: categoryResult.source
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not add expense." });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const expenseId = Number.parseInt(req.params.id, 10);

  if (!email || !Number.isInteger(expenseId)) {
    return res.status(404).json({ message: "Expense not found." });
  }

  try {
    let deleted = false;

    await runTransaction(async () => {
      const userExpenses = expenses[email] || [];
      const expenseIndex = userExpenses.findIndex((expense) => expense.id === expenseId);

      if (expenseIndex === -1) {
        throw Object.assign(new Error("Expense not found."), { statusCode: 404 });
      }

      userExpenses.splice(expenseIndex, 1);
      expenses[email] = userExpenses;
      deleted = true;
    });

    if (!deleted) {
      return res.status(404).json({ message: "Expense not found." });
    }

    return res.json({ message: "Expense deleted successfully." });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || "Expense not found." });
  }
});

app.get("/api/leaderboard", (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
  const totalsByEmail = {};

  // Aggregate each expense once, then join totals to users in one lookup pass.
  for (const [email, userExpenses] of Object.entries(expenses)) {
    totalsByEmail[email] = userExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
  }

  const leaderboard = Array.from(users.entries())
    .map(([email, user]) => ({
      name: user.name,
      email,
      totalExpense: totalsByEmail[email] || 0
    }))
    .sort((firstUser, secondUser) => secondUser.totalExpense - firstUser.totalExpense)
    .slice(0, limit)
    .map((user, index) => ({ rank: index + 1, ...user }));

  return res.json(leaderboard);
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
