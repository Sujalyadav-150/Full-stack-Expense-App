const form = document.getElementById("expenseForm");
const tableBody = document.getElementById("expenseTableBody");
const descriptionInput = document.getElementById("description");
const aiSuggestion = document.getElementById("aiSuggestion");
const leaderboardPreview = document.getElementById("leaderboardPreview");
const leaderboardMessage = document.getElementById("leaderboardMessage");
const loggedInUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");
let predictedCategory = null;
let predictedDescription = "";
let predictedSource = "fallback";

if (!loggedInUser) {
  window.location.href = "login.html";
}

function renderExpenses(expenses) {
  tableBody.innerHTML = expenses.map((expense) => `
    <tr>
      <td>${expense.amount}</td>
      <td>${expense.description}</td>
      <td>${expense.category}</td>
      <td>${expense.categorySource || "saved"}</td>
      <td><button class="delete-button" data-expense-id="${expense.id}" type="button">Delete</button></td>
    </tr>
  `).join("");
}

async function deleteExpense(expenseId) {
  if (!window.confirm("Delete this expense?")) {
    return;
  }

  const response = await fetch(`/api/expenses/${expenseId}?email=${encodeURIComponent(loggedInUser.email)}`, {
    method: "DELETE"
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Could not delete expense.");
  }

  await Promise.all([loadExpenses(), loadLeaderboard()]);
}

async function loadExpenses() {
  const response = await fetch(`/api/expenses?email=${encodeURIComponent(loggedInUser.email)}`);
  const result = await response.json();
  renderExpenses(result);
}

async function suggestCategory() {
  const description = descriptionInput.value.trim();
  if (!description) {
    predictedCategory = null;
    predictedDescription = "";
    predictedSource = "fallback";
    aiSuggestion.textContent = "AI category will appear here.";
    return;
  }

  aiSuggestion.textContent = "AI is thinking...";
  const response = await fetch("/api/categorize-expense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Could not suggest a category.");
  }

  predictedCategory = result.category;
  predictedDescription = description;
  predictedSource = result.source || "fallback";
  aiSuggestion.textContent = `Suggested category: ${result.category}`;
}

async function loadLeaderboard() {
  const response = await fetch("/api/leaderboard?limit=5");
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "Could not load leaderboard.");
  }

  leaderboardPreview.innerHTML = result.map((user) => `
    <li>
      <span><strong>${user.rank}</strong> ${user.name}</span>
      <b>${user.totalExpense.toFixed(2)}</b>
    </li>
  `).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const expense = {
    email: loggedInUser.email,
    amount: document.getElementById("amount").value,
    description: descriptionInput.value,
    category: predictedDescription === descriptionInput.value.trim() ? predictedCategory : null,
    categorySource: predictedDescription === descriptionInput.value.trim() ? predictedSource : null
  };

  try {
    const response = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expense)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Could not add expense.");
    }

    form.reset();
    predictedCategory = null;
    predictedDescription = "";
    predictedSource = "fallback";
    aiSuggestion.textContent = "AI category will appear here.";
    await loadExpenses();
    await loadLeaderboard();
  } catch (error) {
    window.alert(error.message);
  }
});

tableBody.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-expense-id]");
  if (!deleteButton) {
    return;
  }

  deleteExpense(deleteButton.dataset.expenseId).catch((error) => window.alert(error.message));
});

let suggestionTimer;
descriptionInput.addEventListener("input", () => {
  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(() => {
    suggestCategory().catch((error) => {
      aiSuggestion.textContent = error.message;
    });
  }, 400);
});

Promise.all([loadExpenses(), loadLeaderboard()]).catch((error) => {
  leaderboardMessage.textContent = error.message;
});
