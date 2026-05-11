type CounterMap = Map<string, number>

const counters: CounterMap = new Map()
const histograms = new Map<string, number[]>()

function key(name: string, labels: Record<string, string | number | undefined> = {}) {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))

  if (!entries.length) {
    return name
  }

  return `${name}{${entries.map(([label, value]) => `${label}="${String(value)}"`).join(',')}}`
}

export function incrementMetric(name: string, labels?: Record<string, string | number | undefined>, value = 1) {
  const metricKey = key(name, labels)
  counters.set(metricKey, (counters.get(metricKey) ?? 0) + value)
}

export function observeMetric(name: string, value: number, labels?: Record<string, string | number | undefined>) {
  const metricKey = key(name, labels)
  const values = histograms.get(metricKey) ?? []
  values.push(value)

  if (values.length > 200) {
    values.shift()
  }

  histograms.set(metricKey, values)
}

export function renderMetrics() {
  const lines: string[] = []

  for (const [metricKey, value] of counters.entries()) {
    lines.push(`${metricKey} ${value}`)
  }

  for (const [metricKey, values] of histograms.entries()) {
    const count = values.length
    const sum = values.reduce((total, item) => total + item, 0)
    const sorted = [...values].sort((left, right) => left - right)
    const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0

    lines.push(`${metricKey}_count ${count}`)
    lines.push(`${metricKey}_sum ${sum}`)
    lines.push(`${metricKey}_p95 ${p95}`)
  }

  return `${lines.join('\n')}\n`
}
