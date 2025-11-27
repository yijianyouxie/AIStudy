import path, { resolve } from 'path'
import { Response } from 'express'
import fs, { readdir, access } from 'fs/promises'
import { createReadStream } from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import { AUDIO_DIR, STATIC_DOMAIN, EDGE_API_LIMIT } from '../config'
import { logger } from '../utils/logger'
import { getPrompt } from '../llm/prompt/generateSegment'
import {
  asyncSleep,
  ensureDir,
  generateId,
  getLangConfig,
  readJson,
  streamToResponse,
} from '../utils'
import { openai } from '../utils/openai'
import { splitText } from './text.service'
import { generateSingleVoiceStream, generateSrt } from './edge-tts.service'
import { EdgeSchema } from '../schema/generate'
import { MapLimitController } from '../controllers/concurrency.controller'
import audioCacheInstance from './audioCache.service'
import { mergeSubtitleFiles, SubtitleFile, SubtitleFiles } from '../utils/subtitle'
import taskManager, { Task } from '../utils/taskManager'
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
    logger.info(`Cache hit: ${voice} ${text.slice(0, 10)}`, { cacheKey, cache })
    try {
      // 从缓存中提取实际文件路径
      let fullPath = cache.audio;
      logger.info(`Original cached audio path: ${fullPath}`)
      logger.info(`STATIC_DOMAIN: ${STATIC_DOMAIN}`)
      logger.info(`AUDIO_DIR: ${AUDIO_DIR}`)
      
      // 确保我们总是使用相对于AUDIO_DIR的路径
      // 移除可能存在的前导斜杠
      if (fullPath.startsWith('/')) {
        fullPath = fullPath.substring(1);
        logger.info(`Removed leading slash: ${fullPath}`)
      }
      
      // 构建完整路径
      fullPath = path.resolve(AUDIO_DIR, fullPath);
      logger.info(`Resolved file path: ${fullPath}`)
      
      // 检查文件是否存在
      try {
        await access(fullPath)
        logger.info(`Cached audio file exists: ${fullPath}`)
      } catch (error) {
        logger.error(`Cached audio file not found: ${fullPath}`, error)
        
        // 文件不存在，继续执行正常的生成流程而不是报错
        logger.info('Cached file not found, continuing with normal generation');
        throw error; // 抛出错误以继续正常的生成流程
      }
      
      // 直接将缓存的音频文件流式传输给客户端
      const fileStream = createReadStream(fullPath)
      
      // 设置响应头
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('x-generate-tts-type', 'stream-cache')
      res.setHeader('Access-Control-Expose-Headers', 'x-generate-tts-type, x-generate-tts-id')
      
      // 管道传输文件流到响应对象
      fileStream.pipe(res)
      
      // 监听流完成事件
      fileStream.on('end', () => {
        logger.info(`Finished streaming cached file: ${fullPath}`)
        task.endTask?.(task.id)
      })
      
      // 监听流错误事件
      fileStream.on('error', (err: NodeJS.ErrnoException) => {
        logger.error('Error streaming cached audio:', err)
        logger.error('Error stack:', err.stack)
        if (!res.headersSent) {
          res.status(500).json({ 
            success: false, 
            message: 'Error streaming cached audio',
            error: err.message,
            stack: err.stack
          })
        }
        task.endTask?.(task.id)
      })
      
      return
    } catch (error) {
      logger.error('Error handling cached audio:', error)
      logger.error('Error stack:', (error as Error).stack)
      // 出现错误时，继续执行正常的生成流程
      logger.info('Error handling cache, continuing with normal generation');
    }
  }

  if (useLLM) {
    generateWithLLMStream(task)
  } else {
    generateWithoutLLMStream({ ...params, output: segment.id }, task)
  }
  
  // 添加缓存保存逻辑
  const originalEndTask = task.endTask;
  task.endTask = (taskId: string) => {
    // 先执行原有的结束任务逻辑
    if (originalEndTask) {
      originalEndTask(taskId);
    }
    
    // 保存结果到缓存
    const cacheKey = taskManager.generateTaskId({ text, pitch, voice, rate, volume, useLLM });
    
    const fileName = path.basename(segment.id, '.mp3');
    const result = {
      text,
      pitch,
      voice,
      rate,
      volume,
      useLLM,
      audio: `${STATIC_DOMAIN}/${fileName}.mp3`,
      srt: `${STATIC_DOMAIN}/${fileName}.srt`
    };
    
    audioCacheInstance.setAudio(cacheKey, result)
      .then(() => {
        logger.info(`Successfully cached result for ${voice} ${text.slice(0, 10)}`);
      })
      .catch((error) => {
        logger.error(`Failed to cache result for ${voice} ${text.slice(0, 10)}:`, error);
      });
  };
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

/**
 * 生成单个片段的音频和字幕
 */
async function buildSegment(params: TTSParams, task: Task, dir: string = '') {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const output = path.resolve(AUDIO_DIR, dir, segment.id)
  const stream = (await generateSingleVoiceStream({
    ...params,
    output,
    outputType: 'stream',
  })) as Readable
  const { res } = task.context as Required<NonNullable<Task['context']>>

  streamToResponse(res, stream, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-generate-tts-type': 'stream',
      'Access-Control-Expose-Headers-generate-tts-id': task.id,
    },
    fileName: segment.id,
    onError: (err) => `Custom error: ${err.message}`,
    onEnd: () => {
      task?.endTask?.(task.id)
      logger.info(`Streaming ${task.id} finished`)
      setTimeout(() => {
        handleSrt(output)
      }, 200)
      
      // 保存结果到缓存
      const cacheKey = taskManager.generateTaskId({ 
        text: segment.text,
        pitch: params.pitch,
        voice: params.voice,
        rate: params.rate,
        volume: params.volume,
        useLLM: false
      });
      
      const fileName = path.basename(segment.id, '.mp3');
      const result = {
        text: segment.text,
        pitch: params.pitch,
        voice: params.voice,
        rate: params.rate,
        volume: params.volume,
        useLLM: false,
        audio: `${STATIC_DOMAIN}/${fileName}.mp3`,
        srt: `${STATIC_DOMAIN}/${fileName}.srt`
      };
      
      audioCacheInstance.setAudio(cacheKey, result)
        .then(() => {
          logger.info(`Successfully cached segment result for ${params.voice} ${segment.text.slice(0, 10)}`);
        })
        .catch((error) => {
          logger.error(`Failed to cache segment result for ${params.voice} ${segment.text.slice(0, 10)}:`, error);
        });
    },
  })
}

/**
 * 生成多个片段并合并的 TTS
 */

interface SegmentError extends Error {
  segmentIndex: number
  attempt: number
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
async function buildSegmentList(segments: BuildSegment[], task: Task): Promise<void> {
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
      
      // 保存结果到缓存
      if (segments.length > 0) {
        const firstSegment = segments[0];
        const cacheKey = taskManager.generateTaskId({ 
          text: segment.text,
          pitch: firstSegment.pitch,
          voice: firstSegment.voice,
          rate: firstSegment.rate,
          volume: firstSegment.volume,
          useLLM: false
        });
        
        const fileName = path.basename(segment.id, '.mp3');
        const result = {
          text: segment.text,
          pitch: firstSegment.pitch,
          voice: firstSegment.voice,
          rate: firstSegment.rate,
          volume: firstSegment.volume,
          useLLM: false,
          audio: `${STATIC_DOMAIN}/${fileName}.mp3`,
          srt: `${STATIC_DOMAIN}/${fileName}.srt`
        };
        
        audioCacheInstance.setAudio(cacheKey, result)
          .then(() => {
            logger.info(`Successfully cached segment list result for ${firstSegment.voice} ${segment.text.slice(0, 10)}`);
          })
          .catch((error) => {
            logger.error(`Failed to cache segment list result for ${firstSegment.voice} ${segment.text.slice(0, 10)}:`, error);
          });
      }
      
      return
    }

    const currentSegment = segments[index]
    const generateWithRetry = async (attempt = 0): Promise<Readable> => {
      try {
        return (await generateSingleVoiceStream({
          ...currentSegment,
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
      logger.info(`processing text:\n ${currentSegment.text.slice(0, 10)}...`)
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
