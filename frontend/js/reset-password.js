const form = document.getElementById("resetPasswordForm");
const message = document.getElementById("message");

const urlParams = new URLSearchParams(window.location.search);
const rawToken = urlParams.get("token");
const token = rawToken ? rawToken.trim() : "";

if (!token) {
  message.textContent = "Missing reset token. Please request a new password reset link.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = document.getElementById("password").value.trim();

  if (!token) {
    message.textContent = "Missing reset token. Please request a new password reset link.";
    return;
  }

  if (password.length < 6) {
    message.textContent = "Password must be at least 6 characters long.";
    return;
  }

  message.textContent = "Updating password...";

  try {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Could not reset password.");
    }

    message.textContent = result.message || "Password reset successfully.";
    form.reset();
    setTimeout(() => {
      window.location.href = "login.html";
    }, 1500);
  } catch (error) {
    message.textContent = error.message;
  }
});
