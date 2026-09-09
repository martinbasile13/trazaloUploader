import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Mismos parámetros que src/utils/videoConverter.ts en trazaloApp (ya
// probados ahí) — la diferencia es que acá corren con ffmpeg nativo, no wasm.
const VIDEO_ARGS = [
  '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '26',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-movflags', '+faststart',
]

export async function transcodeVideo(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', ['-y', '-i', inputPath, ...VIDEO_ARGS, outputPath], {
    maxBuffer: 1024 * 1024 * 50,
  })
}
