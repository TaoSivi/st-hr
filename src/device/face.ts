// Face matching runs on the phone; only the 128-number descriptors and a photo leave the device.
import { yawOf } from '../domain/face';
import { exposureBoost, frameStats, type FrameStats } from '../domain/faceQuality';
export { matchScore } from '../domain/face';
type FaceApi = typeof import('@vladmandic/face-api');

let api: FaceApi | null = null;
let loading: Promise<FaceApi> | null = null;

export function loadFaceModels(): Promise<FaceApi> {
  if (api) return Promise.resolve(api);
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const url = new URL('./models/', document.baseURI).href;
      await faceapi.nets.tinyFaceDetector.loadFromUri(url);
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(url);
      await faceapi.nets.faceRecognitionNet.loadFromUri(url);
      api = faceapi;
      return faceapi;
    })();
  }
  return loading;
}

// face-api's default detector (320 / 0.5), then a more sensitive one: measured on real faces the second finds more of them when they are far or low-contrast,
// and it did not invent faces in pictures that had none.
const DETECTORS = [{ inputSize: 320, scoreThreshold: 0.5 }, { inputSize: 416, scoreThreshold: 0.3 }]; // the default first; the sensitive one only when the default finds nothing, so nothing it found before is lost
const WORK_WIDTH = 640;

export interface SeenFace { descriptor: number[]; yaw: number; faceFrac: number }
export interface FrameLook { stats: FrameStats; face: SeenFace | null }

/**
 * One look at the camera: the single most prominent face (its descriptor, how far the head is turned, how big it is in the frame)
 * and how bright and sharp the frame is. A dark frame is brightened first, so a dim room still finds the face;
 * enrolment and scanning both go through here, so both see the same kind of picture.
 */
export async function readFrame(source: HTMLVideoElement | HTMLCanvasElement): Promise<FrameLook> {
  const faceapi = await loadFaceModels();
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const scale = Math.min(1, WORK_WIDTH / (sw || WORK_WIDTH));
  const work = document.createElement('canvas');
  work.width = Math.max(1, Math.round(sw * scale)); work.height = Math.max(1, Math.round(sh * scale));
  const g = work.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(source, 0, 0, work.width, work.height);

  const small = document.createElement('canvas');
  small.width = 160; small.height = 120;
  small.getContext('2d', { willReadFrequently: true })!.drawImage(work, 0, 0, 160, 120);
  const stats = frameStats(small.getContext('2d')!.getImageData(0, 0, 160, 120).data, 160, 120);

  const boost = exposureBoost(stats.luma);
  if (boost > 1) { // done on the pixels, not with a canvas filter, which iPhones' Safari does not support
    const img = g.getImageData(0, 0, work.width, work.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * boost); d[i + 1] = Math.min(255, d[i + 1] * boost); d[i + 2] = Math.min(255, d[i + 2] * boost); }
    g.putImageData(img, 0, 0);
  }

  let res = null;
  for (const opts of DETECTORS) {
    res = await faceapi.detectSingleFace(work, new faceapi.TinyFaceDetectorOptions(opts)).withFaceLandmarks(true).withFaceDescriptor();
    if (res) break;
  }
  return {
    stats,
    face: res ? { descriptor: Array.from(res.descriptor), yaw: yawOf(res.landmarks.positions), faceFrac: res.detection.box.width / work.width } : null
  };
}

export function snapshot(video: HTMLVideoElement, width = 240): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((video.videoHeight / video.videoWidth) * width) || width;
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

export async function openFrontCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => t.stop());
}
