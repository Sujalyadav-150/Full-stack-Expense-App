const app = require('../app');

(async () => {
  const server = app.listen(0, async () => {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    try {
      const add = await fetch(`${base}/api/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'verify@example.com',
          amount: 125,
          description: 'Tea and snacks',
          category: 'Food',
          categorySource: 'fallback'
        })
      });
      const addJson = await add.json();
      console.log('POST_STATUS', add.status);
      console.log('POST_BODY', JSON.stringify(addJson));

      const get = await fetch(`${base}/api/expenses?email=verify@example.com`);
      const getJson = await get.json();
      console.log('GET_STATUS', get.status);
      console.log('GET_BODY', JSON.stringify(getJson));

      const del = await fetch(`${base}/api/expenses/${addJson.id}?email=verify@example.com`, { method: 'DELETE' });
      const delJson = await del.json();
      console.log('DELETE_STATUS', del.status);
      console.log('DELETE_BODY', JSON.stringify(delJson));

      const finalGet = await fetch(`${base}/api/expenses?email=verify@example.com`);
      console.log('FINAL_GET_STATUS', finalGet.status);
      console.log('FINAL_GET_BODY', JSON.stringify(await finalGet.json()));
    } catch (error) {
      console.error('VERIFY_ERROR', error.message);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });
})();
