import { Server } from '@grpc/grpc-js';
import { HealthImplementation, protoPath, ServingStatusMap } from 'grpc-health-check';

export const GRPC_HEALTH_SERVICE = 'grpc.health.v1.Health';
export const GRPC_HEALTH_PROTO_PATH = protoPath;
export const SERVING_STATUS = 'SERVING';

export function addGrpcHealthCheck(server: Server, statuses: ServingStatusMap = { '': 'SERVING' }): HealthImplementation {
  const health = new HealthImplementation(statuses);
  health.addToServer(server);
  return health;
}
