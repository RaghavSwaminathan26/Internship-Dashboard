import { describe, it, expect, vi } from 'vitest';
import { parseMarkdownTable, parseMarkdownRow, serializeToMarkdownRow } from './simplifyParser';

describe('simplifyParser', () => {
  describe('parseMarkdownRow', () => {
    it('parses a valid row with all fields', () => {
      const row = '| Google | SWE Intern | Mountain View, CA | [Apply](https://example.com) | Jan 15 |';
      const result = parseMarkdownRow(row);
      expect(result).toEqual({
        company: 'Google',
        role: 'SWE Intern',
        location: 'Mountain View, CA',
        applicationLink: '[Apply](https://example.com)',
        datePosted: 'Jan 15',
      });
    });

    it('returns null for rows with wrong column count', () => {
      const row = '| Google | SWE Intern | Mountain View, CA |';
      expect(parseMarkdownRow(row)).toBeNull();
    });

    it('returns null for rows with empty required fields', () => {
      const row = '| | SWE Intern | Mountain View, CA | [Apply](url) | Jan 15 |';
      expect(parseMarkdownRow(row)).toBeNull();
    });

    it('returns null for rows not starting with pipe', () => {
      const row = 'Google | SWE Intern | Mountain View, CA | [Apply](url) | Jan 15 |';
      expect(parseMarkdownRow(row)).toBeNull();
    });

    it('returns null for rows not ending with pipe', () => {
      const row = '| Google | SWE Intern | Mountain View, CA | [Apply](url) | Jan 15';
      expect(parseMarkdownRow(row)).toBeNull();
    });

    it('trims whitespace from cell values', () => {
      const row = '|  Google  |  SWE Intern  |  Mountain View  |  [Apply](url)  |  Jan 15  |';
      const result = parseMarkdownRow(row);
      expect(result).toEqual({
        company: 'Google',
        role: 'SWE Intern',
        location: 'Mountain View',
        applicationLink: '[Apply](url)',
        datePosted: 'Jan 15',
      });
    });

    it('returns null for empty string', () => {
      expect(parseMarkdownRow('')).toBeNull();
    });

    it('returns null for separator row pattern', () => {
      const row = '| --- | --- | --- | --- | --- |';
      expect(parseMarkdownRow(row)).toBeNull();
    });
  });

  describe('parseMarkdownTable', () => {
    it('parses a complete table with header, separator, and data rows', () => {
      const markdown = `| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | --------------- | ----------- |
| Google | SWE Intern | Mountain View, CA | [Apply](https://google.com) | Jan 15 |
| Meta | Backend Intern | Menlo Park, CA | [Apply](https://meta.com) | Jan 20 |`;

      const results = parseMarkdownTable(markdown);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        company: 'Google',
        role: 'SWE Intern',
        location: 'Mountain View, CA',
        applicationLink: '[Apply](https://google.com)',
        datePosted: 'Jan 15',
      });
      expect(results[1]).toEqual({
        company: 'Meta',
        role: 'Backend Intern',
        location: 'Menlo Park, CA',
        applicationLink: '[Apply](https://meta.com)',
        datePosted: 'Jan 20',
      });
    });

    it('skips invalid rows and continues parsing valid ones', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const markdown = `| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | --------------- | ----------- |
| Google | SWE Intern | Mountain View, CA | [Apply](url) | Jan 15 |
| Invalid Row Missing Columns |
| Meta | Backend Intern | Menlo Park, CA | [Apply](url) | Jan 20 |`;

      const results = parseMarkdownTable(markdown);
      expect(results).toHaveLength(2);
      expect(results[0]!.company).toBe('Google');
      expect(results[1]!.company).toBe('Meta');
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('returns empty array when no table is found', () => {
      const markdown = `# Some heading\n\nJust regular text with no table.`;
      expect(parseMarkdownTable(markdown)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(parseMarkdownTable('')).toEqual([]);
    });

    it('handles table with content before it', () => {
      const markdown = `# Internship Postings

Some introductory text here.

| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | --------------- | ----------- |
| Apple | iOS Intern | Cupertino, CA | [Apply](url) | Feb 1 |`;

      const results = parseMarkdownTable(markdown);
      expect(results).toHaveLength(1);
      expect(results[0]!.company).toBe('Apple');
    });

    it('stops parsing at non-table lines after data rows', () => {
      const markdown = `| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | --------------- | ----------- |
| Google | SWE Intern | Mountain View, CA | [Apply](url) | Jan 15 |

Some footer text here.`;

      const results = parseMarkdownTable(markdown);
      expect(results).toHaveLength(1);
    });
  });

  describe('serializeToMarkdownRow', () => {
    it('serializes a ParsedRow to markdown format', () => {
      const row = {
        company: 'Google',
        role: 'SWE Intern',
        location: 'Mountain View, CA',
        applicationLink: '[Apply](https://google.com)',
        datePosted: 'Jan 15',
      };
      expect(serializeToMarkdownRow(row)).toBe(
        '| Google | SWE Intern | Mountain View, CA | [Apply](https://google.com) | Jan 15 |'
      );
    });
  });

  describe('round-trip property', () => {
    it('serialize then parse produces equivalent result', () => {
      const original = {
        company: 'Google',
        role: 'SWE Intern',
        location: 'Mountain View, CA',
        applicationLink: '[Apply](https://google.com)',
        datePosted: 'Jan 15',
      };

      const serialized = serializeToMarkdownRow(original);
      const parsed = parseMarkdownRow(serialized);
      expect(parsed).toEqual(original);
    });
  });
});
