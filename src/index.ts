import app from './app';
import env from './config';
import { startDailyCronJob } from './services/cron.service';

const PORT = env.PORT;

// In serverless environments (like Vercel), do not run app.listen().
// Vercel handles the serverless execution lifecycle and imports the exported Express app.
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`CORS enabled for origin: ${env.CLIENT_URL} (credentials: true)`);

    // Start daily background cron job to complete expired rentals and email users
    startDailyCronJob();
  });
}

export default app;
