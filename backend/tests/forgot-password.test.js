const assert = require('node:assert/strict');
const { once } = require('node:events');

const app = require('../app');

(async () => {
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const forgotResponse = await fetch(`http://localhost:${port}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sujalsunny1234@gmail.com' })
    });

    const forgotBody = await forgotResponse.json();
    assert.equal(forgotResponse.status, 200, 'forgot-password should return 200');
    assert.ok(forgotBody.message, 'forgot response should include a message');
    assert.ok(forgotBody.resetToken || forgotBody.message.includes('reset link'), 'forgot response should include token or reset link message');

    const resetResponse = await fetch(`http://localhost:${port}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgotBody.resetToken, password: 'newpassword123' })
    });

    const resetBody = await resetResponse.json();
    assert.equal(resetResponse.status, 200, 'reset-password should return 200');
    assert.match(resetBody.message, /success|updated/i, 'reset response should confirm a successful password update');
  } finally {
    server.close();
  }
})();
