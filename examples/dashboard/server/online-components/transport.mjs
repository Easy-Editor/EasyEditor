import https from 'node:https'

import { OnlineComponentDependencyError } from './errors.mjs'

export const requestOnlineComponentResource = ({ url, headers, signal, lookup, maxBytes, kind }) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers,
        lookup,
        signal,
        autoSelectFamily: false,
        servername: url.hostname,
      },
      response => {
        const chunks = []
        let bytes = 0
        response.on('data', chunk => {
          bytes += chunk.length
          if (bytes > maxBytes) {
            request.destroy(
              new OnlineComponentDependencyError(
                'upstream-response-invalid',
                502,
                `${kind} response exceeded its byte limit`,
              ),
            )
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 502,
            headers: response.headers,
            body: Buffer.concat(chunks),
            url: url.href,
            remoteAddress: response.socket.remoteAddress,
          }),
        )
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    request.end()
  })
