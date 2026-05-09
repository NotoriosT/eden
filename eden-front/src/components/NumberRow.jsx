export default function NumberRow({ label, value, onChange }) {
  return (
    <label className="row">
      <span>{label}</span>
      <input type="number" step="0.1" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
