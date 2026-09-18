const form = document.getElementById("loginForm");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = {
    name: document.getElementById("name").value,
    email: document.getElementById("email").value,
    password: document.getElementById("password").value
  };

  const message = document.getElementById("message");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Login failed.");
    }

    localStorage.setItem("loggedInUser", JSON.stringify(result.user));
    window.location.href = "expenses.html";
  } catch (error) {
    message.textContent = error.message;
  }
});
