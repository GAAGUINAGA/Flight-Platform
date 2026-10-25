import { evaluateAudit, readAuditReport } from './audit-policy.cjs';

const high = (advisory: string) => ({ vulnerabilities: { zod: { severity: 'high', via: [{ name: 'zod', url: `https://github.com/advisories/${advisory}` }] } } });

describe('npm audit policy', () => {
  const auditExitOne = (report: object) => () => {
    const error = Object.assign(new Error('Command failed: npm audit --json'), { status: 1, stdout: JSON.stringify(report) });
    throw error;
  };

  it('AUDIT-01: código 1 con alta falla sin excepciones', () => {
    const report = readAuditReport(auditExitOne(high('GHSA-mrhx-c7xc-m3w5')));
    expect(evaluateAudit(report)).toEqual(['zod: GHSA-MRHX-C7XC-M3W5 (high)']);
  });

  it('AUDIT-02: código 1 con alta no exceptuada falla y la nombra', () => {
    const report = readAuditReport(auditExitOne(high('GHSA-aaaa-bbbb-cccc')));
    expect(evaluateAudit(report)).toEqual(['zod: GHSA-AAAA-BBBB-CCCC (high)']);
  });

  it('AUDIT-03: error sin JSON válido falla con mensaje claro', () => {
    const execute = () => { throw Object.assign(new Error('network unavailable'), { status: 1, stdout: 'gateway timeout' }); };
    expect(() => readAuditReport(execute)).toThrow('npm audit did not produce a valid JSON report');
  });
});
