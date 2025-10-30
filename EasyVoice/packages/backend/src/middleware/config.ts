import cors from 'cors'
import helmet from 'helmet'
import rateLimitMiddleware from 'express-rate-limit'
import { requestLoggerMiddleware } from './info.middleware.js'
import { USE_HELMET, USE_LIMIT } from '../config/index.js'
import { Request, Response, NextFunction } from 'express'
import express from 'express'

interface MiddlewareConfig {
  isDev: boolean
  rateLimit: number
  rateLimitWindow: number
}

export function createMiddlewareConfig({ isDev, rateLimit, rateLimitWindow }: MiddlewareConfig) {
  const useLimiter = rateLimitMiddleware({
    windowMs: rateLimitWindow * 60 * 1000,
    limit: isDev ? 1e6 : rateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  const useHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://www.google-analytics.com',
          'https://www.googletagmanager.com',
        ],
        imgSrc: ["'self'", 'https://www.google-analytics.com', 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://www.google-analytics.com'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
      },
    },
  })
  const pass = (_req: Request, _res: Response, next: NextFunction) => next()
  return {
    cors: cors(),
    json: express.json({ limit: '20mb' }),
    requestLogger: requestLoggerMiddleware,
    helmet: USE_HELMET ? useHelmet : pass,
    limiter: USE_LIMIT ? useLimiter : pass,
  }
}
