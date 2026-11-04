// An error we create on purpose, with an HTTP status and a stable code.
// Example: throw new AppError(404, 'LEAD_NOT_FOUND', 'No lead with id LD-9999')
//
// - statusCode: the HTTP status sent to the client (400, 404, 409, ...)
// - code:       a fixed, machine-readable name. Programs (and later the
//               Recovery Agent) decide what to do based on the code, not the
//               message text, which may change.
// - details:    optional extra info, e.g. { zip: 'Enter a valid ZIP' }
//
// Any error that is NOT an AppError is treated as an unexpected bug (500).
export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}
