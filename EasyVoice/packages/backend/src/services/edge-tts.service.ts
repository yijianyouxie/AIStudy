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
    // 修复文件命名逻辑，确保正确处理文件扩展名
    let baseOutput = output;
    // 移除可能存在的扩展名，确保我们从基础文件名开始
    if (baseOutput.endsWith('.wav')) {
      baseOutput = baseOutput.slice(0, -4);
    } else if (baseOutput.endsWith('.mp3')) {
      baseOutput = baseOutput.slice(0, -4);
    }
    
    // Use .mp3 extension for the initial output
    const mp3Output = baseOutput + '.mp3';
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
    let finalOutput = mp3Output;
    if (output.endsWith('.wav')) {
      // Convert MP3 to WAV using ffmpeg with optimized parameters
      const wavOutput = baseOutput + '.wav';
      logger.info(`Converting MP3 to WAV: ${mp3Output} -> ${wavOutput}`)
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
            .save(wavOutput)
        })
        logger.info(`WAV file generated successfully at: ${wavOutput}`)
        finalOutput = wavOutput;
        
        // Remove the temporary MP3 file
        await fs.unlink(mp3Output).catch(err => logger.warn('Failed to delete temporary MP3 file:', err))
      } catch (error) {
        logger.error('Error during ffmpeg conversion:', error)
        throw error
      }
    }
    
    // 修复字幕文件路径生成逻辑
    const srtPath = baseOutput + '.srt';
    
    return {
      audio: finalOutput,
      srt: srtPath,
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
  if (params.outputType === 'stream') {
    // 返回一个真正的可读流
    const result = await runEdgeTTS({ ...params, outputType: 'file' }) as { audio: string; srt: string; file: string; };
    // 创建一个可读流来传输音频文件
    const fs = await import('fs');
    return fs.createReadStream(result.audio);
  }
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
