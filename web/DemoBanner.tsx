import { useState } from 'react'

export function DemoBanner(): React.JSX.Element | null {
  const [visible, setVisible] = useState(true)
  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg, #f97316, #ea580c)',
        color: '#fff',
        textAlign: 'center',
        padding: '6px 16px',
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px'
      }}
    >
      <span>
        <strong>Web Demo</strong> — This is an interactive preview. Data is simulated.{' '}
        <a
          href="https://github.com/musanajam11/BeamNG-Content-Manager/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#fff', textDecoration: 'underline' }}
        >
          Download the real app
        </a>
      </span>
      <button
        onClick={() => setVisible(false)}
        style={{
          background: 'rgba(0,0,0,0.2)',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: '2px 8px',
          fontSize: '12px',
          lineHeight: '1'
        }}
      >
        ✕
      </button>
    </div>
  )
}
