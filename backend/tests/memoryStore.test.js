import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../services/stores/memoryStore.js'
import { runStoreContract, contractSeed } from './storeContract.js'
import { config } from '../config.js'

// The memory store must follow the same rules as every other store.
runStoreContract('memory', async (seed) => createMemoryStore(seed))

describe('memory store extras', () => {
  it('reset() restores the seed data', async () => {
    const store = createMemoryStore(contractSeed)
    await store.insertLead({ ...contractSeed.leads[0], id: 'LD-2999' })
    store.reset()
    expect(await store.listLeads()).toHaveLength(2)
  })

  it('never changes the seed objects it was given', async () => {
    const seed = structuredClone(contractSeed)
    const store = createMemoryStore(seed)
    await store.insertLead({ ...seed.leads[0], id: 'LD-2999' })
    expect(seed.leads).toHaveLength(2)
  })
})

describe('config safety', () => {
  it('tests always run on the memory store', () => {
    expect(config.dataStore).toBe('memory')
  })
})
