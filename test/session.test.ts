import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
  consumeNonce,
  createSession,
  dropSession,
  issueNonce,
  readSessionId,
  resolveSession,
} from '../src/lib/session.ts'

afterEach(() => {
  // Reset any Date.now spy left dangling between cases.
  ;(Date.now as unknown as { mockRestore?: () => void }).mockRestore?.()
})

describe('issueNonce / consumeNonce', () => {
  test('issued nonces are non-empty strings', () => {
    const n = issueNonce()
    expect(typeof n).toBe('string')
    expect(n.length).toBeGreaterThan(0)
  })

  test('successive nonces are unique', () => {
    const a = issueNonce()
    const b = issueNonce()
    expect(a).not.toBe(b)
  })

  test('consume returns true the first time, false on replay', () => {
    const n = issueNonce()
    expect(consumeNonce(n)).toBe(true)
    expect(consumeNonce(n)).toBe(false)
  })

  test('consume returns false for an unknown nonce', () => {
    expect(consumeNonce('nope-not-issued')).toBe(false)
  })

  test('consume returns false after the 5-minute TTL elapses', () => {
    const n = issueNonce()
    const future = Date.now() + 5 * 60_000 + 1
    spyOn(Date, 'now').mockReturnValue(future)
    expect(consumeNonce(n)).toBe(false)
  })
})

describe('createSession / resolveSession / dropSession', () => {
  test('create lowercases the address and returns an id', () => {
    const { id, session } = createSession('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(8)
    expect(session.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  })

  test('resolve returns the stored session for a valid id', () => {
    const { id, session } = createSession('0xabc')
    expect(resolveSession(id)).toEqual(session)
  })

  test('resolve returns null for missing / unknown ids', () => {
    expect(resolveSession(undefined)).toBeNull()
    expect(resolveSession(null)).toBeNull()
    expect(resolveSession('')).toBeNull()
    expect(resolveSession('not-a-real-id')).toBeNull()
  })

  test('resolve returns null and evicts after the session TTL', () => {
    const { id, session } = createSession('0xexpiry')
    spyOn(Date, 'now').mockReturnValue(session.expiresAt + 1)
    expect(resolveSession(id)).toBeNull()
    // Restore time and confirm the session was actually deleted, not just hidden.
    ;(Date.now as unknown as { mockRestore?: () => void }).mockRestore?.()
    expect(resolveSession(id)).toBeNull()
  })

  test('drop removes the session', () => {
    const { id } = createSession('0xdrop')
    dropSession(id)
    expect(resolveSession(id)).toBeNull()
  })

  test('drop tolerates undefined / null / unknown ids', () => {
    expect(() => dropSession(undefined)).not.toThrow()
    expect(() => dropSession(null)).not.toThrow()
    expect(() => dropSession('not-a-real-id')).not.toThrow()
  })
})

describe('readSessionId', () => {
  test('prefers a non-empty cookie value', () => {
    expect(readSessionId('cookie-id', 'header-id')).toBe('cookie-id')
  })

  test('falls back to the header when cookie is missing or empty', () => {
    expect(readSessionId(undefined, 'header-id')).toBe('header-id')
    expect(readSessionId('', 'header-id')).toBe('header-id')
  })

  test('returns undefined when neither is a usable string', () => {
    expect(readSessionId(undefined, undefined)).toBeUndefined()
    expect(readSessionId('', '')).toBeUndefined()
    expect(readSessionId(123, true)).toBeUndefined()
    expect(readSessionId({}, [])).toBeUndefined()
  })
})
