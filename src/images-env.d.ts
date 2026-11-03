declare namespace Cloudflare {
  interface Env {
    // Optional per-deployment image upload limit in bytes. Values above 20 MB are capped.
    IMAGE_UPLOAD_MAX_BYTES?: string;
  }
}
