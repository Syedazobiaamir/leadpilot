// Tests the fetch layer on its own: every kind of server answer, including failures.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createLead, getLeads } from './leadService.js'
import { jsonResponse } from '../test/fakeApi.js'

/** Replaces fetch with a function that returns (or throws) what the test needs. */
function mockFetch(implementation) {
  const fn = vi.fn(implementation)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const newLead = {
  name: 'Tom Rivera',
  phone: '512-555-0199',
  email: 'tom.rivera@example.com',
  zip: '78702',
  serviceType: 'Siding',
  timeline: 'Within 1 month',
  message: 'Need new siding on a two-story house.',
}

describe('getLeads', () => {
  it('calls GET /api/leads and returns the data array', async () => {
    const fetchFn = mockFetch(async () => jsonResponse({ data: [{ id: 'LD-1001' }], count: 1 }))
    expect(await getLeads()).toEqual([{ id: 'LD-1001' }])
    expect(fetchFn).toHaveBeenCalledWith('/api/leads', expect.objectContaining({ method: 'GET' }))
  })

  it('throws a clear NETWORK_ERROR when the server cannot be reached', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(getLeads()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NETWORK_ERROR',
      message: expect.stringMatching(/Could not reach the server/),
    })
  })

  it('throws TIMEOUT when the request takes too long', async () => {
    mockFetch(async () => {
      throw new DOMException('signal timed out', 'TimeoutError')
    })
    await expect(getLeads()).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('passes on the API error code, message and requestId', async () => {
    mockFetch(async () =>
      jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side', requestId: 'abc12345-x' } }, 500),
    )
    const error = await getLeads().catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', requestId: 'abc12345-x' })
  })

  it('treats a non-JSON error response (e.g. the proxy with no backend) as BAD_GATEWAY', async () => {
    mockFetch(async () => new Response('', { status: 502 }))
    await expect(getLeads()).rejects.toMatchObject({ code: 'BAD_GATEWAY', status: 502 })
  })

  it('rejects a successful response that is not JSON', async () => {
    mockFetch(async () => new Response('<html>hi</html>', { status: 200 }))
    await expect(getLeads()).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

describe('createLead', () => {
  it('POSTs JSON and returns { success, lead } on 201', async () => {
    const fetchFn = mockFetch(async () => jsonResponse({ data: { id: 'LD-1011', ...newLead } }, 201))
    const result = await createLead(newLead)

    expect(result).toEqual({ success: true, lead: expect.objectContaining({ id: 'LD-1011' }) })
    const [url, options] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/leads')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual(newLead)
  })

  it('returns field errors from a 400 VALIDATION_ERROR', async () => {
    mockFetch(async () =>
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: { zip: 'Enter a valid 5-digit US ZIP code' } } }, 400),
    )
    expect(await createLead(newLead)).toEqual({ success: false, errors: { zip: 'Enter a valid 5-digit US ZIP code' } })
  })

  it('returns a form error for a 409 duplicate', async () => {
    mockFetch(async () => jsonResponse({ error: { code: 'DUPLICATE_LEAD', message: 'A lead with this email or phone number already exists' } }, 409))
    expect(await createLead(newLead)).toEqual({
      success: false,
      errors: { form: 'A lead with this email or phone number already exists' },
    })
  })

  it('adds a short reference ID to server (5xx) errors', async () => {
    mockFetch(async () => jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side', requestId: 'abc12345-6789' } }, 500))
    const result = await createLead(newLead)
    expect(result.errors.form).toBe('Something went wrong on our side (reference: abc12345)')
  })

  it('never reports success when the server is down', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await createLead(newLead)
    expect(result.success).toBe(false)
    expect(result.errors.form).toMatch(/Could not reach the server/)
  })
})
