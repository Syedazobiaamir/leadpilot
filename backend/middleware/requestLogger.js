// Logs one line per request, AFTER the response has been sent, so we know the final
// status code and how long it took.
// Request bodies are deliberately NOT logged: they contain customer personal data.
import { logger as defaultLogger } from '../utils/logger.js'

export function requestLogger(log = defaultLogger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint() // high-precision clock

    // 'finish' fires when the response has been fully sent.
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      const fields = {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0], // leave out the query string: it may contain personal data
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      }
      if (res.locals.errorCode) fields.errorCode = res.locals.errorCode // set by errorHandler

      if (res.statusCode >= 500) log.error('request failed', fields)
      else if (res.statusCode >= 400) log.warn('request rejected', fields)
      else log.info('request completed', fields)
    })

    next()
  }
}
