import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { pinPublicSearchPath, serviceDatabaseUrl, singleConnectionUrl } from '../../../../test-support/search-path';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { PrismaTicketStore } from '../../src/infrastructure/persistence/prisma-ticket-store';

// ADR-F12b1-fix-01: la secuencia de números de billete (ticket_sequences) se califica con el esquema.
describe('ADR-F12b1-fix-01: consultas a mano de Ticketing con search_path = public', () => {
  let prisma: PrismaClient;
  const bookingId = randomUUID(); const ownerId = `sp-owner-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: singleConnectionUrl(serviceDatabaseUrl('microservices/ticketing-service')) });
    await prisma.$connect();
    await pinPublicSearchPath(prisma, 'ticketing', 'ticket_sequences');
  }, 60_000);
  afterAll(async () => {
    try { if (prisma) { await prisma.issuanceRequest.deleteMany({ where: { bookingId } }); await prisma.ticket.deleteMany({ where: { bookingId } }); } } finally { await prisma?.$disconnect(); }
  });

  it('issue genera el número de billete desde ticket_sequences sin depender del search_path', async () => {
    const tickets = await new PrismaTicketStore(prisma).issue(bookingId, 'sp-request', ownerId, [{ passengerId: 'sp-p1' }], ['sp-s1'], '999', 'none', new Date());
    expect(tickets).toHaveLength(1);
    expect(tickets[0].props.eTicketNumber).toMatch(/^999\d{10}$/);
  });
});
