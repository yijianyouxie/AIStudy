interface Segment {
  text: string
  id: string
}

interface TTSResult {
  audio: string
  srt: string
  file?: string
  partial?: boolean
}

interface TTSParams {
  text: string
  voice: string
  volume: string
  rate: string
  pitch: string
  output: string
  format?: string
}

type BuildSegment = TTSParams & {
  text: string
}