const encoder = new TextEncoder();

// Purpose-separated keys allow using the existing deployment secret without using its signing key.
async function encryptionKey(secret: string, purpose: string) {
  if (!secret) throw new Error('Connector encryption is not configured.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('yresonance/connectors/v1'),
      info: encoder.encode(purpose),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealConnection(
  value: unknown,
  secret: string,
  scope: string,
  purpose = 'credentials',
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(scope) },
    await encryptionKey(secret, purpose),
    encoder.encode(JSON.stringify(value)),
  );
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function openConnection(
  value: string,
  secret: string,
  scope: string,
  purpose = 'credentials',
): Promise<unknown> {
  const [iv, ciphertext, extra] = value.split('.');
  if (!iv || !ciphertext || extra !== undefined) throw new Error('Invalid encrypted connection.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(scope) },
    await encryptionKey(secret, purpose),
    decode(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) =>
    character.charCodeAt(0),
  );
}
