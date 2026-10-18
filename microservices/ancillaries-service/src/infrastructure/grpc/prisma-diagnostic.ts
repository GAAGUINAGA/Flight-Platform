import { Prisma } from '../persistence/prisma-client/client';

const models = Prisma.dmmf.datamodel.models;
const modelNames = new Set(models.map((model) => model.name));
const fields = new Set(models.flatMap((model) => model.fields.flatMap((field) => [field.name, ...(field.dbName ? [field.dbName] : [])])));
const indexes = new Set(['seat_layouts_pkey', 'seat_layouts_aircraft_seat_number_key', 'seat_layouts_aircraft_cabin_class_row_number_idx', 'seat_assignments_pkey', 'seat_assignments_booking_id_passenger_id_segment_id_key', 'seat_assignments_booking_id_owner_id_idx', 'seat_assignments_flight_instance_id_seat_number_idx', 'seat_assignments_active_flight_seat_key', 'baggage_items_pkey', 'baggage_items_operation_id_key', 'baggage_items_booking_id_owner_id_idx', 'baggage_items_booking_id_passenger_id_itinerary_id_idx', 'booking_owners_pkey', 'baggage_allowances_pkey', 'baggage_allowances_booking_id_owner_id_idx']);

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
