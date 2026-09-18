const leaderboardBody = document.getElementById("leaderboardBody");
const leaderboardMessage = document.getElementById("leaderboardMessage");

function renderLeaderboard(users) {
  leaderboardBody.innerHTML = users.map((user) => `
    <tr>
      <td>${user.rank}</td>
      <td>${user.name}</td>
      <td>${user.email}</td>
      <td>${user.totalExpense.toFixed(2)}</td>
    </tr>
  `).join("");
}

async function loadLeaderboard() {
  const response = await fetch("/api/leaderboard?limit=10");
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Could not load leaderboard.");
  }

  renderLeaderboard(result);
}

loadLeaderboard().catch((error) => {
  leaderboardMessage.textContent = error.message;
});
