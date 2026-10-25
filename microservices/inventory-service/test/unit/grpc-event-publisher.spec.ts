import { of, throwError } from 'rxjs';
import { GrpcEventPublisher, SafeEventPublisher } from '../../src/infrastructure/events/grpc-event-publisher';
const event = { eventType: 'hold.expired' as const, ownerId: 'owner', holdId: 'hold', occurredAt: new Date('2026-10-23T12:00:00.000Z'), data: { status: 'EXPIRED' as const } };
describe('PLT-H3 Inventory Webhooks publisher', () => {
  it('publica hold.expired con holdId adicional permitido por el contrato', async () => { const publishEvent = jest.fn(() => of({ eventId: 'event' })); await new GrpcEventPublisher({ publishEvent }).publish(event); expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner', payload: expect.objectContaining({ eventType: 'hold.expired', data: { holdId: 'hold', status: 'EXPIRED' } }) })); });
  it('un rechazo de Webhooks registra dependencia, tipo y codigo sin revertir la expiracion', async () => { const warn = jest.fn(); await expect(new SafeEventPublisher(new GrpcEventPublisher({ publishEvent: () => throwError(() => Object.assign(new Error('down'), { code: 3 })) }), { warn } as never).publish(event)).resolves.toBeUndefined(); expect(warn).toHaveBeenCalledWith({ dependency: 'webhooks', eventType: 'hold.expired', code: '3' }, 'event publish failed'); });
});
