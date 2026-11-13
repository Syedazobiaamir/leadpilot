// Security headers (Stage 8, decision D2A: our own small middleware instead of the `helmet`
// package, so every header is visible and explained here). They tell the BROWSER how to treat
// our responses. This API only ever returns JSON, so the rules can be strict.
//
//   X-Content-Type-Options: nosniff        never guess a content type (stops JSON being run as a script)
//   Content-Security-Policy                load nothing, run nothing, and never be shown inside a frame
//   X-Frame-Options: DENY                  the same "no frames" rule for older browsers (stops clickjacking)
//   Referrer-Policy: no-referrer           don't leak our URLs to other sites
//   Cross-Origin-Resource-Policy           other websites may not embed our responses
//   Cache-Control: no-store                responses hold customer data: browsers and proxies must not keep copies
//   Strict-Transport-Security (production) always use HTTPS for the next year (only sent in production, over HTTPS)
//
// The dashboard's own HTML/JS gets its headers from the host (Vercel) in Stage 9.
export function securityHeaders({ production = false } = {}) {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    })
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  }
}
