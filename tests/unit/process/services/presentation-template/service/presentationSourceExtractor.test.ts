/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import {
  buildPresentationGrounding,
  extractPresentationSources,
  PresentationSourceExtractionError,
  type PresentationSourceExtractionInput,
  type PresentationSourceExtractorDependencies,
} from '@/process/services/presentation-template/run/service/presentationSourceExtractor';

const grantId = (suffix: number): string => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

const source = (
  suffix: number,
  format: PresentationSourceExtractionInput['format'],
  contents: string | Buffer = 'source text'
): PresentationSourceExtractionInput => {
  const bytes = Buffer.from(contents);
  return {
    grantId: grantId(suffix),
    displayName: `source-${suffix}.${format}`,
    format,
    byteLength: bytes.byteLength,
    sha256: String(suffix).padStart(64, '0'),
    snapshot: {
      byteLength: bytes.byteLength,
      readBytes: async () => Buffer.from(bytes),
    },
  };
};

afterEach(() => vi.useRealTimers());

describe('extractPresentationSources', () => {
  it('normalizes OfficeCLI text in source order and falls back from PPTX to officeparser', async () => {
    const pptxFallback = vi.fn(async () => 'fallback slide text');
    const officeViewText = vi.fn(async (_bytes: Buffer, format: 'docx' | 'pptx') => {
      if (format === 'pptx') throw new Error('officecli failed');
      return { totalItems: 3, returnedItems: 3, textItems: ['first', '', 'second'] };
    });

    const result = await extractPresentationSources([source(1, 'pptx'), source(2, 'docx')], {
      officeViewText,
      extractPptxFallback: pptxFallback,
    });

    expect(result.map(({ grantId: id, text }) => ({ id, text }))).toEqual([
      { id: grantId(1), text: 'fallback slide text' },
      { id: grantId(2), text: 'first\nsecond' },
    ]);
    expect(pptxFallback).toHaveBeenCalledOnce();
    expect(officeViewText.mock.calls.map(([, format]) => format)).toEqual(['pptx', 'docx']);
    expect(officeViewText.mock.calls.every(([bytes]) => Buffer.isBuffer(bytes))).toBe(true);
  });

  it('uses PDF.js for at most 50 pages and rejects a larger document without OCR fallback', async () => {
    const extractPdf = vi.fn(async () => ({
      pages: ['page one'],
      pageCount: PRESENTATION_RUN_LIMITS.MAX_PDF_PAGES + 1,
      hasTextLayer: true,
      truncated: true,
    }));

    await expect(extractPresentationSources([source(1, 'pdf')], { extractPdf })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      grantId: grantId(1),
    });
    expect(extractPdf).toHaveBeenCalledWith(expect.any(Buffer), {
      maxPages: PRESENTATION_RUN_LIMITS.MAX_PDF_PAGES,
    });
  });

  it('decodes text sources as strict UTF-8 and rejects unreadable or empty content', async () => {
    const invalid = source(1, 'txt');
    invalid.snapshot.readBytes = async () => Buffer.from([0xc3, 0x28]);
    await expect(extractPresentationSources([invalid])).rejects.toBeInstanceOf(PresentationSourceExtractionError);

    await expect(extractPresentationSources([source(2, 'md', '   \n\t')])).rejects.toMatchObject({
      code: 'SOURCE_TAMPERED',
      grantId: grantId(2),
    });
  });

  it('accepts the exact per-source and total character bounds and rejects one character over', async () => {
    const perSource = PRESENTATION_RUN_LIMITS.MAX_EXTRACTED_CHARS_PER_SOURCE;
    const atBoundary = Array.from({ length: 5 }, (_, index) => source(index + 1, 'txt', 'x'.repeat(perSource)));
    const extracted = await extractPresentationSources(atBoundary);
    expect(extracted.reduce((total, item) => total + item.characterCount, 0)).toBe(
      PRESENTATION_RUN_LIMITS.MAX_EXTRACTED_CHARS_TOTAL
    );

    await expect(extractPresentationSources([source(9, 'txt', 'x'.repeat(perSource + 1))])).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      grantId: grantId(9),
    });

    const overTotal = [
      ...Array.from({ length: 5 }, (_, index) => source(index + 10, 'txt', 'x'.repeat(perSource))),
      source(15, 'txt', 'x'),
    ];
    await expect(extractPresentationSources(overTotal)).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
  });

  it('accepts exactly 16 sources and rejects a seventeenth before reading bytes', async () => {
    const atBoundary = Array.from({ length: PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN }, (_, index) =>
      source(index + 1, 'txt', 'x')
    );
    await expect(extractPresentationSources(atBoundary)).resolves.toHaveLength(
      PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN
    );

    const firstRead = vi.fn(async () => Buffer.from('x'));
    const overBoundary = [...atBoundary, source(PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN + 1, 'txt', 'x')];
    overBoundary[0]!.snapshot.readBytes = firstRead;
    await expect(extractPresentationSources(overBoundary)).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
    expect(firstRead).not.toHaveBeenCalled();
  });

  it('bounds each extraction attempt by the configured timeout', async () => {
    vi.useFakeTimers();
    const pending = extractPresentationSources([source(1, 'xlsx')], {
      extractXlsx: () => new Promise<string>(() => undefined),
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      grantId: grantId(1),
    });

    await vi.advanceTimersByTimeAsync(PRESENTATION_RUN_LIMITS.EXTRACTION_ATTEMPT_TIMEOUT_MS);
    await assertion;
  });

  it('terminates the default parser worker when its extraction attempt times out', async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(async () => 0);
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const fakeWorker = {
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return fakeWorker;
      }),
      terminate,
    };
    const parserWorkerFactory = vi.fn(() => fakeWorker);
    const dependencies = { parserWorkerFactory } as PresentationSourceExtractorDependencies & {
      parserWorkerFactory: typeof parserWorkerFactory;
    };
    const pending = extractPresentationSources([source(1, 'xlsx')], dependencies);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      grantId: grantId(1),
    });

    await vi.advanceTimersByTimeAsync(PRESENTATION_RUN_LIMITS.EXTRACTION_ATTEMPT_TIMEOUT_MS);
    await assertion;

    expect(parserWorkerFactory).toHaveBeenCalledOnce();
    expect(parserWorkerFactory.mock.calls[0]?.[1]).toMatchObject({
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('maps parser-worker output limits to a bounded extraction failure', async () => {
    const terminate = vi.fn(async () => 0);
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const fakeWorker = {
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return fakeWorker;
      }),
      terminate,
    };
    const parserWorkerFactory = vi.fn(() => {
      queueMicrotask(() => listeners.get('message')?.({ ok: false, outputLimit: true }));
      return fakeWorker;
    });
    const dependencies = { parserWorkerFactory } as PresentationSourceExtractorDependencies & {
      parserWorkerFactory: typeof parserWorkerFactory;
    };

    await expect(extractPresentationSources([source(1, 'docx')], dependencies)).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      grantId: grantId(1),
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('uses the bounded library fallback after an OfficeCLI attempt times out', async () => {
    vi.useFakeTimers();
    const pending = extractPresentationSources([source(1, 'docx')], {
      officeViewText: () => new Promise(() => undefined),
      extractDocxFallback: async () => 'fallback after timeout',
    });

    await vi.advanceTimersByTimeAsync(PRESENTATION_RUN_LIMITS.EXTRACTION_ATTEMPT_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject([{ grantId: grantId(1), text: 'fallback after timeout' }]);
  });

  it('times the Office fallback read and parse as one extraction attempt', async () => {
    vi.useFakeTimers();
    const input = source(1, 'pptx');
    input.snapshot.readBytes = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      return Buffer.from('pptx');
    };
    const pending = extractPresentationSources([input], {
      officeViewText: async () => {
        throw new Error('officecli failed');
      },
      extractPptxFallback: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        return 'late fallback';
      },
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      grantId: grantId(1),
    });

    await vi.advanceTimersByTimeAsync(20_000 + PRESENTATION_RUN_LIMITS.EXTRACTION_ATTEMPT_TIMEOUT_MS);
    await assertion;
  });

  it('does not start another source after the first extraction failure', async () => {
    let releaseSecond: ((value: Buffer) => void) | undefined;
    const first = source(1, 'txt');
    first.snapshot.readBytes = vi.fn(async () => {
      throw new Error('unreadable');
    });
    const second = source(2, 'txt');
    second.snapshot.readBytes = vi.fn(
      () =>
        new Promise<Buffer>((resolve) => {
          releaseSecond = resolve;
        })
    );
    const third = source(3, 'txt');
    third.snapshot.readBytes = vi.fn(async () => Buffer.from('third'));

    const pending = extractPresentationSources([first, second, third]);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'SOURCE_TAMPERED',
      grantId: grantId(1),
    });
    await vi.waitFor(() => expect(second.snapshot.readBytes).toHaveBeenCalledOnce());
    expect(third.snapshot.readBytes).not.toHaveBeenCalled();
    releaseSecond?.(Buffer.from('second'));
    await assertion;
    expect(third.snapshot.readBytes).not.toHaveBeenCalled();
  });

  it('extracts XLSX cells in a killable worker without exposing workbook paths', async () => {
    const XLSX = await import('xlsx-republish');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Region', 'Revenue'],
        ['APAC', 100],
      ]),
      'Data'
    );
    const bytes = Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));

    const [result] = await extractPresentationSources([source(1, 'xlsx', bytes)]);

    expect(result?.text).toContain('## Data');
    expect(result?.text).toContain('A2: APAC');
    expect(result?.text).toContain('B2: 100');
    expect(result?.text).not.toContain('/private/grants');
  });

  it('extracts PDF, DOCX, and PPTX through the production parser workers', async () => {
    const fixtures = [
      ['docx', 'packages/desktop/resources/presentation-templates/operations-guide.docx'],
      ['pptx', 'packages/desktop/resources/presentation-templates/business-review.pptx'],
      ['pdf', 'tests/fixtures/knowledge/text-layer.pdf'],
    ] as const;
    const inputs = await Promise.all(
      fixtures.map(async ([format, relativePath], index) => {
        const bytes = await readFile(path.join(process.cwd(), relativePath));
        return source(index + 1, format, bytes);
      })
    );

    const extracted = await extractPresentationSources(inputs, {
      officeViewText: async () => {
        throw new Error('force bounded library fallback');
      },
    });

    expect(extracted.map(({ format, text }) => ({ format, text }))).toEqual([
      expect.objectContaining({ format: 'docx', text: expect.stringContaining('Production Release Procedure') }),
      expect.objectContaining({ format: 'pptx', text: expect.stringContaining('QUARTERLY BUSINESS REVIEW') }),
      expect.objectContaining({ format: 'pdf', text: expect.stringContaining('Visa Letter Policy') }),
    ]);
    // This starts three production parser workers and their lazy library imports. It measured
    // 369ms alone, but reached Vitest's 10,004ms deadline under full-suite contention. Keep the
    // assertions and global timeout strict while giving this bounded worker test loaded headroom.
  }, 30_000);
});

describe('buildPresentationGrounding', () => {
  it('keeps prompt-only requests useful without inventing a source', () => {
    const grounding = buildPresentationGrounding('Create a concise board update', []);

    expect(grounding).toContain('Create a concise board update');
    expect(grounding).toContain('No managed source documents were supplied.');
    expect(grounding).not.toContain('/private/');
  });

  it('contains only opaque source identity and indents source text as evidence', () => {
    const grounding = buildPresentationGrounding(
      'Summarize it',
      [
        {
          grantId: grantId(1),
          displayName: 'metrics.csv',
          format: 'csv',
          byteLength: 12,
          sha256: 'a'.repeat(64),
          text: 'Revenue,100\nMargin,42',
          characterCount: 21,
        },
      ],
      {
        fileName: 'THEME.md',
        sha256: 'b'.repeat(64),
        text: '# Board theme\nUse navy accents.',
      }
    );

    expect(grounding).toContain('Selected theme specification: THEME.md');
    expect(grounding).toContain('    # Board theme\n    Use navy accents.');
    expect(grounding).toContain(`Grant id: ${grantId(1)}`);
    expect(grounding).toContain('    Revenue,100\n    Margin,42');
    expect(grounding).not.toContain('sourcePath');
  });
});
