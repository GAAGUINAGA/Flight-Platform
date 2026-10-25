import { Buffer } from 'node:buffer';
import { Writable } from 'node:stream';
import { validate } from '@flight-platform/shared';
import { createSubscription, publishEvent } from '../../src/application/schemas';
import { createLogger } from '../../src/infrastructure/grpc/server';
import { AesGcmCipher, WebhookUrlPolicy } from '../../src/infrastructure/security/webhook-security';

describe('webhook security', () => {
  it('rejects an incorrectly typed holdId with INVALID_ARGUMENT', () => {
    expect(() => validate(publishEvent, { ownerId: 'owner', payload: { eventType: 'hold.expired', data: { holdId: 'hold', extension: true } } })).not.toThrow();
    let rejection: unknown; try { validate(publishEvent, { ownerId: 'owner', payload: { eventType: 'hold.expired', data: { holdId: 7 } } }); } catch (error) { rejection = error; }
    expect(rejection).toMatchObject({ error: { details: 'VALIDATION_FAILED' } });
  });
  it('encrypts secrets with authenticated encryption', () => { const cipher = new AesGcmCipher(Buffer.alloc(32, 9).toString('base64')); expect(cipher.decrypt(cipher.encrypt('private-secret'))).toBe('private-secret'); });
  it('rejects invalid subscription input', () => { expect(() => validate(createSubscription, { ownerId: 'a', url: 'not-a-url', events: ['booking.confirmed'], extra: true })).toThrow(); });
  it('rejects loopback webhook URLs', async () => { await expect(new WebhookUrlPolicy(true).assertSafe('http://127.0.0.1/hook')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); });
  it('redacts subscription secrets from logging', () => { const records: string[] = []; const sink = new Writable({ write(chunk, _encoding, callback) { records.push(String(chunk)); callback(); } }); createLogger(sink).info({ request: { secret: 'must-not-appear' } }, 'subscription created'); expect(records.join('')).not.toContain('must-not-appear'); });
});
