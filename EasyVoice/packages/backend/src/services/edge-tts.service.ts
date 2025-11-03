import fs from 'fs/promises'
import ffmpeg from 'fluent-ffmpeg'
import { EdgeSchema } from '../schema/generate.js'
import { EdgeTTS } from '../lib/node-edge-tts/edge-tts-fixed.js'
import { fileExist, readJson, safeRunWithRetry } from '../utils/index.js'
import { logger } from '../utils/logger.js'

export async function runEdgeTTS({
  text,
  pitch,
  volume,
  voice,
  rate,
  output,
  outputType = 'file',
}: Omit<EdgeSchema, 'useLLM'> & { output: string; outputType?: string }) {
  const lang = /([a-zA-Z]{2,5}-[a-zA-Z]{2,5}\b)/.exec(voice)?.[1]
  const tts = new EdgeTTS({
    voice,
    lang,
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    saveSubtitles: true,
    pitch,
    rate,
    volume,
    timeout: 30_000,
  })
  logger.info('run with nodejs edge-tts service...')
  
  if (outputType === 'file') {
    // Use .mp3 extension for the initial output
    const mp3Output = output.endsWith('.wav') ? output.replace('.wav', '.mp3') : output + '.mp3'
    logger.info(`Generating MP3 file at: ${mp3Output}`)
    
    try {
      await tts.ttsPromise(text, { audioPath: mp3Output, outputType })
      logger.info(`MP3 file generated successfully at: ${mp3Output}`)
    } catch (error) {
      logger.error('Error generating MP3 file:', error)
      throw error
    }
    
    // Check if MP3 file exists
    try {
      await fs.access(mp3Output)
      logger.info(`MP3 file exists: ${mp3Output}`)
    } catch (error) {
      logger.error(`MP3 file does not exist: ${mp3Output}`, error)
      throw new Error(`Failed to generate MP3 file: ${mp3Output}`)
    }
    
    // If output is already a WAV file, convert MP3 to WAV using ffmpeg
    if (output.endsWith('.wav')) {
      // Convert MP3 to WAV using ffmpeg with optimized parameters
      logger.info(`Converting MP3 to WAV: ${mp3Output} -> ${output}`)
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(mp3Output)
            .toFormat('wav')
            .audioFrequency(22050) // Reduce sample rate for smaller file and faster processing
            .audioChannels(1) // Use mono instead of stereo for smaller file
            .on('error', (err) => {
              logger.error('FFmpeg conversion error:', err)
              reject(err)
            })
            .on('end', () => {
              logger.info('FFmpeg conversion completed successfully')
              resolve()
            })
            .save(output)
        })
        logger.info(`WAV file generated successfully at: ${output}`)
        
        // Remove the temporary MP3 file
        await fs.unlink(mp3Output).catch(err => logger.warn('Failed to delete temporary MP3 file:', err))
      } catch (error) {
        logger.error('Error during ffmpeg conversion:', error)
        throw error
      }
    } else {
      // If output is not a WAV file, move the MP3 file to the output path
      if (mp3Output !== output) {
        await fs.rename(mp3Output, output)
        logger.info(`Moved MP3 file from ${mp3Output} to ${output}`)
      }
    }
    
    return {
      audio: output,
      srt: output.replace('.wav', '.srt').replace('.mp3', '.srt'),
      file: '',
    }
  }
  
  return tts.ttsPromise(text, { audioPath: output, outputType: outputType as any })
}

export const generateSingleVoice = async (
  params: Omit<EdgeSchema, 'useLLM'> & { output: string }
) => {
  let result: TTSResult = {
    audio: '',
    srt: '',
  }
  await safeRunWithRetry(
    async () => {
      console.log(`edge-tts.service02,runEdgeTTS...`)
      result = (await runEdgeTTS({ ...params })) as TTSResult
    },
    { retries: 5 }
  )
  return result!
}

export const generateSingleVoiceStream = async (
  params: Omit<EdgeSchema, 'useLLM'> & { output: string; outputType?: string }
) => {
  console.log(`edge-tts.service01,runEdgeTTS...`)
  // When streaming, we still want to generate a file but read it as a stream
  return runEdgeTTS({ ...params, outputType: 'file' })
}

// 定义字幕数据的类型
interface Subtitle {
  part: string // 字幕文本
  start: number // 开始时间（毫秒）
  end: number // 结束时间（毫秒）
}

/**
 * 将毫秒转换为 SRT 时间格式（HH:MM:SS,MMM）
 * @param ms 毫秒数
 * @returns 格式化的时间字符串
 */
function formatTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
    .toString()
    .padStart(2, '0')
  const minutes = Math.floor((ms % 3600000) / 60000)
    .toString()
    .padStart(2, '0')
  const seconds = Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, '0')
  const milliseconds = (ms % 1000).toString().padStart(3, '0')
  return `${hours}:${minutes}:${seconds},${milliseconds}`
}

/**
 * 将字幕 JSON 数据转换为 SRT 格式字符串
 * @param subtitles 字幕数组
 * @returns SRT 格式的字符串
 */
function convertToSrt(subtitles: Subtitle[]): string {
  let srtContent = ''

  subtitles.forEach((subtitle, index) => {
    const startTime = formatTime(subtitle.start)
    const endTime = formatTime(subtitle.end)

    srtContent += `${index + 1}\n`
    srtContent += `${startTime} --> ${endTime}\n`
    srtContent += `${subtitle.part}\n\n`
  })

  return srtContent
}

export const jsonToSrt = async (jsonPath: string) => {
  const json = await readJson<any>(jsonPath)
  const srtResult = convertToSrt(json)
  return srtResult
}

export const generateSrt = async (jsonPath: string, srtPath: string, deleteJson = false) => {
  if (await fileExist(srtPath)) {
    console.log(`SRT file already exists at ${srtPath}`)
    return
  }
  try {
    const srtTxt = await jsonToSrt(jsonPath)
    await fs.writeFile(srtPath, srtTxt, 'utf8')
    console.log(`SRT file created at ${srtPath}`)
    if (deleteJson) await fs.unlink(jsonPath)
    return srtPath
  } catch (err) {
    console.error(`Error reading JSON file at ${jsonPath}:`, err)
    return
  }
}
