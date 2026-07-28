import {
  verifyOutput,
  segmentClaims,
  significantNumbers,
  quotedSpans,
  identifiers,
  findingsToEventKinds,
  renderReport,
} from './verification';

describe('claim segmentation', () => {
  test('splits on sentence boundaries', () => {
    expect(segmentClaims('Revenue grew. Costs fell. Margin improved.')).toEqual([
      'Revenue grew', 'Costs fell', 'Margin improved',
    ]);
  });

  test('does not split decimals or abbreviations', () => {
    // A naive splitter produces fragments here, and every fragment then fails
    // grounding for no reason — turning a formatting quirk into false alarms.
    const claims = segmentClaims('Latency was 3.5 ms. Acme Inc. reported growth.');
    expect(claims).toHaveLength(2);
    expect(claims[0]).toContain('3.5');
    expect(claims[1]).toContain('Inc.');
  });

  test('handles empty input without throwing', () => {
    expect(segmentClaims('')).toEqual([]);
  });
});

describe('significant numbers', () => {
  test('captures percentages, currency and decimals', () => {
    const found = significantNumbers('Margin rose 23% on $4.2M revenue with a 1.5x multiple');
    expect(found).toContain('23%');
    expect(found).toContain('$4.2m');
    expect(found).toContain('1.5');
  });

  test('ignores small integers and bare years', () => {
    // Flagging "3 steps" or "in 2024" would bury real fabricated statistics.
    const found = significantNumbers('There are 3 steps and it launched in 2024');
    expect(found).toEqual([]);
  });

  test('normalises thousands separators when comparing', () => {
    const report = verifyOutput('The total was 1,200 units.', ['We shipped 1200 units.']);
    expect(report.findings.filter(f => f.kind === 'unsupported_number')).toHaveLength(0);
  });

  test('a magnitude suffix is part of the number', () => {
    // Without this, "$4.2M" and "$4.2B" compare equal and a thousand-fold
    // error passes as grounded — the exact failure the check exists to catch.
    const report = verifyOutput('Revenue was $4.2B.', ['Revenue of $4.2M this year.']);
    expect(report.findings.some(f => f.kind === 'unsupported_number')).toBe(true);
  });

  test('the same figure written differently still matches', () => {
    const report = verifyOutput('Revenue was $4.2M.', ['Revenue of 4,200,000 dollars this year.']);
    expect(report.findings.filter(f => f.kind === 'unsupported_number')).toHaveLength(0);
  });

  test('a percentage never collapses onto the bare number', () => {
    const report = verifyOutput('Margin was 23%.', ['We surveyed 23 companies.']);
    expect(report.findings.some(f => f.kind === 'unsupported_number')).toBe(true);
  });
});

describe('quotes and identifiers', () => {
  test('extracts quoted spans of substance', () => {
    expect(quotedSpans('He said "the migration is complete and verified" yesterday'))
      .toEqual(['the migration is complete and verified']);
  });

  test('ignores short scare quotes', () => {
    expect(quotedSpans('It was "fine" apparently')).toEqual([]);
  });

  test('extracts urls, dois and emails', () => {
    const found = identifiers('See https://example.com/report and 10.1000/xyz123 or mail a@b.com');
    expect(found).toContain('https://example.com/report');
    expect(found).toContain('10.1000/xyz123');
    expect(found).toContain('a@b.com');
  });
});

describe('grounding', () => {
  const sources = [
    'The Q3 report shows revenue of $4.2M, up 23% year over year. Operating costs were flat at $1.1M.',
  ];

  test('a fabricated figure is flagged as critical', () => {
    const report = verifyOutput('Revenue reached $9.9M in Q3.', sources);
    const finding = report.findings.find(f => f.kind === 'unsupported_number');

    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
    expect(finding!.evidence).toContain('9.9');
  });

  test('a figure present in the sources is not flagged', () => {
    const report = verifyOutput('Revenue reached $4.2M, up 23%.', sources);
    expect(report.findings.filter(f => f.kind === 'unsupported_number')).toHaveLength(0);
  });

  test('a fabricated quotation is flagged', () => {
    const report = verifyOutput('The report states "growth will continue indefinitely" this year.', sources);
    expect(report.findings.some(f => f.kind === 'unsupported_quote')).toBe(true);
  });

  test('an invented citation is flagged', () => {
    const report = verifyOutput('Full details at https://example.com/fabricated-page here.', sources);
    expect(report.findings.some(f => f.kind === 'unsupported_identifier')).toBe(true);
  });

  test('with no sources it checks self-consistency only', () => {
    const report = verifyOutput('Revenue reached $9.9M in Q3.', []);

    expect(report.grounded).toBe(false);
    expect(report.findings.filter(f => f.kind === 'unsupported_number')).toHaveLength(0);
    expect(report.disclaimer).toContain('No sources were supplied');
  });

  test('reports the terms it matched, so a finding can be argued with', () => {
    const report = verifyOutput('Revenue was strong in Q3.', sources);
    expect(report.claims[0]!.matchedTerms.length).toBeGreaterThan(0);
    expect(report.claims[0]!.grounding).toBeGreaterThan(0);
  });
});

describe('self-contradiction', () => {
  test('opposite polarity about the same subject is caught', () => {
    const report = verifyOutput(
      'The migration completed successfully on Tuesday. The migration did not complete successfully on Tuesday.'
    );
    expect(report.findings.some(f => f.kind === 'self_contradiction')).toBe(true);
  });

  test('unrelated sentences containing a negation are not flagged', () => {
    // The overlap requirement is what stops every "not" from tripping this.
    const report = verifyOutput(
      'The database migration completed on Tuesday. Marketing did not attend the quarterly planning session.'
    );
    expect(report.findings.some(f => f.kind === 'self_contradiction')).toBe(false);
  });

  test('two different values for the same quantity are caught', () => {
    const report = verifyOutput(
      'Total processed volume reached 4,500 records overall. Total processed volume reached 7,800 records overall.'
    );
    expect(report.findings.some(f => f.kind === 'numeric_conflict' || f.kind === 'self_contradiction')).toBe(true);
  });

  test('needs no sources at all', () => {
    const report = verifyOutput('The service is available now. The service is not available now.');
    expect(report.grounded).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});

describe('evidence status', () => {
  const sources = ['The Q3 report shows revenue of $4.2M, up 23% year over year.'];

  test('a claim with no backing evidence is UNVERIFIED, never "false"', () => {
    const report = verifyOutput('The CEO approved this.', sources);

    // The whole product is in this distinction: absent evidence is not a claim
    // of falsehood, and the status must never imply one.
    expect(report.claims[0]!.status).toBe('UNVERIFIED');
    // No status in the vocabulary asserts falsehood, and none is a probability.
    expect(report.claims[0]!.status).not.toMatch(/false|likely|probab/i);
    expect(report.claims[0]!.evidence).toEqual([
      { kind: 'terms', value: '0/2 content words in sources', found: false },
    ]);
  });

  test('a short claim is not silently swallowed into the sentence before it', () => {
    // "Revenue was $4.2M." ends in a capital, and a lookbehind that rejects
    // capitals leaves both sentences as one claim — which then inherits the
    // first one's evidence and reports as SUPPORTED.
    const claims = segmentClaims('Revenue was $4.2M. The CEO approved it.');
    expect(claims).toHaveLength(2);
  });

  test('a fully backed claim is SUPPORTED', () => {
    expect(verifyOutput('Revenue was $4.2M.', sources).claims[0]!.status).toBe('SUPPORTED');
  });

  test('CONTRADICTED is the only status that asserts a defect', () => {
    const report = verifyOutput('The service is available now. The service is not available now.');
    expect(report.status).toBe('CONTRADICTED');
    expect(report.disclaimer).toContain('Only CONTRADICTED asserts a defect');
  });

  test('with no sources nothing is claimed either way', () => {
    expect(verifyOutput('The CEO approved this.').claims[0]!.status).toBe('NOT_CHECKED');
  });

  test('the report status is the worst across all claims', () => {
    const report = verifyOutput('Revenue was $4.2M. The CEO approved it personally last week.', sources);
    expect(report.summary.SUPPORTED).toBe(1);
    expect(report.summary.UNVERIFIED).toBe(1);
    expect(report.status).toBe('UNVERIFIED');
  });

  test('evidence lists what was checked, found and not found alike', () => {
    const report = verifyOutput('Revenue was $4.2M and margin hit 71%.', sources);
    const evidence = report.claims[0]!.evidence;

    expect(evidence.some(e => e.value.includes('4.2') && e.found)).toBe(true);
    expect(evidence.some(e => e.value.includes('71') && !e.found)).toBe(true);
  });

  test('renders as claim / evidence / status for a human', () => {
    const rendered = renderReport(verifyOutput('The CEO approved this.', sources));

    expect(rendered).toContain('Claim:');
    expect(rendered).toContain('Evidence:');
    expect(rendered).toContain('Status:   UNVERIFIED');
  });
});

describe('review priority', () => {
  test('a fully grounded output has priority zero and reads as clean', () => {
    const report = verifyOutput('Costs were flat.', ['Operating costs were flat this quarter.']);
    expect(report.reviewPriority).toBe(0);
    expect(report.clean).toBe(true);
  });

  test('orders a queue by density, not raw count', () => {
    const sources = ['Nothing relevant here at all.'];
    const dense = verifyOutput('Revenue was $9.9M.', sources);
    const padded = verifyOutput(
      `Revenue was $9.9M. ${'Nothing relevant here at all. '.repeat(20)}`,
      sources
    );
    // Same fabricated figure, far more surrounding grounded text.
    expect(padded.reviewPriority).toBeLessThan(dense.reviewPriority);
  });

  test('is documented as ordering, not as a probability of falsehood', () => {
    const report = verifyOutput('Revenue was $9.9M.', ['Revenue was $4.2M.']);
    expect(report.reviewPriority).toBeGreaterThan(0);
    // The status carries the meaning; this number only sorts work.
    expect(report.status).toBe('UNVERIFIED');
  });

  test('never claims the output is true', () => {
    const report = verifyOutput('Anything at all.', ['Anything at all.']);
    expect(report.disclaimer).toMatch(/not that it is true/i);
  });
});

describe('mapping findings to trust events', () => {
  test('unsupported figures become an unsupported_claim event', () => {
    const report = verifyOutput('Revenue was $9.9M.', ['Revenue was $4.2M.']);
    expect(findingsToEventKinds(report)).toContain('unsupported_claim');
  });

  test('weak grounding alone never lands on a permanent record', () => {
    // A good paraphrase scores low on lexical overlap. Penalising that would
    // make the score punish competence.
    const report = verifyOutput(
      'Earnings climbed considerably during the period under review.',
      ['Revenue increased substantially over the quarter.']
    );
    expect(report.findings.some(f => f.kind === 'low_grounding')).toBe(true);
    expect(findingsToEventKinds(report)).not.toContain('unsupported_claim');
  });

  test('a clean ungrounded check does not claim a pass', () => {
    const report = verifyOutput('Some statement here.', []);
    expect(findingsToEventKinds(report)).toEqual([]);
  });

  test('a clean grounded check records a pass', () => {
    const report = verifyOutput('Costs were flat.', ['Operating costs were flat this quarter.']);
    expect(findingsToEventKinds(report)).toEqual(['verification_passed']);
  });
});
