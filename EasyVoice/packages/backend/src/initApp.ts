import { ensureDir } from './utils/index.js'
import { AUDIO_DIR, PUBLIC_DIR } from './config/index.js'

export async function initApp() {
  await ensureDir(AUDIO_DIR)
  await ensureDir(PUBLIC_DIR)
}
