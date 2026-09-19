const form = document.getElementById("forgotPasswordForm");
const message = document.getElementById("message");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  message.textContent = "Sending reset link...";

  try {
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Could not send reset link.");
    }

    if (result.resetUrl) {
      message.innerHTML = `Reset link created. <a href="${result.resetUrl}">Click here if not redirected automatically</a>.`;
      window.location.href = result.resetUrl;
      return;
    }

    message.textContent = result.message || "Reset link sent.";
  } catch (error) {
    message.textContent = error.message;
  }
});
