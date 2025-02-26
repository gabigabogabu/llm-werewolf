const axios = require('axios');
const fs = require('fs');

const openRouterClient = axios.create({
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    'Authorization': `Bearer ${process.env.OPEN_ROUTER_API_KEY}`,
  },
});

const listModels = async () => {
  const response = await openRouterClient.get('/models');
  console.log(response.data);
};

const main = async () => {
  const models = await listModels();
  fs.writeFileSync('models.json', JSON.stringify(models, null, 2));
};

main();
