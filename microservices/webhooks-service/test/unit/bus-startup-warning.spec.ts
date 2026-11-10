import { warnIfBusNotConsumed } from '../../src/infrastructure/events/amqp-event-bus-consumer';

describe('aviso de arranque de Webhooks sin broker (F12b-2, audit-12 H1)', () => {
  it('WH-BUS-W1: en producción sin RABBITMQ_URL avisa con JSON claro y dependency event-bus', () => {
    const lines: string[] = [];
    const message = warnIfBusNotConsumed({ NODE_ENV: 'production' }, (line) => lines.push(line));
    expect(message).toContain('RABBITMQ_URL is not set in production');
    expect(message).toContain('will not be consumed');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'warn', service: 'webhooks-service', dependency: 'event-bus' });
  });

  it('WH-BUS-W2: sin aviso si hay RABBITMQ_URL o si no es producción', () => {
    const lines: string[] = [];
    expect(warnIfBusNotConsumed({ NODE_ENV: 'production', RABBITMQ_URL: 'amqps://u:p@h/flight' }, (l) => lines.push(l))).toBeUndefined();
    expect(warnIfBusNotConsumed({ NODE_ENV: 'development' }, (l) => lines.push(l))).toBeUndefined();
    expect(warnIfBusNotConsumed({}, (l) => lines.push(l))).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it('WH-BUS-W3: el aviso no contiene la URL ni credenciales', () => {
    const lines: string[] = [];
    warnIfBusNotConsumed({ NODE_ENV: 'production', RABBITMQ_URL: '' }, (l) => lines.push(l));
    expect(lines.join('')).not.toMatch(/amqps?:\/\//);
  });
});
