import dotenv from 'dotenv'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({
  path: [
    resolve(__dirname, '..', '..', '.env'),
    resolve(__dirname, '..', '..', '..', '..', '.env'),
  ],
})
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
}

export const AUDIO_DIR = join(__dirname, '..', '..', 'audio')
export const AUDIO_CACHE_DIR = join(AUDIO_DIR, '.cache')
export const PUBLIC_DIR = join(__dirname, '..', '..', 'public')
export const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.srt'])

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY
export const MODEL_NAME = process.env.MODEL_NAME

export const STATIC_DOMAIN = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : ''

export const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '0') || 10
export const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '0') || 1e6

export const EDGE_API_LIMIT = parseInt(process.env.EDGE_API_LIMIT || '3') || 3

export const PORT = parseInt(process.env.PORT || '3000') || 3000

// 添加缺失的导出
export const USE_HELMET = process.env.USE_HELMET !== 'false'
export const USE_LIMIT = process.env.USE_LIMIT !== 'false'

// 为 schema/generate.ts 添加缺失的导出
export const DIRECT_GEN_LIMIT = parseInt(process.env.DIRECT_GEN_LIMIT || '0') || 1000
export const LIMIT_TEXT_LENGTH = parseInt(process.env.LIMIT_TEXT_LENGTH || '0') || 5000
export const LIMIT_TEXT_LENGTH_ERROR_MESSAGE = process.env.LIMIT_TEXT_LENGTH_ERROR_MESSAGE || 'Text too long'

// 为 tts/engines/index.ts 添加缺失的导出
export const REGISTER_KOKORO = process.env.REGISTER_KOKORO === 'true'
export const REGISTER_OPENAI_TTS = process.env.REGISTER_OPENAI_TTS === 'true'
export const TTS_KOKORO_URL = process.env.TTS_KOKORO_URL || 'http://127.0.0.1:8080'