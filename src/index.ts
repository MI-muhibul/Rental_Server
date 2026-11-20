import app from './app';
import env from './config';

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`CORS enabled for origin: ${env.CLIENT_URL} (credentials: true)`);
});
