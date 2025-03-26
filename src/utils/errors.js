class AppError extends Error {

  constructor(message, statusCode, code, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

class SessionNotFoundError extends AppError {

  constructor(sessionId) {
    super(
      `Session not found: ${sessionId}`,
      404,
      'SESSION_NOT_FOUND',
      { sessionId }
    );
  }
}

class ProvisioningError extends AppError {

  constructor(message, details = null) {
    super(
      `Provisioning failed: ${message}`,
      500,
      'PROVISIONING_ERROR',
      details
    );
  }
}

class TunnelError extends AppError {

  constructor(message, details = null) {
    super(
      `SSH tunnel error: ${message}`,
      502,
      'TUNNEL_ERROR',
      details
    );
  }
}

class PortExhaustedError extends AppError {

  constructor(rangeStart, rangeEnd) {
    super(
      `No available ports in range ${rangeStart}-${rangeEnd}`,
      503,
      'PORT_EXHAUSTED',
      { rangeStart, rangeEnd }
    );
  }
}

class TestbedNotFoundError extends AppError {

  constructor(testbedId) {
    super(
      `Testbed not found: ${testbedId}`,
      404,
      'TESTBED_NOT_FOUND',
      { testbedId }
    );
  }
}

class InvalidSessionStateError extends AppError {

  constructor(sessionId, currentState, requestedAction) {
    super(
      `Cannot ${requestedAction} session ${sessionId}: current state is ${currentState}`,
      409,
      'INVALID_SESSION_STATE',
      { sessionId, currentState, requestedAction }
    );
  }
}

module.exports = {
  AppError,
  SessionNotFoundError,
  ProvisioningError,
  TunnelError,
  PortExhaustedError,
  TestbedNotFoundError,
  InvalidSessionStateError,
};
