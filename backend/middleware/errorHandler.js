// The single place where errors become HTTP responses.
// Express knows this is an error handler because it takes FOUR arguments (err, req, res, next).
// Express 5 also sends errors thrown inside async route handlers here automatically.
//
// Every error response has the same shape:
//   { "error": { "code": "...", "message": "...", "details": {...}, "requestId": "..." } }
import { AppError } from '../utils/AppError.js'
import { logger as defaultLogger } from '../utils/logger.js'

/** Turns any error into { statusCode, code, message, details } that is safe to send to the client. */
export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message, details: err.details }
  }
  // Errors from express.json() when the request body is bad:
  if (err.type === 'entity.parse.failed') {
    return { statusCode: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' }
  }
  if (err.type === 'entity.too.large') {
    return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }
  }
  // Anything else is an unexpected bug. Never send internal details (stack traces,
  // file paths, database messages) to the client. They help attackers, not users.
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' }
}

export function errorHandler(log = defaultLogger) {
  // All 4 parameters are required, even when "next" goes unused. That's how Express spots an error handler.
  return (err, req, res, next) => {
    // If part of the response was already sent, we can't send a new one. Let Express close it.
    if (res.headersSent) return next(err)

    const { statusCode, code, message, details } = toErrorResponse(err)

    // Unexpected errors get the full stack trace, but only in OUR logs.
    if (statusCode >= 500) {
      log.error('unhandled error', { requestId: req.id, code, error: err.message, stack: err.stack })
    }

    res.locals.errorCode = code // lets requestLogger include the code
    res.status(statusCode).json({
      error: { code, message, ...(details && { details }), requestId: req.id },
    })
  }
}
