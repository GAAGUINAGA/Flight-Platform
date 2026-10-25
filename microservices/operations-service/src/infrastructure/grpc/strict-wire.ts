import { Buffer } from 'node:buffer';
import { PackageDefinition } from '@grpc/proto-loader';

// Preserve unknown top-level fields for Zod's strict schemas while accepting
// the protobuf wire type declared by each known request field.
export function preserveUnknownRequestFields(definition: PackageDefinition): void {
  const service = definition['flightplatform.operations.v1.OperationsService'] as unknown as Record<string, {
    requestType: { type: { field: Array<{ number: number; type: string }> } };
    requestDeserialize: (bytes: Buffer) => Record<string, unknown>;
  }>;
  for (const method of Object.values(service)) {
    const fields = new Map(method.requestType.type.field.map((field) => [field.number, wireTypeFor(field.type)]));
    const decode = method.requestDeserialize;
    method.requestDeserialize = (bytes: Buffer) => {
      const decoded = decode(bytes);
      let position = 0;
      const readVarint = (): number => {
        let value = 0;
        let multiplier = 1;
        for (let n = 0; n < 10 && position < bytes.length; n++) {
          const byte = bytes[position++];
          value += (byte & 127) * multiplier;
          if (!(byte & 128)) return value;
          multiplier *= 128;
        }
        throw new Error('invalid protobuf');
      };
      while (position < bytes.length) {
        const tag = readVarint();
        const fieldNumber = Math.floor(tag / 8);
        const wireType = tag % 8;
        if (fields.get(fieldNumber) !== wireType) return { ...decoded, __unknownProtobufField: true };
        if (wireType === 0) { readVarint(); continue; }
        if (wireType === 1) { position += 8; }
        else if (wireType === 2) {
          const length = readVarint();
          if (!Number.isSafeInteger(length) || position + length > bytes.length) throw new Error('invalid protobuf');
          position += length;
        } else if (wireType === 5) { position += 4; }
        else return { ...decoded, __unknownProtobufField: true };
        if (position > bytes.length) throw new Error('invalid protobuf');
      }
      return decoded;
    };
  }
}

function wireTypeFor(type: string): number {
  if (['TYPE_DOUBLE', 'TYPE_FIXED64', 'TYPE_SFIXED64'].includes(type)) return 1;
  if (['TYPE_FLOAT', 'TYPE_FIXED32', 'TYPE_SFIXED32'].includes(type)) return 5;
  if (['TYPE_STRING', 'TYPE_BYTES', 'TYPE_MESSAGE'].includes(type)) return 2;
  return 0;
}
