// Face matching runs on the phone; only the 128-number descriptor and a photo leave the device.
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

/** Descriptor of the single most prominent face in the frame, or null if none. */
export async function describeFace(video: HTMLVideoElement): Promise<number[] | null> {
  const faceapi = await loadFaceModels();
  const res = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  return res ? Array.from(res.descriptor) : null;
}

/**
 * Euclidean distance → 0..100 score. Distance 0.3 or less = 100, 0.54 ≈ 70 (default pass mark),
 * 0.6 (face-api's usual "same person" limit) ≈ 62.
 */
export function matchScore(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  const d = Math.sqrt(sum);
  return Math.max(0, Math.min(100, Math.round((100 * (1.1 - d)) / 0.8)));
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
