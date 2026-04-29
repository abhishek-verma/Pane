import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { S3Client } from '@aws-sdk/client-s3'
import { putFile } from '../scripts/common/r2'

class FakeS3Client {
  commands: Array<{ name: string; input: Record<string, unknown> }> = []
  failedFirstPart = false
  failedPutObject = false

  async send(command: { input: Record<string, unknown> }): Promise<unknown> {
    const name = command.constructor.name
    this.commands.push({ name, input: command.input })
    if (name === 'PutObjectCommand' && !this.failedPutObject) {
      this.failedPutObject = true
      throw new Error('socket reset')
    }
    if (name === 'CreateMultipartUploadCommand') return { UploadId: 'upload-1' }
    if (name === 'UploadPartCommand') {
      const partNumber = command.input.PartNumber
      if (partNumber === 1 && !this.failedFirstPart) {
        this.failedFirstPart = true
        throw new Error('socket reset')
      }
      return { ETag: `etag-${partNumber}` }
    }
    return {}
  }
}

describe('putFile', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (!dir) return
    await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('retries failed multipart parts with a fresh file stream', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'browseros-r2-upload-'))
    const filePath = path.join(dir, 'large.tar.gz')
    await writeFile(filePath, new Uint8Array(6 * 1024 * 1024))
    const client = new FakeS3Client()

    await putFile(
      client as unknown as S3Client,
      'bucket',
      'vm/images/large.tar.gz',
      filePath,
      'application/gzip',
      {
        multipartThresholdBytes: 1,
        partSizeBytes: 5 * 1024 * 1024,
        retryDelayMs: 0,
      },
    )

    const uploadParts = client.commands.filter(
      ({ name }) => name === 'UploadPartCommand',
    )
    expect(uploadParts.map(({ input }) => input.PartNumber)).toEqual([1, 1, 2])
    expect(uploadParts[0].input.Body).not.toBe(uploadParts[1].input.Body)
    expect(
      client.commands.find(
        ({ name }) => name === 'CompleteMultipartUploadCommand',
      )?.input.MultipartUpload,
    ).toEqual({
      Parts: [
        { ETag: 'etag-1', PartNumber: 1 },
        { ETag: 'etag-2', PartNumber: 2 },
      ],
    })
  })

  it('retries failed put-object uploads with a fresh file stream', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'browseros-r2-upload-'))
    const filePath = path.join(dir, 'small.tar.gz')
    await writeFile(filePath, 'small tarball')
    const client = new FakeS3Client()

    await putFile(
      client as unknown as S3Client,
      'bucket',
      'vm/images/small.tar.gz',
      filePath,
      'application/gzip',
      { retryDelayMs: 0 },
    )

    const putObjects = client.commands.filter(
      ({ name }) => name === 'PutObjectCommand',
    )
    expect(putObjects).toHaveLength(2)
    expect(putObjects[0].input.Body).not.toBe(putObjects[1].input.Body)
  })
})
