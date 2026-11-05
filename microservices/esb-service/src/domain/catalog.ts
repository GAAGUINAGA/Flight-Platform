export const SERVICES = ['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks'] as const;
export type ServiceName = (typeof SERVICES)[number];
export const DOMAINS = ['vuelos', 'reservas', 'postventa', 'clientes', 'sistema'] as const;
export type Domain = (typeof DOMAINS)[number];

/** Operación 1:1 con un método gRPC. `orchestrated` = plazo largo (sagas que hoy viven en Reservation). */
export interface RpcOperation { kind: 'rpc'; name: string; service: ServiceName; method: string; orchestrated?: true; roleHint?: string; roles?: readonly string[] }
/** Pasos en orden; cada paso toma de `input` solo los campos listados. El resultado es el del último paso. */
export interface CompositeOperation { kind: 'composite'; name: string; steps: Array<{ service: ServiceName; method: string; pick: string[] }> }
/** Sondeo de salud de los siete servicios. */
export interface HealthOperation { kind: 'health'; name: string }
export type Operation = RpcOperation | CompositeOperation | HealthOperation;

const rpc = (name: string, service: ServiceName, method: string, extra: { orchestrated?: true; roleHint?: string; roles?: readonly string[] } = {}): RpcOperation => ({ kind: 'rpc', name, service, method, ...extra });

/**
 * Catálogo de operaciones con nombre `<dominio>.<operación>` (docs/dev/f12b1-diseno-esb.md §5). `roles` lista los roles admitidos
 * en las operaciones administrativas y de sistema: el ESB los verifica con la identidad del Gateway (defensa en profundidad,
 * ADR-F12b-09) y reproduce exactamente lo que ya exige el microservicio dueño, que sigue siendo la autoridad. `roleHint` es
 * solo informativo (operaciones cuyo control de rol vive en el Gateway y no en el microservicio).
 */
export const OPERATIONS: readonly Operation[] = [
  // vuelos
  rpc('vuelos.buscar-ofertas', 'pricing', 'searchOffers'),
  {
    kind: 'composite', name: 'vuelos.mapa-asientos',
    steps: [{ service: 'pricing', method: 'resolveSegment', pick: ['segmentId'] }, { service: 'ancillaries', method: 'getSeatMapForOffer', pick: ['offerId', 'segmentId'] }]
  },
  rpc('vuelos.crear-hold', 'pricing', 'holdOffer'),
  rpc('vuelos.consultar-hold', 'pricing', 'getOfferHold'),
  rpc('vuelos.liberar-hold', 'pricing', 'releaseOfferHold'),
  rpc('vuelos.estado-vuelo', 'operations', 'getFlightStatus'),
  rpc('vuelos.buscar-instancia', 'inventory', 'findFlightInstance', { roleHint: 'admin|system' }),
  rpc('vuelos.ocupacion-cabinas', 'inventory', 'listCabinOccupancy', { roleHint: 'admin|system' }),
  rpc('vuelos.obtener-instancia', 'inventory', 'getFlightInstance', { roleHint: 'system' }),
  rpc('vuelos.consultar-disponibilidad', 'inventory', 'queryAvailability', { roleHint: 'system' }),
  rpc('vuelos.guardar-instancia', 'inventory', 'upsertFlightInstance', { roles: ['admin'] }),
  rpc('vuelos.listar-instancias', 'inventory', 'listFlightInstances', { roleHint: 'admin' }),
  rpc('vuelos.cerrar-instancia', 'inventory', 'closeFlightInstance', { roles: ['admin'] }),
  rpc('vuelos.guardar-tarifa', 'pricing', 'upsertFare', { roles: ['admin'] }),
  rpc('vuelos.listar-tarifas', 'pricing', 'listFares', { roles: ['admin'] }),
  rpc('vuelos.registrar-novedad-operativa', 'operations', 'recordOperationalUpdate', { roles: ['admin'] }),
  rpc('vuelos.contar-check-ins', 'operations', 'countCheckedIn', { roles: ['admin'] }),
  // reservas
  rpc('reservas.crear', 'reservation', 'createReservation', { orchestrated: true }),
  rpc('reservas.obtener', 'reservation', 'getReservation'),
  rpc('reservas.listar', 'reservation', 'listReservations'),
  rpc('reservas.reanudar', 'reservation', 'resumeReservation'),
  rpc('reservas.fallar', 'reservation', 'failReservation'),
  rpc('reservas.listar-por-vuelo', 'reservation', 'listReservationsByFlightInstance', { roles: ['system'] }),
  rpc('reservas.listar-boletos', 'ticketing', 'listTickets'),
  rpc('reservas.obtener-boleto', 'ticketing', 'getTicket'),
  // postventa
  rpc('postventa.opciones-equipaje', 'reservation', 'getBaggageOptions'),
  rpc('postventa.agregar-equipaje', 'reservation', 'addBaggage', { orchestrated: true }),
  rpc('postventa.buscar-cambio-fecha', 'reservation', 'searchDateChange'),
  rpc('postventa.confirmar-cambio-fecha', 'reservation', 'confirmDateChange', { orchestrated: true }),
  rpc('postventa.cotizar-cancelacion', 'reservation', 'getCancellationQuote'),
  rpc('postventa.cotizacion-guardada', 'reservation', 'getStoredCancellationQuote'),
  rpc('postventa.cotizar-cancelacion-exonerada', 'reservation', 'quoteCancellation'),
  rpc('postventa.cancelar', 'reservation', 'cancelReservation', { orchestrated: true }),
  rpc('postventa.cambiar-asientos', 'ancillaries', 'changeSeats'),
  rpc('postventa.check-in', 'operations', 'checkIn'),
  rpc('postventa.listar-pases', 'operations', 'listBoardingPasses'),
  // clientes
  rpc('clientes.listar-suscripciones', 'webhooks', 'listSubscriptions'),
  rpc('clientes.crear-suscripcion', 'webhooks', 'createSubscription'),
  rpc('clientes.eliminar-suscripcion', 'webhooks', 'deleteSubscription'),
  rpc('clientes.listar-eventos', 'webhooks', 'listEvents'),
  rpc('clientes.publicar-evento', 'webhooks', 'publishEvent', { roleHint: 'system' }),
  // sistema (tareas del scheduler y salud)
  rpc('sistema.expirar-holds', 'inventory', 'expireHolds', { roles: ['system'] }),
  rpc('sistema.reanudar-pendientes', 'reservation', 'resumePending', { roles: ['system'] }),
  rpc('sistema.despachar-webhooks', 'webhooks', 'dispatchPending', { roles: ['system'] }),
  rpc('sistema.recuperar-check-ins', 'operations', 'recoverCheckIns', { roles: ['system'] }),
  { kind: 'health', name: 'sistema.salud' }
];

const BY_NAME = new Map(OPERATIONS.map((operation) => [operation.name, operation]));
export const findOperation = (name: string): Operation | undefined => BY_NAME.get(name);
export const domainOf = (operationName: string): string => operationName.split('.', 1)[0];
export const isOrchestrated = (operation: Operation): boolean => operation.kind === 'rpc' && operation.orchestrated === true;
