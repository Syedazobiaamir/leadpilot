// Runs only if no route matched the request. It turns that into a normal 404 error,
// and errorHandler then formats the response.
import { AppError } from '../utils/AppError.js'

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl.split('?')[0]} not found`))
}
