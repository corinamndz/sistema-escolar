require('dotenv').config();
const app = require('./src/app');
const { startBcvRateJob } = require('./src/jobs/bcvRateJob');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend escuchando en http://localhost:${PORT}`);
  startBcvRateJob(); // tasa BCV automática (si BCV_AUTO_UPDATE=true)
});
