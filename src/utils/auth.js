const jwt = require('jsonwebtoken');
const DB = require('./db')();

async function decodeToken(req, res, next) {
  try {
    const bearerHeader = req.get('Authorization');
    const match = /^[Bb]earer (.+)$/.exec(bearerHeader);
    console.info('Bearer match: ', match);
    if (match) {
      // eslint-disable-next-line prefer-destructuring
      req.token = match[1];
      try {
        const decoded = jwt.verify(match[1], process.env.TOKEN_SECRET);
        console.info('Token', match[1], 'decoded', decoded);

        req.user = await DB.User.findById(decoded.id);
        if (req.user) {
          console.info('Token verified. User:', decoded, req.user);
          next();
        } else res.status(403).send({ error: 'Invalid session token' });
      } catch (error) {
        console.error(error);
        res.status(403).send({ error: 'Invalid session token' });
      }
    } else {
      next();
    }
  } catch (error) {
    console.error(error);
    res.status(400).send({ error });
  }
}

async function verifyToken(req, res, next) {
  if (!req.user) res.status(401).send({ error: 'Unauthorized' });
  else next();
}

function createToken(user) {
  return jwt.sign({ id: String(user.id) }, process.env.TOKEN_SECRET, {
    expiresIn: '1800s',
  });
}
module.exports = { createToken, decodeToken, verifyToken };
