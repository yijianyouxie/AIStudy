import path, { resolve } from 'path'
import { Response } from 'express'
import fs, { readdir } from 'fs/promises'
import ffmpeg from 'fluent-ffmpeg'
import { AUDIO_DIR, STATIC_DOMAIN, EDGE_API_LIMIT } from '../config/index.js'
import { logger } from '../utils/logger.js'
import { getPrompt } from '../llm/prompt/generateSegment.js'
import {
  asyncSleep,
  ensureDir,
  generateId,
  getLangConfig,
  readJson,
  streamToResponse,
} from '../utils/index.js'
import { openai } from '../utils/openai.js'
import { splitText } from './text.service.js'
import { generateSingleVoiceStream, generateSrt } from './edge-tts.service.js'
import { EdgeSchema } from '../schema/generate.js'
import { MapLimitController } from '../controllers/concurrency.controller.js'
import audioCacheInstance from './audioCache.service.js'
import { mergeSubtitleFiles, SubtitleFile, SubtitleFiles } from '../utils/subtitle.js'
import taskManager, { Task } from '../utils/taskManager.js'
import { Readable, PassThrough } from 'stream'
import { createWriteStream } from 'fs'

// 错误消息枚举
enum ErrorMessages {
  ENG_MODEL_INVALID_TEXT = 'English model cannot process non-English text',
  API_FETCH_FAILED = 'Failed to fetch TTS parameters from API',
  INVALID_API_RESPONSE = 'Invalid API response: no TTS parameters returned',
  PARAMS_PARSE_FAILED = 'Failed to parse TTS parameters',
  INVALID_PARAMS_FORMAT = 'Invalid TTS parameters format',
  TTS_GENERATION_FAILED = 'TTS generation failed',
  INCOMPLETE_RESULT = 'Incomplete TTS result',
}

/**
 * 流式生成文本转语音 (TTS) 的音频和字幕
 */
export async function generateTTSStream(params: Required<EdgeSchema>, task: Task) {
  const { text, pitch, voice, rate, volume, useLLM } = params
  const segment: Segment = { id: generateId(useLLM ? 'aigen-' : voice, text), text }
  const { lang, voiceList } = await getLangConfig(segment.text)
  logger.debug(`Language detected lang: `, lang)
  task!.context!.segment = segment
  task!.context!.lang = lang
  task!.context!.voiceList = voiceList
  const { res } = task.context as Required<NonNullable<Task['context']>>
  if (!validateLangAndVoice(lang, voice, res)) {
    task?.endTask?.(task.id)
    return
  }

  // 检查缓存, 如果有缓存则直接返回
  const cacheKey = taskManager.generateTaskId({ text, pitch, voice, rate, volume })
  const cache = await audioCacheInstance.getAudio(cacheKey)
  if (cache) {
    const data = {
      ...cache,
      file: path.parse(cache.audio).base,
      srt: path.parse(cache.srt).base,
      text: '',
    }
    logger.info(`Cache hit: ${voice} ${text.slice(0, 10)}`)
    task.context?.res?.setHeader('x-generate-tts-type', 'application/json')
    task.context?.res?.setHeader('Access-Control-Expose-Headers', 'x-generate-tts-type')
    task.context?.res?.json({ code: 200, data, success: true })
    task.endTask?.(task.id)
    return
  }

  if (useLLM) {
    generateWithLLMStream(task)
  } else {
    generateWithoutLLMStream({ ...params, output: segment.id }, task)
  }
}
export async function generateTTSStreamJson(formatedBody: Required<EdgeSchema>[], task: Task) {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const output = path.resolve(AUDIO_DIR, segment.id)
  const segments = formatedBody
  logger.info(`generateTTSStreamJson splitText length: ${formatedBody.length} `)
  const buildSegments = segments.map((segment) => ({ ...segment, output }))
  logger.info('buildSegments:', buildSegments)
  buildSegmentList(buildSegments, task)
}

/**
 * 生成单个片段的音频和字幕
 */
async function buildSegment(params: TTSParams & { format?: string }, task: Task, dir: string = '') {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const outputBase = path.resolve(AUDIO_DIR, dir, segment.id)
  const { res } = task.context as Required<NonNullable<Task['context']>>

  // Check if we have cached audio for this segment
  const cacheParams = {
    text: segment.text,
    voice: params.voice,
    rate: params.rate || '+0%',
    pitch: params.pitch || '+0Hz',
    volume: params.volume || '+0%',
    format: params.format || 'wav'
  };
  
  const cacheKey = taskManager.generateTaskId(cacheParams);
  logger.info(`Checking cache with key: ${cacheKey}`, cacheParams);
  
  const cachedAudio = await audioCacheInstance.getAudio(cacheKey);
  if (cachedAudio) {
    logger.info(`Using cached audio for segment: ${segment.id}`)
    const audioPath = cachedAudio.audio;
    
    try {
      // Check if file exists
      await fs.access(audioPath);
      
      // Set appropriate content type based on format
      if (params.format === 'wav') {
        res!.setHeader('Content-Type', 'audio/wav')
        // Stream the WAV file
        const fileBuffer = await fs.readFile(audioPath)
        res!.write(fileBuffer)
        res!.end()
      } else {
        res!.setHeader('Content-Type', 'audio/mpeg')
        // Stream the MP3 file
        const fileBuffer = await fs.readFile(audioPath)
        res!.write(fileBuffer)
        res!.end()
      }
      
      // Mark task as completed
      task.endTask?.(task.id)
      return;
    } catch (fileError) {
      logger.warn(`Cached audio file not found, re-processing: ${audioPath}`, fileError)
      // Continue with normal processing if file not found
    }
  }

  // Generate MP3 file first - always generate MP3 first
  const mp3Output = outputBase + '.mp3'
  logger.info(`Generating MP3 for streaming at: ${mp3Output}`)
  
  try {
    const result = await generateSingleVoiceStream({
      ...params,
      output: mp3Output,
      outputType: 'file'
    }) as any

    const generatedMp3Path = result.audio || mp3Output
    logger.info(`MP3 file generated at: ${generatedMp3Path}`)
    
    // Check if MP3 file exists
    try {
      await fs.access(generatedMp3Path)
      logger.info(`Generated MP3 file exists: ${generatedMp3Path}`)
    } catch (error) {
      logger.error(`Generated MP3 file does not exist: ${generatedMp3Path}`, error)
      throw new Error(`Failed to generate MP3 file: ${generatedMp3Path}`)
    }
    
    // Check if we need to convert to WAV format
    const needWavFormat = params.format === 'wav'
    logger.info(`Need WAV format conversion: ${needWavFormat}`)
    
    let finalAudioPath = '';
    
    if (needWavFormat) {
      // Set appropriate content type for WAV
      res!.setHeader('Content-Type', 'audio/wav')
      
      // Convert MP3 to WAV and stream with optimized parameters
      const wavOutput = outputBase + '.wav'
      logger.info(`Converting MP3 to WAV: ${generatedMp3Path} -> ${wavOutput}`)
      
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(generatedMp3Path)
            .toFormat('wav')
            .audioFrequency(22050) // Reduce sample rate for smaller file and faster processing
            .audioChannels(1) // Use mono instead of stereo for smaller file
            .on('error', (err) => {
              logger.error('WAV conversion error:', err)
              reject(err)
            })
            .on('end', () => {
              logger.info('FFmpeg conversion completed successfully')
              resolve()
            })
            .save(wavOutput)
        })
        
        // Check if WAV file exists
        try {
          await fs.access(wavOutput)
          logger.info(`WAV file exists: ${wavOutput}`)
        } catch (error) {
          logger.error(`WAV file does not exist: ${wavOutput}`, error)
          throw new Error(`Failed to generate WAV file: ${wavOutput}`)
        }
        
        // Stream the WAV file
        logger.info(`Streaming WAV file: ${wavOutput}`)
        const fileBuffer = await fs.readFile(wavOutput)
        res!.write(fileBuffer)
        res!.end()
        
        finalAudioPath = wavOutput;
        
        // Clean up temporary files
        await fs.unlink(generatedMp3Path).catch(err => logger.warn('Failed to delete MP3 file:', err))
        
        // Mark task as completed
        task.endTask?.(task.id)
      } catch (error) {
        logger.error('Error during WAV conversion or streaming:', error)
        // Fallback to MP3 if WAV conversion fails
        logger.info('Falling back to MP3 streaming')
        const fileBuffer = await fs.readFile(generatedMp3Path)
        res!.setHeader('Content-Type', 'audio/mpeg')
        res!.write(fileBuffer)
        res!.end()
        finalAudioPath = generatedMp3Path;
        
        // Mark task as completed
        task.endTask?.(task.id)
      }
    } else {
      // Set appropriate content type for MP3
      res!.setHeader('Content-Type', 'audio/mpeg')
      
      // Directly stream MP3
      logger.info(`Streaming MP3 file: ${generatedMp3Path}`)
      const fileBuffer = await fs.readFile(generatedMp3Path)
      res!.write(fileBuffer)
      res!.end()
      
      finalAudioPath = generatedMp3Path;
      
      // Mark task as completed
      task.endTask?.(task.id)
    }
    
    // Cache the result
    logger.info(`Caching audio with key: ${cacheKey}`)
    await audioCacheInstance.setAudio(cacheKey, {
      voice: params.voice,
      text: segment.text,
      rate: params.rate || '+0%',
      pitch: params.pitch || '+0Hz',
      volume: params.volume || '+0%',
      audio: finalAudioPath,
      srt: finalAudioPath.replace(/\.(wav|mp3)$/, '.srt')
    }).catch(err => logger.warn('Failed to cache audio:', err))
    
  } catch (error) {
    logger.error('Error in buildSegment:', error)
    if (!res!.headersSent) {
      res!.status(500).send({ error: 'Failed to generate audio' })
    }
    task.endTask?.(task.id)
    throw error
  }

  // Handle subtitles after streaming is set up
  setTimeout(() => {
    handleSrt(outputBase)
    // Ensure task is marked as completed even if subtitle handling fails
    if (task.status !== 'completed') {
      task.endTask?.(task.id)
    }
  }, 200)
}

/**
 * 生成多个片段并合并的 TTS
 */

interface SegmentError extends Error {
  segmentIndex: number
  attempt: number
}

async function buildSegmentList(segments: (BuildSegment & { format?: string })[], task: Task): Promise<void> {
  const { res, segment } = task.context as Required<NonNullable<Task['context']>>
  const { id: outputId } = segment
  const totalSegments = segments.length
  const output = path.resolve(AUDIO_DIR, outputId)
  let completedSegments = 0
  if (!totalSegments) {
    task?.endTask?.(task.id)
    return void res.status(400).end('No segments provided')
  }

  const progress = () => Number(((completedSegments / totalSegments) * 100).toFixed(2))
  const outputStream = new PassThrough()

  streamToResponse(res, outputStream, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-generate-tts-type': 'stream',
      'Access-Control-Expose-Headers-generate-tts-id': task.id,
    },
    onError: (err) => `Custom error: ${err.message}`,
    fileName: segment.id,
    onEnd: () => {
      task?.endTask?.(task.id)
      logger.info(`Streaming ${task.id} finished`)
      setTimeout(() => {
        handleSrt(output)
      }, 200)
    },
    onClose: () => {
      task?.endTask?.(task.id)
      logger.info(`Streaming ${task.id} closed`)
    },
  })

  const processSegment = async (index: number, maxRetries = 3): Promise<void> => {
    if (index >= totalSegments) {
      outputStream.end()
      task?.endTask?.(task.id)
      return
    }

    const segment = segments[index]
    const generateWithRetry = async (attempt = 0): Promise<Readable> => {
      try {
        return (await generateSingleVoiceStream({
          ...segment,
          outputType: 'stream',
          output,
        })) as Readable
      } catch (err) {
        const error = err as Error
        if (attempt + 1 >= maxRetries) {
          throw Object.assign(error, { segmentIndex: index, attempt: attempt + 1 } as SegmentError)
        }
        logger.warn(
          `Segment ${index + 1} failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}`
        )
        await asyncSleep(1000)
        return generateWithRetry(attempt + 1)
      }
    }

    try {
      // TODO: Concurrency of streaming flow
      const audioStream = await generateWithRetry()
      await audioStream.pipe(outputStream, { end: false })
      await new Promise((resolve) => audioStream.on('end', resolve))
      completedSegments++
      logger.info(`processing text:\n ${segment.text.slice(0, 10)}...`)
      logger.info(`Segment ${index + 1}/${totalSegments} completed. Progress: ${progress()}%`)
      await processSegment(index + 1)
    } catch (err) {
      const { segmentIndex, attempt, message } = err as SegmentError
      logger.error(`Segment ${segmentIndex + 1} failed after ${attempt} retries: ${message}`)
      outputStream.emit('error', err)
    }
  }

  try {
    await processSegment(0)
  } catch (err) {
    logger.error(`Audio processing aborted: ${(err as Error).message}`)
    !res.headersSent && res.status(500).end('Internal server error')
  }
}

/**
 * 使用 LLM 生成 TTS
 */
async function generateWithLLMStream(task: Task) {
  const { segment, voiceList, lang, res } = task.context as Required<NonNullable<Task['context']>>
  const { text, id } = segment
  const { length, segments } = splitText(text.trim())
  const formatLlmSegments = (llmSegments: any) =>
    llmSegments
      .filter((segment: any) => segment.text)
      .map((segment: any) => ({
        ...segment,
        voice: segment.name,
      }))
  if (length <= 1) {
    const prompt = getPrompt(lang, voiceList, segments[0])
    logger.debug(`Prompt for LLM: ${prompt}`)
    const llmResponse = await fetchLLMSegment(prompt)
    let llmSegments = llmResponse?.result || llmResponse?.segments || []
    if (!Array.isArray(llmSegments)) {
      throw new Error(
        'LLM response is not an array, please switch to Edge TTS mode or use another model'
      )
    }
    buildSegmentList(formatLlmSegments(llmSegments), task)
  } else {
    const output = resolve(AUDIO_DIR, id)
    let count = 0
    logger.info('Splitting text into multiple segments:', segments.length)
    const getProgress = () => {
      return Number(((count / segments.length) * 100).toFixed(2))
    }
    const localStream = createWriteStream(output)
    const outputStream = new PassThrough()
    outputStream.pipe(res)
    outputStream.pipe(localStream)

    for (let seg of segments) {
      count++
      const prompt = getPrompt(lang, voiceList, seg)
      logger.debug(`Prompt for LLM: ${prompt}`)
      const llmResponse = await fetchLLMSegment(prompt)
      let llmSegments = llmResponse?.result || llmResponse?.segments || []
      if (!Array.isArray(llmSegments)) {
        throw new Error(
          'LLM response is not an array, please switch to Edge TTS mode or use another model'
        )
      }
      for (let segment of formatLlmSegments(llmSegments)) {
        const stream = (await generateSingleVoiceStream({
          ...segment,
          output,
          outputType: 'stream',
        })) as Readable
        stream.pipe(outputStream, { end: false })
        await new Promise((resolve) => {
          stream.on('end', resolve)
        })
      }
      logger.info(`Progress: ${getProgress()}%`)
    }
    outputStream.end()
    setTimeout(() => {
      handleSrt(output)
    }, 200)
  }
}
const buildFinal = async (finalSegments: TTSResult[], id: string) => {
  const subtitleFiles: SubtitleFiles = await Promise.all(
    finalSegments.map((file) => {
      const base = path.basename(file.audio)
      const jsonPath = path.resolve(AUDIO_DIR, base.replace('.mp3', ''), 'all_splits.mp3.json')
      return readJson<SubtitleFile>(jsonPath)
    })
  )

  const mergedJson = mergeSubtitleFiles(subtitleFiles)
  const finalDir = path.resolve(AUDIO_DIR, id.replace('.mp3', ''))
  await ensureDir(finalDir)
  const finalJson = path.resolve(finalDir, '[merged]all_splits.mp3.json')
  await fs.writeFile(finalJson, JSON.stringify(mergedJson, null, 2))
  await generateSrt(finalJson, path.resolve(AUDIO_DIR, id.replace('.mp3', '.srt')))
  const fileList = finalSegments.map((segment) =>
    path.resolve(AUDIO_DIR, path.parse(segment.audio).base)
  )
  const outputFile = path.resolve(AUDIO_DIR, id)
  await concatDirAudio({ inputDir: finalDir, fileList, outputFile })
  return {
    audio: `${STATIC_DOMAIN}/${id}`,
    srt: `${STATIC_DOMAIN}/${id.replace('.mp3', '.srt')}`,
  }
}

async function generateWithoutLLMStream(params: TTSParams, task: Task) {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const { text } = segment
  const { length, segments } = splitText(text)
  logger.info(`splitText length: ${length} `)
  if (length <= 1) {
    buildSegment(params, task)
  } else {
    const buildSegments = segments.map((segment) => ({ ...params, text: segment }))
    buildSegmentList(buildSegments, task)
  }
}

export async function handleSrt(audioPath: string, stream = true) {
  if (!stream) {
    const tempJsonPath = audioPath + '.json'
    await generateSrt(tempJsonPath, audioPath.replace('.mp3', '.srt'))
    return
  }
  const { dir, base } = path.parse(audioPath)
  const tmpDir = audioPath + '_tmp'
  await ensureDir(tmpDir)

  const fileList = (await readdir(tmpDir))
    .filter((file) => file.includes(base) && file.includes('.json'))
    .sort((a, b) => Number(a.split('.json.')?.[1] || 0) - Number(b.split('.json.')?.[1] || 0))
    .map((file) => path.join(tmpDir, file))
  if (!fileList.length) return
  concatDirSrt({ jsonFiles: fileList, inputDir: tmpDir, outputFile: audioPath })
}

/**
 * 并发执行任务
 */
async function runConcurrentTasks(tasks: (() => Promise<any>)[], limit: number): Promise<any[]> {
  logger.debug(`Running ${tasks.length} tasks with a limit of ${limit}`)
  const controller = new MapLimitController(tasks, limit, () =>
    logger.info('All concurrent tasks completed')
  )
  const { results, cancelled } = await controller.run()
  logger.info(`Tasks completed: ${results.length}, cancelled: ${cancelled}`)
  logger.debug(`Task results:`, results)
  return results
}

/**
 * 验证语言和语音参数
 */
function validateLangAndVoice(lang: string, voice: string, res: Response): boolean {
  if (lang !== 'eng' && voice.startsWith('en')) {
    res.status(400).send({
      code: 400,
      success: false,
      message: ErrorMessages.ENG_MODEL_INVALID_TEXT,
    })
    return false
  }
  return true
}

/**
 * 从 LLM 获取分段参数
 */
async function fetchLLMSegment(prompt: string): Promise<any> {
  const response = await openai.createChatCompletion({
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant. And you can return valid json object',
      },
      { role: 'user', content: prompt },
    ],
    // temperature: 0.7,
    // max_tokens: 500,
    response_format: { type: 'json_object' },
  })

  if (!response.choices[0].message.content) {
    throw new Error(ErrorMessages.INVALID_API_RESPONSE)
  }
  return parseLLMResponse(response)
}

/**
 * 解析 LLM 响应
 */
function parseLLMResponse(response: any): TTSParams {
  const params = JSON.parse(response.choices[0].message.content) as TTSParams
  if (!params || typeof params !== 'object') {
    throw new Error(ErrorMessages.INVALID_PARAMS_FORMAT)
  }
  return params
}

/**
 * 验证 TTS 结果
 */
function validateTTSResult(result: TTSResult, segmentId: string): void {
  if (!result.audio) {
    throw new Error(`${ErrorMessages.INCOMPLETE_RESULT} for segment ${segmentId}`)
  }
}

/**
 * 拼接音频文件
 */
export async function concatDirAudio({
  fileList,
  outputFile,
  inputDir,
}: ConcatAudioParams): Promise<void> {
  const mp3Files = sortAudioDir(fileList!, '.mp3')
  if (!mp3Files.length) throw new Error('No MP3 files found in input directory')

  const tempListPath = path.resolve(inputDir, 'file_list.txt')
  await fs.writeFile(tempListPath, mp3Files.map((file) => `file '${file}'`).join('\n'))

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(tempListPath)
      .inputFormat('concat')
      .inputOption('-safe', '0')
      .audioCodec('copy')
      .output(outputFile)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`Concat failed: ${err.message}`)))
      .run()
  })
}

/**
 * 拼接字幕文件
 */
export async function concatDirSrt({
  fileList,
  outputFile,
  inputDir,
  jsonFiles,
}: ConcatAudioParams): Promise<void> {
  const _jsonFiles =
    jsonFiles ||
    sortAudioDir(
      fileList!.map((file) => `${file}.json`),
      '.json'
    )
  if (!_jsonFiles.length) throw new Error('No JSON files found for subtitles')

  const subtitleFiles: SubtitleFiles = await Promise.all(
    _jsonFiles.map((file) => readJson<SubtitleFile>(file))
  )
  const mergedJson = mergeSubtitleFiles(subtitleFiles)
  const tempJsonPath = path.resolve(inputDir, 'all_splits.mp3.json')
  await fs.writeFile(tempJsonPath, JSON.stringify(mergedJson, null, 2))
  await generateSrt(tempJsonPath, outputFile.replace('.mp3', '.srt'))
}

/**
 * 按文件名排序音频文件
 */
function sortAudioDir(fileList: string[], ext: string = '.mp3'): string[] {
  return fileList
    .filter((file) => path.extname(file).toLowerCase() === ext)
    .sort(
      (a, b) => Number(path.parse(a).name.split('_')[0]) - Number(path.parse(b).name.split('_')[0])
    )
}

export interface ConcatAudioParams {
  fileList?: string[]
  outputFile: string
  inputDir: string
  jsonFiles?: string[]
}
