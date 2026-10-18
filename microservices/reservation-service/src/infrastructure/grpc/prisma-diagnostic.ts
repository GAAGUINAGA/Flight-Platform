import { Prisma } from '../persistence/prisma-client/client';

const models = Prisma.dmmf.datamodel.models;
const modelNames = new Set(models.map((model) => model.name));
const fields = new Set(models.flatMap((model) => model.fields.flatMap((field) => [field.name, ...(field.dbName ? [field.dbName] : [])])));
const indexes = new Set(['reservations_pkey', 'reservations_pnr_key', 'reservations_owner_id_idempotency_key_key', 'reservations_owner_id_created_at_idx', 'reservation_passengers_pkey', 'reservation_passengers_reservation_id_passenger_id_key', 'reservation_passengers_reservation_id_fkey', 'reservation_changes_pkey', 'reservation_changes_reservation_id_changed_at_idx', 'reservation_changes_reservation_id_fkey', 'payment_usages_pkey', 'payment_usages_reservation_id_key', 'payment_usages_reservation_id_fkey', 'baggage_purchases_owner_id_idempotency_key_key', 'baggage_purchases_payment_reference_key', 'baggage_purchases_booking_id_owner_id_idx', 'baggage_purchases_booking_id_fkey', 'cancellation_quotes_pkey', 'cancellation_quotes_booking_id_fkey', 'cancellation_quotes_booking_id_owner_id_expires_at_idx']);

export function prismaDiagnostic(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !/^P2\d{3}$/.test(error.code)) return 'internal error';
  const safe = [`prisma_code=${error.code}`];
  const meta = error.meta;
  if (meta && typeof meta.modelName === 'string' && modelNames.has(meta.modelName)) safe.push(`model=${meta.modelName}`);
  if (meta && typeof meta.field_name === 'string' && fields.has(meta.field_name)) safe.push(`field=${meta.field_name}`);
  const target = meta?.target;
  if (typeof target === 'string' && indexes.has(target)) safe.push(`index=${target}`);
  if (Array.isArray(target) && target.every((value) => typeof value === 'string' && fields.has(value))) safe.push(`fields=${target.join(',')}`);
  return `internal error: ${safe.join(' ')}`;
}
