/**
 * Nombre de la operación del ESB para cada (servicio, método gRPC) que el Gateway usa (docs/dev/f12b1-diseno-esb.md §5).
 * Es la contraparte del catálogo del ESB: una prueba comprueba que ambos coinciden, así que no puede desfasarse en silencio.
 */
export const ESB_OPERATIONS: Readonly<Record<string, string>> = {
  'pricing.searchOffers': 'vuelos.buscar-ofertas',
  'pricing.holdOffer': 'vuelos.crear-hold',
  'pricing.getOfferHold': 'vuelos.consultar-hold',
  'pricing.releaseOfferHold': 'vuelos.liberar-hold',
  'operations.getFlightStatus': 'vuelos.estado-vuelo',
  'inventory.findFlightInstance': 'vuelos.buscar-instancia',
  'inventory.listCabinOccupancy': 'vuelos.ocupacion-cabinas',
  'inventory.getFlightInstance': 'vuelos.obtener-instancia',
  'inventory.queryAvailability': 'vuelos.consultar-disponibilidad',
  'inventory.upsertFlightInstance': 'vuelos.guardar-instancia',
  'inventory.listFlightInstances': 'vuelos.listar-instancias',
  'inventory.closeFlightInstance': 'vuelos.cerrar-instancia',
  'pricing.upsertFare': 'vuelos.guardar-tarifa',
  'pricing.listFares': 'vuelos.listar-tarifas',
  'operations.recordOperationalUpdate': 'vuelos.registrar-novedad-operativa',
  'operations.countCheckedIn': 'vuelos.contar-check-ins',
  'reservation.createReservation': 'reservas.crear',
  'reservation.getReservation': 'reservas.obtener',
  'reservation.listReservations': 'reservas.listar',
  'reservation.resumeReservation': 'reservas.reanudar',
  'reservation.failReservation': 'reservas.fallar',
  'reservation.listReservationsByFlightInstance': 'reservas.listar-por-vuelo',
  'ticketing.listTickets': 'reservas.listar-boletos',
  'ticketing.getTicket': 'reservas.obtener-boleto',
  'reservation.getBaggageOptions': 'postventa.opciones-equipaje',
  'reservation.addBaggage': 'postventa.agregar-equipaje',
  'reservation.searchDateChange': 'postventa.buscar-cambio-fecha',
  'reservation.confirmDateChange': 'postventa.confirmar-cambio-fecha',
  'reservation.getCancellationQuote': 'postventa.cotizar-cancelacion',
  'reservation.getStoredCancellationQuote': 'postventa.cotizacion-guardada',
  'reservation.quoteCancellation': 'postventa.cotizar-cancelacion-exonerada',
  'reservation.cancelReservation': 'postventa.cancelar',
  'ancillaries.changeSeats': 'postventa.cambiar-asientos',
  'operations.checkIn': 'postventa.check-in',
  'operations.listBoardingPasses': 'postventa.listar-pases',
  'webhooks.listSubscriptions': 'clientes.listar-suscripciones',
  'webhooks.createSubscription': 'clientes.crear-suscripcion',
  'webhooks.deleteSubscription': 'clientes.eliminar-suscripcion',
  'webhooks.listEvents': 'clientes.listar-eventos',
  'webhooks.publishEvent': 'clientes.publicar-evento',
  'inventory.expireHolds': 'sistema.expirar-holds',
  'reservation.resumePending': 'sistema.reanudar-pendientes',
  'webhooks.dispatchPending': 'sistema.despachar-webhooks',
  'operations.recoverCheckIns': 'sistema.recuperar-check-ins'
};

/** Operaciones compuestas y de salud, que no son un método gRPC. */
export const ESB_SEAT_MAP = 'vuelos.mapa-asientos';
export const ESB_HEALTH = 'sistema.salud';
/** Operación nativa del ESB (F12b-2): publica la outbox de eventos al bus. La dispara el scheduler antes de despachar webhooks. */
export const ESB_PUBLISH_EVENTS = 'sistema.publicar-eventos';
