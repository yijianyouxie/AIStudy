import fs from 'fs/promises'
import { createReadStream, createWriteStream } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Response } from 'express'
import { PassThrough, Readable, Stream } from 'stream'
import { logger } from './logger.js'
import { AUDIO_DIR } from '../config/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export async function getLangConfig(text: string) {
  const { franc } = await import('franc')
  let lang = franc(text)
  if (lang === 'cmn') {
    lang = 'zh'
  }
  const voicePath = resolve(__dirname, `../llm/prompt/voice.json`)
  const voiceList = await readJson<VoiceConfig[]>(voicePath)
  return { lang, voiceList }
}

export async function readJson<T>(path: string): Promise<T> {
  try {
    const data = await fs.readFile(path, 'utf-8')
    return JSON.parse(data)
  } catch (err) {
    console.log(`readJson ${path} error:`, (err as Error).message)
    return {} as T
  }
}
export async function ensureDir(path: string) {
  try {
    await fs.access(path)
    console.log(`dir exists: ${path}`)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await fs.mkdir(path, { recursive: true })
      console.log(`create dir succed: ${path}`)
    } else {
      throw error
    }
  }
}
export async function safeRunWithRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number
    baseDelayMs?: number
    onError?: (err: unknown, attempt: number) => void
  } = {}
): Promise<T> {
  const { retries = 3, baseDelayMs = 200, onError = defaultErrorHandler } = options

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      onError(err, attempt + 1)
      if (attempt < retries - 1) {
        await asyncSleep(baseDelayMs * (attempt + 1))
      } else {
        throw err
      }
    }
  }
  throw new Error('Unexpected execution flow') // 理论上不会到达这里
}

// 默认错误处理器
function defaultErrorHandler(err: unknown, attempt: number): void {
  const message = err instanceof Error ? err.message : String(err)
  const fnName = (err as any)?.fn?.name || 'anonymous'
  if (message.includes('Invalid response status')) {
    console.log(`Attempt ${attempt} failed for ${fnName}: ${message}`)
  } else {
    console.error(`Attempt ${attempt} failed for ${fnName}:`, (err as Error).message)
  }
}
export async function asyncSleep(delay = 200) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}
export function generateId(voice: string, text: string) {
  const now = Date.now()
  return `${voice}-${safeFileName(text).slice(0, 10)}-${now}.mp3`
}
export function safeFileName(fileName: string) {
  return fileName.replace(/[/\\?%*:|"<>\r\n\s#]/g, '-')
}

export async function fileExist(path: string) {
  try {
    await fs.access(path, fs.constants.F_OK)
    return true
  } catch (err) {
    return false
  }
}

export function formatFileSize(bytes: number) {
  if (!bytes) return ''
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
/**
 * 将流式数据发送到客户端的通用函数
 * @param res Express 响应对象
 * @param inputStream 输入流
 * @param options 配置选项
 */
export function streamToResponse(
  res: Response,
  inputStream: Readable | Stream,
  options: StreamOptions = {}
): void {
  const {
    headers = {},
    onError = (err) => `Error occurred: ${err.message}`,
    onEnd,
    onClose,
    fileName,
  } = options

  const outputStream = new PassThrough()
  let isClientDisconnected = false

  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value)
  })

  const handleDisconnect = () => {
    if (!isClientDisconnected) {
      isClientDisconnected = true
      logger.info('Client disconnected')
      // 清理流
      if ('destroy' in inputStream) {
        ;(inputStream as Readable).destroy()
      }
      outputStream.destroy()
      if (onClose) onClose()
    }
  }

  res.on('close', handleDisconnect)
  res.on('finish', () => {
    logger.info('Response finished')
  })

  // 输入流错误处理
  inputStream.on('error', (err: Error) => {
    if (isClientDisconnected) return
    logger.error('Input stream error:', err)
    const errorMessage = onError(err)
    outputStream.write(errorMessage)
    outputStream.end()
  })

  // 输出流错误处理
  outputStream.on('error', (err: Error) => {
    if (isClientDisconnected) return
    logger.error('Output stream error:', err)
    res.status(500).end('Internal server error')
  })

  // 流完成处理
  if (onEnd) {
    inputStream.on('end', () => {
      if (isClientDisconnected) return
      logger.info('Stream completed successfully')
      onEnd()
    })
  }

  inputStream.on('uncaughtException' as any, (err: Error) => {
    logger.error('Uncaught exception in input stream:', err)
    if (!isClientDisconnected) {
      res.status(500).end('Internal server error')
    }
  })

  // 检查响应是否已可写
  if (!res.writable) {
    if ('destroy' in inputStream) {
      ;(inputStream as Readable).destroy()
    }
    outputStream.destroy()
    return
  }
  const streamer = inputStream.pipe(outputStream)
  streamer.pipe(res)

  if (fileName) {
    const streamFile = resolve(AUDIO_DIR, fileName)
    const localStream = createWriteStream(streamFile)
    streamer.pipe(localStream)
  }
}

interface StreamOptions {
  headers?: Record<string, string>
  onError?: (err: Error) => string
  onEnd?: () => void
  onClose?: () => void
  fileName?: string
}
export function streamWithLimit(res: Response, filePath: string, bitrate = 128) {
  const byteRate = (bitrate * 1024) / 8 // kbps to bytes per second
  const chunkSize = byteRate / 10
  const fileStream = createReadStream(filePath)

  res.setHeader('Content-Type', 'audio/opus')

  let buffer = Buffer.alloc(0)

  fileStream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk as Buffer])
    if (!fileStream.isPaused() && buffer.length >= chunkSize * 2) {
      fileStream.pause()
    }
  })

  fileStream.on('end', () => {
    clearInterval(timer)
    res.end(buffer)
  })

  fileStream.on('error', (err: Error) => {
    logger.error(`Stream error: ${err.message}`)
    res.status(500).send(`Stream error: ${err.message}`)
  })

  const timer = setInterval(() => {
    if (buffer.length > 0) {
      const sendSize = Math.min(chunkSize, buffer.length)
      res.write(buffer.slice(0, sendSize))
      buffer = buffer.slice(sendSize)
      if (buffer.length < chunkSize && fileStream.isPaused()) {
        fileStream.resume()
      }
    }
  }, 100)

  res.on('close', () => {
    fileStream.destroy()
    clearInterval(timer)
  })
}

export function escapeSSML(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
