const request = require('supertest');
const express = require('express');
const { initDatabase, closeDatabase } = require('../../src/models/database');
const path = require('path');

const sessionsRouter = require('../../src/api/routes/sessions');
const testbedsRouter = require('../../src/api/routes/testbeds');
const healthRouter = require('../../src/api/routes/health');
const errorHandler = require('../../src/api/middleware/errorHandler');

describe('REST API Integration Tests', () => {
  let app;
  let mockSessionManager;
  let mockDockerService;
  let mockSessionModel;
  let mockTestbedModel;

  beforeAll(() => {

    const testDbPath = path.join(__dirname, '../../data/test-api.db');
    initDatabase(testDbPath);
  });

  afterAll(() => {
    closeDatabase();
  });

  beforeEach(() => {
    mockDockerService = {
      docker: {
        ping: jest.fn().mockResolvedValue('OK')
      },
      getContainerStatus: jest.fn().mockResolvedValue({ running: true })
    };

    mockSessionModel = {
      countByStatus: jest.fn().mockReturnValue({ ACTIVE: 1, PENDING: 0 }),
      findAll: jest.fn().mockReturnValue([
        { id: 'session-1', testbedId: 'next-ub', userId: 'user-1', status: 'ACTIVE' }
      ]),
      findById: jest.fn().mockReturnValue(
        { id: 'session-1', testbedId: 'next-ub', userId: 'user-1', status: 'ACTIVE' }
      )
    };

    mockTestbedModel = {
      findAll: jest.fn().mockReturnValue([
        { id: 'next-ub', name: 'UB NeXT', status: 'available' }
      ]),
      findById: jest.fn().mockReturnValue(
        { id: 'next-ub', name: 'UB NeXT', status: 'available' }
      ),
      create: jest.fn().mockImplementation((data) => ({ id: 'new-testbed', ...data })),
      count: jest.fn().mockReturnValue(1)
    };

    mockSessionManager = {
      createSession: jest.fn().mockResolvedValue({
        id: 'new-session-id',
        testbedId: 'next-ub',
        userId: 'user-1',
        status: 'PENDING'
      }),
      provisionSession: jest.fn().mockResolvedValue({
        id: 'new-session-id',
        status: 'READY'
      }),
      stopSession: jest.fn().mockResolvedValue({
        success: true,
        errors: []
      }),
      getSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        testbedId: 'next-ub',
        userId: 'user-1',
        status: 'ACTIVE'
      }),
      getAllSessions: jest.fn().mockResolvedValue([
        { id: 'session-1', testbedId: 'next-ub', userId: 'user-1', status: 'ACTIVE' }
      ])
    };

    app = express();
    app.use(express.json());

    app.use('/api/sessions', sessionsRouter(mockSessionManager));
    app.use('/api/testbeds', testbedsRouter(mockTestbedModel));
    app.use('/api/health', healthRouter(mockDockerService, mockSessionModel));
    app.use(errorHandler);
  });

  describe('GET /api/health', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.services.database).toBe(true);
      expect(response.body.services.docker).toBe(true);
      expect(response.body.activeSessions).toBe(1);
    });
  });

  describe('GET /api/testbeds', () => {
    test('should return list of testbeds', async () => {
      const response = await request(app)
        .get('/api/testbeds')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.testbeds).toBeDefined();
      expect(response.body.testbeds).toHaveLength(1);
      expect(response.body.testbeds[0].name).toBe('UB NeXT');
      expect(response.body.count).toBe(1);
    });

    test('should return testbed details by ID', async () => {
      const response = await request(app)
        .get('/api/testbeds/next-ub')
        .expect(200);

      expect(response.body.name).toBe('UB NeXT');
    });
  });

  describe('POST /api/sessions', () => {
    test('should create a session with valid input', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({
          testbedId: 'next-ub',
          userId: 'user-123',
          options: {
            duration: 60
          }
        })
        .expect(201);

      expect(response.body.id).toBe('new-session-id');
      expect(response.body.status).toBe('PENDING');
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        'next-ub',
        'user-123',
        expect.objectContaining({ duration: 60 })
      );
    });

    test('should return 400 validation error if parameters are missing', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({
          userId: 'user-123'
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details[0].field).toBe('testbedId');
    });
  });

  describe('POST /api/sessions/:id/stop', () => {
    test('should stop session', async () => {
      const response = await request(app)
        .post('/api/sessions/session-1/stop')
        .expect(200);

      expect(response.body.message).toContain('initiated');
      expect(mockSessionManager.stopSession).toHaveBeenCalledWith('session-1');
    });
  });
});
