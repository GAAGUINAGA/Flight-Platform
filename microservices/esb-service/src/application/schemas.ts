import { z } from 'zod';

/** Sobre de petición (ADR-F12b-02). El contenido de `input` lo valida el microservicio dueño; aquí solo se exige que sea un objeto. */
export const operationEnvelope = z.object({ input: z.record(z.string(), z.unknown()) }).strict();

/** Nombre `<dominio>.<operación>` en minúsculas con guiones. */
export const operationName = z.string().regex(/^[a-z]+\.[a-z-]+$/).max(64);

export const requestHeaders = z.object({
  correlationId: z.string().trim().min(1).max(128),
  ownerId: z.string().trim().min(1).max(255).optional(),
  role: z.string().trim().min(1).max(64).optional(),
  deadlineMs: z.coerce.number().int().positive().max(3_600_000).optional()
});
