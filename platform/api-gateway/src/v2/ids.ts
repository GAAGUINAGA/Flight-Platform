import { createHash } from 'node:crypto';
import { GatewayProblemError } from '../web-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** UUID determinista (forma v5) a partir de una semilla: mismo origen, mismo id; nunca colisiona con uno aleatorio por construcción práctica. */
export function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type PassengerIn = { passengerId: string; associatedAdultId?: string; [key: string]: unknown };

/**
 * Los servicios internos identifican al pasajero con un UUID; Booking puede usar cualquier texto (p. ej. `PAX-1`).
 * Un id que ya es UUID se respeta; el resto se traduce de forma determinista y la tabla inversa se guarda con la reserva
 * para devolverle a Booking siempre sus propios ids.
 */
export function mapPassengerIds<T extends PassengerIn>(passengers: T[], scope: string): { passengers: T[]; internalToExternal: Record<string, string> } {
  const toInternal = new Map<string, string>(); const internalToExternal: Record<string, string> = {};
  for (const passenger of passengers) {
    if (toInternal.has(passenger.passengerId)) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'passengerId duplicado en la solicitud');
    const internal = isUuid(passenger.passengerId) ? passenger.passengerId.toLowerCase() : deterministicUuid(`${scope}:${passenger.passengerId}`);
    toInternal.set(passenger.passengerId, internal);
    if (internal !== passenger.passengerId) internalToExternal[internal] = passenger.passengerId;
  }
  const mapped = passengers.map((passenger) => ({ ...passenger, passengerId: toInternal.get(passenger.passengerId)!, ...(passenger.associatedAdultId !== undefined ? { associatedAdultId: toInternal.get(passenger.associatedAdultId) ?? (isUuid(passenger.associatedAdultId) ? passenger.associatedAdultId : deterministicUuid(`${scope}:${passenger.associatedAdultId}`)) } : {}) }));
  return { passengers: mapped, internalToExternal };
}

export const externalId = (map: Record<string, string>, internal: string): string => map[internal] ?? internal;
