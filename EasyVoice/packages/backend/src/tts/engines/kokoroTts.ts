import { TTSEngine, TtsOptions } from '../types'
import { fetcher } from '../../utils/request'
import { Readable } from 'stream' // Node.js 流支持

// Kokoro 支持的音频格式
const RESPONSE_FORMATS = ['mp3', 'wav'] as const
type ResponseFormat = (typeof RESPONSE_FORMATS)[number]

// 扩展 TtsOptions，添加 stream 参数
interface ExtendedTtsOptions extends TtsOptions {
  stream?: boolean // 是否返回流式响应
}

export class KokoroTtsEngine implements TTSEngine {
  name = 'kokoro-tts'
  private baseUrl: string
  private initialized = false

  constructor(baseUrl: string = 'http://localhost:8880/v1') {
    this.baseUrl = baseUrl
  }

  async initialize(): Promise<void> {
    try {
      const response = await fetcher.get<{ status: string }>(
        `${this.baseUrl.replace('/v1', '')}/health`
      )
      console.log(`Initialize KokoroTtsEngine response:`, response.data)
      if (response.data.status !== 'healthy') {
        throw new Error('Kokoro TTS server is not healthy.')
      }
      this.initialized = true
    } catch (error) {
      throw new Error(`Failed to initialize Kokoro TTS: ${(error as Error).message}`)
    }
  }

  // 修改 synthesize 方法，返回 Buffer 或 Readable
  async synthesize(text: string, options: ExtendedTtsOptions): Promise<Buffer | Readable> {
    if (!this.initialized) {
      await this.initialize()
    }

    const {
      voice = 'af_bella',
      speed = 1.0,
      format = 'mp3',
      stream = false, // 默认一次性返回 Buffer
    } = options

    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('Input text is required.')
    }
    if (!RESPONSE_FORMATS.includes(format as ResponseFormat)) {
      throw new Error(
        `Invalid response format: ${format}. Supported formats are: ${RESPONSE_FORMATS.join(', ')}.`
      )
    }

    try {
      const requestBody = {
        model: 'kokoro',
        input: text,
        voice,
        speed,
        response_format: format,
      }

      if (stream) {
        const response = await fetcher.post(`${this.baseUrl}/audio/speech`, requestBody, {
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream',
        })
        return response.data
      } else {
        const response = await fetcher.post(`${this.baseUrl}/audio/speech`, requestBody, {
          headers: { 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
        })
        return Buffer.from(response.data)
      }
    } catch (error) {
      const err = error as any
      if (err.response?.status === 400) {
        throw new Error('Invalid request to Kokoro TTS server.')
      } else if (err.response?.status === 503) {
        throw new Error('Kokoro TTS server is unavailable.')
      }
      throw new Error(`Failed to synthesize speech with Kokoro TTS: ${err.message}`)
    }
  }

  async getSupportedLanguages(): Promise<string[]> {
    return ['en-US', 'ja-JP', 'ko-KR', 'zh-CN']
  }

  async getVoiceOptions(): Promise<string[]> {
    try {
      const response = await fetcher.get<{ voices: string[] }>(`${this.baseUrl}/audio/voices`)
      return response.data.voices
    } catch (error) {
      console.warn(`Failed to fetch Kokoro voice options: ${(error as Error).message}`)
      return ['af_bella', 'af_sky', 'am_adam', 'bf_emma']
    }
  }

  // 可以直接运行这个文件来测试
  /* if (typeof module !== 'undefined' && require.main === module) {
    ;(async () => {
      const ttsEngine = new KokoroTtsEngine()
      await ttsEngine.initialize()
      const voices = await ttsEngine.getVoiceOptions()
      console.log('Available voices:', voices)

      const text = `
The Lantern in the Woods
In a small village nestled between rolling hills and a dense forest, there lived an old woman named Elara. She was known for her peculiar habit of wandering into the woods every night, carrying a glowing lantern. The villagers whispered about her—some said she was a witch, others believed she was searching for a lost treasure. But no one dared to follow her.
`

      const buffer = await ttsEngine.generateAudio(text, {
        voice: 'bf_emma',
        rate: 1.0,
        volume: 1.0,
        pitch: 1.0,
      })

      console.log('Generated audio buffer length:', buffer.length)
    })()
  } */
}
// 注意：我们已经使用 export class KokoroTtsEngine 导出了类，所以不需要再使用 export { KokoroTtsEngine }