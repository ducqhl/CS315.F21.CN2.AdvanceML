import { useQuery } from '@tanstack/react-query';
import { fetchCorrelation } from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import CorrelationMatrix from './correlation/components/CorrelationMatrix';
import CorrelationSummary from './correlation/components/CorrelationSummary';

export default function CorrelationPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['correlation'],
    queryFn:  fetchCorrelation,
    staleTime: 600_000,
  });

  if (isLoading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '32px', width: '260px', borderRadius: '8px', marginBottom: '28px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div className="skeleton" style={{ height: '280px', borderRadius: '12px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="skeleton" style={{ height: '130px', borderRadius: '12px' }} />
            <div className="skeleton" style={{ height: '130px', borderRadius: '12px' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans', fontSize: '14px' }}>
        Failed to load correlation data
      </div>
    );
  }

  const { coins, matrix, docs } = data;
  const mainCorr   = docs[0]?.pearson_corr ?? matrix?.['BTC']?.['DOGE'] ?? 0;
  const computedAt = docs[0]?.computed_at?.split('T')[0] ?? '—';

  return (
    <div>
      <PageHeader
        title="Correlation Analysis"
        subtitle="Pearson correlation coefficient between BTC and DOGE"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        <CorrelationMatrix coins={coins} matrix={matrix} />
        <CorrelationSummary mainCorr={mainCorr} computedAt={computedAt} docs={docs} />
      </div>
    </div>
  );
}
