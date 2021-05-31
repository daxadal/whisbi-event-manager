const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('basic-auth');
const Joi = require('joi');

const DB = require('./utils/db')();
const { createToken, decodeToken, verifyToken } = require('./utils/auth');
const config = require('../config');

// Register / LOGIN
const usersApp = express.Router();

const hash = (pass) =>
  crypto.createHash('sha256', config.pass.SECRET).update(pass).digest('hex');

usersApp.use(express.json({ limit: '512b' }));
usersApp.use(
  rateLimit({
    max: 10,
    windowMs: 60 * 1000, // 1 minute
    message: 'Too many requests',
  })
);

usersApp.post('/sign-up', async (req, res) => {
  try {
    const inputSchema = Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    });

    const newUser = await inputSchema.validateAsync(req.body).catch((error) => {
      throw error.message;
    });

    const oldUser = await DB.User.findOne({
      email: newUser.email,
    });

    if (oldUser) {
      res.status(400).send({ error: 'Email already in use' });
      return;
    }

    const user = await new DB.User({
      name: newUser.name,
      email: newUser.email,
      hashedPassword: hash(newUser.password),
    }).save();

    const token = createToken(user);

    user.sessionToken = token;
    user.save();

    res.status(200).send({ message: 'Signed up successfully', token });
  } catch (error) {
    console.error(error);
    res.status(400).send({ error });
  }
});

usersApp.post('/sign-in', async (req, res) => {
  try {
    const basicAuth = auth(req);

    if (!basicAuth) {
      res.status(400).send({
        error: 'Credentials must be provided as Basic Auth (email:password)',
      });
      return;
    }
    const inputSchema = Joi.object({
      name: Joi.string().email().required(),
      pass: Joi.string().required(),
    });

    const credentials = await inputSchema
      .validateAsync(basicAuth)
      .catch((error) => {
        throw error.message;
      });

    const user = await DB.User.findOne({
      email: credentials.name,
      hashedPassword: hash(credentials.pass),
    });

    if (!user) {
      res.status(400).send({ error: 'Invalid credentials' });
      return;
    }

    const token = createToken(user);

    user.sessionToken = token;
    user.save();

    console.info('Auth:', credentials, '\nUser:', user);
    res.status(200).send({ message: 'Signed in successfully', token });
  } catch (error) {
    console.error(error);
    res.status(400).send({ error });
  }
});

usersApp.post('/sign-out', decodeToken, verifyToken, async (req, res) => {
  req.user.sessionToken = undefined;
  req.user.socketId = undefined;
  await req.user.save();
  res.status(200).send({ message: 'Signed out successfully' });
});

module.exports = usersApp;
