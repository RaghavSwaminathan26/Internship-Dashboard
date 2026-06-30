import type { ReactNode } from 'react';
import type { PostingDocument } from '@interniq/shared/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { computeSkillFrequencies } from '../utils/skillFrequencies';

interface TrendsChartProps {
  postings: PostingDocument[];
}

/**
 * Displays a bar chart of the top 10 most frequently occurring tech skills
 * across all ingested postings. Shows a "no data" message when no postings
 * have extracted tech stack data.
 *
 * Updates reactively when the postings prop changes.
 */
export default function TrendsChart({ postings }: TrendsChartProps): ReactNode {
  const frequencies = computeSkillFrequencies(postings);

  if (frequencies.length === 0) {
    return (
      <section className="trends-chart" aria-label="Tech skills trends chart">
        <p className="trends-chart__empty" role="status">
          Trend data is not yet available.
        </p>
      </section>
    );
  }

  return (
    <section className="trends-chart" aria-label="Tech skills trends chart">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={frequencies} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="skill" angle={-45} textAnchor="end" interval={0} />
          <YAxis allowDecimals={false} label={{ value: 'Frequency', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Bar dataKey="count" fill="#4f46e5" name="Frequency" />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
