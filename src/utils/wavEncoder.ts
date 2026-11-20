/**
 * Records microphone input via Web Audio API and encodes it as a standard
 * 16-bit PCM mono WAV Blob so Python's speech_recognition.AudioFile can read it directly.
 */
export interface WavRecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
  getLevel: () => number;
}

export async function startWavRecording(): Promise<WavRecorderHandle> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Microphone capture is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioContextClass();
  const sampleRate = audioContext.sampleRate;

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  // ScriptProcessorNode provides broad compatibility inside iframes without external worklet files
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(analyser);
  analyser.connect(processor);
  processor.connect(audioContext.destination);

  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try {
      processor.disconnect();
      analyser.disconnect();
      source.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }
    stream.getTracks().forEach((track) => track.stop());
    if (audioContext.state !== 'closed') {
      void audioContext.close();
    }
  };

  return {
    getLevel: () => {
      if (stopped) return 0;
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / dataArray.length) * 4);
    },
    stop: async () => {
      cleanup();
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return encodePcmWav(merged, sampleRate);
    },
    cancel: () => {
      cleanup();
    },
  };
}

function encodePcmWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let byteOffset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(byteOffset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    byteOffset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAsciiString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
