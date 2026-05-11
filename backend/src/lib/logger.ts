type LogLevel = 'info' | 'warn' | 'error'

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  }

  const line = JSON.stringify(payload)

  if (level === 'error') {
    console.error(line)
    return
  }

  if (level === 'warn') {
    console.warn(line)
    return
  }

  console.log(line)
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
}
