import { z } from 'zod';

/**
 * Sends a file with XMLHttpRequest, which unlike fetch reports upload progress. `onRequest`
 * receives the request so callers can abort it; an abort rejects with UploadCancelledError.
 * Resolves with the response body. Failed uploads reject with the server's `error` message when
 * it sends one.
 */
export function uploadFile(
  file: File,
  uploadUrl: string,
  onProgress: (progress: number) => void,
  onRequest: (request: XMLHttpRequest) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    onRequest(request);
    request.open('PUT', uploadUrl);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(request.responseText);
      } else {
        reject(
          new Error(
            serverMessage(request.responseText) ?? `Upload returned HTTP ${request.status}.`,
          ),
        );
      }
    });
    request.addEventListener('error', () => reject(new Error('The upload failed. Try again.')));
    request.addEventListener('abort', () => reject(new UploadCancelledError()));
    request.send(file);
  });
}

const uploadErrorSchema = z.object({ error: z.string() });

function serverMessage(body: string) {
  try {
    return uploadErrorSchema.safeParse(JSON.parse(body)).data?.error;
  } catch {
    return undefined;
  }
}

export class UploadCancelledError extends Error {}
