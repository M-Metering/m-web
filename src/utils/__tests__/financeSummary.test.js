import { describe, it, expect } from 'vitest';
import {
  summarizeRevenue,
  dataQualityNote,
  recognitionLabel,
  normalizeRevenueTransaction,
  transactionAmountLabel,
} from '../financeSummary';

// The documented sample response, as the integration guide prints it.
const SUMMARY = {
  success: true,
  data: {
    currency: 'NGN',
    range: { from: null, to: null, preset: null },
    total: { amount: 2042500, count: 21 },
    byDisco: [{
      discoCode: 'ABA_POWER',
      recognition: 'ON_INSTALLATION_COMPLETED',
      amount: 2042500,
      count: 21,
      estimatedAmount: 1935000,
      estimatedCount: 18,
      missingAmountCount: 2,
    }],
    dataQuality: { estimatedAmount: 1935000, estimatedCount: 18, missingAmountCount: 2 },
  },
};

describe('dataQualityNote — a total is never presented as exact', () => {
  it('names both the estimated value and the unpriced records', () => {
    expect(dataQualityNote({ estimatedAmount: 1935000, estimatedCount: 18, missingAmountCount: 2 }))
      .toBe("Includes ₦1,935,000 estimated at today's price (18 records), and 2 records completed with no price recorded.");
  });

  it('mentions only what actually applies', () => {
    expect(dataQualityNote({ estimatedAmount: 5000, estimatedCount: 1, missingAmountCount: 0 }))
      .toBe("Includes ₦5,000 estimated at today's price (1 record).");
    expect(dataQualityNote({ missingAmountCount: 3 }))
      .toBe('Includes 3 records completed with no price recorded.');
  });

  it('returns nothing only when the figure genuinely carries no caveat', () => {
    expect(dataQualityNote({ estimatedCount: 0, missingAmountCount: 0 })).toBeNull();
    expect(dataQualityNote(null)).toBeNull();
  });
});

describe('summarizeRevenue', () => {
  it('uses the API totals as given rather than re-adding the rows', () => {
    const s = summarizeRevenue(SUMMARY);
    expect(s.amount).toBe(2042500);
    expect(s.count).toBe(21);
    expect(s.currency).toBe('NGN');
  });

  it('carries the caveat alongside the total', () => {
    expect(summarizeRevenue(SUMMARY).note).toContain('2 records completed with no price recorded');
  });

  it('keeps each disco’s own recognition basis instead of deriving one', () => {
    const [aba] = summarizeRevenue(SUMMARY).byDisco;
    expect(aba.recognition).toBe('ON_INSTALLATION_COMPLETED');
    expect(aba.recognitionText).toBe('counted when the installation is completed');
    expect(aba.note).toContain('estimated');
  });

  it('falls back to the total row when dataQuality is absent, so the caveat is never lost', () => {
    const withoutQuality = { data: { ...SUMMARY.data, dataQuality: undefined, total: { amount: 10, count: 1, missingAmountCount: 1 } } };
    expect(summarizeRevenue(withoutQuality).note).toBe('Includes 1 record completed with no price recorded.');
  });

  it('handles an empty range without inventing figures', () => {
    const s = summarizeRevenue({ data: { total: {}, byDisco: [] } });
    expect(s).toMatchObject({ amount: 0, count: 0, byDisco: [], note: null });
  });
});

describe('recognitionLabel', () => {
  it('translates the two documented bases', () => {
    expect(recognitionLabel('ON_PAYMENT_CONFIRMED')).toBe('counted when Remita confirms payment');
    expect(recognitionLabel('ON_INSTALLATION_COMPLETED')).toBe('counted when the installation is completed');
  });

  it('shows an unknown basis rather than guessing or hiding it', () => {
    expect(recognitionLabel('ON_SOMETHING_NEW')).toBe('on something new');
    expect(recognitionLabel(null)).toBeNull();
  });
});

describe('normalizeRevenueTransaction', () => {
  const ROW = {
    discoCode: 'ABA_POWER', source: 'installation_request', sourceId: 685,
    reference: '3705431479', customerName: 'IHESIABA CHIEMELA ISRAEL',
    meterType: 'THREE PHASE', amount: 0, amountMissing: true,
    isEstimated: null, sourceStatus: 'INSTALLED',
    revenueAt: '2026-09-24T14:07:35.021Z', dateBasis: 'reported_at',
  };

  it('keeps the reference as the account-number string, never a number', () => {
    const row = normalizeRevenueTransaction({ ...ROW, reference: '0239110006909' });
    expect(row.reference).toBe('0239110006909');
    expect(typeof row.reference).toBe('string');
  });

  it('distinguishes unpriced work from zero revenue', () => {
    const row = normalizeRevenueTransaction(ROW);
    expect(row.amountMissing).toBe(true);
    expect(transactionAmountLabel(row)).toBe('Not priced');
  });

  it('shows a real amount as currency', () => {
    const row = normalizeRevenueTransaction({ ...ROW, amount: 97500, amountMissing: false });
    expect(transactionAmountLabel(row)).toBe('₦97,500');
  });

  it('treats a null isEstimated as not estimated, not as unknown', () => {
    expect(normalizeRevenueTransaction(ROW).isEstimated).toBe(false);
    expect(normalizeRevenueTransaction({ ...ROW, isEstimated: true }).isEstimated).toBe(true);
  });
});
