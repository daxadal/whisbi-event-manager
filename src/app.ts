import express from 'express';
import rateLimit from 'express-rate-limit';
import { Logger } from 'winston';

import { api } from '@/config';
import { sendReminders } from '@/socket';

import * as DB from '@/services/db';
import { checkBreeToken } from '@/services/auth';

import eventsApp from '@/routes/events';
import usersApp from '@/routes/users';
import devApp from '@/routes/dev';
import { getLoggerMiddleware } from '@/services/winston';

const MAIN_RPM = 10;

const app = express();

app.use(
  rateLimit({
    max: MAIN_RPM,
    windowMs: 60 * 1000,
    message: 'Too many requests',
  })
);

app.use(getLoggerMiddleware('api'));

if (api.DEV) app.use('/dev', devApp);
app.use('/events', eventsApp);
app.use('/users', usersApp);

app.post('/jobs/remind', checkBreeToken, async (req: any, res) => {
  const logger: Logger | Console = (req as any).logger || console;
  try {
    logger.info('Remind:', req.dates);
    const { start, end } = req.dates;

    const events = await DB.Event.find({
      startDate: { $gte: start, $lte: end },
    });
    await sendReminders(events);
    res.status(200).send({ message: 'Reminders sent' });
  } catch (error) {
    logger.error(`Internal server error at ${req.method} ${req.originalUrl}`, error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  const logger: Logger | Console = (req as any).logger || console;
  logger.error(
    `Internal server error at ${req.method} ${req.originalUrl} captured at final handler`,
    err
  );
  res.status(500).send({ error: 'Internal server error' });
});

app.use((req, res) => {
  const logger: Logger | Console = (req as any).logger || console;
  logger.error(
    `Error at ${req.method} ${req.originalUrl} - Endpoint not found`
  );
  res.status(404).send({ error: 'Endpoint not found' });
});

export default app;
