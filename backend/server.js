require('dotenv').config();
const app = require('./src/app');
const { startBcvRateJob } = require('./src/jobs/bcvRateJob');
const { startEmailOutboxWorker } = require('./src/jobs/emailOutboxWorker');
const { startDailyRemindersJob } = require('./src/jobs/dailyRemindersJob');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend escuchando en http://localhost:${PORT}`);
  startBcvRateJob(); // tasa BCV automática (BCV_AUTO_UPDATE=false la desactiva)
  startEmailOutboxWorker(); // correos de avisos encolados (EMAIL_OUTBOX_WORKER=false la desactiva)
  startDailyRemindersJob(); // recordatorios diarios: evaluaciones, eventos, citas y pagos vencidos (DAILY_REMINDERS=false la desactiva)
});
