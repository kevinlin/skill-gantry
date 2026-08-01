import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeAsset {
  name: string
  body: Buffer
}

export interface FakeRelease {
  repo: string
  tag: string
  assets: readonly FakeAsset[]
}

export interface FakeReleaseHandle {
  apiBase: string
  close: () => Promise<void>
}

export const sha256 = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

/**
 * Serves the two endpoints the driver uses — the release-by-tag JSON and each
 * asset's download URL — so integrity and extraction are testable offline.
 */
export async function startFakeRelease(release: FakeRelease): Promise<FakeReleaseHandle> {
  let base = ''
  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === `/repos/${release.repo}/releases/tags/${release.tag}`) {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          tag_name: release.tag,
          assets: release.assets.map((asset) => ({
            name: asset.name,
            browser_download_url: `${base}/download/${asset.name}`,
          })),
        }),
      )
      return
    }
    const asset = release.assets.find((a) => url === `/download/${a.name}`)
    if (asset) {
      res.setHeader('content-type', 'application/octet-stream')
      res.end(asset.body)
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
  return {
    apiBase: base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
