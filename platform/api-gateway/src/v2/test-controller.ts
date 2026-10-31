import type { Request } from 'express';
import { v2Controller, v2Route } from './route';

/** Solo se registra con NODE_ENV=test: ejercita guards, dueño compuesto y scopes de v2 sin depender de los microservicios. */
export class V2TestController {
  whoami(req: Request): unknown { return { ownerId: req.auth!.ownerId, role: req.auth!.role, clientId: req.auth!.clientId ?? null, scopes: [...req.auth!.scopes].sort() }; }
  ops(req: Request): unknown { return { ownerId: req.auth!.ownerId }; }
}
v2Controller(V2TestController, '__test');
v2Route(V2TestController.prototype, 'whoami', 'get', 'whoami', ['req'], { scopes: ['flights:read'] });
v2Route(V2TestController.prototype, 'ops', 'get', 'ops', ['req'], { anyScope: ['flights:ops', 'flights:admin'] });
