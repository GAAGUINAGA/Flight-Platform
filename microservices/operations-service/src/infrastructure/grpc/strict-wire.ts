import { Buffer } from 'node:buffer';
import { PackageDefinition } from '@grpc/proto-loader';

// Preserve unknown top-level fields for Zod's strict schemas. All Operations
// request fields are strings; the normal protobuf decoder still validates data.
export function preserveUnknownRequestFields(definition: PackageDefinition): void {
  const service = definition['flightplatform.operations.v1.OperationsService'] as unknown as Record<string, {
    requestType: { type: { field: Array<{ number: number }> } };
    requestDeserialize: (bytes: Buffer) => Record<string, unknown>;
  }>;
  for (const method of Object.values(service)) {
    const fields = new Set(method.requestType.type.field.map((field) => field.number));
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
        if (!fields.has(Math.floor(tag / 8)) || tag % 8 !== 2) return { ...decoded, __unknownProtobufField: true };
        const length = readVarint();
        if (!Number.isSafeInteger(length) || position + length > bytes.length) throw new Error('invalid protobuf');
        position += length;
      }
      return decoded;
    };
  }
}
