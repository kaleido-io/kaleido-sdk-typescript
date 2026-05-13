import type { CantonContractEvent } from './types.js';

export function shortPartyName(partyId: string | undefined | null): string {
  if (!partyId) return '';
  return partyId.split('::')[0] ?? partyId;
}

/** Asset Manager lowercases all addresses — normalize to match. */
export function normalizeAddr(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Common contract metadata block included in every fragment's `info`.
 * Handlers can spread this and add extra fields on top.
 */
export function contractInfoBlock(ce: CantonContractEvent): Record<string, unknown> {
  return {
    contractId: ce.contractId,
    templateId: ce.templateId,
    transactionId: ce.transactionId,
    offset: ce.offset,
    effectiveAt: ce.effectiveAt,
    entityName: ce.entityName,
    moduleName: ce.moduleName,
    arguments: ce.arguments,
    signatories: ce.signatories,
    observers: ce.observers,
  };
}

/**
 * Build fragment labels with chain=canton, the given standard/type,
 * spent=false, and any extra labels.
 */
export function baseLabels(
  standard: string,
  type: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return { chain: 'canton', standard, type, spent: 'false', ...extra };
}
