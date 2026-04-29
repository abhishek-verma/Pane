import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  AbortMultipartUploadCommand,
  type CompletedPart,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'

const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024
const DEFAULT_MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024
const DEFAULT_MULTIPART_PART_SIZE_BYTES = 64 * 1024 * 1024
const DEFAULT_UPLOAD_ATTEMPTS = 3

export interface PutFileOptions {
  multipartThresholdBytes?: number
  partSizeBytes?: number
  maxAttempts?: number
  retryDelayMs?: number
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing env var: ${name}`)
  return value
}

export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  })
}

export function getBucket(): string {
  return required('R2_BUCKET')
}

export function getCdnBase(): string {
  return process.env.R2_PUBLIC_BASE_URL?.trim() ?? 'https://cdn.browseros.com'
}

/** Uploads a file to R2, using multipart uploads for large artifacts so failed parts can be retried. */
export async function putFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
  opts: PutFileOptions = {},
): Promise<void> {
  const { size } = await stat(filePath)
  const multipartThresholdBytes =
    opts.multipartThresholdBytes ?? DEFAULT_MULTIPART_THRESHOLD_BYTES
  if (size > 0 && size >= multipartThresholdBytes) {
    await putFileMultipart(
      client,
      bucket,
      key,
      filePath,
      contentType,
      size,
      opts,
    )
    return
  }

  await sendWithRetry(
    () =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
        }),
      ),
    opts,
  )
}

/** Uploads large files as multipart objects with fresh streams for each retried part. */
async function putFileMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
  size: number,
  opts: PutFileOptions,
): Promise<void> {
  const partSizeBytes = opts.partSizeBytes ?? DEFAULT_MULTIPART_PART_SIZE_BYTES
  if (partSizeBytes < MIN_MULTIPART_PART_SIZE_BYTES) {
    throw new Error(
      `multipart part size must be at least ${MIN_MULTIPART_PART_SIZE_BYTES} bytes`,
    )
  }

  const { UploadId } = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
  )
  if (!UploadId) {
    throw new Error(`missing multipart upload id for ${bucket}/${key}`)
  }

  const parts: CompletedPart[] = []
  try {
    for (let start = 0, partNumber = 1; start < size; start += partSizeBytes) {
      const end = Math.min(start + partSizeBytes, size) - 1
      const contentLength = end - start + 1
      const result = await sendWithRetry(
        () =>
          client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId,
              PartNumber: partNumber,
              Body: createReadStream(filePath, { start, end }),
              ContentLength: contentLength,
            }),
          ),
        opts,
      )
      if (!result.ETag) {
        throw new Error(`missing ETag for ${bucket}/${key} part ${partNumber}`)
      }
      parts.push({ ETag: result.ETag, PartNumber: partNumber })
      partNumber += 1
    }

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId,
        MultipartUpload: { Parts: parts },
      }),
    )
  } catch (error) {
    await client
      .send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId }),
      )
      .catch(() => {})
    throw error
  }
}

/** Retries part uploads by rerunning the command factory, which recreates consumed request bodies. */
async function sendWithRetry<T>(
  send: () => Promise<T>,
  opts: PutFileOptions,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_UPLOAD_ATTEMPTS
  const retryDelayMs = opts.retryDelayMs ?? 1000
  let lastError: unknown
  if (maxAttempts < 1) throw new Error('maxAttempts must be at least 1')

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await send()
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
      if (retryDelayMs > 0) await sleep(retryDelayMs * attempt)
    }
  }

  throw lastError
}

export async function putBody(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: Buffer.byteLength(body),
      ContentType: contentType,
    }),
  )
}

export async function getBody(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    )
    const body = response.Body as
      | { transformToByteArray(): Promise<Uint8Array> }
      | undefined
    if (!body) throw new Error(`missing response body for R2 key: ${key}`)
    const bytes = await body.transformToByteArray()
    return new TextDecoder().decode(bytes)
  } catch (error) {
    const cause = error as {
      name?: string
      $metadata?: { httpStatusCode?: number }
    }
    if (cause.name === 'NoSuchKey' || cause.$metadata?.httpStatusCode === 404) {
      return null
    }
    throw error
  }
}
