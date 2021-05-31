const express = require('express');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');

const DB = require('./utils/db')();
const { verifyToken, decodeToken } = require('./utils/auth');

// EVENTS
const eventsApp = express.Router();

eventsApp.use(express.json({ limit: '1kb' }));
eventsApp.use(express.urlencoded({ extended: true }));
eventsApp.use(
  rateLimit({
    max: 100,
    windowMs: 60 * 1000, // 1 minute
    message: 'Too many requests',
  })
);

/* eslint-disable no-underscore-dangle */
function formatEvent(event) {
  const formatted = JSON.parse(JSON.stringify(event));
  formatted.id = formatted._id;
  delete formatted._id;
  delete formatted.__v;
  return formatted;
}

eventsApp
  .route('/')
  .post(decodeToken, verifyToken, async (req, res) => {
    try {
      const inputSchema = Joi.object({
        headline: Joi.string().max(100).required(),
        description: Joi.string().max(500),
        startDate: Joi.date().required(),
        location: Joi.object({
          name: Joi.string().max(100),
          lat: Joi.number().min(-90).max(90),
          lon: Joi.number().min(-180).max(180),
        })
          .or('name', 'lat', 'lon')
          .and('lat', 'lon')
          .required(),
        state: Joi.valid('draft', 'public', 'private').default('draft'),
      });

      const event = await inputSchema.validateAsync(req.body).catch((error) => {
        throw error.message;
      });

      if (event.state === 'public') {
        const events = await DB.Event.find({
          state: 'public',
          creatorId: req.user.id,
        });

        if (events.length > 0) {
          res.status(400).send({ error: 'Public events limit exceeded' });
          return;
        }
      }

      const eventDB = await new DB.Event({
        ...event,
        creatorId: req.user.id,
      }).save();

      res.status(200).send(formatEvent(eventDB));
    } catch (error) {
      console.error(error);
      res.status(400).send({ error });
    }
  })
  .get(decodeToken, async (req, res) => {
    try {
      let query;
      if (req.user)
        query = DB.Event.find().or([
          { state: { $in: ['public', 'private'] } },
          { creatorId: req.user.id },
        ]);
      else query = DB.Event.find({ state: 'public' });

      const events = await query.exec();

      console.info('Events retieved:', events.length);
      if (events) res.status(200).send(events.map(formatEvent));
      else res.status(400).send({ error: 'Event not found' });
    } catch (error) {
      console.error(error);
      res.status(400).send({ error });
    }
  });

eventsApp
  .route('/:eventId(\\w+)')
  .get(async (req, res) => {
    try {
      const { eventId } = req.params;

      const event = await DB.Event.findById(eventId).exec();

      if (event) res.status(200).send(formatEvent(event));
      else res.status(400).send({ error: 'Event not found' });
    } catch (error) {
      console.error(error);
      res.status(400).send({ error });
    }
  })
  .put(decodeToken, verifyToken, async (req, res) => {
    try {
      const { eventId } = req.params;

      const inputSchema = Joi.object({
        headline: Joi.string().min(10).max(100).required(),
        description: Joi.string().max(500),
        startDate: Joi.date().required(),
        location: Joi.object({
          name: Joi.string().max(100),
          lat: Joi.number().min(-90).max(90),
          lon: Joi.number().min(-180).max(180),
        })
          .or('name', 'lat', 'lon')
          .and('lat', 'lon')
          .required(),
        state: Joi.valid('draft', 'public', 'private').default('draft'),
      });

      const newEvent = await inputSchema
        .validateAsync(req.body)
        .catch((error) => {
          throw error.message;
        });

      let event = await DB.Event.findById(eventId).exec();

      if (!event) {
        res.status(400).send({ error: 'Event not found' });
        return;
      }

      if (String(event.creatorId) !== req.user.id) {
        res
          .status(400)
          .send({ error: 'Events can only be edited by their creator' });
        return;
      }

      if (event.state !== 'public' && newEvent.state === 'public') {
        const events = await DB.Event.find({
          state: 'public',
          creatorId: req.user.id,
        });

        if (events.length > 0) {
          res.status(400).send({ error: 'Public events limit exceeded' });
        }
      }

      event.headline = newEvent.headline;
      event.description = newEvent.description;
      event.startDate = newEvent.startDate;
      event.location = newEvent.location;
      event.state = newEvent.state;

      event = await event.save();

      if (event) res.status(200).send(formatEvent(event));
      else res.status(400).send({ error: 'Event not found' });
    } catch (error) {
      console.error(error);
      res.status(400).send({ error });
    }
  })
  .delete(decodeToken, verifyToken, async (req, res) => {
    try {
      const { eventId } = req.params;

      console.log('Params:', req.params);

      const event = await DB.Event.findById(eventId).exec();

      if (!event) {
        res.status(400).send({ error: 'Event not found' });
        return;
      }
      if (String(event.creatorId) !== req.user.id) {
        res
          .status(400)
          .send({ error: 'Events can only be edited by their creator' });
        return;
      }

      await event.delete();

      await DB.Subscription.deleteMany({ eventId: event.id }).exec();

      if (event) res.status(200).send({ message: 'Event deleted' });
      else res.status(400).send({ error: 'Event not found' });
    } catch (error) {
      console.error(error);
      res.status(400).send({ error });
    }
  });

// SUBSCRIPTIONS
eventsApp
  .route('/:eventId(\\w+)/subscribe')
  .post(decodeToken, verifyToken, async (req, res) => {
    try {
      const { eventId } = req.params;

      const inputSchema = Joi.object({
        comment: Joi.string(),
      }).optional();

      const params = await inputSchema
        .validateAsync(req.body)
        .catch((error) => {
          throw error.message;
        });

      const event = await DB.Event.findById(eventId);
      if (!event) {
        res.status(400).send({ error: 'Event not found' });
        return;
      }

      if (String(event.creatorId) === req.user.id) {
        res
          .status(400)
          .send({ error: "You can't subscribe to your own events" });
        return;
      }

      const subscriptions = await DB.Subscription.find({
        subscriberId: req.user.id,
      });

      const oldSubscription = subscriptions.find(
        (sub) => String(sub.eventId) === eventId
      );

      if (oldSubscription) {
        res.status(400).send({
          message: 'You already have subscribed to this event',
          subscription: oldSubscription,
        });
      } else if (subscriptions.length) {
        res.status(400).send({
          message: 'Subscribed events limit exceeded',
          subscription: oldSubscription,
        });
      } else {
        const subscription = await new DB.Subscription({
          eventId: event.id,
          subscriberId: req.user.id,
          subscriptionDate: Date.now(),
          comment: params.comment,
        }).save();

        res
          .status(200)
          .send({ message: 'Subscribed successfully', subscription });
      }
    } catch (error) {
      console.error(error);
      res.status(400).send({ error });
    }
  });

module.exports = eventsApp;
