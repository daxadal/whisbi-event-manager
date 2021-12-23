import request from 'supertest';
import { Document } from 'mongoose';
import { mocked } from 'ts-jest/utils';

import app from '@/app';
import {
  closeConnection,
  createConnection,
  Event,
  EventType,
  format,
  UserType,
} from '@/services/db';
import * as auth from '@/services/auth';

import { clearDatabase, createMockEvents, createMockUser } from 'test/mocks/db';

jest.mock('@/services/auth', () => ({
  decodeToken: jest.fn((req, res, next) => next()),
  verifyToken: jest.fn((req, res, next) => next()),
}));

const mockedAuth = mocked(auth, true);

const AMOUNT_OF_EVENTS = 12;

describe('The /events API', () => {
  beforeAll(createConnection);

  beforeEach(jest.clearAllMocks);

  afterEach(clearDatabase);

  afterAll(closeConnection);

  describe('POST /events endpoint', () => {
    let user: UserType & Document;

    beforeEach(async () => {
      user = await createMockUser();

      mockedAuth.decodeToken.mockImplementationOnce((req: any, res, next) => {
        req.token = 'token';
        req.user = user;
        next();
      });
    });

    it('Returns 400 on empty body', async () => {
      // given
      const body = {};

      // when
      const response = await request(app).post('/events').send(body);

      // then
      expect(response.status).toEqual(400);
      expect(response.body).toBeDefined();
      expect(response.body.error).toMatch(/is required/);
    });

    it('Returns 400 if only one of `location.lat` or `location.lon` is present', async () => {
      // given
      const body = {
        headline: 'New event',
        startDate: new Date(),
        location: { name: 'Somewhere', lat: 40 },
      };

      // when
      const response = await request(app).post('/events').send(body);

      // then
      expect(response.status).toEqual(400);
      expect(response.body).toBeDefined();
      expect(response.body.error).toMatch(
        /location.* contains \[lat\] without its required peers \[lon\]/
      );
    });

    it('Returns 400 if headline is missing', async () => {
      // given
      const body = {
        startDate: new Date(),
        location: { name: 'Somewhere' },
      };

      // when
      const response = await request(app).post('/events').send(body);

      // then
      expect(response.status).toEqual(400);
      expect(response.body).toBeDefined();
      expect(response.body.error).toMatch(/is required/);
    });

    it('Returns 200 and the created event on success (minimum required fields)', async () => {
      // given
      const body = {
        headline: 'New event',
        startDate: new Date(),
        location: { name: 'Somewhere' },
      };

      // when
      const response = await request(app).post('/events').send(body);

      // then
      const createdEvent = await Event.findOne({});

      expect(response.status).toEqual(200);
      expect(response.body).toBeDefined();
      expect(response.body.message).toEqual('Event created');
      expect(response.body.event).toBeDefined();
      expect(response.body.event).toMatchObject<EventType>(
        format(createdEvent)
      );
    });

    it('Returns 200 and the created event on success (all fields)', async () => {
      // given
      const body = {
        headline:
          '1Ot3HAS2r LSxtVk2kC DSgBJicUl l7JsXbHul XzHbL2yR3 AXNKwWTTG wsx7UXz8i O9yryfVBV 669mCkjsH p6gijqSQG ',
        description:
          'BBDzxzQQ1Z Sk7htzCHH yYoxbBXjg D6xQVB9Pl W5NjeVjvl WUWUH6q3s d9nLlX6Dd u7aQ8XOKH LTtWw0JHb PDQMhmmeq IVEqhZbK1 QTOW9wPLd cvWkEDvTL Wg4v67A8E T4A71VIYj vYhU2TF8g FKdjU9fGO FxkM8djYP 3Jqz6iROj 1UJXjvIid pESX4XP1F hv66f7OAj 97TcC1XyG MlS86AoUi aipsTaZBV eh1rIukyT DeWavtMY8 A90ICXjOT EO3yQ2LAW 7zFT5A2LB d3wQhIl2X zxZw2FiwL XG0jp484e I40jYQBVq jAoH1Ixii GZdN1Okva scwwQCxqE J7i1HixhA Mws9icxXw jZbWMHKGO SLCFX2IFX E8v30FU04 I9ZVhavaP 4ZZnrzhUq vz1J2e2c3 eKXiU4qdr KcB9CF9Nf rNbG9zfDd RgvolUcZe SS2iTdEAp',
        startDate: '2021-08-01T00:00:00.000Z',
        location: {
          name: '1Ot3HAS2r LSxtVk2kC DSgBJicUl l7JsXbHul XzHbL2yR3 AXNKwWTTG wsx7UXz8i O9yryfVBV 669mCkjsH p6gijqSQG ',
          lat: 40.168453126,
          lon: -5.1561561231,
        },
        state: 'private',
      };

      // when
      const response = await request(app).post('/events').send(body);

      // then
      const createdEvent = await Event.findOne({});

      expect(response.status).toEqual(200);
      expect(response.body).toBeDefined();
      expect(response.body.message).toEqual('Event created');
      expect(response.body.event).toBeDefined();
      expect(response.body.event).toMatchObject<EventType>(
        format(createdEvent)
      );
    });

    it('Returns 400 if the user already has one public event', async () => {
      // given
      await new Event({
        headline: 'Previous event',
        startDate: new Date(),
        location: { name: 'Somewhere' },
        state: 'public',
        creatorId: user.id,
      }).save();

      const body = {
        headline: 'New event',
        startDate: new Date(),
        location: { name: 'Somewhere' },
        state: 'public',
      };

      // when
      const response = await request(app).post('/events').send(body);

      // then
      expect(response.status).toEqual(400);
      expect(response.body).toBeDefined();
      expect(response.body.error).toEqual('Public events limit exceeded');
    });
  });

  describe('GET /events endpoint', () => {
    let creatorUser: UserType & Document;
    let otherUser: UserType & Document;
    let events: Array<EventType & Document>;

    beforeEach(async () => {
      creatorUser = await createMockUser({ email: 'creator@doe.com' });
      otherUser = await createMockUser({ email: 'other@doe.com' });

      events = await createMockEvents(AMOUNT_OF_EVENTS, {
        creatorId: creatorUser._id,
        state: (i) => {
          switch (i % 3) {
            case 0:
              return 'draft';
            case 1:
              return 'private';
            case 2:
              return 'public';
          }
        },
      });
    });

    it('Returns 200 and all public events if the user is not authenticated', async () => {
      // given
      mockedAuth.decodeToken.mockImplementationOnce((req: any, res, next) => {
        next();
      });

      // when
      const response = await request(app).get('/events');

      // then
      expect(response.status).toEqual(200);
      expect(response.body).toBeDefined();
      expect(response.body.events).toBeDefined();
      expect(response.body.events).toHaveLength(AMOUNT_OF_EVENTS / 3);

      response.body.events.forEach((event: EventType) => {
        expect(['public']).toContain(event.state);
      });
    });

    it('Returns 200 and all public and private events if the user has no events', async () => {
      // given
      mockedAuth.decodeToken.mockImplementationOnce((req: any, res, next) => {
        req.token = 'token';
        req.user = otherUser;
        next();
      });

      // when
      const response = await request(app).get('/events');

      // then
      expect(response.status).toEqual(200);
      expect(response.body).toBeDefined();
      expect(response.body.events).toBeDefined();
      expect(response.body.events).toHaveLength((2 * AMOUNT_OF_EVENTS) / 3);

      response.body.events.forEach((event: EventType) => {
        expect(['public', 'private']).toContain(event.state);
      });
    });

    it('Returns 200 and all public, private and owned events if the user has events', async () => {
      // given
      mockedAuth.decodeToken.mockImplementationOnce((req: any, res, next) => {
        req.token = 'token';
        req.user = creatorUser;
        next();
      });

      // when
      const response = await request(app).get('/events');

      // then
      expect(response.status).toEqual(200);
      expect(response.body).toBeDefined();
      expect(response.body.events).toBeDefined();
      expect(response.body.events).toHaveLength(AMOUNT_OF_EVENTS);

      response.body.events.forEach((event: EventType) => {
        expect(['public', 'private', 'draft']).toContain(event.state);
      });
    });
  });
});
