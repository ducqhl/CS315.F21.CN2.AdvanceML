import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader } from 'lucide-react';
import { fetchModels, setActiveModel, triggerRetrain, fetchRetrainStatus } from '../api/client';
import type { ModelRegistryEntry } from '../api/client';
import PageHeader from '../components/ui/PageHeader';
import Toast, { type ToastState } from '../components/ui/Toast';
import ModelsTable from './models/components/ModelsTable';
import TrainingJobsTable from './models/components/TrainingJobsTable';

export default function ModelRegistryPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ['ml-models'],
    queryFn:  () => fetchModels(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['retrain-jobs'],
    queryFn:  () => fetchRetrainStatus(),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const activateMutation = useMutation({
    mutationFn: ({ coin, horizon }: { coin: string; horizon: number }) =>
      setActiveModel(coin, horizon),
    onSuccess: (_, vars) => {
      showToast(`H${vars.horizon} set as active for ${vars.coin.toUpperCase()}`, 'ok');
      queryClient.invalidateQueries({ queryKey: ['ml-models'] });
    },
    onError: () => showToast('Failed to update active model', 'err'),
  });

  const retrainMutation = useMutation({
    mutationFn: ({ coin, horizon }: { coin: string; horizon: number }) =>
      triggerRetrain(coin, horizon),
    onSuccess: (_, vars) => {
      showToast(`Retrain queued for ${vars.coin.toUpperCase()} H${vars.horizon}`, 'ok');
      queryClient.invalidateQueries({ queryKey: ['retrain-jobs'] });
    },
    onError: () => showToast('Failed to queue retrain', 'err'),
  });

  const models = modelsData?.models ?? [];
  const jobs   = jobsData?.jobs ?? [];

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending').length;

  const isActivating = (m: ModelRegistryEntry) =>
    activateMutation.isPending &&
    activateMutation.variables?.coin === m.coin_id &&
    activateMutation.variables?.horizon === m.horizon;

  const isRetraining = (m: ModelRegistryEntry) =>
    retrainMutation.isPending &&
    retrainMutation.variables?.coin === m.coin_id &&
    retrainMutation.variables?.horizon === m.horizon;

  return (
    <div>
      <Toast toast={toast} errorIcon="alert" />

      <PageHeader
        title="Model Registry"
        subtitle="LSTM model management · activate horizons · trigger retraining"
        right={activeJobs > 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '7px 13px', borderRadius: '8px',
            background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.2)',
            fontSize: '12px', fontFamily: 'Plus Jakarta Sans', color: 'var(--accent-light)',
          }}>
            <Loader size={12} className="spin" />
            {activeJobs} job{activeJobs > 1 ? 's' : ''} running
          </div>
        ) : undefined}
      />

      <ModelsTable
        models={models}
        loading={modelsLoading}
        isActivating={isActivating}
        isRetraining={isRetraining}
        onActivate={m => activateMutation.mutate({ coin: m.coin_id, horizon: m.horizon })}
        onRetrain={m => retrainMutation.mutate({ coin: m.coin_id, horizon: m.horizon })}
      />

      <TrainingJobsTable jobs={jobs} loading={jobsLoading} />
    </div>
  );
}
