import app from './app';
import env from './config';
import { startDailyCronJob } from './services/cron.service';

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`CORS enabled for origin: ${env.CLIENT_URL} (credentials: true)`);

  // Start daily background cron job to complete expired rentals and email users
  startDailyCronJob();
});
