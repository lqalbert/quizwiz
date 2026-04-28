import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app, appReady } from '../server/index.js'

describe('API smoke', () => {
  beforeAll(async () => {
    await appReady
  })

  it('GET /api/health returns service id when DB is up', async () => {
    const res = await request(app).get('/api/health')
    if (res.status === 200) {
      expect(res.body?.service).toBe('quizwiz-teacher-admin')
      expect(res.body?.ok).toBe(true)
    } else {
      expect(res.status).toBe(500)
      expect(res.body?.ok).toBe(false)
    }
  })

  it('GET /api/auth/me without token is 401', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })
})
