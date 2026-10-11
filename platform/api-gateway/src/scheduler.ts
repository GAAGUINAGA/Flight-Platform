export class GatewayScheduler {
  constructor(private readonly enabled: boolean, private readonly run: () => Promise<void>) {}
  async tick(): Promise<void> { if (this.enabled) await this.run(); }
}
