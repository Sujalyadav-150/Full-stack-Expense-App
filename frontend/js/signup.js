const form = document.getElementById("signupForm");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = {
    name: document.getElementById("name").value,
    email: document.getElementById("email").value,
    password: document.getElementById("password").value
  };

  const message = document.getElementById("message");

  try {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Signup failed.");
    }

    window.location.href = "login.html";
  } catch (error) {
    message.textContent = error.message;
  }
});
