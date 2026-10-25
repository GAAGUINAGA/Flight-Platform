import { preserveUnknownRequestFields } from '../src/infrastructure/grpc/strict-wire';
import { Buffer } from 'node:buffer';

describe('Operations strict protobuf wire guard', () => {
  const deserialize = jest.fn(() => ({ limit: 10 }));
  const definition = {
    'flightplatform.operations.v1.OperationsService': {
      recoverCheckIns: {
        requestType: { type: { field: [{ number: 1, type: 'TYPE_INT32' }] } },
        requestDeserialize: deserialize
      }
    }
  } as never;

  it('accepts the declared varint wire type of RecoverCheckIns.limit', () => {
    preserveUnknownRequestFields(definition);
    const result = (definition as { 'flightplatform.operations.v1.OperationsService': { recoverCheckIns: { requestDeserialize(bytes: Buffer): object } } })['flightplatform.operations.v1.OperationsService'].recoverCheckIns.requestDeserialize(Buffer.from([0x08, 0x0a]));
    expect(result).toEqual({ limit: 10 });
  });

  it('preserves an unknown field for the strict Zod request validator', () => {
    preserveUnknownRequestFields(definition);
    const result = (definition as { 'flightplatform.operations.v1.OperationsService': { recoverCheckIns: { requestDeserialize(bytes: Buffer): object } } })['flightplatform.operations.v1.OperationsService'].recoverCheckIns.requestDeserialize(Buffer.from([0x10, 0x01]));
    expect(result).toEqual({ limit: 10, __unknownProtobufField: true });
  });
});
