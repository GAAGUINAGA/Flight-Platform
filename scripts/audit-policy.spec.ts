import { evaluateAudit, readAuditReport } from './audit-policy.cjs';

const high = (advisory: string) => ({ vulnerabilities: { zod: { severity: 'high', via: [{ name: 'zod', url: `https://github.com/advisories/${advisory}` }] } } });
const exception = { package: 'zod', advisory: 'GHSA-mrhx-c7xc-m3w5', expiresAt: '2026-11-23', justification: 'major upgrade', mitigation: '100kb', owner: 'Flight Platform' };

describe('npm audit policy', () => {
  const auditExitOne = (report: object) => () => {
    const error = Object.assign(new Error('Command failed: npm audit --json'), { status: 1, stdout: JSON.stringify(report) });
    throw error;
  };

  it('AUDIT-01: código 1 con excepción vigente pasa', () => {
    const report = readAuditReport(auditExitOne(high(exception.advisory)));
    expect(evaluateAudit(report, [exception], new Date('2026-10-24T00:00:00Z'))).toEqual([]);
  });

  it('AUDIT-02: código 1 con alta no exceptuada falla y la nombra', () => {
    const report = readAuditReport(auditExitOne(high('GHSA-aaaa-bbbb-cccc')));
    expect(evaluateAudit(report, [exception], new Date('2026-10-24T00:00:00Z'))).toEqual(['zod: GHSA-AAAA-BBBB-CCCC (high)']);
  });

  it('AUDIT-03: código 1 con excepción vencida falla', () => {
    const report = readAuditReport(auditExitOne(high(exception.advisory)));
    expect(evaluateAudit(report, [exception], new Date('2026-11-24T00:00:00Z'))).toEqual(['zod: GHSA-mrhx-c7xc-m3w5 exception expired 2026-11-23']);
  });

  it('AUDIT-04: error sin JSON válido falla con mensaje claro', () => {
    const execute = () => { throw Object.assign(new Error('network unavailable'), { status: 1, stdout: 'gateway timeout' }); };
    expect(() => readAuditReport(execute)).toThrow('npm audit did not produce a valid JSON report');
  });
});
