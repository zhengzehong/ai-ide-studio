export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
