const portAllocator = require('../../src/utils/portAllocator');
const config = require('../../src/config');
const { PortExhaustedError } = require('../../src/utils/errors');

describe('Port Allocator Utility', () => {
  beforeEach(() => {
    portAllocator.releaseAll();
  });

  afterAll(() => {
    portAllocator.releaseAll();
  });

  test('should allocate ports sequentially in the configured range', () => {
    const startPort = config.ports.rangeStart;
    const port1 = portAllocator.allocatePort();
    const port2 = portAllocator.allocatePort();

    expect(port1).toBe(startPort);
    expect(port2).toBe(startPort + 1);
  });

  test('should release port and allow it to be re-allocated', () => {
    const startPort = config.ports.rangeStart;
    const port1 = portAllocator.allocatePort();
    const port2 = portAllocator.allocatePort();

    portAllocator.releasePort(port1);
    const port3 = portAllocator.allocatePort();

    expect(port3).toBe(port1);
  });

  test('should return active allocated ports', () => {
    const port1 = portAllocator.allocatePort();
    const port2 = portAllocator.allocatePort();

    expect(portAllocator.getActivePorts()).toEqual([port1, port2]);

    portAllocator.releasePort(port1);
    expect(portAllocator.getActivePorts()).toEqual([port2]);
  });

  test('should return correct count of available ports', () => {
    const totalRange = config.ports.rangeEnd - config.ports.rangeStart + 1;
    expect(portAllocator.getAvailableCount()).toBe(totalRange);

    portAllocator.allocatePort();
    expect(portAllocator.getAvailableCount()).toBe(totalRange - 1);
  });

  test('should throw PortExhaustedError when range is filled', () => {
    const totalRange = config.ports.rangeEnd - config.ports.rangeStart + 1;

    for (let i = 0; i < totalRange; i++) {
      portAllocator.allocatePort();
    }

    expect(() => {
      portAllocator.allocatePort();
    }).toThrow(PortExhaustedError);
  });

  test('should handle releasing an unallocated port gracefully', () => {
    expect(() => {
      portAllocator.releasePort(9999);
    }).not.toThrow();
  });
});
