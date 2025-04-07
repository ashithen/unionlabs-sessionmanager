const config = require('../config');
const { PortExhaustedError } = require('./errors');
const logger = require('./logger');

const allocatedPorts = new Set();

const RANGE_START = config.ports.rangeStart;
const RANGE_END = config.ports.rangeEnd;

function allocatePort() {
  for (let port = RANGE_START; port <= RANGE_END; port++) {
    if (!allocatedPorts.has(port)) {
      allocatedPorts.add(port);
      logger.debug(`Port allocated: ${port}`, {
        service: 'port-allocator',
        port,
        totalAllocated: allocatedPorts.size,
      });
      return port;
    }
  }

  logger.error('Port pool exhausted', {
    service: 'port-allocator',
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END,
    totalAllocated: allocatedPorts.size,
  });
  throw new PortExhaustedError(RANGE_START, RANGE_END);
}

function releasePort(port) {
  if (allocatedPorts.has(port)) {
    allocatedPorts.delete(port);
    logger.debug(`Port released: ${port}`, {
      service: 'port-allocator',
      port,
      totalAllocated: allocatedPorts.size,
    });
  } else {
    logger.warn(`Attempted to release unallocated port: ${port}`, {
      service: 'port-allocator',
      port,
    });
  }
}

function getActivePorts() {
  return Array.from(allocatedPorts).sort((a, b) => a - b);
}

function getAvailableCount() {
  return (RANGE_END - RANGE_START + 1) - allocatedPorts.size;
}

function releaseAll() {
  const count = allocatedPorts.size;
  allocatedPorts.clear();
  logger.info(`All ports released (${count} total)`, {
    service: 'port-allocator',
  });
}

module.exports = {
  allocatePort,
  releasePort,
  getActivePorts,
  getAvailableCount,
  releaseAll,
};
