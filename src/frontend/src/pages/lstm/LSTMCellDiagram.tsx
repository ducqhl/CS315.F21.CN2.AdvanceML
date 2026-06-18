/* LSTM memory cell — canonical figure from Christopher Olah's
   "Understanding LSTM Networks" (2015), used with attribution. */

const COLAH = 'https://colah.github.io/posts/2015-08-Understanding-LSTMs';

export function LSTMCellDiagram() {
  return (
    <figure style={{ margin: '16px auto', maxWidth: 620, textAlign: 'center' }}>
      <img
        src={`${COLAH}/img/LSTM3-chain.png`}
        alt="LSTM cell: forget / input / output gates và cell state"
        loading="lazy"
        style={{
          width: '100%', height: 'auto', display: 'block',
          borderRadius: 8, border: '1px solid var(--border)',
          background: '#fff', padding: 10,
        }}
      />
      <figcaption style={{
        marginTop: 8, fontSize: 11.5, lineHeight: 1.6, fontStyle: 'italic',
        color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans',
      }}>
        Mỗi module lặp lại chứa 4 lớp tương tác: 3 cổng sigmoid (σ) và 1 lớp tanh.{' '}
        <a href={`${COLAH}/`} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--accent-light)', textDecoration: 'none' }}>
          [nguồn: Olah, 2015]
        </a>
      </figcaption>
    </figure>
  );
}
