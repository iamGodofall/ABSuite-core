/**
 * A notary, and nothing else.
 *
 * No dependency on capkit — deliberately. A notary that imported the thing it
 * witnesses would be a component of it, and the entire value on offer is that
 * it is a different party. It receives a hash and returns a signed timestamp;
 * it has no idea what a trace is and must never need one.
 */
export {
  Notary,
  InMemoryReceiptStore,
  NotaryError,
  canonicalReceipt,
  verifyReceipt,
  auditAgainstReceipts,
  suggestChainId,
  RECEIPT_VERSION,
  SUPPORTED_RECEIPT_VERSIONS,
  type Receipt,
  type ReceiptStore,
  type AuditFinding,
  type AuditResult,
} from './notary';
