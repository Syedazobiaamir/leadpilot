// Validation Agent (Stage 5): rule-based quality checks, the setReviewFlags tool, and the API shape.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { checkLeadQuality, isBlocked, REVIEW_FLAGS, validationAgent } from '../agents/validationAgent.js'
import { createToolRegistry } from '../agents/toolRegistry.js'
import { createTools } from '../agents/tools.js'
import { runAgent } from '../agents/runAgent.js'
import { createMemoryStore } from '../services/stores/memoryStore.js'
import { createApp } from '../app.js'
import { resetStore } from '../services/leadStore.js'
import { parseReviewFlags } from '../services/leadService.js'
import { sampleLeads } from '../data/sampleLeads.js'
import { createLogger } from '../utils/logger.js'
import { contractSeed } from './storeContract.js'

// A realistic, clean lead to change one field at a time.
const good = {
  name: 'Maria Gonzalez',
  phone: '512-555-0147',
  email: 'maria@gmail.com',
  message: 'Hail damaged several shingles and the attic is leaking. Need an inspection this week.',
}
const flagsFor = (changes) => checkLeadQuality({ ...good, ...changes })

describe('checkLeadQuality: each rule', () => {
  it('a normal inquiry has no flags', () => {
    expect(flagsFor({})).toEqual([])
  })

  it.each([
    ['name "Smoke Test" (our own smoke test)', { name: 'Smoke Test' }],
    ['message "Automated smoke test lead. Safe to ignore."', { message: 'Automated smoke test lead. Safe to ignore.' }],
    ['name "test"', { name: 'Test' }],
    ['name "John Doe"', { name: '  john   DOE ' }],
    ['message "test test"', { message: 'test test!!' }],
    ['message "asdf"', { message: 'asdf' }],
    ['lorem ipsum', { message: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.' }],
  ])('test/placeholder: %s → blocked', (_label, changes) => {
    const flags = flagsFor(changes)
    expect(flags).toContain('test_or_placeholder')
    expect(isBlocked(flags)).toBe(true)
  })

  it.each([
    ['SEO offer', 'We can get your website on the first page of Google with our SEO backlinks package.'],
    ['crypto', 'Invest in crypto today and double your money, reply for details now please.'],
    ['two links', 'See http://a.example/1 and also www.b.example/2 for my project photos please.'],
  ])('spam: %s → blocked', (_label, message) => {
    const flags = flagsFor({ message })
    expect(flags).toContain('spam_content')
    expect(isBlocked(flags)).toBe(true)
  })

  it('ONE link is only "review" (it may be a photo of the damage)', () => {
    const flags = flagsFor({ message: 'Here is a photo of the leak in our ceiling: https://photos.example.com/abc' })
    expect(flags).toEqual(['contains_link'])
    expect(isBlocked(flags)).toBe(false)
  })

  it.each([
    ['too_vague', { message: 'need quote asap' }],
    ['all_caps', { message: 'MY ROOF IS LEAKING VERY BADLY PLEASE CALL ME BACK TODAY' }],
    ['repeated_characters', { message: 'Roof is leaking please help me!!!!!!!! need someone today' }],
    ['suspicious_phone', { phone: '123-456-7890' }],
    ['suspicious_phone', { phone: '(555) 555-5555' }],
    ['disposable_email', { email: 'someone@mailinator.com' }],
  ])('%s → review only (not blocked)', (code, changes) => {
    const flags = flagsFor(changes)
    expect(flags).toContain(code)
    expect(isBlocked(flags)).toBe(false)
  })

  it.each([
    ['Roof leak after storm.'],
    ['Furnace died, no heat.'],
    ['AC not cooling since Monday.'],
  ])('short but CLEAR messages are not vague: "%s"', (message) => {
    expect(flagsFor({ message })).toEqual([])
  })

  it.each([['I need a quote'], ['Looking for an estimate please'], ['Need a quote for some plumbing work.']])(
    'short generic requests without project details are vague: "%s"',
    (message) => {
      expect(flagsFor({ message })).toEqual(['too_vague'])
    },
  )

  it.each([['Maria Testa'], ['Celeste Moore'], ['Protest Lane']])('a real name that merely contains "test" is fine: %s', (name) => {
    expect(flagsFor({ name })).toEqual([])
  })

  it('the smoke-test lead created by scripts/smoke.js is blocked (saves AI quota)', async () => {
    const smoke = readFileSync(new URL('../scripts/smoke.js', import.meta.url), 'utf8')
    const name = smoke.match(/name: '([^']+)'/)[1]
    const message = smoke.match(/message: '([^']+)'/)[1]
    expect(isBlocked(checkLeadQuality({ ...good, name, message }))).toBe(true)
  })

  it('a vague test message is reported as test, not also as vague', () => {
    expect(flagsFor({ message: 'test' })).toEqual(['test_or_placeholder'])
  })

  it('flags always come in the same (catalog) order', () => {
    const flags = flagsFor({ message: 'BUY NOW!!!!!!!', phone: '111-111-1111' })
    expect(flags).toEqual(Object.keys(REVIEW_FLAGS).filter((code) => flags.includes(code)))
  })
})

describe('checkLeadQuality: no false alarms on realistic inquiries', () => {
  it('none of the 10 sample leads is blocked or flagged', () => {
    for (const lead of sampleLeads) {
      expect(checkLeadQuality(lead), lead.id).toEqual([])
    }
  })

  it('none of the 16 AI evaluation inquiries is blocked (incl. Spanish and the injection attempts)', () => {
    const { cases } = JSON.parse(readFileSync(new URL('../evals/qualification-cases.json', import.meta.url), 'utf8'))
    for (const c of cases) {
      const flags = checkLeadQuality({ ...good, message: c.message })
      expect(isBlocked(flags), `${c.id}: ${flags}`).toBe(false)
    }
  })

  it('words that merely CONTAIN a spam word are not spam ("cryptographer" contains "crypto")', () => {
    expect(flagsFor({ message: 'My neighbor, a cryptographer, recommended you for our roof repair this month.' })).toEqual([])
  })
})

describe('the agent', () => {
  let store, registry, logger
  beforeEach(() => {
    store = createMemoryStore(structuredClone(contractSeed))
    logger = createLogger({ level: 'silent' })
    registry = createToolRegistry(createTools({ store }), { logger })
  })

  it('declares only the tools it needs (no AI fields, no follow-ups)', () => {
    expect(validationAgent.tools).toEqual(['readLead', 'setReviewFlags', 'writeActivity'])
    expect(() => registry.checkAgent(validationAgent)).not.toThrow()
  })

  it('a clean lead: flags cleared, no activity event, run "success"', async () => {
    const outcome = await runAgent({ agent: validationAgent, input: { leadId: 'LD-2001' }, registry, store, logger })
    expect(outcome).toMatchObject({ status: 'success', result: { flags: [], blocked: false, summary: 'no issues' } })
    expect((await store.findLeadById('LD-2001')).reviewFlags).toBeNull()
    expect(await store.listActivity()).toHaveLength(contractSeed.activity.length)
  })

  it('a test lead: flags saved, audit event WITHOUT personal data, blocked', async () => {
    await store.insertLead({ ...contractSeed.leads[0], id: 'LD-2050', name: 'Test User', message: 'test test', email: 'qa@example.com' })
    const outcome = await runAgent({ agent: validationAgent, input: { leadId: 'LD-2050' }, registry, store, logger })

    expect(outcome.result).toMatchObject({ flags: ['test_or_placeholder'], blocked: true, summary: 'blocked: test_or_placeholder' })
    expect((await store.findLeadById('LD-2050')).reviewFlags).toBe('test_or_placeholder')
    const event = (await store.listActivity()).find((e) => e.leadId === 'LD-2050')
    expect(event.message).toBe('LD-2050 flagged for review: test_or_placeholder (AI skipped)')
    expect(JSON.stringify(event)).not.toMatch(/Test User|qa@example/)
  })

  it('an unknown lead → run "failed" with kind not_found (no crash)', async () => {
    const outcome = await runAgent({ agent: validationAgent, input: { leadId: 'LD-9999' }, registry, store, logger })
    expect(outcome).toMatchObject({ ok: false, status: 'failed', run: { errorKind: 'not_found' } })
  })

  it('cannot change AI fields (not on its tool list)', async () => {
    const evil = { ...validationAgent, run: async ({ tools }) => tools.call('updateLeadAiFields', 'LD-2001', { classification: 'Cold' }) }
    const outcome = await runAgent({ agent: evil, input: { leadId: 'LD-2001' }, registry, store, logger })
    expect(outcome.status).toBe('denied')
    expect((await store.findLeadById('LD-2001')).classification).toBe('Hot')
  })
})

describe('setReviewFlags tool', () => {
  it('rejects unknown flag codes, and changes nothing but reviewFlags', async () => {
    const store = createMemoryStore(structuredClone(contractSeed))
    const tools = createTools({ store })
    await expect(tools.setReviewFlags.fn('LD-2001', ['made_up_flag'])).rejects.toThrow(/unknown flag\(s\): made_up_flag/)
    const before = await store.findLeadById('LD-2001')
    await tools.setReviewFlags.fn('LD-2001', ['too_vague', 'all_caps'])
    expect(await store.findLeadById('LD-2001')).toEqual({ ...before, reviewFlags: 'too_vague,all_caps' })
  })
})

describe('API shape', () => {
  it('parseReviewFlags: stored string → array', () => {
    expect(parseReviewFlags('too_vague,all_caps')).toEqual(['too_vague', 'all_caps'])
    expect(parseReviewFlags(null)).toEqual([])
    expect(parseReviewFlags('')).toEqual([])
    expect(parseReviewFlags(['x'])).toEqual(['x'])
  })

  it('GET and POST both return reviewFlags as an array', async () => {
    resetStore()
    const app = createApp()
    const list = await request(app).get('/api/leads')
    expect(list.body.data.every((l) => Array.isArray(l.reviewFlags))).toBe(true)
    const created = await request(app).post('/api/leads').send({
      name: 'Tom Rivera', phone: '512-555-0199', email: 'tom.rivera@example.com', zip: '78702',
      serviceType: 'Siding', timeline: 'Within 1 month', message: 'Need new siding on a two-story house.',
    })
    expect(created.body.data.reviewFlags).toEqual([])
  })
})
